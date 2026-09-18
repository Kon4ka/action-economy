/**
 * Смоук-тест чистой логики модуля: расчёт максимумов, состояние пулов, запись трат.
 * Интерфейс Foundry не поднимается, глобальные объекты заменены заглушками.
 *
 * Запуск: node action-economy/tests/smoke-test.cjs
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Заглушки глобальных объектов Foundry.
globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 }
};
globalThis.foundry = { utils: { isEmpty: obj => Object.keys(obj).length === 0 } };
Math.clamp ??= (value, min, max) => Math.min(Math.max(value, min), max);

/** Простейший актёр-заглушка с флагами и эффектами. */
function makeActor({ flags = {}, effects = [], limit = 1, isOwner = true } = {}) {
  const actor = {
    type: "character",
    isOwner,
    flags: { "action-economy": flags },
    appliedEffects: effects,
    system: { attributes: { concentration: { limit } } },
    concentration: { effects: new Set() },
    updates: [],
    getFlag(scope, key) {
      return key.split(".").reduce((obj, part) => obj?.[part], actor.flags[scope]);
    },
    async setFlag(scope, key, value) {
      const parts = key.split(".");
      const last = parts.pop();
      const target = parts.reduce((obj, part) => (obj[part] ??= {}), actor.flags[scope]);
      target[last] = value;
      actor.updates.push({ [`flags.${scope}.${key}`]: value });
    },
    async update(changes) {
      actor.updates.push(changes);
      for ( const [key, value] of Object.entries(changes) ) {
        const parts = key.replace("flags.action-economy.", "").split(".");
        const last = parts.pop();
        const target = parts.reduce((obj, part) => (obj[part] ??= {}), actor.flags["action-economy"]);
        target[last] = value;
      }
    }
  };
  return actor;
}

const change = (pool, mode, value, priority) => ({
  key: `flags.action-economy.max.${pool}`,
  mode,
  value,
  priority
});

(async () => {
  const state = await import(pathToFileURL(path.join(__dirname, "..", "scripts", "state.mjs")).href);
  const M = globalThis.CONST.ACTIVE_EFFECT_MODES;

  // База — по одному на каждый пул.
  const plain = makeActor();
  for ( const pool of state.TRACKED_POOLS ) assert.equal(state.getMax(plain, pool), 1, `база ${pool}`);

  // Эффекты складываются.
  const buffed = makeActor({
    effects: [
      { changes: [change("bonus", M.ADD, 1)] },
      { changes: [change("bonus", M.ADD, "1"), change("action", M.ADD, 1)] }
    ]
  });
  assert.equal(state.getMax(buffed, "bonus"), 3, "два эффекта по +1 к бонусному действию");
  assert.equal(state.getMax(buffed, "action"), 2, "+1 к основному действию");
  assert.equal(state.getMax(buffed, "reaction"), 1, "нетронутый пул остаётся базовым");

  // Режимы: Upgrade не опускает, Override задаёт, приоритет соблюдается.
  const modes = makeActor({
    effects: [
      { changes: [change("action", M.UPGRADE, 3, 10)] },
      { changes: [change("action", M.ADD, 1, 20)] },
      { changes: [change("reaction", M.OVERRIDE, 0, 10)] }
    ]
  });
  assert.equal(state.getMax(modes, "action"), 4, "Upgrade до 3, затем Add +1");
  assert.equal(state.getMax(modes, "reaction"), 0, "Override в ноль");

  // Жёсткий оверрайд важнее эффектов.
  const overridden = makeActor({
    flags: { override: { action: 5 } },
    effects: [{ changes: [change("action", M.ADD, 2)] }]
  });
  assert.equal(state.getMax(overridden, "action"), 5, "оверрайд перебивает эффекты");

  // Состояние пула и обрезка по максимуму.
  const spentActor = makeActor({ flags: { spent: { bonus: 5 } } });
  const poolState = state.getPoolState(spentActor, "bonus");
  assert.deepEqual(poolState, { max: 1, spent: 1, available: 0 }, "траты не превышают максимум");

  // Запись трат.
  const writable = makeActor({ effects: [{ changes: [change("bonus", M.ADD, 2)] }] });
  assert.equal(await state.setSpent(writable, "bonus", 2), true, "запись состоялась");
  assert.equal(state.getSpent(writable, "bonus"), 2, "потрачено две единицы");
  await state.spend(writable, "bonus");
  assert.equal(state.getSpent(writable, "bonus"), 3, "третья трата в пределах максимума");
  await state.spend(writable, "bonus");
  assert.equal(state.getSpent(writable, "bonus"), 3, "сверх максимума не пишем");
  assert.equal(await state.resetPools(writable), true, "сброс сработал");
  assert.equal(state.getSpent(writable, "bonus"), 0, "после сброса пул чист");

  // Без прав ничего не пишется.
  const foreign = makeActor({ isOwner: false });
  assert.equal(await state.setSpent(foreign, "action", 1), false, "чужой лист не меняем");
  assert.equal(foreign.updates.length, 0, "записи не было");

  // Концентрация целиком из системы.
  const concentrating = makeActor({ limit: 2 });
  concentrating.concentration.effects = new Set([{ name: "Смех Таши" }]);
  assert.deepEqual(state.getPoolState(concentrating, "concentration"), { max: 2, spent: 1, available: 1 },
    "концентрация читается из системных данных");

  // Карта активаций: только три типа что-то стоят.
  assert.equal(state.ACTIVATION_TO_POOL.action, "action");
  assert.equal(state.ACTIVATION_TO_POOL.bonus, "bonus");
  assert.equal(state.ACTIVATION_TO_POOL.reaction, "reaction");
  assert.equal(state.ACTIVATION_TO_POOL.special, undefined, "переключатели с активацией special ничего не стоят");

  // Локализация: каждый ключ из кода должен быть в обоих словарях.
  const fs = require("node:fs");
  const root = path.join(__dirname, "..");
  const dictionaries = ["ru", "en"].map(lang => [lang, JSON.parse(fs.readFileSync(path.join(root, "lang", `${lang}.json`), "utf8"))]);
  const pools = Object.keys(state.POOLS);
  const used = new Set();

  for ( const file of ["state.mjs", "settings.mjs", "economy.mjs", "ui.mjs", "main.mjs"] ) {
    const source = fs.readFileSync(path.join(root, "scripts", file), "utf8");
    for ( const match of source.matchAll(/ACTION_ECONOMY\.[A-Za-z0-9_.]*/g) ) {
      const key = match[0];
      // Ключи вида `ACTION_ECONOMY.Settings.show.${pool}` попадают сюда с точкой на конце.
      if ( key.endsWith(".") ) pools.forEach(pool => used.add(`${key}${pool}`));
      else used.add(key);
    }
  }

  assert.ok(used.size > 10, "ключи локализации найдены в коде");
  for ( const [lang, dictionary] of dictionaries ) {
    const missing = [...used].filter(key => !(key in dictionary));
    assert.deepEqual(missing, [], `нет перевода в lang/${lang}.json`);
  }

  // Манифест должен ссылаться только на существующие файлы.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
  const files = [
    ...manifest.esmodules ?? [],
    ...manifest.styles ?? [],
    ...(manifest.languages ?? []).map(entry => entry.path)
  ];
  for ( const file of files ) {
    assert.ok(fs.existsSync(path.join(root, file)), `файл из манифеста существует: ${file}`);
  }
  assert.equal(manifest.id, "action-economy", "id модуля совпадает с именем папки");

  console.log(`Смоук-тест пройден. Ключей локализации проверено: ${used.size}, файлов манифеста: ${files.length}.`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
