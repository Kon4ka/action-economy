/**
 * Диагностика 2: какие хуки срабатывают при использовании способности с Midi-QOL.
 *
 * Зачем: модуль «Экономия действий» планирует списывать ресурсы на dnd5e.preUseActivity
 * и dnd5e.postUseActivity. Нужно убедиться, что Midi-QOL не перехватывает использование
 * раньше и эти хуки реально доходят, а также увидеть порядок срабатывания.
 *
 * Как запускать — макрос-переключатель:
 *   1) запустить — включится слежение (уведомление «слежение включено»);
 *   2) использовать оружие, заклинание с концентрацией, бонусное действие, реакцию;
 *   3) запустить ещё раз — слежение выключится и покажет отчёт.
 * Отчёт: диалог, консоль (F12) и буфер обмена.
 *
 * Запускать на том клиенте, с которого идёт игра. Полезно повторить и от лица мастера,
 * и от лица игрока: Midi-QOL часть работы переносит на мастера.
 */

(async () => {
  const KEY = "__actionEconomyHookProbe";
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const HOOKS = [
    "dnd5e.preUseActivity",
    "dnd5e.postUseActivity",
    "dnd5e.preActivityConsumption",
    "dnd5e.activityConsumption",
    "dnd5e.postActivityConsumption",
    "dnd5e.preCreateUsageMessage",
    "dnd5e.postCreateUsageMessage",
    "dnd5e.beginConcentrating",
    "dnd5e.endConcentration",
    "midi-qol.preItemRoll",
    "midi-qol.preambleComplete",
    "midi-qol.AttackRollComplete",
    "midi-qol.DamageRollComplete",
    "midi-qol.RollComplete"
  ];

  /** Вытащить из аргументов хука актёра, предмет, активность и тип активации. */
  function describe(args) {
    const out = { actor: "—", item: "—", activity: "—", activation: "—", note: "" };
    try {
      for ( const arg of args.slice(0, 4) ) {
        if ( !arg || typeof arg !== "object" ) continue;
        // Activity D&D5e: есть activation и ссылка на item.
        if ( (out.activity === "—") && arg.activation && arg.item?.name ) {
          out.activity = arg.name ?? arg.type ?? "activity";
          out.activation = arg.activation?.type === "" ? "(пусто)" : (arg.activation?.type ?? "—");
          out.item = arg.item.name;
          out.actor = arg.actor?.name ?? arg.item.actor?.name ?? out.actor;
        }
        // Workflow Midi-QOL.
        else if ( (out.note === "") && (arg.workflowName || arg.itemCardUuid || arg.constructor?.name?.includes("Workflow")) ) {
          out.note = "midi workflow";
          out.item = arg.item?.name ?? out.item;
          out.actor = arg.actor?.name ?? out.actor;
          const act = arg.activity;
          if ( act ) {
            out.activity = act.name ?? act.type ?? out.activity;
            out.activation = act.activation?.type ?? out.activation;
          }
        }
        // Хуки концентрации: (actor, item, effect, activity).
        else if ( arg.documentName === "Actor" ) out.actor = arg.name;
        else if ( arg.documentName === "Item" && (out.item === "—") ) out.item = arg.name;
        else if ( arg.documentName === "ActiveEffect" ) out.note = out.note || `эффект «${arg.name}»`;
      }
    } catch(err) { out.note = `ошибка разбора: ${err.message}`; }
    return out;
  }

  // Выключение и отчёт.
  if ( globalThis[KEY] ) {
    const probe = globalThis[KEY];
    for ( const [hook, id] of probe.ids ) Hooks.off(hook, id);
    delete globalThis[KEY];

    const lines = [];
    lines.push("=== ОКРУЖЕНИЕ ===");
    lines.push(`Foundry: ${game.version} | Система: ${game.system.id} ${game.system.version}`);
    const midi = game.modules.get("midi-qol");
    lines.push(`Midi-QOL: ${midi ? `${midi.version} (активен: ${midi.active})` : "не установлен"}`);
    lines.push(`Пользователь: ${game.user.name} (мастер: ${game.user.isGM})`);
    lines.push("");
    lines.push(`=== СОБЫТИЯ (${probe.log.length}) ===`);
    if ( !probe.log.length ) lines.push("Ничего не сработало. Значит, ни один из перечисленных хуков при использовании не вызывался.");

    let previous = null;
    for ( const entry of probe.log ) {
      if ( previous && ((entry.t - previous) > 2500) ) lines.push("--- новое использование ---");
      const offset = previous === null ? 0 : entry.t - probe.log[0].t;
      previous = entry.t;
      lines.push(
        `+${String(offset).padStart(5)}мс  ${entry.hook.padEnd(32)} `
        + `актёр: ${entry.actor} | предмет: ${entry.item} | активность: ${entry.activity} `
        + `| активация: ${entry.activation}${entry.note ? ` | ${entry.note}` : ""}`
      );
    }
    lines.push("");
    lines.push("=== ХУКИ, КОТОРЫЕ НИ РАЗУ НЕ СРАБОТАЛИ ===");
    const fired = new Set(probe.log.map(e => e.hook));
    lines.push(HOOKS.filter(h => !fired.has(h)).join("\n") || "нет, сработали все");

    const report = lines.join("\n");
    console.log("=== Экономия действий: отчёт по хукам ===\n" + report);
    try {
      await game.clipboard.copyPlainText(report);
      ui.notifications.info(`Слежение выключено. Событий: ${probe.log.length}. Отчёт скопирован в буфер обмена.`);
    } catch(err) {
      ui.notifications.info(`Слежение выключено. Событий: ${probe.log.length}. Отчёт в консоли (F12).`);
    }
    try {
      await foundry.applications.api.DialogV2.prompt({
        window: { title: "Экономия действий — отчёт по хукам", resizable: true },
        position: { width: 1000, height: 700 },
        content: `<textarea readonly style="width:100%;height:560px;font-family:monospace;font-size:11px;">${esc(report)}</textarea>`,
        ok: { label: "Закрыть" }
      });
    } catch(err) {
      console.warn("Экономия действий: диалог не открылся, отчёт остался в консоли.", err);
    }
    return;
  }

  // Включение.
  const probe = globalThis[KEY] = { ids: [], log: [] };
  for ( const hook of HOOKS ) {
    const id = Hooks.on(hook, (...args) => {
      const info = describe(args);
      const entry = { t: Date.now(), hook, ...info };
      probe.log.push(entry);
      console.log(`[Экономия действий] ${hook}`, info, args);
    });
    probe.ids.push([hook, id]);
  }
  ui.notifications.info("Слежение за хуками включено. Используй способности, затем запусти макрос ещё раз для отчёта.");
})();
