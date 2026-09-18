/**
 * Настройки модуля.
 */

import { MODULE_ID, POOLS } from "./state.mjs";

/** Что делать, когда ресурс кончился. */
export const SHORTAGE = {
  CONFIRM: "confirm",
  NOTIFY: "notify",
  NONE: "none"
};

/**
 * Ключ настройки видимости пула. Точки в ключах настроек не используем: ядро хранит их
 * строкой `<модуль>.<ключ>`, и лишняя точка — лишний повод для несовместимости.
 */
const showKey = pool => `show${pool.charAt(0).toUpperCase()}${pool.slice(1)}`;

export function registerSettings(onChange) {
  const refresh = () => onChange?.();

  game.settings.register(MODULE_ID, "manualMode", {
    name: "ACTION_ECONOMY.Settings.manualMode.name",
    hint: "ACTION_ECONOMY.Settings.manualMode.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: refresh
  });

  game.settings.register(MODULE_ID, "shortage", {
    name: "ACTION_ECONOMY.Settings.shortage.name",
    hint: "ACTION_ECONOMY.Settings.shortage.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [SHORTAGE.CONFIRM]: "ACTION_ECONOMY.Settings.shortage.confirm",
      [SHORTAGE.NOTIFY]: "ACTION_ECONOMY.Settings.shortage.notify",
      [SHORTAGE.NONE]: "ACTION_ECONOMY.Settings.shortage.none"
    },
    default: SHORTAGE.CONFIRM,
    onChange: refresh
  });

  game.settings.register(MODULE_ID, "trackOutOfCombat", {
    name: "ACTION_ECONOMY.Settings.trackOutOfCombat.name",
    hint: "ACTION_ECONOMY.Settings.trackOutOfCombat.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refresh
  });

  // Мастер решает, какие ресурсы вообще существуют в этой игре и видны на листах.
  for ( const pool of Object.keys(POOLS) ) {
    game.settings.register(MODULE_ID, showKey(pool), {
      name: `ACTION_ECONOMY.Settings.show.${pool}`,
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: refresh
    });
  }

  // Каждый игрок может скрыть виджет у себя.
  game.settings.register(MODULE_ID, "showForMe", {
    name: "ACTION_ECONOMY.Settings.showForMe.name",
    hint: "ACTION_ECONOMY.Settings.showForMe.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: refresh
  });
}

export const getSetting = key => game.settings.get(MODULE_ID, key);

/** Видимые пулы с учётом мировых и личных настроек. */
export function visiblePools() {
  if ( !getSetting("showForMe") ) return [];
  return Object.keys(POOLS).filter(pool => getSetting(showKey(pool)));
}

/** Списывает ли модуль ресурсы сам. */
export function isAutomatic() {
  return !getSetting("manualMode");
}
