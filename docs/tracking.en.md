# Work tracking: TasmoFlow

*Version française : [tracking.fr.md](tracking.fr.md)*

State of the project, decisions, measurements and next steps, to resume work in a new
session. Architecture details and the test plan: [architecture.en.md](architecture.en.md).
Specification (French, outside the repository):
<https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix>.

## Status (9 November 2026)

- **v0.1 released**: tag `v0.1.0`, `.tapp` attached to the release, interface published on GitHub
  Pages (PRs #1 to #3 merged). Installed on the gateway: server start/stop, memory and the
  light interface after a restart checked; the other `[ ]` items of the test plan are left.
- **v0.2 started** (branch `claude/modest-pascal-8854i4`): step 1 **written and checked on the
  gateway** (editing, previous copy, restore): the **Rules** screen (`Rule1` to `Rule3` and Berry rules, edit, copy of the previous
  version before every write, restore, enable/disable, in the light interface too). Passes
  against the simulated gateway (`node tests/e2e.js`, 10 tests); the Berry code
  (`extension/tf_rules.be`) was only read, not compiled. Next: sentence editor, automations,
  Berry rule editing with compilation check, `autoexec.be`.

- **v0.0 (prototype) complete**, released as
  [v0.0.1](https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1) and checked on the
  gateway (ZB-GW03 with the local Tuya driver). The interface loads from GitHub Pages
  (header "v0.0.1 · github") and falls back to the local copy.
- [PR #1](https://github.com/gnatali/TasmoFlow/pull/1) merged (tracking files, `.claude/rules/`).
- **v0.1 (control)**: Preact + htm interface, API server on demand, Gateways screen, Tuya
  devices in the dashboard (details below).
- **Long URL crash fixed in the code** (10 November, branch `ccr-77cdec39-duy9lp`): cause found in
  Tasmota's source (the `re` matcher recurses once per URI character and overflows the 8 KB loop
  stack); `tf_http.be` now parses requests with `string.find()`. To check on the gateway with a
  test build (`.tapp` to install again): see the long URL item of the test plan.
- **Next**: work through the `[ ]` items of the
  [test plan](architecture.en.md#test-plan-on-the-gateway) on the ZB-GW03 (v0.1 and the new v0.2
  ones). Memory with the rule API measured on 11 November (below).

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
| 11 Nov | Update button (decision: the browser relays the `.tapp` from GitHub Pages): manifests `latest.json` / `dev/latest.json`, the light interface offers the update when the channel has a newer version (test builds: a different commit), the gateway checks size and SHA-256 and replaces itself (`tf_update.be`, `.bak` kept), the page waits for the restart (120 s at most). Simulated gateway: 414 above 512 characters instead of cutting the connection |
| 11 Nov | v0.2 merged (PR #5). The `v0.2.0` tag created on github.com made the `release` job fail ("Tag matches the VERSION file": `VERSION` was still `0.1.0`); `VERSION` bumped to `0.2.0`, the tag then has to be moved onto the new `main` |
| 11 Nov | **Update button validated on the gateway** (two updates in a row, the old `.bak` replaced the second time, nothing left over). Memory before and after, the power cut during the transfer and a wrong `sha256` are still to try |
| 11 Nov | Update button: third test build published (another docs-only commit) to repeat the update on the gateway |
| 11 Nov | Update button: first try failed on `bytes.tohex()` being upper case (the zip header check refused every file); fixed, the fixed `.tapp` installed by hand, second try with another docs-only commit |
| 11 Nov | Update button: first try on the gateway started with a second test build (a commit that only touches the docs, to give the manifest a different version) |
| 11 Nov | v0.2 step 4: Berry section (owner of each rule, `autoexec.be` read only: new route, `.tapp` to install again) and the conflict banner (same trigger, same device: toggles cancel, opposite orders, duplicates) |
| 11 Nov | Rules screen again after a second try: accordion instead of tabs; the trigger and command fields are one choice field (friendly name closed, tree with the current item highlighted open); fixed a rebuild of the edited text at every incoming event |
| 11 Nov | Rules screen redone after trying it on the gateway (desktop and phone): tabs per rule set, tiles in Sentences view, the edit form in a dialog; device information (`IEEEAddr`, `ModelId`...) no longer offered as a trigger |
| 11 Nov | v0.2 step 3: device pickers in the sentence editor (Zigbee triggers and `ZbSend` actions, Tuya `TuyaSend` actions, `SetOption83` read for the trigger key, plain-language sentences); `enabled: false` Tuya bindings now used for the controls; suggestion lists always complete (select, not datalist) |
| 10 Nov | v0.2 step 2: sentence editor (**Sentences** view of a rule set: When / If / Then / Else, raw blocks stay text, nothing rewritten until edited); unit tests of the rule model in CI; no change on the gateway |
| 10 Nov | v0.2 step 1 checked on the gateway (test build): editing, saving, previous copy and restore work. Found on the way: **a request line of 152 characters or more restarts the gateway** (112 passed), so long data goes in a POST body (`tf_http.be` now hands over `Content-Length` bodies; `/api/cmd` and `/api/rule_set` read them) |
| 10 Nov | Long URL crash explained from Tasmota's source: `re.match2()` runs re1.5's `recursiveloop()`, which recurses once per character of `(\S+)` with no depth limit, in the 8 KB stack of the loop task. `tf_http.be` parses the request line and headers with `string.find()` (request line up to 512 characters, else 414; headers 4 KB, else 431; body 3,000 bytes, else 413); `tests/tf_http_test.be` runs the parser on standard Berry in CI |
| 9 Nov | Test build without release: manual `Build` run publishes `dev/app.js` and a test `.tapp` (no SRI) on GitHub Pages; the `.tapp` is reinstalled only when `extension/` or the light interface change |
| 9 Nov | v0.1 released (tag `v0.1.0`); v0.2 started: Rules screen, `tf_rules.be` (read, write in chunks, copy of the previous version, restore), syntax check of rule sets in the interface, rules in the light interface |
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
| **v0.2** step 1 (Rules, POST), extension loaded, no interface open (11 November) | 75 KB, 76 KB | 39 KB, 39 KB | **8 to 9 KB** |
| **v0.2** step 1, interface open (10 November) | 52 KB | 55 KB | 32 KB |
| **v0.2** step 1, 5 minutes after closing it (11 November, two runs) | 70 KB, 70 KB | 39 KB, 39 KB | **14 KB** |

The budget of 15 KB holds with the rule API: **8 to 9 KB at rest, 14 KB five minutes after the interface was closed** (15 KB in v0.1). With an interface open the cost is 32 KB (25 KB in v0.1): `tf_rules.be` and the POST body add 7 KB while the server runs. The Tuya driver needs 45 KB free to start: 52 KB leaves 7 KB. Berry `HeapUsed` is back at 39 KB after closing, as in v0.1. About 6 KB of free heap are still not given back after the first opening (75 to 70 KB, same as v0.1: 75 to 69 KB), cause unknown (see the open point in the test plan).

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
   (`re`, no longer used by `tf_http.be` since 10 November; `introspect`, `sys`), or a reference
   still holding the `tf_http` class.
3. **Tuya devices in the dashboard** (F7.1 to F7.3): switches, dimmers, colour temperature, fan
   speed, readings, live updates, hidden without the driver.
4. **Several gateways** (F1): Gateways screen, link to copy, wake of a stopped server.

Left for v0.1 (small):

- **Colour of `light3`** bindings (`colour_data_v2`, `hhhhssssvvvv`): not offered yet.
- **Tuya sub-device names** with a comma, which `TuyaSend` cannot address.
- **`VERSION` is `0.2.0`** (11 November 2026). Bump it in a pull request **before** tagging a release: the
  `release` job refuses a tag that differs from `VERSION` (the first `v0.2.0` tag failed that way).
- **Checks on the gateway**: the `[ ]` items marked v0.1 in the test plan, in particular that
  the port 8384 `tcpserver` can be closed and listened to again, and `TuyaConfig` memory use.

**Agreed on 11 November 2026, to do later** (not started): a **simple guided mode** for the rule dialog (pick a device, say what happens to it in words, pick what to do), where Zigbee events are learned by pressing the button (the interface listens to the event stream and writes the trigger from what it just saw).

Next, in this order (to confirm with Guillaume): measure the memory of this version (at rest, interface open, after closing); open the pull request (the branch is about 40 commits ahead of `main`); bump `VERSION` to `0.2.0` before the tag, otherwise `latest.json` and the update button do nothing for gateways on a release.

v0.2, what is left after step 4: the **guided mode** (agreed, later), Matter in the pickers,
`elseif` and several triggers in the sentence editor, **automations** (a TasmoFlow automation becomes a
Tasmota rule or Berry code, Tuya triggers need Berry), **editing** Berry rules and `autoexec.be` with
copy before write and a compilation check. Steps 2 to 4 (sentence editor, pickers, Berry view and
conflicts) are written and tried on the gateway in part, see the test plan.

## Points to check

- **Long URL restarts the gateway** (port 8384, request line of 152 characters or more): cause
  found and fixed in the code (10 November, see
  [Request parsing without regular expressions](architecture.en.md#request-parsing-without-regular-expressions)
  and [investigations/long-url-crash.md](investigations/long-url-crash.md)). Left: the check on
  the gateway (test plan), the simulated gateway now answers 414 above 512 characters like the real one.

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
