/**
 * Автоматика: списание ресурсов при использовании Activity, вопрос при нехватке,
 * сброс в начале хода и по окончании боя.
 *
 * Порядок хуков подтверждён игровым тестом с Midi-QOL 14.0.12:
 *   midi-qol.preItemRoll → dnd5e.preUseActivity → расход → dnd5e.beginConcentrating
 *   → dnd5e.postUseActivity → броски Midi.
 * То есть проверять ресурс надо в preUseActivity, а списывать в postUseActivity.
 */

import {
  ACTIVATION_TO_POOL, MODULE_ID, POOLS, blockingEffects, getPoolState, getSpent, isInCombat, isTracked, resetPools,
  setSpent, spend
} from "./state.mjs";
import { SHORTAGE, getSetting, isAutomatic } from "./settings.mjs";

/** Зарегистрированные хуки: имя → id, чтобы снимать их при смене настроек. */
const registered = new Map();

/** Использования, которые игрок уже подтвердил после предупреждения о нехватке. */
const confirmed = new WeakSet();

/* -------------------------------------------- */
/*  Регистрация                                 */
/* -------------------------------------------- */

function on(hook, fn) {
  registered.set(hook, Hooks.on(hook, fn));
}

/** Снять все хуки автоматики (нужно при смене настроек, чтобы не держать лишний код). */
export function unregisterEconomyHooks() {
  for ( const [hook, id] of registered ) Hooks.off(hook, id);
  registered.clear();
}

/** Повесить только те хуки, которые нужны при текущих настройках. */
export function registerEconomyHooks() {
  unregisterEconomyHooks();

  const automatic = isAutomatic();
  const shortage = getSetting("shortage");

  // Проверка и предупреждение. При «ничего не делать» обработчик не вешается вовсе.
  if ( automatic && (shortage !== SHORTAGE.NONE) ) on("dnd5e.preUseActivity", onPreUseActivity);

  // Само списание и кнопки расхода на карточке использования.
  if ( automatic ) {
    on("dnd5e.postUseActivity", onPostUseActivity);
    on("updateChatMessage", onUsageMessageUpdate);
  }

  // Сброс в начале хода и по окончании боя — только на стороне мастера, чтобы запись была одна.
  on("updateCombat", onUpdateCombat);
  on("deleteCombat", onDeleteCombat);

  // Отдых восстанавливает всё: хук срабатывает и на коротком, и на продолжительном.
  on("dnd5e.restCompleted", onRestCompleted);
}

/* -------------------------------------------- */
/*  Списание                                    */
/* -------------------------------------------- */

/** Пул, который стоит эта активность, либо null. */
function poolFor(activity) {
  const type = activity?.activation?.type;
  return ACTIVATION_TO_POOL[type] ?? null;
}

/** Актёр активности. */
function actorFor(activity) {
  return activity?.actor ?? activity?.item?.actor ?? null;
}

/** Учитываем ли сейчас этого актёра. */
function shouldTrack(actor) {
  if ( !isTracked(actor) || !actor.isOwner ) return false;
  if ( !getSetting("trackOutOfCombat") && !isInCombat(actor) ) return false;
  return true;
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  const actor = actorFor(activity);
  const pool = poolFor(activity);
  if ( !pool || !shouldTrack(actor) ) return true;

  // Повторный вызов после «Всё равно использовать».
  if ( confirmed.has(activity) ) {
    confirmed.delete(activity);
    return true;
  }

  const state = getPoolState(actor, pool);
  if ( state.available > 0 ) return true;

  // Обнулённый эффектом пул — это не «потрачено», а «запрещено»: сообщение другое.
  const label = game.i18n.localize(POOLS[pool].label);
  const blocking = (state.max <= 0) ? blockingEffects(actor, pool) : [];
  let message;
  if ( state.max <= 0 ) {
    message = blocking.length
      ? game.i18n.format("ACTION_ECONOMY.Notify.blockedBy", { pool: label, effects: blocking.join(", ") })
      : game.i18n.format("ACTION_ECONOMY.Notify.blocked", { pool: label });
  } else {
    message = game.i18n.format("ACTION_ECONOMY.Notify.spent", { pool: label, actor: actor.name });
  }

  if ( getSetting("shortage") === SHORTAGE.NOTIFY ) {
    ui.notifications.warn(message);
    return true;
  }

  // Спросить подтверждение нельзя прямо здесь: Hooks.call синхронный. Поэтому отменяем
  // использование, спрашиваем, и при согласии повторяем вызов теми же настройками.
  ui.notifications.warn(message);
  askAndRepeat(activity, usageConfig, dialogConfig, messageConfig, message);
  return false;
}

async function askAndRepeat(activity, usageConfig, dialogConfig, messageConfig, message) {
  let proceed = false;
  try {
    proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("ACTION_ECONOMY.Confirm.title") },
      content: `<p>${message}</p><p>${game.i18n.localize("ACTION_ECONOMY.Confirm.question")}</p>`,
      yes: { label: game.i18n.localize("ACTION_ECONOMY.Confirm.yes") },
      no: { label: game.i18n.localize("ACTION_ECONOMY.Confirm.no"), default: true },
      modal: true
    });
  } catch(err) {
    console.error(`${MODULE_ID} | не удалось показать вопрос о нехватке ресурса`, err);
    return;
  }
  if ( !proceed ) return;

  confirmed.add(activity);
  // Если повторный вызов до нашей проверки не дойдёт (его перехватит другой модуль),
  // метка не должна остаться навсегда: иначе следующая нехватка пройдёт без вопроса.
  setTimeout(() => confirmed.delete(activity), 5000);
  try {
    await activity.use(usageConfig, dialogConfig, messageConfig);
  } catch(err) {
    confirmed.delete(activity);
    console.error(`${MODULE_ID} | повторное использование активности не удалось`, err);
  }
}

function onPostUseActivity(activity, usageConfig, results) {
  const actor = actorFor(activity);
  const pool = poolFor(activity);
  if ( !pool || !shouldTrack(actor) ) return;
  spend(actor, pool).catch(err => console.error(`${MODULE_ID} | не удалось списать ресурс`, err));
}

/**
 * Кнопки «Возврат ресурса» и «Расход ресурса» на карточке использования.
 *
 * Своего хука у них нет: система вызывает `activity.refund()` и чистит `system.deltas`
 * у сообщения, а обратная кнопка снова их заполняет. Ловим именно это изменение.
 * Действует только клиент, который нажал кнопку, поэтому запись одна.
 */
function onUsageMessageUpdate(message, changed, options, userId) {
  if ( userId !== game.user.id ) return;
  if ( !foundry.utils.hasProperty(changed, "system.deltas") ) return;

  const activity = message.system?.activity;
  if ( !activity?.activation ) return;

  const actor = message.system?.actor ?? activity.actor;
  const pool = poolFor(activity);
  if ( !pool || !shouldTrack(actor) ) return;

  const refunded = foundry.utils.getProperty(changed, "system.deltas") === null;
  const spent = getSpent(actor, pool);
  setSpent(actor, pool, refunded ? spent - 1 : spent + 1)
    .catch(err => console.error(`${MODULE_ID} | не удалось вернуть ресурс`, err));
}

/* -------------------------------------------- */
/*  Сброс                                       */
/* -------------------------------------------- */

/** Сбросом занимается один клиент — активный мастер. */
function isResponsible() {
  return game.users.activeGM?.id === game.user.id;
}

function onUpdateCombat(combat, changed) {
  if ( !isResponsible() ) return;
  if ( !("turn" in changed) && !("round" in changed) ) return;
  const actor = combat.combatant?.actor;
  if ( isTracked(actor) ) reset(actor);
}

function onDeleteCombat(combat) {
  if ( !isResponsible() ) return;
  for ( const combatant of combat.combatants ) {
    if ( isTracked(combatant.actor) ) reset(combatant.actor);
  }
}

/**
 * Отдых. Хук выполняется на клиенте того, кто отдыхает, поэтому запись и так одна —
 * проверка на мастера тут не нужна, хватает прав на актёра.
 */
function onRestCompleted(actor) {
  if ( isTracked(actor) && actor.isOwner ) reset(actor);
}

function reset(actor) {
  resetPools(actor).catch(err => console.error(`${MODULE_ID} | не удалось сбросить ресурсы`, err));
}
