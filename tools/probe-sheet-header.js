/**
 * Диагностика 1: вёрстка шапки листа персонажа.
 *
 * Зачем: модуль «Экономия действий» вставляет виджет в шапку листа, рядом с кнопками
 * отдыха. Нужно увидеть фактическую разметку в сборке пользователя — тема или другие
 * модули могли её изменить.
 *
 * Как запускать: выделить токен своего персонажа (или просто запустить, если персонаж
 * привязан к пользователю) и выполнить макрос. Лист откроется сам.
 * Результат: диалог с текстом, он же в консоли (F12) и в буфере обмена.
 */

(async () => {
  const trim = (s, n) => (s ?? "").length > n ? `${s.slice(0, n)}\n… (обрезано, всего ${s.length} символов)` : (s ?? "");
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function skeleton(el, depth = 0, max = 4) {
    if ( !el || depth > max ) return "";
    const pad = "    ".repeat(depth);
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList?.length ? `.${[...el.classList].join(".")}` : "";
    const action = el.dataset?.action ? ` [data-action="${el.dataset.action}"]` : "";
    const leaf = !el.children.length || depth === max;
    const text = leaf ? ` "${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}"` : "";
    let out = `${pad}<${el.tagName.toLowerCase()}${id}${cls}>${action}${text}\n`;
    for ( const child of el.children ) out += skeleton(child, depth + 1, max);
    return out;
  }

  // 1. Выбор актёра: выделенный токен → персонаж пользователя → первый свой character.
  const actor = canvas.tokens?.controlled?.[0]?.actor
    ?? game.user.character
    ?? game.actors.find(a => (a.type === "character") && a.isOwner);
  if ( !actor ) return ui.notifications.error("Не найден лист персонажа. Выдели токен своего персонажа и запусти снова.");
  if ( actor.type !== "character" ) ui.notifications.warn(`Актёр «${actor.name}» имеет тип «${actor.type}», а не «character».`);

  // 2. Гарантированно открытый и отрисованный лист.
  await actor.sheet.render(true);
  await new Promise(resolve => setTimeout(resolve, 400));

  const raw = actor.sheet.element;
  const root = (raw instanceof HTMLElement) ? raw : (raw?.[0] ?? raw?.get?.(0) ?? null);
  if ( !root ) return ui.notifications.error("Не удалось получить DOM листа (actor.sheet.element пуст).");

  const header = root.querySelector("header.sheet-header") ?? root.querySelector(".sheet-header");
  const right = header?.querySelector(".right");
  const restButtons = root.querySelector(".sheet-header-buttons");

  // 3. Отчёт.
  const lines = [];
  lines.push("=== ОКРУЖЕНИЕ ===");
  lines.push(`Foundry: ${game.version}`);
  lines.push(`Система: ${game.system.id} ${game.system.version}`);
  const midi = game.modules.get("midi-qol");
  lines.push(`Midi-QOL: ${midi ? `${midi.version} (активен: ${midi.active})` : "не установлен"}`);
  lines.push(`Активные модули: ${game.modules.filter(m => m.active).map(m => m.id).join(", ")}`);
  lines.push("");
  lines.push("=== ЛИСТ ===");
  lines.push(`Актёр: ${actor.name} (тип ${actor.type})`);
  lines.push(`Класс листа: ${actor.sheet.constructor.name}`);
  lines.push(`ApplicationV2: ${raw instanceof HTMLElement}`);
  lines.push(`Классы корня: ${root.className}`);
  lines.push("");
  lines.push("=== ТОЧКИ ВСТАВКИ ===");
  lines.push(`header.sheet-header найден: ${!!header}`);
  lines.push(`.sheet-header .right найден: ${!!right}`);
  lines.push(`.sheet-header-buttons (кнопки отдыха) найден: ${!!restButtons}`);
  if ( restButtons ) {
    lines.push(`родитель кнопок отдыха: <${restButtons.parentElement?.tagName.toLowerCase()} class="${restButtons.parentElement?.className}">`);
    lines.push(`соседи в этом родителе: ${[...(restButtons.parentElement?.children ?? [])].map(c => `${c.tagName.toLowerCase()}.${[...c.classList].join(".")}`).join(" | ")}`);
  }
  lines.push("");
  lines.push("=== СКЕЛЕТ header.sheet-header ===");
  lines.push(header ? skeleton(header, 0, 5) : "шапка не найдена");
  lines.push("=== HTML блока .sheet-header .right ===");
  lines.push(trim(right?.innerHTML ?? "не найден", 6000));

  const report = lines.join("\n");
  console.log("=== Экономия действий: диагностика шапки листа ===\n" + report);

  try {
    await game.clipboard.copyPlainText(report);
    ui.notifications.info("Отчёт скопирован в буфер обмена и выведен в консоль (F12).");
  } catch(err) {
    ui.notifications.warn("Буфер обмена недоступен — возьми текст из диалога или из консоли (F12).");
  }

  try {
    await foundry.applications.api.DialogV2.prompt({
      window: { title: "Экономия действий — диагностика шапки листа", resizable: true },
      position: { width: 900, height: 700 },
      content: `<textarea readonly style="width:100%;height:560px;font-family:monospace;font-size:11px;">${esc(report)}</textarea>`,
      ok: { label: "Закрыть" }
    });
  } catch(err) {
    console.warn("Экономия действий: диалог не открылся, отчёт остался в консоли.", err);
  }
})();
