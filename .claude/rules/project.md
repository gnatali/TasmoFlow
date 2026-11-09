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

- Interface served **by the gateway** (`/tf` page), code loaded from GitHub Pages (pinned
  version + SRI) with a gzipped local copy in the `.tapp` as fallback. **Firmware untouched**:
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
- TasmoFlow manages **all rules**: `Rule1` to `Rule3`, Berry rules, its own automations; copy of
  the previous version before every write.

## Way of working

- `main` is protected: **changes go through a pull request**. Work on a branch, push it, open a
  PR when Guillaume asks.
- This environment cannot push tags (HTTP 403): Guillaume creates release tags `vX.Y.Z` (equal to
  `VERSION`) on `main`; the workflow then publishes the release and GitHub Pages.
- Before pushing: `npm run build` (interface, `app/src/` to `dist/app.js`), `node --check dist/app.js`,
  `python3 tools/pack_tapp.py` (size budgets), `node tests/e2e.js` (Playwright, simulated
  gateway; it builds first). CI also checks the Berry syntax: this environment cannot compile
  Berry, so re-read Berry diffs carefully.
- Check Tasmota internals in its source (firmware commit `TASMOTA_REF` of the firmware
  repository's workflow) before relying on them; cite the file in `docs/architecture.en.md`.
