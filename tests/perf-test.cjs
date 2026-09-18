/**
 * Замер горячего пути модуля: расчёт максимумов пулов.
 *
 * Именно он выполняется чаще всего — при каждой перерисовке листа (пять пулов) и при каждом
 * использовании способности (один пул). Всё остальное в модуле либо O(1), либо разовое.
 *
 * Запуск: node action-economy/tests/perf-test.cjs
 */

const path = require("node:path");
const { pathToFileURL } = require("node:url");

globalThis.CONST = {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 }
};
globalThis.foundry = { utils: { isEmpty: obj => Object.keys(obj).length === 0 } };

/**
 * Актёр с эффектами, как на реальном персонаже: почти все изменения чужие
 * (Midi-QOL, DAE, бонусы системы), наших — единицы.
 */
function makeActor({ effects = 30, changesPerEffect = 4, ours = 2 } = {}) {
  const list = [];
  for ( let i = 0; i < effects; i++ ) {
    const changes = [];
    for ( let c = 0; c < changesPerEffect; c++ ) {
      changes.push({ key: `flags.midi-qol.advantage.attack.n${c}`, mode: 2, value: "1" });
    }
    list.push({ changes });
  }
  for ( let i = 0; i < ours; i++ ) {
    list.push({ changes: [{ key: "flags.action-economy.max.bonus", mode: 2, value: "1", priority: 20 }] });
  }

  return {
    type: "character",
    isOwner: true,
    flags: { "action-economy": { spent: { bonus: 1 } } },
    appliedEffects: list,
    system: { attributes: { concentration: { limit: 2 } } },
    concentration: { effects: new Set([{ name: "Концентрация" }]) },
    getFlag(scope, key) {
      return key.split(".").reduce((obj, part) => obj?.[part], this.flags[scope]);
    }
  };
}

function measure(label, iterations, fn) {
  fn(); // прогрев
  const started = process.hrtime.bigint();
  for ( let i = 0; i < iterations; i++ ) fn();
  const perCall = Number(process.hrtime.bigint() - started) / iterations / 1000;
  console.log(`${label.padEnd(52)} ${perCall.toFixed(1).padStart(7)} мкс`);
  return perCall;
}

(async () => {
  const state = await import(pathToFileURL(path.join(__dirname, "..", "scripts", "state.mjs")).href);
  const pools = Object.keys(state.POOLS);

  console.log("Стенд: расчёт максимумов, 20 000 повторов на замер\n");

  const cases = [
    ["обычный персонаж, 10 эффектов", { effects: 10 }],
    ["тяжёлый бой, 30 эффектов", { effects: 30 }],
    ["крайний случай, 80 эффектов", { effects: 80, changesPerEffect: 6 }]
  ];

  let worstRender = 0;
  for ( const [label, config] of cases ) {
    const actor = makeActor(config);
    const render = measure(`${label}: перерисовка виджета (5 пулов)`, 20_000,
      () => pools.forEach(pool => state.getPoolState(actor, pool)));
    measure(`${label}: использование способности (1 пул)`, 20_000,
      () => state.getPoolState(actor, "bonus"));
    worstRender = Math.max(worstRender, render);
    console.log("");
  }

  // Ориентир: кадр при 60 fps — 16 700 мкс. Виджет должен быть далеко за пределами заметности.
  const frame = 16_700;
  console.log(`Худшая перерисовка: ${worstRender.toFixed(1)} мкс — это ${(worstRender / frame * 100).toFixed(3)}% кадра.`);
  if ( worstRender > frame / 10 ) {
    console.error("Слишком дорого: расчёт занимает больше десятой части кадра.");
    process.exit(1);
  }
  console.log("Запас достаточный.");
})();
