# Changelog

All notable changes to this module are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the module uses [semantic versioning](https://semver.org/).


## [0.1.2] — 2026-09-18

### Added

- Two toggles in the sheet header menu: show the tracker for me, and show it for this character.
- Tooltips on concentration pips naming what the character is currently holding.
- Automated releases: every push to the default branch bumps the patch version, writes this
  changelog and publishes a GitHub release with installation instructions.

### Changed

- The tracker is hidden for everyone until one of the two toggles is switched on.
- Pips are a black socket with a coloured light inside; spending puts the light out and leaves
  the socket in place.
- Reaction is turquoise, concentration has its own drawn icon, pools deplete from the right.

## [0.1.0]

First release.

### Added

- Tracker in the character sheet header for action, bonus action, free action, reaction and concentration.
- Automatic spending on `dnd5e.postUseActivity`, driven by the activity's activation type;
  activities with the `special` activation cost nothing.
- Manual control: click a free pip to spend it, a spent pip to restore it, the icon to refill the pool.
- A shortage prompt that warns and lets the player continue anyway, plus notification-only
  and do-nothing modes.
- Pool sizes raised by Active Effects through `flags.action-economy.max.<pool>`, with the
  Add, Multiply, Upgrade, Downgrade and Override modes.
- Per-character hard overrides and the native concentration limit in one dialog, available
  from the sheet header menu or by right-clicking the tracker.
- Automatic reset at the start of the character's turn and when combat ends.
- World settings for manual mode, shortage behaviour, out-of-combat tracking and per-resource
  visibility, plus a client setting to hide the tracker.
- Russian and English translations.
- A macro that creates ready-made Active Effect features (`tools/create-effects.js`).
