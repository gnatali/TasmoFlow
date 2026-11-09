# Work tracking: TasmoFlow

*Version française : [tracking.fr.md](tracking.fr.md)*

State of the project, decisions, measurements and next steps, to resume work in a new
session. Architecture details and the test plan: [architecture.en.md](architecture.en.md).
Specification (French, outside the repository):
<https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix>.

## Status (9 November 2026)

- **v0.0 (prototype) complete**, released as
  [v0.0.1](https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1) and checked on the
  gateway (ZB-GW03 with the local Tuya driver). The interface loads from GitHub Pages
  (header "v0.0.1 · github") and falls back to the local copy.
- [PR #1](https://github.com/gnatali/TasmoFlow/pull/1) merged (tracking files, `.claude/rules/`).
- **v0.1 (control) written, to be checked on the gateway** (branch
  `claude/modest-pascal-8854i4`, not merged yet): Preact + htm interface, API server on demand,
  Gateways screen, Tuya devices in the dashboard. Everything passes against the simulated
  gateway (`node tests/e2e.js`, 9 tests); **nothing of it ran on a real gateway yet**, and the
  Berry changes were only read, not compiled (the CI does the syntax check).
- **Next**: install the v0.1 `.tapp` on the ZB-GW03, work through the new `[ ]` items of the
  [test plan](architecture.en.md#test-plan-on-the-gateway), measure the memory; then v0.2.

## History

| Date | Step |
| --- | --- |
| 5 Nov 2026 | Existing projects reviewed (none combines GitHub hosting, no-code editor and Zigbee gateway management), 20 decisions taken, specification and roadmap written, name TasmoFlow |
| 5 Nov | Findings from Tasmota's source: no response headers from Berry's `webserver`, `webserver_async` class compiled but not exposed, WebSocket server needs a rebuild, `.tapp` format, Extension Manager catalogue derived from `OtaUrl` |
| 5 Nov | v0.0 prototype written: Berry extension (ports 80 and 8384), interface without dependencies, `pack_tapp.py`, simulated gateway, CI |
| 5-6 Nov | Moved from the firmware repository to `gnatali/TasmoFlow`; CI fixed (`libreadline-dev`, `#-` block comments found by the Berry check) |
| 6 Nov | First load on the gateway: `'re' undeclared` in `tf_http.be` (missing `import re`, hidden by the CI check that predeclared `re`) |
| 6 Nov | First gateway tests: 10 of 11 passed. `/tf` fixed for typed addresses and bookmarks (`Referer` required by Tasmota) |
| 9 Nov | The firmware gained a local Tuya driver: specification, architecture and roadmap extended to Tuya devices (module F7) |
| 9 Nov | Decision: TasmoFlow manages **all rules** (`Rule1` to `Rule3`, Berry, its own automations) |
| 9 Nov | `CLAUDE.md` added; language rule applied (English code, docs and messages; French translation of user docs) |
| 9 Nov | All v0.0 checks passed, memory measured after `tasmota.gc()`; v0.0.1 tagged by Guillaume, GitHub Pages enabled |
| 9 Nov | v0.1: **Preact + htm chosen** (same screen: 6.6 KB gzipped against 6.3 KB for Lit, 5.4 KB for the prototype without dependency); interface bundled with esbuild (12.9 KB gzipped, then 14.6 KB with Tuya) |
| 9 Nov | v0.1: **option B decided**: full interface on GitHub Pages only (pinned, SRI), light interface (13.7 KB gzipped, devices + console + diagnostics) in the `.tapp`; second esbuild entry point of the same sources. Reason: `UfsFree` 148 KB of 320 KB and a full interface that will grow |
| 9 Nov | v0.1: API server on demand (`/tf`, `/tf?w=1`, 5 minutes idle), `tf_http.be` compiled lazily and trimmed; Gateways screen; Tuya devices (`TuyaEnable`, `TuyaStatus`, `TuyaConfig`, `TuyaSend`, `Tuya` rule on the event stream); simulated Tuya driver and tests |

## Measurements on the gateway

After `tasmota.gc()`, gateway running the Tuya driver (9 November 2026):

| Moment | Free heap | Berry `HeapUsed` | TasmoFlow cost |
| --- | --- | --- | --- |
| Before installation | 84 KB | 25 KB | |
| Extension loaded | 67 KB | 47 KB | 17 KB |
| Interface open | 65 KB | 48 KB | 19 KB |
| **v0.1**, extension loaded (API server not started) | 75 KB | 35 KB | **9 KB** |
| **v0.1**, interface open (cached `import`) | 63 KB | 48 KB | 21 KB |
| **v0.1**, interface open (uncached loading) | 59 KB | 48 KB | 25 KB |
| **v0.1**, 5 minutes after closing it | 69 KB | 39 KB | **15 KB** |

Target: 15 KB. Sizes: `TasmoFlow.tapp` 45 KB (budget 150 KB), `app.js.gz` 5.4 KB (budget
120 KB).

## Decisions still open

- **Extension Manager catalogue**: submit TasmoFlow to Tasmota's official catalogue, or
  publish one on `gnatali.github.io/extensions/` (requires `OtaUrl` on that host), or keep the
  manual installation.

## v0.1: what is written, what is left

Done in the code and the simulated gateway (see the [architecture](architecture.en.md)):

1. **Preact + htm** (decision of 9 November), `app/src/`, `npm run build`.
2. **Memory**: API server on demand, lazy uncached loading of `tf_http.be`, events recorded
   only while it runs, unused code removed. **Measured: 9 KB at rest, 15 KB after the first use**
   (target 15 KB), 25 KB with an interface open. The uncached loading gives back 10 KB of 16 KB
   when the server stops; **6 KB (Berry: 4 KB) stay allocated, cause unknown**. Suspects, to
   separate with the Berry console: the Tuya driver keeping data after `TuyaConfig` /
   `TuyaStatus` (run them by hand, then `Br tasmota.gc()`), modules loaded at first use
   (`re`, `introspect`, `sys`), or a reference still holding the `tf_http` class.
3. **Tuya devices in the dashboard** (F7.1 to F7.3): switches, dimmers, colour temperature, fan
   speed, readings, live updates, hidden without the driver.
4. **Several gateways** (F1): Gateways screen, link to copy, wake of a stopped server.

Left for v0.1 (small):

- **Colour of `light3`** bindings (`colour_data_v2`, `hhhhssssvvvv`): not offered yet.
- **Tuya sub-device names** with a comma, which `TuyaSend` cannot address.
- **Light interface scope for v0.2**: add enabling/disabling a rule and restoring the previous
  copy (see the table in the architecture), so that rules stay manageable without GitHub.
- **Bump `VERSION` to `0.1.0`** when Guillaume tags the release (the header still says 0.0.1).
- **Checks on the gateway**: the `[ ]` items marked v0.1 in the test plan, in particular that
  the port 8384 `tcpserver` can be closed and listened to again, and `TuyaConfig` memory use.

Then v0.2: all rules (`Rule1` to `Rule3`, Berry, automations), sentence editor, backup before
writing.

## Points to check

- Writing a DP of a Tuya Zigbee device (TS0601, `EF00` cluster) with `ZbSend`: to try on a real
  device (needed for v0.3).

## Links

| What | Where |
| --- | --- |
| Repository | <https://github.com/gnatali/TasmoFlow> |
| Firmware | <https://github.com/gnatali/tasmota32-zbgw03-matter> (Tuya driver: `docs/tuya-local.en.md`) |
| Specification and roadmap (French) | <https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix> |
| Release v0.0.1 | <https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1> |
| Interface on GitHub Pages | `https://gnatali.github.io/TasmoFlow/v0.0.1/app.js` |
