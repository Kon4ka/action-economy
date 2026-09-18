/**
 * Виджет в шапке листа персонажа и ручное управление ресурсами.
 *
 * Точка вставки подтверждена диагностикой на реальном листе:
 *   header.sheet-header > .right > div > .sheet-header-buttons (кнопки отдыха)
 * Виджет становится первым элементом этого ряда, но сам ничего в нём не занимает:
 * обёртка нулевой ширины, а список вынесен из потока и растёт влево и вверх.
 * Иначе длинные пулы расталкивали бы кнопки отдыха и наезжали на подпись опыта.
 */

import { MODULE_ID, POOLS, TRACKED_POOLS, canEdit, getMax, getPoolState, isTracked, resetPools, setSpent }
  from "./state.mjs";
import { visiblePools } from "./settings.mjs";

const WIDGET_CLASS = "action-economy-tracker";

/** Свой генератор диапазона: глобальные расширения ядра между версиями переезжают. */
const range = count => Array.from({ length: count }, (_, index) => index);

/** Названия предметов попадают в атрибуты, поэтому экранируем. */
const escapeHtml = value => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Значок ресурса: либо шрифтовой значок, либо свой рисунок (концентрация). */
function iconMarkup(pool, tooltip) {
  const tip = ` data-tooltip="${escapeHtml(tooltip)}"`;
  if ( !POOLS[pool].glyph ) return `<i class="ae-icon ${POOLS[pool].icon}"${tip}></i>`;
  return `<svg class="ae-icon ae-glyph" viewBox="0 0 24 24"${tip} fill="none" stroke="currentColor"`
    + ` stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${POOLS[pool].glyph}</svg>`;
}

/**
 * Подсказки для точек концентрации: на занятых — что именно держит персонаж.
 * Работает всегда, ручной режим на это не влияет: концентрацию ведёт система.
 */
function concentrationTooltips(actor, max) {
  const effects = [...(actor.concentration?.effects ?? [])];
  const first = max - effects.length;
  return range(max).map(index => {
    const effect = effects[index - first];
    if ( !effect ) return game.i18n.localize("ACTION_ECONOMY.Concentration.free");
    const link = effect.getFlag("dnd5e", "item");
    const name = (link ? actor.items.get(link.id)?.name : null) ?? effect.name;
    return game.i18n.format("ACTION_ECONOMY.Concentration.holding", { name });
  });
}

/* -------------------------------------------- */
/*  Отрисовка                                   */
/* -------------------------------------------- */

// Ошибки внутри хука отрисовки Foundry не показывает, поэтому сообщаем сами — один раз.
let reported = false;

function report(message, payload) {
  console.warn(`${MODULE_ID} |`, message, payload ?? "");
  if ( reported ) return;
  reported = true;
  ui.notifications.warn(`${game.i18n.localize("ACTION_ECONOMY.Override.menu")}: ${message}`);
}

/** Хук отрисовки листа персонажа. */
export function onRenderSheet(app, element, context, options) {
  try {
    injectWidget(app, element);
  } catch(err) {
    console.error(`${MODULE_ID} | ошибка вставки виджета`, err);
    if ( !reported ) {
      reported = true;
      ui.notifications.error(`${game.i18n.localize("ACTION_ECONOMY.Override.menu")}: ${err.message}`);
    }
  }
}

function injectWidget(app, element) {
  const actor = app?.document ?? app?.actor;
  if ( !isTracked(actor) ) return;

  const raw = element ?? app.element;
  const root = (raw instanceof HTMLElement) ? raw : (raw?.[0] ?? null);
  if ( !root?.querySelector ) return;

  // Частичная перерисовка ApplicationV2 может оставить прежний блок — убираем его всегда.
  root.querySelectorAll(`.${WIDGET_CLASS}`).forEach(node => node.remove());

  const pools = visiblePools();
  if ( !pools.length ) return;

  const anchor = root.querySelector(".sheet-header-buttons")
    ?? root.querySelector("header.sheet-header .right > div")
    ?? root.querySelector("header.sheet-header .right");
  if ( !anchor ) {
    // На сторонних листах (Tidy5e и подобные) нашей шапки просто нет — это не поломка,
    // поэтому беспокоим уведомлением только на штатном листе D&D5e.
    const message = "не нашёл в шапке листа, куда вставить виджет";
    if ( root.classList.contains("dnd5e2") ) return report(message, { actor: actor.name });
    console.debug(`${MODULE_ID} | ${message}: сторонний лист ${app?.constructor?.name}`);
    return;
  }

  const widget = buildWidget(actor, pools);
  if ( anchor.classList.contains("sheet-header-buttons") ) anchor.prepend(widget);
  else anchor.insertAdjacentElement("afterbegin", widget);

  widget.addEventListener("click", event => onClick(event, actor));
  widget.addEventListener("contextmenu", event => {
    event.preventDefault();
    openOverrideDialog(actor).catch(err => console.error(`${MODULE_ID} | диалог не открылся`, err));
  });
}

function buildWidget(actor, pools) {
  const widget = document.createElement("div");
  widget.classList.add(WIDGET_CLASS);
  widget.dataset.actorId = actor.id;
  widget.dataset.tooltipDirection = "LEFT";

  const list = document.createElement("div");
  list.classList.add("ae-list");
  widget.append(list);

  for ( const pool of pools ) {
    const { max, spent } = getPoolState(actor, pool);
    if ( max <= 0 ) continue;

    const label = game.i18n.localize(POOLS[pool].label);
    const row = document.createElement("div");
    row.classList.add("ae-row", `ae-${pool}`);
    row.dataset.pool = pool;

    // Тратится справа налево: чёрными становятся последние точки.
    const tooltips = (pool === "concentration") ? concentrationTooltips(actor, max) : null;
    const dots = range(max).map(index => {
      const used = index >= (max - spent);
      const tooltip = tooltips?.[index];
      return `<span class="ae-dot${used ? " spent" : ""}" data-index="${index}"`
        + `${tooltip ? ` data-tooltip="${escapeHtml(tooltip)}"` : ""}></span>`;
    }).join("");

    row.innerHTML = `${iconMarkup(pool, `${label}: ${max - spent}/${max}`)}<span class="ae-dots">${dots}</span>`;
    list.append(row);
  }
  return widget;
}

/* -------------------------------------------- */
/*  Клики                                       */
/* -------------------------------------------- */

async function onClick(event, actor) {
  try {
    const row = event.target.closest(".ae-row");
    if ( !row ) return;
    const pool = row.dataset.pool;

    if ( !canEdit(actor) ) return ui.notifications.warn(game.i18n.localize("ACTION_ECONOMY.Notify.noPermission"));

    // Клик по значку — полностью восстановить пул.
    if ( event.target.closest(".ae-icon") ) {
      if ( pool === "concentration" ) return;
      return await resetPools(actor, [pool]);
    }

    const dot = event.target.closest(".ae-dot");
    if ( !dot ) return;

    if ( pool === "concentration" ) return await endConcentration(actor, Number(dot.dataset.index));

    // По занятой точке — вернуть одну единицу, по свободной — потратить одну.
    const { spent } = getPoolState(actor, pool);
    const used = dot.classList.contains("spent");
    await setSpent(actor, pool, used ? spent - 1 : spent + 1);
  } catch(err) {
    console.error(`${MODULE_ID} | не удалось изменить ресурс`, err);
    ui.notifications.error(`${game.i18n.localize("ACTION_ECONOMY.Override.menu")}: ${err.message}`);
  }
}

/** Снять конкретную концентрацию: тратами концентрации управляет система. */
async function endConcentration(actor, index) {
  // Точки тратятся справа, поэтому закрашенные — последние. Первая закрашенная точка
  // соответствует первому эффекту концентрации.
  const effects = [...(actor.concentration?.effects ?? [])];
  const { max } = getPoolState(actor, "concentration");
  const effect = effects[index - (max - effects.length)];
  if ( !effect ) return;

  const proceed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("ACTION_ECONOMY.Concentration.title") },
    content: `<p>${game.i18n.format("ACTION_ECONOMY.Concentration.end", { name: effect.name })}</p>`,
    modal: true
  });
  if ( proceed ) await actor.endConcentration(effect);
}

/* -------------------------------------------- */
/*  Жёсткий оверрайд                            */
/* -------------------------------------------- */

/** Пункт в меню листа (три точки в шапке). */
export function onGetHeaderControls(app, controls) {
  const actor = app?.document ?? app?.actor;
  if ( !Array.isArray(controls) || !isTracked(actor) || !canEdit(actor) ) return;
  if ( controls.some(c => c.action === "actionEconomyOverride") ) return;
  controls.push({
    icon: "fa-solid fa-circle-half-stroke",
    label: "ACTION_ECONOMY.Override.menu",
    action: "actionEconomyOverride",
    onClick: () => openOverrideDialog(actor)
  });
}

/**
 * Диалог количества ресурсов для одного персонажа. Пустое поле — считать по эффектам,
 * число — жёстко задать. Предел концентрации тут же, но он пишется в штатное поле
 * системы `system.attributes.concentration.limit`, а не в флаг модуля.
 */
export async function openOverrideDialog(actor) {
  if ( !canEdit(actor) ) return;

  const rows = TRACKED_POOLS.map(pool => {
    const override = actor.getFlag(MODULE_ID, `override.${pool}`);
    const value = Number.isFinite(override) ? override : "";
    return `
      <div class="form-group">
        <label>${game.i18n.localize(POOLS[pool].label)}</label>
        <div class="form-fields">
          <input type="number" name="${pool}" value="${value}" min="0" step="1"
                 placeholder="${game.i18n.format("ACTION_ECONOMY.Override.auto", { value: getMax(actor, pool) })}">
        </div>
      </div>`;
  }).join("");

  // Предел концентрации — штатное поле системы, правим его источник, а не свой флаг.
  // D&D5e держит несколько концентраций сама: старую снимает только когда лимит исчерпан.
  const concentrationSource = foundry.utils.getProperty(actor._source, "system.attributes.concentration.limit") ?? 1;
  const concentrationRow = `
    <div class="form-group">
      <label>${game.i18n.localize("ACTION_ECONOMY.Pool.concentration")}</label>
      <div class="form-fields">
        <input type="number" name="concentrationLimit" value="${concentrationSource}" min="0" step="1">
      </div>
      <p class="hint">${game.i18n.format("ACTION_ECONOMY.Override.concentrationHint", {
        value: getMax(actor, "concentration")
      })}</p>
    </div>`;

  const content = `<p class="hint">${game.i18n.localize("ACTION_ECONOMY.Override.hint")}</p>${rows}${concentrationRow}`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize("ACTION_ECONOMY.Override.menu")}: ${actor.name}` },
    position: { width: 460 },
    // Прокручивается только содержимое: иначе кнопка сохранения уезжает за нижний край окна.
    content: `<div style="max-height:50vh;overflow-y:auto;padding-right:8px;">${content}</div>`,
    ok: {
      label: game.i18n.localize("ACTION_ECONOMY.Override.save"),
      // Читаем поля напрямую: FormDataExtended зависит от того, завернул ли диалог
      // содержимое в form, и при промахе роняет весь обработчик без следов.
      callback: (event, button) => {
        const root = button.closest("form") ?? button.closest(".application") ?? button.ownerDocument;
        const number = name => {
          const raw = root.querySelector(`[name="${name}"]`)?.value?.trim();
          return ((raw === "") || (raw === undefined) || Number.isNaN(Number(raw)))
            ? null : Math.max(0, Math.floor(Number(raw)));
        };
        return {
          ...Object.fromEntries(TRACKED_POOLS.map(pool => [pool, number(pool)])),
          concentrationLimit: number("concentrationLimit")
        };
      }
    },
    rejectClose: false
  });
  if ( !result ) return;

  const update = {};
  for ( const pool of TRACKED_POOLS ) update[`flags.${MODULE_ID}.override.${pool}`] = result[pool] ?? null;
  if ( (result.concentrationLimit !== null) && (result.concentrationLimit !== concentrationSource) ) {
    update["system.attributes.concentration.limit"] = result.concentrationLimit;
  }

  try {
    await actor.update(update);
    ui.notifications.info(game.i18n.localize("ACTION_ECONOMY.Override.saved"));
  } catch(err) {
    console.error(`${MODULE_ID} | не удалось сохранить количество ресурсов`, err);
    ui.notifications.error(`${game.i18n.localize("ACTION_ECONOMY.Override.menu")}: ${err.message}`);
  }
}
