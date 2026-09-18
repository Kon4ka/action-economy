/**
 * Диагностика 3: почему не появился виджет.
 *
 * Отвечает на три вопроса сразу:
 *   1. какие хуки отрисовки вообще срабатывают на этом листе (у модулей, подменяющих лист,
 *      имена другие);
 *   2. находится ли точка вставки в шапке;
 *   3. виден ли вставленный блок или его прячет вёрстка.
 *
 * Запускать при открытом листе персонажа (или выделив свой токен). В шапке появится
 * красный квадратик «AE» — это тестовая вставка, она исчезнет при следующей перерисовке листа.
 */

(async () => {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [];

  const actor = canvas.tokens?.controlled?.[0]?.actor
    ?? game.user.character
    ?? game.actors.find(a => (a.type === "character") && a.isOwner);
  if ( !actor ) return ui.notifications.error("Не найден лист персонажа. Выдели токен своего персонажа.");

  // 1. Перехватываем все хуки, пока лист перерисовывается.
  const fired = [];
  const origCall = Hooks.call;
  const origCallAll = Hooks.callAll;
  Hooks.call = function(hook, ...args) { fired.push(hook); return origCall.call(this, hook, ...args); };
  Hooks.callAll = function(hook, ...args) { fired.push(hook); return origCallAll.call(this, hook, ...args); };

  try {
    await actor.sheet.render(true);
    await new Promise(resolve => setTimeout(resolve, 600));
  } finally {
    Hooks.call = origCall;
    Hooks.callAll = origCallAll;
  }

  const renderHooks = [...new Set(fired.filter(h => /^render/.test(h)))];
  const getHooks = [...new Set(fired.filter(h => /^get.*(Controls|Menu|Entries)/i.test(h)))];

  lines.push("=== ЛИСТ ===");
  lines.push(`Актёр: ${actor.name} (${actor.type})`);
  lines.push(`Класс листа: ${actor.sheet.constructor.name}`);
  lines.push("");
  lines.push("=== ХУКИ ОТРИСОВКИ, КОТОРЫЕ РЕАЛЬНО СРАБОТАЛИ ===");
  lines.push(renderHooks.join("\n") || "ни одного");
  lines.push("");
  lines.push("=== ХУКИ МЕНЮ И КНОПОК ЗАГОЛОВКА ===");
  lines.push(getHooks.join("\n") || "ни одного");
  lines.push("");

  // 2. Точка вставки.
  const raw = actor.sheet.element;
  const root = (raw instanceof HTMLElement) ? raw : (raw?.[0] ?? null);
  lines.push("=== ТОЧКА ВСТАВКИ ===");
  if ( !root ) {
    lines.push("DOM листа недоступен (actor.sheet.element пуст).");
  } else {
    const buttons = root.querySelector(".sheet-header-buttons");
    const right = root.querySelector("header.sheet-header .right");
    lines.push(`.sheet-header-buttons: ${buttons ? "найден" : "НЕ НАЙДЕН"}`);
    lines.push(`header.sheet-header .right: ${right ? "найден" : "НЕ НАЙДЕН"}`);

    const anchor = buttons ?? root.querySelector("header.sheet-header .right > div") ?? right;
    if ( anchor ) {
      const style = getComputedStyle(anchor);
      lines.push(`стиль якоря: display=${style.display}, flex-direction=${style.flexDirection}, `
        + `align-items=${style.alignItems}, overflow=${style.overflow}, ширина=${Math.round(anchor.getBoundingClientRect().width)}px, `
        + `высота=${Math.round(anchor.getBoundingClientRect().height)}px`);

      // 3. Тестовая вставка.
      anchor.querySelectorAll(".ae-probe-block").forEach(node => node.remove());
      const probe = document.createElement("div");
      probe.className = "ae-probe-block";
      probe.textContent = "AE";
      probe.style.cssText = "background:#d33;color:#fff;font-size:10px;padding:2px 4px;border-radius:3px;margin-right:auto;";
      anchor.prepend(probe);
      await new Promise(resolve => requestAnimationFrame(resolve));

      const box = probe.getBoundingClientRect();
      const probeStyle = getComputedStyle(probe);
      lines.push("");
      lines.push("=== ТЕСТОВАЯ ВСТАВКА ===");
      lines.push(`размер: ${Math.round(box.width)}×${Math.round(box.height)} px, позиция: ${Math.round(box.left)};${Math.round(box.top)}`);
      lines.push(`display=${probeStyle.display}, visibility=${probeStyle.visibility}, opacity=${probeStyle.opacity}`);
      lines.push(box.width && box.height
        ? "Блок вставлен и имеет размер. Посмотри на шапку листа: слева от вилки должен быть красный «AE»."
        : "Блок вставлен, но нулевого размера — вёрстка шапки его схлопывает.");
    }

    lines.push("");
    lines.push(`Виджет экономии действий сейчас в DOM: ${!!root.querySelector(".action-economy-tracker")}`);
  }

  lines.push("");
  lines.push(`Макрос экономии действий включён: ${!!globalThis.__actionEconomyMacro}`);

  const report = lines.join("\n");
  console.log("=== Экономия действий: диагностика вставки ===\n" + report);
  try {
    await game.clipboard.copyPlainText(report);
    ui.notifications.info("Отчёт скопирован в буфер обмена.");
  } catch(err) { /* буфер недоступен — отчёт есть в диалоге и консоли */ }

  await foundry.applications.api.DialogV2.prompt({
    window: { title: "Экономия действий — почему нет виджета", resizable: true },
    position: { width: 900, height: 620 },
    content: `<textarea readonly style="width:100%;height:480px;font-family:monospace;font-size:11px;">${esc(report)}</textarea>`,
    ok: { label: "Закрыть" }
  });
})();
