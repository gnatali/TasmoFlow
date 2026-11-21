# Work tracking: TasmoFlow

*Version française : [tracking.fr.md](tracking.fr.md)*

State of the project, decisions, measurements and next steps, to resume work in a new
session. Architecture details and the test plan: [architecture.en.md](architecture.en.md).
Specification (French, outside the repository):
<https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix>.

## Status (9 November 2026)

- **`.tapp` halved** (11 November 2026, branch `claude/tasmoflow-tapp-reduction-t5ofde`, asked by
  Guillaume): 83,069 B in v0.2.0, **40,920 B** now (-51 %; `pack_tapp.py` budget 41,534 B, half of
  v0.2.0). The light interface keeps only device control and the update (rules, console,
  diagnostics left it: full interface only), without `preact/hooks`; the Berry files are minified
  at packing (CI compiles them and runs the parser test on the minified `tf_http.be`). **Works on the
  gateway** (12 November, Guillaume). Then the update's room check, which still asked for two new
  copies plus 20 KB, was redone from the real sizes (`/api/update_check`, size from `latest.json`):
  21 end-to-end tests pass, **checked on the gateway** (12 November, Guillaume). Details: [architecture](architecture.en.md#before-18-november-2026-a-light-interface-in-the-tapp); since 18 November 2026 the `.tapp` carries no interface at all ([local copy](architecture.en.md#local-copy-of-the-interface)).
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
- **Long URL crash fixed** (10 November, branch `ccr-77cdec39-duy9lp`): cause found in
  Tasmota's source (the `re` matcher recurses once per URI character and overflows the 8 KB loop
  stack); `tf_http.be` now parses requests with `string.find()`. **Checked on the gateway**
  (12 November, Guillaume).
- **Checked on the gateway on 12 November** (Guillaume): update room check, drivers detected at
  opening, long URLs, port 8384 closed and listened to again. The 6 KB of free heap not given back
  after the first opening are **not pursued** (Guillaume's decision).
- **Next**: work through the `[ ]` items of the
  [test plan](architecture.en.md#test-plan-on-the-gateway) on the ZB-GW03 (v0.1 and the new v0.2
  ones). Memory with the rule API measured on 11 November (below).

## History

| Date | Step |
| --- | --- |
| 21 Nov | **Tuya device sheet: feasibility** (Guillaume's plan): [investigations/tuya-device-details-2026-11.md](investigations/tuya-device-details-2026-11.md). Go without a firmware change for identity, codes, live values, sensors and Matter bindings (`TuyaConfig <device>`, `TuyaStatus`, events); types and ranges from a tuya-local catalogue (MIT, 2,018 product ids, keyed by the `productKey` of `TuyaScan`) on GitHub Pages; cloud API from the browser no-go (CORS limited to Tuya's sites, credentials rule). To do on the gateway: `TuyaConfig`, `TuyaStatus`, `TuyaScan 10` with `Heap`, and the devices' `product_key` to measure the coverage |
| 21 Nov | **Test plan v0.2, first run** (Guillaume): Sentences view, several triggers and `elseif`, Berry section (TasmoFlow's own `Tuya`/`TuyaConnected`/`TuyaDisconnected` rules hidden, as meant) **checked**. Found: with `SetOption83 1` the named devices vanished from the pickers, and a rule by address showed the device's name although it can never fire. Fixed: names with a space are trigger keys (Tasmota takes the trigger up to ` DO `, `xdrv_10_rules.ino`; the model and the rename follow), and a trigger whose key does not match `SetOption83` is flagged on its tile and in the form, with **Fix the trigger** (`keyMismatch()`); full interface only, no `.tapp` to install again. Then **a button's `Power` missing** (SNZB-01P: `ZbInfo` keeps only its battery): the pickers and the guided mode now offer the attributes seen in events and in the rule sets, and `Power` for a device with only its battery; `BatteryLastSeenEpoch` is no longer offered. Still open: conflicts (redo with real names), guided mode, *connected* triggers, update failure cases |
| 21 Nov | **Renaming devices** (asked for by Guillaume): **Rename** button on the Zigbee and Tuya cards (`rename.js`, `rename_model.js`), `ZbName` and the firmware's new `TuyaRename` (firmware repository, same branch, scenario 30, Matter endpoint kept); the rule sets that name the device are offered for rewriting (`ZbReceived#<name>#` with `SetOption83`, `ZbSend`, `TuyaSend`, `TuyaConnected#Name=`), Berry rules listed; consequences and solutions in the [architecture](architecture.en.md#renaming-devices). 36 end-to-end tests, 36 unit checks. No `.tapp` to install again (`app/src/` only); Tuya needs the new firmware flashed. **Checked on the gateway** (Guillaume, `0.2.0-dev.1a7f51a`, firmware `4bf2549`) |
| 21 Nov | T10 test: `.tapp` `0.2.0-dev.de52476` installed by hand (Guillaume); test builds made to update twice in a row. First update (to `0.2.0-dev.a6d0343`): passed, `one rename`; second (to `0.2.0-dev.fe5913e`): passed, `one rename`. **T10 checked on the gateway** (`.bak` right, no `.new` left); **T7 and T12 checked** too. Free heap 60 KB (conditions to confirm: 69 KB at rest on 20 November) |
| 21 Nov | **Memory measured in one run** (Guillaume, `0.2.0-dev.fe5913e`, firmware `fd7f7cc`, after `Br tasmota.gc()`): 67 KB at rest (15 KB), **43 KB** with the interface open (39 KB; 53 KB on 20 November, below the 45 KB the Tuya driver needs to start), 63 KB after closing (19 KB). The 10 KB with the interface open are **not pursued** (Guillaume's decision of 21 November 2026) |
| 21 Nov | **T10 fixed** (bug analysis): the update copies `TasmoFlow.tapp` to `.bak`, then renames the new file onto it in one step (littlefs replaces an existing file in one commit, checked in the sources along the way): a power cut leaves the old or the new version, never none; the two renames of before stay as a fallback; README line about renaming the `.bak`. **The `.tapp` must be installed by hand once** (the update code changed), then an update tells which way it took (`TFL: update installed (one rename)`) |
| 21 Nov | **T7, T12 fixed** (bug analysis): a rule save gets an id from `rule_set`, and an older save's steps answer `busy` (the interface says another interface is saving, writes and restores nothing); header names in any case, only a request with the token keeps the server awake, an EventSource that reconnects resumes from its `Last-Event-ID` instead of replaying the history. 34 end-to-end tests. **The `.tapp` must be installed again** (`extension/`) |
| 21 Nov | **Tuya command not answered: checked on the gateway** (Guillaume), with the firmware of 21 November (commit `fd7f7cc`, run 44893756664). The first firmware build of this fix (20 November) did not start: a new member in a solidified class of the driver; rewritten without one (firmware repository, `berry-pitfalls.md`) |
| 20 Nov | **T5 checked on the gateway** (Guillaume). **Tuya command not answered** (his second try: a lamp unplugged, then switched on before the driver noticed): `TuyaSend` answered `Done` and nothing showed for 35 s. The Tuya cards now wait 5 s for an event from the device after a command answered `Done`, else "The device did not answer the command." under the card (also for a sub-device of a Tuya gateway, which the driver cannot watch); its next event clears it. With it, the firmware's driver takes a device that does not answer a command within 5 s as lost (`no reply to command`, `TuyaDisconnected`; firmware repository, branch `ccr-a1ed84c3-jng9nv`, 30/30 scenarios, firmware built: **to flash**). Interface only here, no `.tapp` to install again. 34 end-to-end tests |
| 20 Nov | **Zigbee device that does not answer** (Guillaume's report, T11 tried on a cut Zigbee plug): Toggle showed Tasmota's raw answer `{"0xF397":{"Reachable":false}}`, and a mains plug showed "battery -1 %". Now the card says "The device does not answer (unreachable)" under it and "unreachable" in its line as soon as Tasmota publishes `Reachable:false` (`attributes_final`, `Z_Unreachable` in `xdrv_23_zigbee_6_0_commands.ino`), back to normal at the device's next message; a battery of -1 (unknown, `zd_battery` in `xdrv_52_3_berry_zigbee.ino`) is not shown. Interface only, no `.tapp` to install again. T5 is still to try with a **Tuya Wi-Fi** device (the plug cut was Zigbee). 34 end-to-end tests |
| 20 Nov | **Memory measured in one run** (Guillaume, after `Br tasmota.gc()`; 82 KB free without TasmoFlow): 69 KB at rest (**13 KB**), 53 KB with the interface open (**29 KB**, 16 KB over rest; 8 KB above the 45 KB the Tuya driver needs to start), 66 KB after closing every tab and `TFL: API server stopped` (**16 KB**, 3 KB not given back, 6 KB before). The earlier 46 / 51 KB readings came from mixed runs. The budget of 15 KB holds at rest; after the first opening it is 1 KB over |
| 20 Nov | **Cost at rest measured** (Guillaume, 5 minutes after `Restart 1`, after `Br tasmota.gc()`): 82 KB free without TasmoFlow, 69 KB with it: **13 KB at rest**, within the 15 KB budget. The 58 KB at rest of the row below was taken too soon after the restart. Against 69 KB, the 51 KB after closing would leave 18 KB not given back (6 KB before): to measure again in one run (rest, open, more than 5 minutes after closing every tab, `TFL: API server stopped` in the log) |
| 20 Nov | **Memory measured** (Guillaume, after `Br tasmota.gc()`, firmware with the solidified Tuya driver): 58 KB free at rest, 46 KB with the interface open (12 KB), 51 KB five minutes after closing it (7 KB not given back, 5-6 KB before: the known leftover, not pursued). Not comparable with the 75 KB of 11 November: the firmware changed since (Tuya driver of 18 November); the cost at rest needs a reading without TasmoFlow on this firmware. With the interface open, 46 KB free is 1 KB above what the Tuya driver needs to start (45 KB), 16 KB above its `tuya.json` threshold (30 KB) |
| 20 Nov | **Local copy checked on the gateway** (Guillaume): offline, delete and memory pass. Berry `HeapUsed`: 46 KB with the interface closed, 63 KB just after it loaded (39 and 55 KB in v0.2 step 1); free heap (`Status 4`) not taken, so the TasmoFlow cost is not computed |
| 19 Nov | **Checked on the gateway** (Guillaume): the T6/T9 `.tapp` installed by the update button (update with a local copy: passed), T6 and T9 pass, the local copy is saved. Left for the local copy: offline, delete, memory |
| 19 Nov | **T6, T9 fixed** (bug analysis): a fourth interface no longer makes them evict each other every 3 s (the oldest stream receives `event: stop`, its page stops reconnecting and offers **Resume**); port 8384 holds at most 10 connections (503 beyond), cuts a request incomplete after 10 s and an answer not taken 30 s after its end. 34 end-to-end tests pass, `tests/tf_http_test.be` checks the delays and the limit. `.tapp` 29,405 B. **The `.tapp` must be installed again** (the update button does it) |
| 18 Nov | **No interface in the `.tapp`, local copy** (decision of Guillaume, replacing that of 9 November): the light interface (`lite.js.gz`, 14 KB) is gone, the `.tapp` is **28,927 B** (was 42,369). The interface is loaded from the gateway's local copy when it has one for its version (`TasmoFlow.tapp.js`, saved from Diagnostics, SHA-256 checked against the `.tapp`'s `APP_SHA`), else from GitHub; with neither, `/tf` says so in one line. The update banner is in the interface (one click, no confirmation; **Later** hides it), and after an update the copy is saved again by itself. Zopfli and `tools/requirements.txt` dropped. 33 end-to-end tests pass. **The `.tapp` must be installed again by hand** (the update code changed), then save the copy once (Diagnostics) |
| 18 Nov | **T5, T8, T11 fixed** (bug analysis): the Tuya cards follow the driver's `TuyaConnected` / `TuyaDisconnected` (sub-devices follow their gateway), no Refresh needed; the light interface is loaded as `/lite.js?v=<version>`, so a browser cache never runs the previous one after an update; Zigbee Toggle and Pair show Tasmota's answer when it is not `Done`, like the Tuya cards. Robustness and restart items of the test plan checked by Guillaume (13 KB with the interface open). `.tapp` 42,369 B (131 B left). **The `.tapp` must be installed again** (`extension/`, the loader and the light interface) |
| 18 Nov | **Tuya configuration device by device** (end of T4): with the firmware of the same day (`TuyaConfig <device>` read entry by entry, sub-devices found), the interface asks `TuyaConfig <name>` for each device not known yet; never the whole `tuya.json`, no memory threshold any more. Older firmware: whole configuration read once for the sub-devices. `.tapp` 41,988 B. **The `.tapp` must be installed again**, and the firmware flashed (firmware repository, branch `claude/awesome-planck-mow2gg`) |
| 18 Nov | **T2 to T4 fixed** (bug analysis; T4 in part): an API handler that raises now gets a 500 answer (guard in `tf_http.be`, `cmdv()` safe), the interface gives up a request after 15 s; an event stream with more than 6 KB unsent is closed and the history is limited to 4 KB; `/api/devices` is streamed one device at a time; `TuyaConfig` is read once per gateway (then device by device, next entry). `lite.js.gz` compressed with Zopfli (`pip install -r tools/requirements.txt`), tighter Berry minifier; **`.tapp` budget raised to 42,500 B by Guillaume** (41,962 B). **The `.tapp` must be installed again** (`extension/` and the light interface). To check and measure on the gateway (test plan) |
| 18 Nov | **T1 fixed** (bug analysis): after a gateway restart an open interface no longer ignores the events. When the event stream comes back after a cut, the interface reads everything again, and starts over from event 0 when the gateway's counter went back. Simulated gateway: a restart numbers events from 1 again. 30 end-to-end tests. `.tapp` 41,526 B (8 B left); **the `.tapp` must be installed again** (`state.js` is in the light interface). To check on the gateway (test plan) |
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
| 12 Nov | **Drivers detected at opening** (asked by Guillaume): `S.drivers` (`zigbee`, `tuya`: running, starting, disabled, absent), `zigbee_state` added to `/api/status`; a driver that is not running has its functions off with a note. Full interface: looks again every 5 s while a driver starts (2 minutes at most) and turns it on by itself; light interface: off in every case, asks to reload the page, no loop. `.tapp` 41,352 B (budget 41,534). 24 end-to-end tests. **The `.tapp` must be installed again** (`extension/` and light interface changed); to try on the gateway (test plan item "drivers at opening") |
| 12 Nov | Test builds (`--dev`): Berry minified as in a release, but no size budget (the release build of each commit is still checked by CI). Tried for one build: test `.tapp` with the sources as they are (77 KB), dropped at Guillaume's request |
| 12 Nov | **Verified on the gateway** (Guillaume, test build 78): `light3` tabs, wheel and sliders, `light2` arc dial, brightness 1-100 %, held value without flicker, options hidden while the lamp is off or disconnected, names with a comma, light-interface dimmer. Left for v0.1: power cut during the update, wrong `sha256`, `TuyaConfig` memory (32 KB) |
| 12 Nov | `light2` / `light3` panel: a value just set stays on screen until the device reports it (3 s at most), no more flicker new / old / new; options hidden while the lamp is off or disconnected; the simulator now answers 0.4 s late. Full interface only |
| 12 Nov | Colour temperature (DP 23) as an open arc dial (270 degrees, warm to cool) in the `light2` panel and in the White tab of a `light3` with `dp_ct`; full interface only, no `.tapp` to install again for it |
| 12 Nov | `light2` panel like `light3` (brightness + warm-to-cool colour temperature, white mode sent first out of a scene) and brightness sliders from 1 % to 100 % (never 0, like the Tuya app), also in the light interface: the `.tapp` must be installed again (41,457 B, 77 B left) |
| 12 Nov | v0.1 leftovers written: colour of the `light3` bindings (full interface only, `tuya_colour.js` plugged in through `EXTRA.refine`; redone in the Tuya app's layout: tabs White / Colour following the device's mode, hue wheel, saturation and brightness sliders, brightness in White, no colour temperature without `dp_ct`) and Tuya devices whose name has a comma (addressed by their `id`, `sendName`). Simulated gateway: a `light3`, two devices with a comma. 24 end-to-end tests, 24 unit checks. The `.tapp` must be installed again; two new items in the test plan |
| 12 Nov | **Checked on the gateway** (Guillaume): update room check, drivers at opening, long URLs, port 8384 closed and listened to again. The 6 KB of heap not given back after the first opening: dropped, no more investigation |
| 12 Nov | **`VERSION` file removed, the git tag is the only source of the version** (the `release` job kept failing on a tag that differed from the file). `tools/version.py` resolves it (`TF_VERSION`, release tag, latest tag, `0.0.0`); the workflow fetches the tags and rebuilds `dist/` after the tests, which use a fixed version; no `.tapp` to install again (`extension/` unchanged) |
| 12 Nov | Halved `.tapp` checked on the gateway (Guillaume). The room check of the update did not follow the real sizes (two new copies plus 20 KB): now `/api/update_check?size=` (size from `latest.json`) before the download, and on the first piece, counts the free space, the `.bak` and a leftover `.new` against the new size plus 20 KB; the `.bak` is deleted only when needed. `.tapp` 40,920 B. 21 end-to-end tests |
| 11 Nov | **`.tapp` halved** (83,069 to 39,807 B): light interface reduced to device control and the update (its rules, console and diagnostics left: full interface only); its texts, styles and screens split from the full interface's (`i18n_full.js`, `style_full.css`, `views_full.js`), no `preact/hooks` (stores render again from the root); Berry minified by `pack_tapp.py` (token check), compiled and tested in CI; budgets 41,534 B (`.tapp`) and 14 KB (`lite.js.gz`) |
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
| **v0.2**, without TasmoFlow, 5 minutes after `Restart 1` (20 November) | 82 KB | | |
| **v0.2**, with TasmoFlow, 5 minutes after `Restart 1` (20 November) | 69 KB | | **13 KB** |
| **v0.2**, with TasmoFlow, interface open (20 November, same run) | 53 KB | | **29 KB** |
| **v0.2**, with TasmoFlow, after closing every tab, API server stopped (20 November, same run) | 66 KB | | **16 KB** |
| **v0.2**, T7/T10/T12 build, at rest (21 November) | 67 KB | | **15 KB** |
| **v0.2**, T7/T10/T12 build, interface open (21 November, same run; not pursued) | 43 KB | | **39 KB** |
| **v0.2**, T7/T10/T12 build, after closing every tab (21 November, same run) | 63 KB | | **19 KB** |
| **v0.2**, no interface in the `.tapp`, at rest after `Restart 1` (20 November, firmware with the solidified Tuya driver) | 58 KB | not taken | |
| **v0.2**, no interface in the `.tapp`, interface open (20 November) | 46 KB | 63 KB | 12 KB over rest |
| **v0.2**, no interface in the `.tapp`, 5 minutes after closing it (20 November) | 51 KB | 46 KB | 7 KB over rest |

The budget of 15 KB holds with the rule API: **8 to 9 KB at rest, 14 KB five minutes after the interface was closed** (15 KB in v0.1). With an interface open the cost is 32 KB (25 KB in v0.1): `tf_rules.be` and the POST body add 7 KB while the server runs. The Tuya driver needs 45 KB free to start: 52 KB leaves 7 KB. Berry `HeapUsed` is back at 39 KB after closing, as in v0.1. About 6 KB of free heap are still not given back after the first opening (75 to 70 KB, same as v0.1: 75 to 69 KB), cause unknown and **not pursued** (decision of 12 November 2026).

Target: 15 KB. Sizes (19 November 2026, no interface in the `.tapp`): `TasmoFlow.tapp` 28.7 KB (29,405 B, budget **42,500 B**, raised
by Guillaume on 18 November from 41,534, half of v0.2.0's 83 KB: 13.1 KB left), `app.js.gz` 36.3 KB (37,193 B, budget 120 KB; also the local copy, on the gateway's file system when saved). Ways to save more: [investigations/tapp-size-2026-11.md](investigations/tapp-size-2026-11.md).

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
   still holding the `tf_http` class. **Dropped on 12 November 2026**, no more investigation.
3. **Tuya devices in the dashboard** (F7.1 to F7.3): switches, dimmers, colour temperature, fan
   speed, readings, live updates, hidden without the driver.
4. **Several gateways** (F1): Gateways screen, link to copy, wake of a stopped server.

Left for v0.1 (small):

- **`light3` panel** (`colour_data_v2`): **written** (12 November 2026) like the Tuya app (tabs White / Colour, hue wheel, saturation and brightness), full interface only (`tuya_colour.js`), **verified on the gateway** (12 November 2026), with the `light2` arc dial, the held value and the options hidden while the lamp is off.
- **Tuya names with a comma**: **written** (12 November 2026): such a device goes by its `id` (Wi-Fi devices and Tuya gateways); a sub-device of a gateway has none and shows its readings only. **Verified on the gateway** (12 November 2026). The `.tapp` had to be installed again (`tuya.js` and `tuya_model.js` are in the light interface).
- **The version is the git tag** (12 November 2026, no more `VERSION` file): nothing to bump before tagging.
- **Checks on the gateway**: the `[ ]` items marked v0.1 in the test plan (the port 8384
  `tcpserver` closing and listening again was checked on 12 November), in particular `TuyaConfig`
  memory use.

**Guided mode** (agreed on 11 November 2026, **written** on 12 November 2026): a *Guided rule* tile opens a two-step dialog (pick a device, say what happens to it in words, pick what to do), where a Zigbee trigger can be learned by pressing the button (the interface listens to the event stream and writes the trigger from what it just saw). Full interface only, no `.tapp` to install again; **to try on the gateway with the real button** (test plan). Left for later: conditions in the guided dialog, Tuya and Matter triggers.

**`elseif`, several triggers and a *device connected* trigger** (12 November 2026): **written**, full interface only; to try on the gateway (test plan). Tasmota has no `and`/`or` between triggers, so several triggers are several blocks with the same actions. *Connected* is `ZbState#ShortAddr` for Zigbee (the device's announcement: mains devices only), and `TuyaConnected#Name` / `TuyaDisconnected#Name` for Tuya, which **needs the firmware repository's new driver** (branch to build and flash); see the [architecture](architecture.en.md).

v0.2.0 is tagged (12 November 2026). Next: measure the memory of the released version (at rest, interface open, after closing) and try the new items of the test plan on the gateway.

v0.2, what is left after step 4: the **guided mode** (written, to try on the gateway), Matter in the pickers,
**automations** (a TasmoFlow automation becomes a
Tasmota rule or Berry code, Tuya triggers need Berry), **editing** Berry rules and `autoexec.be` with
copy before write and a compilation check. Steps 2 to 4 (sentence editor, pickers, Berry view and
conflicts) are written and tried on the gateway in part, see the test plan.

## Points to check

- **Long URL restarts the gateway** (port 8384, request line of 152 characters or more): cause
  found and fixed (10 November), **checked on the gateway on 12 November** (see
  [Request parsing without regular expressions](architecture.en.md#request-parsing-without-regular-expressions)
  and [investigations/long-url-crash.md](investigations/long-url-crash.md)). Nothing left; the
  simulated gateway answers 414 above 512 characters like the real one.

- Writing a DP of a Tuya Zigbee device (TS0601, `EF00` cluster) with `ZbSend`: to try on a real
  device (needed for v0.3).

- **Bug analysis of 15 November 2026**
  ([investigations/bug-analysis-2026-11.md](investigations/bug-analysis-2026-11.md)): 12 findings
  sorted by priority and 10 improvement ideas. **T1 to T4 fixed** on 18 November 2026 (T4 with
  the firmware of the same day: `TuyaConfig <device>` read entry by entry), checked on the
  gateway by Guillaume; **T5, T8, T11 fixed** the same evening, to check (T8 went with the light
  interface); **T6, T9 fixed** on 19 November, checked on the gateway by Guillaume; T5 and T11 checked on 20 November; T7, T10 and T12 fixed and checked on 21 November: every finding is fixed and checked.

- **Reducing the `.tapp`** (18 November 2026):
  [investigations/tapp-size-2026-11.md](investigations/tapp-size-2026-11.md) lists the options
  with their gains. Zopfli was done, then the budget raised to 42,500 B; the same evening the light
  interface left the `.tapp` (28,927 B, 13.6 KB left): nothing more to do for now.

## Links

| What | Where |
| --- | --- |
| Repository | <https://github.com/gnatali/TasmoFlow> |
| Firmware | <https://github.com/gnatali/tasmota32-zbgw03-matter> (Tuya driver: `docs/tuya-local.en.md`) |
| Specification and roadmap (French) | <https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix> |
| Release v0.0.1 | <https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1> |
| Interface on GitHub Pages | `https://gnatali.github.io/TasmoFlow/v0.0.1/app.js` |
