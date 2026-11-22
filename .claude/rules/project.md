# Project: context, decisions, way of working

TasmoFlow is a no-code web interface for Guillaume's **eWeLink ZB-GW03** gateway running the
[tasmota32-zbgw03-matter](https://github.com/gnatali/tasmota32-zbgw03-matter) firmware
(Tasmota, Zigbee in EZSP, Ethernet, Matter, local Tuya driver). Language rules: `CLAUDE.md` § 2.

**Current state and next steps**: [docs/tracking.en.md](../../docs/tracking.en.md). Read it
before resuming work. The specification (French) lives outside the repository:
https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix

## Hardware (constraints that weigh on every choice)

- ESP32-D0WD, 4 MB flash, **no PSRAM**; 320 KB file system. **RAM is the critical resource.**
- Measure every change with `Heap` (`Status 4`, in KB) **after `Br tasmota.gc()`**: readings
  without it include uncollected garbage (24-30 KB measured instead of 17-19 KB).
- The firmware's Tuya driver needs **45 KB free** to start, **30 KB** to modify `tuya.json`,
  **35 KB** for the cloud import. TasmoFlow's budget: **15 KB** for the whole extension.

## Decisions (do not reopen without Guillaume)

- Interface served **by the gateway** (`/tf` page): one interface (`app/src/main.js`), loaded from
  the gateway's **local copy** when it has one for its version (`<tapp>.js`, saved from the
  Diagnostics screen, SHA-256 checked against the `.tapp`'s `APP_SHA`), else from GitHub Pages
  (pinned version + SRI). The `.tapp` carries **no interface** (decision of 18 November 2026 by
  Guillaume, replacing that of 9 November: the light interface, 14 KB of its 42, is gone; see
  `docs/architecture.en.md`). Budget `pack_tapp.py` 42,500 B (about 29 KB used). **Firmware untouched**:
  TasmoFlow is a Berry extension (`.tapp`), no `USE_CORS`, no rebuild.
- Second server on **port 8384** (`extension/tf_http.be`, copy of Tasmota's
  `webserver_async.be`) for the JSON API, CORS, gzip and Server-Sent Events.
- Single administrator, local network only, no MQTT, several gateways.
- Sentence editor ("When... If... Then..."); automations **run on the gateway**; generated Berry
  is shown read-only; Zigbee bindings are offered when possible.
- Interface in **French and English**, desktop and mobile equally; GPL v3; Preact + htm
  (chosen 9 November 2026, esbuild).
- Devices: Zigbee, Tuya Zigbee paired with the gateway (TS0601, `.zb` plugins) and local Tuya
  (Wi-Fi and Tuya gateway) **through the firmware's Tuya driver only** (`Tuya*` commands,
  `Tuya` rule event). Never show, store or send a Tuya local key or cloud credential.
- **Zigbee and Tuya devices are treated the same way** (Guillaume, 22 November 2026): a feature
  given to one family (card button, details sheet, rename, pickers...) is given to the other in the same
  change, with the same layout; shared logic goes in a common module (e.g. `sheet_model.js`).
- TasmoFlow manages **all rules**: `Rule1` to `Rule3`, Berry rules, its own automations; copy of
  the previous version before every write.

## Way of working

- `main` is protected: **changes go through a pull request**. Work on a branch, push it, open a
  PR when Guillaume asks.
- **The git tag is the only source of the version** (no `VERSION` file since 12 November 2026):
  `tools/version.py` resolves it (`TF_VERSION`, else the `vX.Y.Z` tag being built, else the latest tag,
  else `0.0.0`). Nothing to bump before tagging; the workflow checks out with `fetch-depth: 0` for the
  tags. A tag created too early is moved with `git tag -f vX.Y.Z origin/main && git push -f origin vX.Y.Z`
  (the run rebuilds from the tag; the release already made on github.com stays and gets the `.tapp`).
- This environment cannot push tags (HTTP 403): Guillaume creates release tags `vX.Y.Z` on `main`, with
  git or by publishing a release with a new tag on github.com; the workflow then creates (or completes)
  the release and publishes GitHub Pages.
- Tests without a release: Guillaume (or I, with `gh api -X POST repos/gnatali/TasmoFlow/actions/workflows/build.yml/dispatches -f ref=<branch>`) runs the
  `Build` workflow by hand on the branch (`workflow_dispatch`, job `preview`): it publishes the
  full interface at `.../TasmoFlow/dev/app.js` and a test `.tapp` (`dev/TasmoFlow.tapp`, no SRI).
  **Tell Guillaume when the `.tapp` must be installed again**: any change in `extension/` (the
  loader is in `tasmoflow.be`). A change to `app/src/` needs no reinstall, but a gateway with a
  local copy keeps running its copy: a test build's interface is only seen once the copy is
  deleted, or saved again with the `.tapp` of the same run (each run writes its own `APP_SHA`).
- The update button installs a `.tapp` with the code **already installed**: a change to the update
  code (`tf_update.be`, the loader) needs the new `.tapp` installed by hand once before it
  can be tested by updating (a bug of the zip header check, `tohex()` in upper case, showed this).
- Before pushing: `npm run build` (interface, `app/src/` to `dist/app.js`), `node --check dist/app.js`,
  `python3 tools/pack_tapp.py` (size budgets), `node tests/rules_model_test.js` (rule model),
  `node tests/e2e.js` (Playwright, simulated
  gateway; it builds first, with a fixed version 9.9.9, so run `npm run build` and `pack_tapp.py` again
  before using `dist/`). CI also checks the Berry syntax and runs `tests/tf_http_test.be`
  (request parser on standard Berry), on the sources and on the `.tapp`'s minified copies: this
  environment cannot compile Berry (building Berry here is refused), so re-read Berry
  diffs carefully.
- Check Tasmota internals in its source (firmware commit `TASMOTA_REF` of the firmware
  repository's workflow) before relying on them; cite the file in `docs/architecture.en.md`.

## Reporting a build (permanent rule, asked for by Guillaume on 21 November 2026)

After every `Build` run, give Guillaume the **`.tapp` URL** and the **version to check**:

- test build (`preview` job): `https://gnatali.github.io/TasmoFlow/dev/TasmoFlow.tapp`; version
  `<last tag>-dev.<commit>` (e.g. `0.2.0-dev.a4552d5`), read from
  `https://gnatali.github.io/TasmoFlow/dev/latest.json` once the run is over (`version`);
- release: `https://github.com/gnatali/TasmoFlow/releases/download/vX.Y.Z/TasmoFlow.tapp`
  (also `https://gnatali.github.io/TasmoFlow/vX.Y.Z/TasmoFlow.tapp`); version `X.Y.Z`
  (`https://gnatali.github.io/TasmoFlow/latest.json`).

Say where he checks it on the gateway: the header badge of `/tf` (`v<version> · local|github`) and
the boot log line `TFL: TasmoFlow <version>, API on port 8384 once an interface is opened`. Also
give the run number and result, the branch and commit, and whether the `.tapp` must be installed
again (`extension/` changed) or the update banner is enough.
