/**
 * Создать готовые особенности с эффектами, которые повышают количество ресурсов.
 *
 * Запускать один раз как макрос от мастера. Появится папка предметов «Экономия действий»
 * с пятью особенностями. Дальше их достаточно перетащить на лист персонажа: эффект
 * включится сам и поднимет соответствующий счётчик на единицу.
 *
 * Повторный запуск ничего не дублирует — уже созданные особенности пропускаются.
 */

(async () => {
  const MODULE_ID = "action-economy";
  const FOLDER = "Экономия действий";

  const ENTRIES = [
    { name: "Дополнительное действие", pool: "action", icon: "icons/magic/time/clock-stopwatch-white-blue.webp" },
    { name: "Дополнительное бонусное действие", pool: "bonus", icon: "icons/magic/movement/trail-streak-zigzag-yellow.webp" },
    { name: "Дополнительная реакция", pool: "reaction", icon: "icons/magic/control/buff-flight-wings-blue.webp" },
    { name: "Дополнительное свободное действие", pool: "free", icon: "icons/magic/water/bubbles-air-water-drop-blue.webp" },
    {
      name: "Дополнительная концентрация", pool: "concentration",
      icon: "icons/magic/light/explosion-star-glow-pink.webp",
      // Предел концентрации — штатное поле системы, свой флаг тут не нужен.
      key: "system.attributes.concentration.limit"
    },

    // Запреты: обнуляют пул, пока эффект висит. Снимется эффект — пул вернётся сам.
    { name: "Реакция недоступна", pool: "reaction", block: true, icon: "icons/svg/unconscious.svg" },
    { name: "Действие недоступно", pool: "action", block: true, icon: "icons/svg/paralysis.svg" },
    { name: "Бонусное действие недоступно", pool: "bonus", block: true, icon: "icons/svg/net.svg" },
    { name: "Свободное действие недоступно", pool: "free", block: true, icon: "icons/svg/silenced.svg" }
  ];

  if ( !game.user.isGM ) return ui.notifications.error("Создавать особенности может только мастер.");

  let folder = game.folders.find(f => (f.name === FOLDER) && (f.type === "Item"));
  folder ??= await Folder.create({ name: FOLDER, type: "Item", color: "#c8a96e" });

  const existing = new Set(game.items.filter(i => i.folder?.id === folder.id).map(i => i.name));
  const payload = [];

  for ( const entry of ENTRIES ) {
    if ( existing.has(entry.name) ) continue;
    const key = entry.key ?? `flags.${MODULE_ID}.max.${entry.pool}`;
    const change = entry.block
      ? { key, mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0", priority: 40 }
      : { key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "1", priority: 20 };
    const description = entry.block
      ? `<p>Пока эффект висит, ресурс «${entry.pool}» недоступен. Снимется эффект — вернётся сам.`
        + ` Ключ эффекта: <code>${key}</code>, режим «Переопределить», значение 0.</p>`
      : `<p>Повышает количество ресурса «${entry.pool}» на единицу. Ключ эффекта: <code>${key}</code>.</p>`;

    payload.push({
      name: entry.name,
      type: "feat",
      img: entry.icon,
      folder: folder.id,
      system: { description: { value: description } },
      effects: [{
        name: entry.name,
        img: entry.icon,
        disabled: false,
        transfer: true,
        changes: [change]
      }]
    });
  }

  if ( !payload.length ) return ui.notifications.info("Все особенности уже созданы.");
  const created = await Item.createDocuments(payload);
  ui.notifications.info(`Создано особенностей: ${created.length}. Папка предметов «${FOLDER}».`);
})();
