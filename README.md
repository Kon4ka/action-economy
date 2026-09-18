# Action Economy 5e

English · [Русский](./README.ru.md)

A Foundry VTT module for D&D 5e that keeps action, bonus action, free action, reaction and
concentration counters in the character sheet header, spends them when an activity is used,
and lets Active Effects raise the pools.

Verified on Foundry 14.367, dnd5e 5.3.3 and Midi-QOL 14.0.12.

## Installation

In Foundry: **Settings → Add-on Modules → Install Module**, then paste this manifest URL:

```
https://github.com/Kon4ka/action-economy/releases/latest/download/module.json
```

Or download the release archive and unpack it into `Data/modules/action-economy`.

## The tracker

Each row is one resource: an icon and a row of pips. There are as many pips as the pool has,
and spent ones turn black from the right. Pools longer than five pips wrap onto another line.

| Icon | Resource | Spent by |
| --- | --- | --- |
| Green circle | Action | automatically, activities with the Action activation |
| Orange triangle | Bonus action | automatically, Bonus Action activation |
| Blue drop | Free action | by hand only |
| Turquoise arrow | Reaction | automatically, Reaction activation |
| Pink ring | Concentration | the dnd5e system itself |

Activities with the `special` activation — toggles and passive switches — cost nothing.

Hovering a filled concentration pip shows what the character is holding; an empty one says the
slot is free. Manual mode does not affect this — concentration always comes from the system.

The tracker sits to the left of the rest buttons and takes no space in that row, so the header
layout stays exactly as the system draws it.

## Turning the tracker on

**Nobody sees the tracker by default.** It is switched on from the sheet header menu, by two
independent toggles — either one is enough:

- **"Show for me"** — for this user only, on every character sheet at once. The same switch
  lives in the module's client settings.
- **"Show for this character"** — for everyone, on this sheet only. Available to the sheet's
  owner and the GM; stored as a flag on the actor.

Picking the same entry again turns it back off.

## Controls

- **Click a free pip** — spend one.
- **Click a spent pip** — give it back.
- **Click the icon** — refill the whole pool.
- **Click a concentration pip** — end that concentration, after a confirmation.
- **Right-click the tracker** — the Action economy dialog: hard counts per resource and the
  concentration limit for this character. The same dialog lives in the sheet header menu.

Pools refill on their own at the start of the character's turn and when combat ends.

## Raising the pools with Active Effects

| Effect key | Pool |
| --- | --- |
| `flags.action-economy.max.action` | Action |
| `flags.action-economy.max.bonus` | Bonus action |
| `flags.action-economy.max.reaction` | Reaction |
| `flags.action-economy.max.free` | Free action |
| `system.attributes.concentration.limit` | Concentration, a native system field |

Add, Multiply, Upgrade, Downgrade and Override all work, priority is respected, and disabled
or suppressed effects are ignored. The module reads the effects itself instead of relying on
flag initialisation, so nothing is written into the actor's source data.

Multiple concentrations are a native dnd5e feature: when a new concentration starts, the system
compares the number of active ones with `system.attributes.concentration.limit` and only drops
the oldest once the limit is reached. A limit of 2 really holds two.

Ready-made features carrying these effects are created by the
[tools/create-effects.js](./tools/create-effects.js) macro — run it once as the GM, then drag
the features onto sheets.

## Settings

- **Manual mode** — the module never spends anything by itself.
- **When a resource runs out** — warn and ask for confirmation (default), notification only,
  or do nothing. The last option unregisters the handler entirely.
- **Track outside combat** — whether resources are spent when there is no combat.
- **Show action / bonus action / free action / reaction / concentration** — world settings:
  which resources exist on sheets at all.
- **Show the tracker for me** — the personal switch, off by default (see "Turning the tracker on").

## Scope and limits

- Player character sheets only (`actor.type === "character"`). NPCs are untouched.
- Extra Attack spends an action per use of the attack activity; click a pip to give it back.
- Free actions are never detected automatically — dnd5e has no such activation type.
- The tracker needs the stock dnd5e character sheet header. On third-party sheets the module
  stays quiet and simply does not draw anything.

## Compatibility

The module patches nothing. It registers six hooks, eight settings in its own namespace, and
inserts a single node into the sheet header. It writes only to `flags.action-economy` on the
actor, plus `system.attributes.concentration.limit` when you change that field yourself. No
prototype wrapping, no libWrapper, no `CONFIG` changes, no data model changes, no sockets, no
custom document types — so the usual "two modules wrapped the same method" conflicts cannot
happen here. Verified alongside Midi-QOL, DAE, Dnd5e Custom Skills and the Monks modules.

## How it works

Spending happens on `dnd5e.postUseActivity`, after the usage is committed but before the attack
roll, so Midi-QOL workflows are unaffected. The shortage prompt runs on `dnd5e.preUseActivity`:
because Foundry hooks are synchronous, the use is cancelled, the question is asked, and on
"use anyway" the activity is re-invoked with the same configuration.

State lives in `flags.action-economy.spent` on the actor; concentration is read from the system
and never duplicated.

## Development

- `node tests/smoke-test.cjs` — checks the pool maths without launching Foundry.
- `tools/standalone-macro.js` — the same behaviour as a single macro, for trying it out
  without installing the module.
- `tools/probe-*.js` — diagnostics for sheet markup, hooks and storage.
- [PLAN.md](./PLAN.md) — design notes and verified API facts (in Russian).

Every push to the default branch publishes a release: the workflow bumps the patch version,
writes the changelog from commit subjects, builds the archive and attaches installation
instructions. Put `[skip release]` in a commit message to skip it, or fill in the `Unreleased`
section of the changelog to write the release notes by hand.

## License

[MIT](./LICENSE).
