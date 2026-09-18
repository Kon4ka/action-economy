/**
 * Экономия действий — точка входа.
 *
 * Foundry VTT 14, D&D5e 5.3.3, совместимо с Midi-QOL.
 */

import { MODULE_ID, getMax, getPoolState, resetPools } from "./state.mjs";
import { registerSettings } from "./settings.mjs";
import { registerEconomyHooks } from "./economy.mjs";
import { onGetHeaderControls, onRenderSheet, openOverrideDialog } from "./ui.mjs";

Hooks.once("init", () => {
  registerSettings(() => {
    registerEconomyHooks();
    refreshOpenSheets();
  });

  // Слушаем хуки уровня ядра, а не имена классов D&D5e: система свои листы уже
  // переименовывала (ActorSheet5eCharacter2 → CharacterActorSheet), и привязка к имени
  // класса ломается на каждом таком переезде. ApplicationV2 вызывает хуки для всей
  // цепочки классов, поэтому базового имени достаточно. Оба имени подтверждены
  // диагностикой на живом листе.
  Hooks.on("renderActorSheetV2", onRenderSheet);
  Hooks.on("getHeaderControlsActorSheetV2", onGetHeaderControls);
});

Hooks.once("ready", () => {
  registerEconomyHooks();

  // Публичный API для макросов: game.modules.get("action-economy").api
  const module = game.modules.get(MODULE_ID);
  if ( module ) module.api = { getMax, getPoolState, resetPools, openOverrideDialog };

  console.log(`${MODULE_ID} | готов`);
});

/** Перерисовать открытые листы персонажей после смены настроек. */
function refreshOpenSheets() {
  const open = new Set([
    ...Object.values(ui.windows ?? {}),
    ...(foundry.applications?.instances?.values?.() ?? [])
  ]);
  for ( const app of open ) {
    if ( app?.document?.type === "character" ) app.render(false);
  }
}
