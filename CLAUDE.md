# CLAUDE.md: TasmoFlow

No-code web interface to control and manage a Tasmota gateway (ZB-GW03 first): Zigbee and Tuya
devices, rules, Matter and administration.

## 1. Size rule (permanent)

* **This file never exceeds 150 lines.** It only holds short directives and the module index:
  no details, tutorials or large documentation.
* If an addition might exceed the limit: **stop**, create a module in `.claude/rules/` and only
  put here an index line pointing to it.
* This rule only changes at Guillaume's explicit request.

## 2. Language (permanent)

* **Code comments, documentation, commit messages, this file and `.claude/rules/` are written
  in English.**
* User documentation (`README.md`, `docs/*.en.md`) is written in English, the reference, and
  **translated into French** (`README.fr.md`, `docs/*.fr.md`). Any change to one is carried
  over to the other in the same commit.
* Conversations with Guillaume are in French.

## 3. `.claude/rules/` modules (loaded by Claude Code)

* Detailed instructions go into a `.claude/rules/` module, one topic per file.
* Claude Code loads these modules itself:
  * a module **without** a `paths:` header is loaded in every session;
  * a module **with** a `paths:` header (glob patterns) is only loaded when a matching file is
    read or edited. Every new specialised module has one.
* Do not use `@path` imports here: they load the file at startup. The index below uses plain
  Markdown links.

## 4. Module index

* [`project.md`](.claude/rules/project.md): context, hardware (no PSRAM, critical RAM), decisions, way of working (PRs, tags, checks).
* [`berry-pitfalls.md`](.claude/rules/berry-pitfalls.md): Berry pitfalls met in the extension.

See also: progress and next steps in [`docs/tracking.en.md`](docs/tracking.en.md).
