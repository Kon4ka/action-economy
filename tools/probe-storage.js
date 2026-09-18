/**
 * Диагностика 4: куда макрос может писать данные.
 *
 * Проверяет три способа хранения по очереди и показывает, какой из них работает:
 *   1. флаги актёра через actor.update (туда пишутся траты и жёсткий оверрайд);
 *   2. флаги актёра через setFlag (заведомо запрещены без установленного модуля,
 *      проверяем ради полноты картины);
 *   3. настройка мира через game.settings (туда макрос кладёт общие настройки).
 *
 * Ничего лишнего в мире не оставляет: тестовые значения удаляются.
 * Запускать при выделенном токене своего персонажа.
 */

(async () => {
  const MODULE_ID = "action-economy";
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [];

  const actor = canvas.tokens?.controlled?.[0]?.actor
    ?? game.user.character
    ?? game.actors.find(a => (a.type === "character") && a.isOwner);
  if ( !actor ) return ui.notifications.error("Не найден лист персонажа. Выдели токен своего персонажа.");

  lines.push("=== КТО Я ===");
  lines.push(`Пользователь: ${game.user.name}, мастер: ${game.user.isGM}`);
  lines.push(`Актёр: ${actor.name}, владелец: ${actor.isOwner}, id: ${actor.id}`);
  lines.push(`Foundry ${game.version}, dnd5e ${game.system.version}`);
  lines.push("");

  // 1. actor.update.
  lines.push("=== 1. ФЛАГИ АКТЁРА ЧЕРЕЗ actor.update ===");
  try {
    await actor.update({ [`flags.${MODULE_ID}.probe`]: 42 });
    const inMemory = foundry.utils.getProperty(actor, `flags.${MODULE_ID}.probe`);
    const inSource = foundry.utils.getProperty(actor._source, `flags.${MODULE_ID}.probe`);
    const fresh = foundry.utils.getProperty(game.actors.get(actor.id), `flags.${MODULE_ID}.probe`);
    lines.push(`запись прошла без ошибки`);
    lines.push(`в подготовленных данных: ${JSON.stringify(inMemory)}`);
    lines.push(`в исходных данных (_source): ${JSON.stringify(inSource)}`);
    lines.push(`при повторном чтении из коллекции: ${JSON.stringify(fresh)}`);
    lines.push(inSource === 42 ? "ИТОГ: работает" : "ИТОГ: значение не сохранилось");
  } catch(err) {
    lines.push(`ОШИБКА: ${err.message}`);
    lines.push("ИТОГ: не работает");
  }
  lines.push("");

  // 2. setFlag.
  lines.push("=== 2. ФЛАГИ АКТЁРА ЧЕРЕЗ setFlag ===");
  try {
    await actor.setFlag(MODULE_ID, "probeFlag", 7);
    lines.push(`ИТОГ: работает, значение ${JSON.stringify(actor.getFlag(MODULE_ID, "probeFlag"))}`);
  } catch(err) {
    lines.push(`ОШИБКА: ${err.message}`);
    lines.push("ИТОГ: не работает (ожидаемо, пока модуль не установлен)");
  }
  lines.push("");

  // 3. Настройка мира.
  lines.push("=== 3. НАСТРОЙКА МИРА ЧЕРЕЗ game.settings ===");
  try {
    if ( !game.settings.settings.has(`${MODULE_ID}.probeSetting`) ) {
      game.settings.register(MODULE_ID, "probeSetting", { scope: "world", config: false, type: Object, default: {} });
      lines.push("регистрация прошла");
    } else lines.push("настройка уже была зарегистрирована");
    await game.settings.set(MODULE_ID, "probeSetting", { value: 99 });
    const read = game.settings.get(MODULE_ID, "probeSetting");
    lines.push(`прочитано обратно: ${JSON.stringify(read)}`);
    const stored = game.settings.storage.get("world")?.find?.(s => s.key === `${MODULE_ID}.probeSetting`);
    lines.push(`документ настройки в мире: ${stored ? "есть" : "не найден"}`);
    lines.push(read?.value === 99 ? "ИТОГ: работает" : "ИТОГ: значение не сохранилось");
  } catch(err) {
    lines.push(`ОШИБКА: ${err.message}`);
    lines.push("ИТОГ: не работает");
  }
  lines.push("");

  // Что уже лежит во флагах актёра.
  lines.push("=== ТЕКУЩИЕ ФЛАГИ АКТЁРА ===");
  lines.push(`flags.${MODULE_ID} = ${JSON.stringify(actor.flags?.[MODULE_ID] ?? null)}`);
  lines.push(`все scope: ${Object.keys(actor.flags ?? {}).join(", ")}`);

  // Уборка.
  try {
    await actor.update({ [`flags.${MODULE_ID}.-=probe`]: null, [`flags.${MODULE_ID}.-=probeFlag`]: null });
  } catch(err) { /* если запись не работает, убирать нечего */ }
  try {
    const setting = game.settings.storage.get("world")?.find?.(s => s.key === `${MODULE_ID}.probeSetting`);
    await setting?.delete();
  } catch(err) { /* то же самое */ }

  const report = lines.join("\n");
  console.log("=== Экономия действий: диагностика хранения ===\n" + report);
  try { await game.clipboard.copyPlainText(report); } catch(err) { /* буфер недоступен */ }

  await foundry.applications.api.DialogV2.prompt({
    window: { title: "Экономия действий — куда можно писать", resizable: true },
    position: { width: 860, height: 640 },
    content: `<textarea readonly style="width:100%;height:500px;font-family:monospace;font-size:11px;">${esc(report)}</textarea>`,
    ok: { label: "Закрыть" }
  });
})();
