/**
 * Экономия действий — автономная версия одним макросом, для проверки без установки модуля.
 *
 * Что делает: то же, что модуль, — виджет в шапке листа персонажа, списание основного,
 * бонусного действия и реакции при использовании способностей, вопрос при нехватке,
 * сброс в начале хода и по концу боя, ручные клики, жёсткий оверрайд.
 *
 * Отличия от модуля:
 *   - работает только у того, кто запустил макрос, и только до перезагрузки страницы (F5);
 *   - настройки не в интерфейсе Foundry, а константами в самом начале макроса;
 *   - у остальных игроков ничего не меняется, пока они не запустят макрос у себя.
 *
 * Виджет по умолчанию не показывается никому. Включается в меню листа под тремя точками:
 * «показывать у меня» — лично для этого пользователя на всех листах, «показывать у этого
 * персонажа» — для всех на этом листе. Достаточно любого из двух.
 *
 * Как пользоваться: запустить макрос — включится (появится уведомление). Запустить ещё раз —
 * выключится и уберёт виджет. После F5 запустить заново.
 *
 * Флаги и ключи эффектов те же, что у модуля, поэтому накопленное состояние и созданные
 * эффекты не пропадут при переходе на модуль. Перед включением модуля макрос надо выключить,
 * иначе ресурсы будут списываться дважды.
 */

(() => {
  /* ==========================================================================
     Настройки. Правятся прямо здесь.
     ========================================================================== */
  const SETTINGS = {
    // true — ничего не списывать автоматически, только ручные клики.
    manualMode: false,
    // Что делать, когда ресурса не осталось: "confirm" | "notify" | "none".
    shortage: "confirm",
    // Списывать ли ресурсы вне боя.
    trackOutOfCombat: true,
    // Какие строки показывать.
    show: { action: true, bonus: true, free: true, reaction: true, concentration: true }
  };

  /* ========================================================================== */

  const MODULE_ID = "action-economy";
  const KEY = "__actionEconomyMacro";
  const WIDGET_CLASS = "action-economy-tracker";
  const STYLE_ID = "action-economy-macro-style";

  const POOLS = {
    action: { icon: "fa-solid fa-circle", label: "Основное действие", color: "#57d07a" },
    bonus: { icon: "fa-solid fa-play", label: "Бонусное действие", color: "#e8813a" },
    free: { icon: "fa-solid fa-droplet", label: "Свободное действие", color: "#3ba7e8" },
    reaction: { icon: "fa-solid fa-arrow-rotate-left", label: "Реакция", color: "#2fd8c2" },
    concentration: { glyph: true, label: "Концентрация", color: "#e0489b", system: true }
  };

  // Значок концентрации: кольцо с тремя штрихами. В бесплатном Font Awesome такого нет.
  const CONCENTRATION_GLYPH = '<circle cx="12" cy="9" r="7"/><path d="M12 11.5V22.5"/>'
    + '<path d="M7.7 12.8 3.8 22.3"/><path d="M16.3 12.8 20.2 22.3"/>';
  const TRACKED_POOLS = ["action", "bonus", "free", "reaction"];
  const ACTIVATION_TO_POOL = { action: "action", bonus: "bonus", reaction: "reaction" };
  const BASE = 1;

  // Хук уровня ядра: ApplicationV2 вызывает хуки для всей цепочки классов, поэтому базового
  // имени достаточно и оно переживает переименования листов в D&D5e. Раньше тут был список
  // из шести имён — виджет собирался по шесть раз на каждую перерисовку.
  const RENDER_HOOKS = ["renderActorSheetV2", "renderActorSheet"];

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const range = count => Array.from({ length: count }, (_, index) => index);

  /** Названия предметов попадают в атрибуты, поэтому экранируем. */
  const escapeHtml = value => String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /**
   * Подсказки для точек концентрации: на занятых — что именно держит персонаж.
   * Ручной режим на это не влияет, концентрацию ведёт система.
   */
  function concentrationTooltips(actor, max) {
    const effects = [...(actor.concentration?.effects ?? [])];
    const first = max - effects.length;
    return range(max).map(index => {
      const effect = effects[index - first];
      if ( !effect ) return "Свободная концентрация";
      const link = effect.getFlag("dnd5e", "item");
      const name = (link ? actor.items.get(link.id)?.name : null) ?? effect.name;
      return `${name} — клик, чтобы снять`;
    });
  }

  // Общие настройки стараемся сохранить в мире, чтобы они пережили перезагрузку страницы.
  // Если не выйдет — работают значения, заданные выше, до конца сеанса.
  let persisted = false;
  const SETTINGS_KEY = `${MODULE_ID}.macroSettings`;

  function loadSettings() {
    try {
      if ( !game.settings.settings.has(SETTINGS_KEY) ) {
        game.settings.register(MODULE_ID, "macroSettings", {
          scope: "world", config: false, type: Object, default: {}
        });
      }
      const stored = game.settings.get(MODULE_ID, "macroSettings");
      if ( stored && (typeof stored === "object") ) foundry.utils.mergeObject(SETTINGS, stored, { inplace: true });
      return true;
    } catch(err) {
      console.warn("Экономия действий: настройки не сохраняются между перезагрузками", err);
      return false;
    }
  }

  async function saveSettings() {
    if ( !persisted ) return false;
    try {
      await game.settings.set(MODULE_ID, "macroSettings", SETTINGS);
      return true;
    } catch(err) {
      console.warn("Экономия действий: не удалось сохранить настройки", err);
      ui.notifications.warn("Экономия действий: настройки применены, но сохранить их не вышло — их меняет мастер.");
      return false;
    }
  }

  // Личный показ виджета: у модуля это клиентская настройка, здесь — localStorage,
  // чтобы выбор был свой у каждого пользователя и переживал перезагрузку страницы.
  const FOR_ME_KEY = `${MODULE_ID}.showForMe`;
  const showsForMe = () => {
    try { return localStorage.getItem(FOR_ME_KEY) === "1"; } catch { return false; }
  };
  const setShowsForMe = value => {
    try { localStorage.setItem(FOR_ME_KEY, value ? "1" : "0"); } catch { /* приватный режим */ }
  };

  // getFlag и setFlag требуют, чтобы scope был активным модулем, а модуль не установлен.
  // Поэтому читаем флаги напрямую, а пишем через update: там проверки scope нет.
  const readFlag = (actor, path) => foundry.utils.getProperty(actor?.flags?.[MODULE_ID] ?? {}, path);
  const writeFlags = (actor, data) => actor.update(Object.fromEntries(
    Object.entries(data).map(([path, value]) => [`flags.${MODULE_ID}.${path}`, value])
  ));

  /* ==========================================================================
     Выключение
     ========================================================================== */

  if ( globalThis[KEY] ) {
    for ( const [hook, id] of globalThis[KEY].hooks ) Hooks.off(hook, id);
    document.getElementById(STYLE_ID)?.remove();
    document.querySelectorAll(`.${WIDGET_CLASS}`).forEach(node => node.remove());
    delete globalThis[KEY];
    return ui.notifications.info("Экономия действий: выключено.");
  }

  /* ==========================================================================
     Расчёты
     ========================================================================== */

  const isTracked = actor => actor?.type === "character";

  function getMax(actor, pool) {
    if ( POOLS[pool]?.system ) return actor.system?.attributes?.concentration?.limit ?? 0;

    const override = readFlag(actor, `override.${pool}`);
    if ( Number.isFinite(override) ) return Math.max(0, override);

    const key = `flags.${MODULE_ID}.max.${pool}`;
    const changes = [];
    for ( const effect of actor.appliedEffects ) {
      for ( const change of effect.changes ) {
        if ( change.key === key ) changes.push({ ...change, priority: change.priority ?? (change.mode * 10) });
      }
    }
    changes.sort((a, b) => a.priority - b.priority);

    const MODES = CONST.ACTIVE_EFFECT_MODES;
    let value = BASE;
    for ( const change of changes ) {
      const delta = Number(change.value);
      if ( !Number.isFinite(delta) ) continue;
      switch ( change.mode ) {
        case MODES.ADD: value += delta; break;
        case MODES.MULTIPLY: value *= delta; break;
        case MODES.UPGRADE: value = Math.max(value, delta); break;
        case MODES.DOWNGRADE: value = Math.min(value, delta); break;
        case MODES.OVERRIDE:
        case MODES.CUSTOM: value = delta; break;
      }
    }
    return Math.max(0, Math.floor(value));
  }

  /**
   * Эффекты, обнулившие пул. Отдельного механизма блокировки нет и не нужно: эффект
   * с ключом пула, режимом «Переопределить» и значением 0 запрещает пул, пока висит,
   * а когда кончится — пул вернётся сам, максимум считается заново при каждой отрисовке.
   */
  function blockingEffects(actor, pool) {
    if ( POOLS[pool]?.system ) return [];
    const key = `flags.${MODULE_ID}.max.${pool}`;
    const MODES = CONST.ACTIVE_EFFECT_MODES;
    const names = [];
    for ( const effect of actor.appliedEffects ) {
      for ( const change of effect.changes ) {
        if ( change.key !== key ) continue;
        const blocks = [MODES.OVERRIDE, MODES.DOWNGRADE, MODES.CUSTOM, MODES.MULTIPLY].includes(change.mode);
        if ( blocks && (Number(change.value) === 0) ) names.push(effect.name);
      }
    }
    return names;
  }

  function getSpent(actor, pool) {
    if ( pool === "concentration" ) return actor.concentration?.effects?.size ?? 0;
    return Math.max(0, Math.floor(Number(readFlag(actor, `spent.${pool}`) ?? 0) || 0));
  }

  function getPoolState(actor, pool) {
    const max = getMax(actor, pool);
    const spent = Math.min(getSpent(actor, pool), Math.max(max, 0));
    return { max, spent, available: Math.max(0, max - spent) };
  }

  async function setSpent(actor, pool, value) {
    if ( !TRACKED_POOLS.includes(pool) || !actor.isOwner ) return false;
    const next = clamp(Math.floor(value), 0, getMax(actor, pool));
    if ( next === getSpent(actor, pool) ) return false;
    await writeFlags(actor, { [`spent.${pool}`]: next });
    return true;
  }

  async function resetPools(actor, pools = TRACKED_POOLS) {
    if ( !actor.isOwner ) return false;
    const update = {};
    for ( const pool of pools ) {
      if ( getSpent(actor, pool) > 0 ) update[`spent.${pool}`] = 0;
    }
    if ( foundry.utils.isEmpty(update) ) return false;
    await writeFlags(actor, update);
    return true;
  }

  const isInCombat = actor => !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.actor?.id === actor?.id));

  function shouldTrack(actor) {
    if ( !isTracked(actor) || !actor.isOwner ) return false;
    if ( !SETTINGS.trackOutOfCombat && !isInCombat(actor) ) return false;
    return true;
  }

  /* ==========================================================================
     Виджет
     ========================================================================== */

  function injectStyle() {
    if ( document.getElementById(STYLE_ID) ) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Столбик из пяти строк выше ряда кнопок отдыха (30 px), поэтому сам список вынесен
         из потока и растёт вверх, в пустую часть шапки. В потоке остаётся только обёртка
         нужной ширины — так столбик не наезжает на подпись опыта. */
      .${WIDGET_CLASS} { position: relative; align-self: stretch; width: 0; min-width: 0; line-height: 1; }
      .${WIDGET_CLASS} .ae-list { position: absolute; bottom: -12px; right: 10px; width: max-content;
        display: flex; flex-direction: column; gap: 5px; }
      .${WIDGET_CLASS} .ae-row { display: flex; align-items: center; gap: 4px; cursor: pointer; }
      .${WIDGET_CLASS} .ae-icon { width: 11px; text-align: center; font-size: 9px; color: var(--ae-color);
        filter: drop-shadow(0 0 2px rgba(0,0,0,.8)); }
      .${WIDGET_CLASS} svg.ae-glyph { width: 11px; height: 12px; overflow: visible; }
      /* Пул, обнулённый эффектом. */
      .${WIDGET_CLASS} .ae-row.blocked { cursor: default; }
      .${WIDGET_CLASS} .ae-row.blocked .ae-icon { opacity: .4; }
      .${WIDGET_CLASS} .ae-blocked { font-size: 8px; color: var(--ae-color); opacity: .75;
        filter: drop-shadow(0 0 2px rgba(0,0,0,.8)); }
      /* Ширина ряда точек фиксирована под пять штук, лишние переносятся на новую строку:
         так длинные пулы не растягивают виджет вбок. */
      .${WIDGET_CLASS} .ae-dots { display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
        width: 66px; }
      /* Точка — чёрное гнездо, которое видно всегда, и цветной огонёк внутри него. */
      .${WIDGET_CLASS} .ae-dot { display: grid; place-items: center; width: 9px; height: 9px;
        border-radius: 50%; background: #000; box-sizing: border-box;
        box-shadow: inset 0 0 0 1px #000, 0 0 2px rgba(0,0,0,.9); }
      .${WIDGET_CLASS} .ae-dot::after { content: ""; width: 5px; height: 5px; border-radius: 50%;
        background: var(--ae-color); transition: opacity 120ms ease; }
      .${WIDGET_CLASS} .ae-dot.spent::after { opacity: 0; }
      /* Подсветка от начала строки до точки под курсором. */
      .${WIDGET_CLASS} .ae-dot:hover,
      .${WIDGET_CLASS} .ae-dot:has(~ .ae-dot:hover) { outline: 1px solid rgba(255,255,255,.5); }
      .${WIDGET_CLASS} .ae-bonus .ae-icon { transform: rotate(-90deg); }
      .dnd5e2.sheet .sheet-header-buttons:has(.${WIDGET_CLASS}) { align-items: center; }
    `;
    document.head.append(style);
  }

  // Ошибки внутри хука отрисовки Foundry молча глотает, поэтому показываем их сами — один раз.
  let reported = false;
  function report(message, payload) {
    console.warn("Экономия действий:", message, payload ?? "");
    if ( reported ) return;
    reported = true;
    ui.notifications.warn(`Экономия действий: ${message}. Подробности в консоли (F12).`);
  }

  function renderWidget(app, element) {
    try {
      return injectWidget(app, element);
    } catch(err) {
      console.error("Экономия действий: ошибка вставки виджета", err);
      if ( !reported ) {
        reported = true;
        ui.notifications.error(`Экономия действий: ошибка вставки — ${err.message}. Подробности в консоли (F12).`);
      }
      return false;
    }
  }

  function injectWidget(app, element) {
    const actor = app?.document ?? app?.actor;
    if ( !isTracked(actor) ) return false;
    const raw = element ?? app.element;
    const root = (raw instanceof HTMLElement) ? raw : (raw?.[0] ?? null);
    if ( !root?.querySelector ) return false;

    root.querySelectorAll(`.${WIDGET_CLASS}`).forEach(node => node.remove());

    // По умолчанию трекера нет ни у кого: он появляется, если включён для этого персонажа
    // либо лично для этого пользователя — достаточно одного из двух.
    if ( (readFlag(actor, "enabled") !== true) && !showsForMe() ) return false;

    const pools = Object.keys(POOLS).filter(pool => SETTINGS.show[pool]);
    if ( !pools.length ) return false;

    const anchor = root.querySelector(".sheet-header-buttons")
      ?? root.querySelector("header.sheet-header .right > div")
      ?? root.querySelector("header.sheet-header .right");
    if ( !anchor ) {
      report("не нашёл в шапке листа, куда вставить виджет", { actor: actor.name, root });
      return false;
    }

    const widget = document.createElement("div");
    widget.classList.add(WIDGET_CLASS);
    const list = document.createElement("div");
    list.classList.add("ae-list");
    widget.append(list);

    for ( const pool of pools ) {
      const { max, spent } = getPoolState(actor, pool);
      const row = document.createElement("div");
      row.classList.add("ae-row", `ae-${pool}`);
      row.dataset.pool = pool;
      row.style.setProperty("--ae-color", POOLS[pool].color);

      // Пул обнулён эффектом — показываем, что он недоступен, а не прячем строку.
      if ( max <= 0 ) {
        const blocking = blockingEffects(actor, pool);
        const tooltip = escapeHtml(blocking.length
          ? `${POOLS[pool].label}: недоступно — ${blocking.join(", ")}`
          : `${POOLS[pool].label}: сейчас недоступно`);
        row.classList.add("blocked");
        row.innerHTML = (POOLS[pool].glyph
          ? `<svg class="ae-icon ae-glyph" viewBox="0 0 24 24" data-tooltip="${tooltip}" fill="none"`
            + ` stroke="currentColor" stroke-width="2.2" stroke-linecap="round"`
            + ` stroke-linejoin="round">${CONCENTRATION_GLYPH}</svg>`
          : `<i class="ae-icon ${POOLS[pool].icon}" data-tooltip="${tooltip}"></i>`)
          + `<i class="ae-blocked fa-solid fa-ban" data-tooltip="${tooltip}"></i>`;
        list.append(row);
        continue;
      }
      // Тратится справа налево: чёрными становятся последние точки.
      // На точках концентрации подсказка говорит, что именно держит персонаж.
      const tooltips = (pool === "concentration") ? concentrationTooltips(actor, max) : null;
      const dots = range(max).map(i => {
        const tooltip = tooltips?.[i];
        return `<span class="ae-dot${i >= (max - spent) ? " spent" : ""}" data-index="${i}"`
          + `${tooltip ? ` data-tooltip="${escapeHtml(tooltip)}"` : ""}></span>`;
      }).join("");
      const tip = escapeHtml(`${POOLS[pool].label}: ${max - spent}/${max}`);
      const icon = POOLS[pool].glyph
        ? `<svg class="ae-icon ae-glyph" viewBox="0 0 24 24" data-tooltip="${tip}" fill="none"`
          + ` stroke="currentColor" stroke-width="2.2" stroke-linecap="round"`
          + ` stroke-linejoin="round">${CONCENTRATION_GLYPH}</svg>`
        : `<i class="ae-icon ${POOLS[pool].icon}" data-tooltip="${tip}"></i>`;
      row.innerHTML = `${icon}<span class="ae-dots">${dots}</span>`;
      list.append(row);
    }

    if ( anchor.classList.contains("sheet-header-buttons") ) anchor.prepend(widget);
    else anchor.insertAdjacentElement("afterbegin", widget);

    widget.addEventListener("click", event => onClick(event, actor));
    widget.addEventListener("contextmenu", event => {
      event.preventDefault();
      openSettingsDialog(actor);
    });
    return true;
  }

  async function onClick(event, actor) {
    const row = event.target.closest(".ae-row");
    if ( !row ) return;
    const pool = row.dataset.pool;
    if ( !actor.isOwner ) return ui.notifications.warn("Нет прав на изменение этого листа.");

    if ( event.target.closest(".ae-icon") ) {
      if ( pool === "concentration" ) return;
      return resetPools(actor, [pool]);
    }

    const dot = event.target.closest(".ae-dot");
    if ( !dot ) return;

    if ( pool === "concentration" ) {
      // Точки тратятся справа, поэтому закрашенные — последние. Первая закрашенная точка
      // соответствует первому эффекту концентрации.
      const effects = [...(actor.concentration?.effects ?? [])];
      const { max } = getPoolState(actor, "concentration");
      const effect = effects[Number(dot.dataset.index) - (max - effects.length)];
      if ( !effect ) return;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Снять концентрацию" },
        content: `<p>Прекратить концентрацию: ${effect.name}?</p>`,
        modal: true
      });
      if ( ok ) await actor.endConcentration(effect);
      return;
    }

    const { spent } = getPoolState(actor, pool);
    await setSpent(actor, pool, dot.classList.contains("spent") ? spent - 1 : spent + 1);
  }

  /** Пункты меню листа (три точки): два выключателя показа и настройки. */
  function onGetHeaderControls(app, controls) {
    const actor = app?.document ?? app?.actor;
    if ( !Array.isArray(controls) || !isTracked(actor) ) return;
    if ( controls.some(control => control.action === "actionEconomyToggleUser") ) return;

    const forMe = showsForMe();
    controls.push({
      icon: forMe ? "fa-solid fa-eye-slash" : "fa-solid fa-eye",
      label: forMe ? "Экономия действий: скрыть у меня" : "Экономия действий: показывать у меня",
      action: "actionEconomyToggleUser",
      onClick: () => {
        setShowsForMe(!forMe);
        refreshSheets();
      }
    });

    if ( !actor.isOwner ) return;

    const forActor = readFlag(actor, "enabled") === true;
    controls.push({
      icon: forActor ? "fa-solid fa-user-slash" : "fa-solid fa-user-check",
      label: forActor
        ? "Экономия действий: скрыть у этого персонажа"
        : "Экономия действий: показывать у этого персонажа",
      action: "actionEconomyToggleActor",
      onClick: () => writeFlags(actor, { enabled: !forActor })
        .catch(err => console.error("Экономия действий: переключение не удалось", err))
    });

    controls.push({
      icon: "fa-solid fa-circle-half-stroke",
      label: "Экономия действий",
      action: "actionEconomySettings",
      onClick: () => openSettingsDialog(actor)
    });
  }

  /** Перерисовать открытые листы персонажей. */
  function refreshSheets() {
    for ( const actor of game.actors ) {
      if ( actor.sheet?.rendered ) actor.sheet.render(false);
    }
  }

  /** Настройки макроса и жёсткий оверрайд для конкретного персонажа в одном окне. */
  async function openSettingsDialog(actor) {
    const canEdit = actor?.isOwner;

    const overrideRows = TRACKED_POOLS.map(pool => {
      const override = readFlag(actor, `override.${pool}`);
      return `<div class="form-group"><label>${POOLS[pool].label}</label><div class="form-fields">
        <input type="number" name="override.${pool}" min="0" step="1"
               value="${Number.isFinite(override) ? override : ""}"
               placeholder="по эффектам: ${getMax(actor, pool)}"></div></div>`;
    }).join("");

    const showRows = Object.entries(POOLS).map(([pool, config]) => `
      <div class="form-group"><label>${config.label}</label><div class="form-fields">
        <input type="checkbox" name="show.${pool}" ${SETTINGS.show[pool] ? "checked" : ""}></div></div>`).join("");

    const shortageOptions = [
      ["confirm", "Предупредить и спросить подтверждение"],
      ["notify", "Только уведомление"],
      ["none", "Ничего не делать"]
    ].map(([value, label]) =>
      `<option value="${value}" ${SETTINGS.shortage === value ? "selected" : ""}>${label}</option>`).join("");

    // Предел концентрации — штатное поле системы, поэтому правим его источник, а не свой флаг.
    // D&D5e держит несколько концентраций сама: старую снимает только когда лимит исчерпан.
    const concentrationSource = foundry.utils.getProperty(actor._source, "system.attributes.concentration.limit") ?? 1;
    const concentrationTotal = actor.system?.attributes?.concentration?.limit ?? 1;
    const concentrationRow = `
      <div class="form-group"><label>Концентрация</label><div class="form-fields">
        <input type="number" name="concentrationLimit" min="0" step="1" value="${concentrationSource}"></div>
        <p class="hint">Штатное поле D&amp;D5e, система сама удержит столько концентраций.
          Сейчас с учётом эффектов: ${concentrationTotal}.</p></div>`;

    const content = `
      <h3>Этот персонаж: ${actor.name}</h3>
      <p class="hint">Жёсткое количество ресурсов. Пустое поле — считать по эффектам.</p>
      ${overrideRows}
      ${concentrationRow}
      <hr>
      <h3>Общие настройки</h3>
      <div class="form-group"><label>Ручной режим</label><div class="form-fields">
        <input type="checkbox" name="manualMode" ${SETTINGS.manualMode ? "checked" : ""}></div>
        <p class="hint">Ничего не списывать автоматически, только клики.</p></div>
      <div class="form-group"><label>Если ресурса не осталось</label><div class="form-fields">
        <select name="shortage">${shortageOptions}</select></div></div>
      <div class="form-group"><label>Вести учёт вне боя</label><div class="form-fields">
        <input type="checkbox" name="trackOutOfCombat" ${SETTINGS.trackOutOfCombat ? "checked" : ""}></div></div>
      <hr>
      <h3>Что показывать</h3>
      ${showRows}
      <p class="hint">${persisted
        ? "Общие настройки сохраняются в мире."
        : "Общие настройки действуют до перезагрузки страницы: сохранить их не удалось."}</p>`;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Экономия действий", resizable: true },
      position: { width: 480 },
      // Прокручивается только содержимое: иначе кнопка «Сохранить» уезжает за нижний край
      // окна, и закрытие крестиком тихо теряет введённое.
      content: `<div style="max-height:50vh;overflow-y:auto;padding-right:8px;">${content}</div>`,
      ok: {
        label: "Сохранить",
        // Читаем поля прямо из разметки. FormDataExtended зависит от того, завернул ли
        // диалог содержимое в form, и при промахе молча роняет весь обработчик.
        callback: (event, button) => {
          const root = button.closest("form") ?? button.closest(".application") ?? button.ownerDocument;
          const field = name => root.querySelector(`[name="${name}"]`);
          const number = name => {
            const raw = field(name)?.value?.trim();
            return (raw === "" || raw === undefined || Number.isNaN(Number(raw)))
              ? null : Math.max(0, Math.floor(Number(raw)));
          };
          const parsed = {
            override: Object.fromEntries(TRACKED_POOLS.map(pool => [pool, number(`override.${pool}`)])),
            concentrationLimit: number("concentrationLimit"),
            show: Object.fromEntries(Object.keys(POOLS).map(pool => [pool, !!field(`show.${pool}`)?.checked])),
            manualMode: !!field("manualMode")?.checked,
            trackOutOfCombat: !!field("trackOutOfCombat")?.checked,
            shortage: field("shortage")?.value ?? "confirm"
          };
          console.log("Экономия действий: сохраняю", parsed);
          return parsed;
        }
      },
      rejectClose: false
    });
    if ( !result ) return;

    try {
      SETTINGS.manualMode = !!result.manualMode;
      SETTINGS.trackOutOfCombat = !!result.trackOutOfCombat;
      SETTINGS.shortage = result.shortage ?? "confirm";
      for ( const pool of Object.keys(POOLS) ) SETTINGS.show[pool] = !!result.show?.[pool];
      await saveSettings();

      if ( canEdit ) {
        const update = {};
        for ( const pool of TRACKED_POOLS ) update[`override.${pool}`] = result.override?.[pool] ?? null;
        await writeFlags(actor, update);

        const limit = result.concentrationLimit;
        if ( (limit !== null) && (limit !== concentrationSource) ) {
          await actor.update({ "system.attributes.concentration.limit": limit });
        }

        // Проверяем, что запись действительно легла: молчаливая потеря хуже ошибки.
        const lost = TRACKED_POOLS.filter(pool => {
          const expected = update[`override.${pool}`] ?? null;
          const actual = readFlag(actor, `override.${pool}`) ?? null;
          return expected !== actual;
        });
        if ( lost.length ) {
          console.warn("Экономия действий: не сохранилось", { lost, флаги: actor.flags?.[MODULE_ID] });
          ui.notifications.error("Экономия действий: жёсткое количество не сохранилось. "
            + "Запусти probe-storage.js — он покажет, куда мир разрешает писать.");
        }
      }
    } catch(err) {
      console.error("Экономия действий: ошибка сохранения", err);
      return ui.notifications.error(`Экономия действий: не удалось сохранить — ${err.message}`);
    }

    ui.notifications.info("Экономия действий: сохранено.");
    for ( const openActor of game.actors ) {
      if ( openActor.sheet?.rendered ) await openActor.sheet.render(false);
    }
  }

  /* ==========================================================================
     Автоматика
     ========================================================================== */

  const confirmed = new WeakSet();
  const poolFor = activity => ACTIVATION_TO_POOL[activity?.activation?.type] ?? null;
  const actorFor = activity => activity?.actor ?? activity?.item?.actor ?? null;

  function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
    if ( SETTINGS.manualMode || (SETTINGS.shortage === "none") ) return true;
    const actor = actorFor(activity);
    const pool = poolFor(activity);
    if ( !pool || !shouldTrack(actor) ) return true;

    if ( confirmed.has(activity) ) {
      confirmed.delete(activity);
      return true;
    }

    const state = getPoolState(actor, pool);
    if ( state.available > 0 ) return true;

    // Обнулённый эффектом пул — это не «потрачено», а «запрещено».
    const blocking = (state.max <= 0) ? blockingEffects(actor, pool) : [];
    const message = (state.max <= 0)
      ? (blocking.length
        ? `${POOLS[pool].label}: недоступно — ${blocking.join(", ")}.`
        : `${POOLS[pool].label}: сейчас недоступно.`)
      : `${actor.name}: ${POOLS[pool].label} уже потрачено.`;
    ui.notifications.warn(message);
    if ( SETTINGS.shortage === "notify" ) return true;

    // Hooks.call синхронный, диалог тут не дождаться: отменяем, спрашиваем, повторяем.
    (async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Ресурс потрачен" },
        content: `<p>${message}</p><p>Всё равно использовать?</p>`,
        yes: { label: "Использовать" },
        no: { label: "Отмена", default: true },
        modal: true
      });
      if ( !ok ) return;
      confirmed.add(activity);
      try {
        await activity.use(usageConfig, dialogConfig, messageConfig);
      } catch(err) {
        confirmed.delete(activity);
        console.error("Экономия действий: повторное использование не удалось", err);
      }
    })();
    return false;
  }

  function onPostUseActivity(activity) {
    if ( SETTINGS.manualMode ) return;
    const actor = actorFor(activity);
    const pool = poolFor(activity);
    if ( !pool || !shouldTrack(actor) ) return;
    setSpent(actor, pool, getSpent(actor, pool) + 1)
      .catch(err => console.error("Экономия действий: не удалось списать ресурс", err));
  }

  function onUpdateCombat(combat, changed) {
    if ( !("turn" in changed) && !("round" in changed) ) return;
    const actor = combat.combatant?.actor;
    if ( isTracked(actor) && actor.isOwner ) resetPools(actor).catch(console.error);
  }

  function onDeleteCombat(combat) {
    for ( const combatant of combat.combatants ) {
      const actor = combatant.actor;
      if ( isTracked(actor) && actor.isOwner ) resetPools(actor).catch(console.error);
    }
  }

  /** Отдых восстанавливает всё: хук общий для короткого и продолжительного. */
  function onRestCompleted(actor) {
    if ( isTracked(actor) && actor.isOwner ) resetPools(actor).catch(console.error);
  }

  /**
   * Кнопки «Возврат ресурса» и «Расход ресурса» на карточке использования. Своего хука
   * у них нет: система чистит `system.deltas` у сообщения, обратная кнопка их возвращает.
   */
  function onUsageMessageUpdate(message, changed, options, userId) {
    if ( SETTINGS.manualMode || (userId !== game.user.id) ) return;
    if ( !foundry.utils.hasProperty(changed, "system.deltas") ) return;

    const activity = message.system?.activity;
    if ( !activity?.activation ) return;

    const actor = message.system?.actor ?? activity.actor;
    const pool = poolFor(activity);
    if ( !pool || !shouldTrack(actor) ) return;

    const refunded = foundry.utils.getProperty(changed, "system.deltas") === null;
    const spent = getSpent(actor, pool);
    setSpent(actor, pool, refunded ? spent - 1 : spent + 1)
      .catch(err => console.error("Экономия действий: не удалось вернуть ресурс", err));
  }

  /* ==========================================================================
     Включение
     ========================================================================== */

  persisted = loadSettings();
  injectStyle();

  const seenHooks = new Set();
  const hooks = [
    ["dnd5e.preUseActivity", onPreUseActivity],
    ["dnd5e.postUseActivity", onPostUseActivity],
    ["updateCombat", onUpdateCombat],
    ["deleteCombat", onDeleteCombat],
    ["dnd5e.restCompleted", onRestCompleted],
    ["updateChatMessage", onUsageMessageUpdate],
    // Имя хука меню заголовка подтверждено диагностикой на живом листе.
    ["getHeaderControlsCharacterActorSheet", onGetHeaderControls]
  ].map(([hook, fn]) => [hook, Hooks.on(hook, fn)]);

  for ( const name of RENDER_HOOKS ) {
    const id = Hooks.on(name, (app, element) => {
      if ( !renderWidget(app, element) ) return;
      if ( seenHooks.has(name) ) return;
      seenHooks.add(name);
      console.log(`Экономия действий: виджет вставлен по хуку ${name}`);
    });
    hooks.push([name, id]);
  }

  globalThis[KEY] = {
    hooks, settings: SETTINGS, seenHooks, renderWidget, getMax, getPoolState, resetPools, openSettingsDialog
  };

  // Показать виджет сразу на уже открытых листах — напрямую, не полагаясь на хуки.
  let injected = 0;
  const open = new Set([
    ...Object.values(ui.windows ?? {}),
    ...(foundry.applications?.instances?.values?.() ?? [])
  ]);
  for ( const actor of game.actors ) {
    if ( actor.sheet?.rendered ) open.add(actor.sheet);
  }
  for ( const app of open ) {
    if ( renderWidget(app, app?.element) ) injected++;
  }

  ui.notifications.info(`Экономия действий: включено. Виджет вставлен на открытых листах: ${injected}.`
    + " Запусти макрос ещё раз, чтобы выключить.");
  console.log("Экономия действий: включено", { открытыхЛистов: open.size, вставлено: injected });
})();
