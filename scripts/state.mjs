/**
 * Состояние экономии действий: описание пулов, расчёт максимумов, чтение и запись трат.
 */

export const MODULE_ID = "action-economy";

/**
 * Значок концентрации: кольцо с тремя штрихами. В бесплатном наборе Font Awesome такой
 * фигуры нет, поэтому рисуем сами. Содержимое `<svg>`, обводка берёт цвет ресурса.
 */
const CONCENTRATION_GLYPH = '<circle cx="12" cy="9" r="7"/><path d="M12 11.5V22.5"/>'
  + '<path d="M7.7 12.8 3.8 22.3"/><path d="M16.3 12.8 20.2 22.3"/>';

/** Пулы в порядке отрисовки. `system: true` — значение целиком ведёт система D&D5e. */
export const POOLS = {
  action: { icon: "fa-solid fa-circle", label: "ACTION_ECONOMY.Pool.action" },
  bonus: { icon: "fa-solid fa-play", label: "ACTION_ECONOMY.Pool.bonus" },
  free: { icon: "fa-solid fa-droplet", label: "ACTION_ECONOMY.Pool.free" },
  reaction: { icon: "fa-solid fa-arrow-rotate-left", label: "ACTION_ECONOMY.Pool.reaction" },
  concentration: { glyph: CONCENTRATION_GLYPH, label: "ACTION_ECONOMY.Pool.concentration", system: true }
};

/** Пулы, траты которых хранит сам модуль. */
export const TRACKED_POOLS = ["action", "bonus", "free", "reaction"];

/** Тип активации Activity → пул. Всё остальное (`special`, время, отдых) ничего не стоит. */
export const ACTIVATION_TO_POOL = {
  action: "action",
  bonus: "bonus",
  reaction: "reaction"
};

/** Базовое количество каждого пула до эффектов. */
const BASE = 1;

/** Свои мелкие помощники: глобальные расширения ядра между версиями переезжают. */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/* -------------------------------------------- */
/*  Расчёт                                      */
/* -------------------------------------------- */

/**
 * Максимум пула: база, поверх неё изменения активных эффектов, поверх всего — жёсткий оверрайд.
 *
 * Эффекты считаем сами, перебирая `actor.appliedEffects`, а не полагаемся на штатное
 * применение к флагу: у несуществующего флага поведение режимов зависит от версии ядра,
 * а так результат предсказуем и правильно учитывает приоритет, отключение и подавление.
 *
 * Ключ эффекта: `flags.action-economy.max.<пул>`, режимы Add, Upgrade, Downgrade, Override, Multiply.
 */
export function getMax(actor, pool) {
  if ( POOLS[pool]?.system ) return actor.system?.attributes?.concentration?.limit ?? 0;

  const override = actor.getFlag(MODULE_ID, `override.${pool}`);
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

/** Сколько пула уже потрачено. */
export function getSpent(actor, pool) {
  if ( pool === "concentration" ) return actor.concentration?.effects?.size ?? 0;
  const spent = actor.getFlag(MODULE_ID, `spent.${pool}`) ?? 0;
  return Math.max(0, Math.floor(Number(spent) || 0));
}

/** Полное состояние пула для отрисовки и проверок. */
export function getPoolState(actor, pool) {
  const max = getMax(actor, pool);
  const spent = Math.min(getSpent(actor, pool), Math.max(max, 0));
  return { max, spent, available: Math.max(0, max - spent) };
}

/* -------------------------------------------- */
/*  Запись                                      */
/* -------------------------------------------- */

/** Может ли текущий пользователь менять состояние этого актёра. */
export function canEdit(actor) {
  return !!actor?.isOwner;
}

/** Задать точное число потраченного. Возвращает true, если запись состоялась. */
export async function setSpent(actor, pool, value) {
  if ( !TRACKED_POOLS.includes(pool) ) return false;
  if ( !canEdit(actor) ) return false;
  const max = getMax(actor, pool);
  const next = clamp(Math.floor(value), 0, max);
  if ( next === getSpent(actor, pool) ) return false;
  await actor.setFlag(MODULE_ID, `spent.${pool}`, next);
  return true;
}

/** Потратить одну единицу пула. */
export async function spend(actor, pool, amount = 1) {
  return setSpent(actor, pool, getSpent(actor, pool) + amount);
}

/** Сбросить все траты актёра (начало хода, конец боя, клик по значку). */
export async function resetPools(actor, pools = TRACKED_POOLS) {
  if ( !canEdit(actor) ) return false;
  const update = {};
  for ( const pool of pools ) {
    if ( getSpent(actor, pool) > 0 ) update[`flags.${MODULE_ID}.spent.${pool}`] = 0;
  }
  if ( foundry.utils.isEmpty(update) ) return false;
  await actor.update(update);
  return true;
}

/* -------------------------------------------- */
/*  Общее                                       */
/* -------------------------------------------- */

/** Модуль работает только на листах персонажей игроков. */
export function isTracked(actor) {
  return actor?.type === "character";
}

/** Участвует ли актёр в текущем бою. */
export function isInCombat(actor) {
  if ( !actor ) return false;
  return !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.actor?.id === actor.id));
}
