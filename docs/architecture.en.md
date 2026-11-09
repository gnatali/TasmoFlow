# TasmoFlow architecture

*Version française : [architecture.fr.md](architecture.fr.md)*

TasmoFlow leaves the firmware untouched: the interface is a Berry extension (`.tapp`) that
opens a second HTTP server on the gateway. Tasmota's main server cannot add headers from Berry;
this second server can.

The findings below come from Tasmota's source code, `development` branch, commit
`b7994b52c47777ea3f125723f2ba5db6d3669397` (5 November 2026). They are being checked on a
real ZB-GW03 (see the [test plan](#test-plan-on-the-gateway)).

## Two servers on the gateway

| Port | Server | Role |
| --- | --- | --- |
| 80 | Tasmota's web server | "TasmoFlow" button in the main menu, `/tf` page protected by the web password |
| 8384 | `tf_http.be`, Berry asynchronous server | JSON API, event stream, light interface; CORS and `Content-Encoding` headers; [only while an interface is open](#api-server-on-demand) |

The `/tf` page gives the interface the API address and a 128-bit token, created at first
start and kept in `persist`. Every `/api/*` route requires this token (`t` parameter); only
`/lite.js` is public.

### API server on demand

RAM is the critical resource, so the port 8384 server (`tf_http.be`) is not started at boot
(v0.1):

- `/tf`, once the password check has passed, starts it. `tf_http.be` is compiled at that moment
  (`load_module()`, `introspect.module('tf_http', true)`: loaded **without cache**, so
  `tasmota.gc()` frees it when the server stops): no RAM is spent while no interface is open.
  A plain `import` would cache the module for good, and fails at run time anyway: Tasmota only
  keeps the `.tapp` folder in `sys.path` while it loads the extension, so `load_module()` adds
  it back around the call. `tf_rules.be` (rule API, v0.2) is loaded the same way, with the
  server, and dropped with it.
- `/tf?w=1` also starts it, **without password and without returning any data**. It lets an
  interface open on another gateway wake this one (see [Several gateways](#several-gateways));
  the API itself still requires the token.
- The server stops after 5 minutes (`IDLE_MS`) without a request and without an open event
  stream. Events and the Zigbee and Tuya handlers only exist while it runs.
- An open interface whose event stream drops calls `/tf?w=1` again (at most every 10 s), which
  covers a gateway restart.

### Access to the `/tf` page

`webserver.check_privileged_access()` calls `HttpCheckPriviledgedAccess()`: HTTP Basic
authentication if `WebPassword` is set, then a check of the `Referer` header, which must come
from the gateway (unless `SetOption128 1`). Without a `Referer`, Tasmota refuses and sends
nothing back (`xdrv_01_9_webserver.ino`). `/tf` therefore first answers with a page that
reloads itself when the header is missing.

### Why a second port

- `webserver.content_open()` only sends the headers of `WSHeaderSend()`: `Server`,
  `Cache-Control`, `Pragma`, `Expires`. CORS is only added with `USE_CORS` at build time,
  which the official build does not set (`tasmota/tasmota_xdrv_driver/xdrv_01_9_webserver.ino`).
- The Berry `webserver` module has no function to add a response header
  (`lib/libesp32/berry_tasmota/src/be_webserver_lib.c`).
- The firmware compiles the `webserver_async` class, which handles headers, CORS and
  streamed responses, but does not expose it to Berry. The official Leds Panel extension
  ships its own copy; TasmoFlow does the same (`extension/tf_http.be`).
- The Berry WebSocket server (`be_wsserver_lib.c`) requires `CONFIG_HTTPD_WS_SUPPORT` at
  build time: real time therefore goes through Server-Sent Events on port 8384.

Consequences:

- **Several gateways**: an interface opened on gateway A can call gateway B's API, since
  port 8384 sends `Access-Control-Allow-Origin: *`. It needs B's token (see below).
- **Compressed light interface**: served with `Content-Encoding: gzip`, the browser
  decompresses it itself.
- **Real time**: `/api/events` keeps the connection open and pushes each Zigbee message as
  soon as it arrives, without polling.

### Several gateways

The interface's **Gateways** screen (v0.1):

- **This gateway**: a link `address:port#token` (the token is masked until shown), to copy and
  paste into another gateway's interface. The copy falls back to `execCommand` because the
  Clipboard API needs a secure context, which `http://<gateway>` is not.
- **Other gateways**: name, address and token kept in the browser (`localStorage` of the page's
  address: a list is per address, IP or name, used to reach the gateway). Test, use and remove.
  The header gets a selector as soon as one is saved.
- Switching gateway closes the event stream, clears the devices and reloads everything from the
  other API. B's server may be stopped: the interface first sends `/tf?w=1` to B's port 80
  (an opaque `no-cors` request: only its effect matters), then retries `/api/status` for 5 s.
- Port 80 is assumed for the main server of the other gateways.
- Tokens are not secrets between gateways of the same administrator, but they stay out of the
  interface unless asked for, and out of `/api/status`.

## Loading the interface

1. The browser opens `http://<gateway>/tf`.
2. The page loads `https://gnatali.github.io/TasmoFlow/vX.Y.Z/app.js` with the SRI hash
   computed at build time. An HTTP page may load an HTTPS script.
3. If GitHub does not answer within 3 s, or if the hash does not match, the page loads
   `http://<gateway>:8384/lite.js`, the **light interface** held, gzipped, in the `.tapp`. It
   says so in a banner and offers to retry.
4. If both fail, the page says so.

The script guards against starting twice: the GitHub copy may arrive after the timeout, when
the light interface is already running.

### Test build

`workflow_dispatch` of `build.yml` (job `preview`) publishes `dev/app.js` and `dev/TasmoFlow.tapp`
on GitHub Pages (`tools/publish_pages.sh`, branch `gh-pages`, shared lock with the release job).
`pack_tapp.py --dev` gives that `.tapp` `DIR = "dev"` and an empty `SRI`: the `/tf` page adds
`?t=<millis>` to the address (never cached) and no `integrity`. The version reads
`X.Y.Z-dev.<commit>` and the interface header shows its own build (`TF_BUILD`, esbuild `define`).
Deliberately unpinned: for tests only, the release `.tapp` stays pinned (see "Not unpinned"
below). Reinstalling the `.tapp` is only needed when `extension/` or the light interface changed.

### Full interface on GitHub, light interface on the gateway

Decision of 9 November 2026 (option B of the analysis; it replaces "the same full copy in both
places" of v0.0):

| | Full interface (`dist/app.js`) | Light interface (`dist/lite.js`) |
| --- | --- | --- |
| Where | GitHub Pages only, `vX.Y.Z/`, pinned by the `.tapp` with its SRI hash | In the `.tapp` as `lite.js.gz`, served on port 8384 |
| Used | Normally | When the browser cannot reach GitHub (no internet, GitHub down, wrong hash) |
| Content | Everything: devices, events, console, Gateways, and later rules, sentence editor, scenes, administration | Devices (Zigbee and Tuya, switches, sliders, pairing), console, diagnostics, French and English |
| Source | `app/src/main.js` | `app/src/main_lite.js`: same code, fewer tabs (`boot.js`) |
| Budget (gzipped) | 120 KB | 25 KB |

Light interface, since v0.2: enable or disable a rule and restore the previous copy of a
rule, so that rules stay manageable without GitHub. Never in the light interface: sentence
editor, groups, scenes, Zigbee plugins, administration (OTA), several gateways.

Why:

- The **browser**, not the gateway, needs internet to load the full interface. Rules and
  automations run on the gateway: without internet nothing stops, only editing is unavailable.
  Tasmota's own pages stay the last resort (Zigbee list, console, `/tuya`, Matter).
- **File system**: `UfsFree` was 148 KB of 320 KB (9 November 2026), and the full interface
  will grow (rule and sentence editor, scenes, administration). A full local copy would eat the
  room that rule backups (copy before every write), `tuya.json.bak` and imports need.
- **Not unpinned**: the full interface stays pinned to the installed version with its SRI hash.
  An unpinned interface would run whatever GitHub serves in a browser holding the gateway's
  token and full control of Tasmota. Updating it still means a new `.tapp`. A later "update the
  interface" button could write the new version and its hash to `persist` after the user's
  approval, which would decouple the two while keeping SRI (the full interface would then have
  to stay compatible with older APIs).
- **Kept local, light**: GitHub (account, Pages, repository) must not be a single point of
  failure for controlling the gateway.
- The light interface is another entry point of the same sources, so no second code base:
  same API client, same Tuya model, same texts. Today it is only 1 KB smaller (13.7 against
  14.9 KB gzipped); the gap grows with the full interface.
- The full interface cannot be moved to `https://gnatali.github.io` to manage gateways from
  one place: an HTTPS page calling `http://<gateway>` is blocked (mixed content, Private
  Network Access). It must stay loaded by the gateway's HTTP page.
- Users who want no GitHub at all (`pack_tapp.py --cdn ''`) only get the light interface.

## Port 8384 API

| Route | Response |
| --- | --- |
| `GET /lite.js` | Light interface (gzip), sent in 1 KB chunks |
| `GET /api/status?t=` | Versions, free memory, file system, Zigbee state, number of devices |
| `GET /api/devices?t=` | Zigbee devices: address, name, model, manufacturer, LQI, battery, last message, last attributes |
| `GET /api/cmd?t=&c=` | Runs a Tasmota command (`c`, encoded) and returns its JSON response |
| `GET /api/events?t=&since=` | SSE stream; first sends the kept events after `since` (50 at most) |
| `GET /api/rules?t=` | The three Tasmota rule sets (state, options, text, free space, previous copy) and the Berry rules (`tf_rules.be`) |
| `GET /api/rule_set?t=&n=&i=&x=[&last=1]` | Writes rule set `n`, text in chunks `x` (`i` = 0, 1, 2...), applied on `last` |
| `GET /api/rule_restore?t=&n=` | Puts the previous copy of rule set `n` back |

Events carry a sequence number and a `type`: `zigbee` (`device`, `name`, `attrs`) and `tuya`
(`name`, `dps`, from the driver's `Tuya` rule).

The asynchronous server only handles `GET`: commands go in the address. A `GET` request
without custom headers does not trigger an `OPTIONS` preflight request.

## Extension format

- A `.tapp` is an **uncompressed** zip, like the official extensions
  (`https://ota.tasmota.com/extensions/tapp/`).
- `manifest.json` holds `name`, `version` (Tasmota format, `0x00000100` for 0.0.1),
  `description`, `author`, `min_tasmota`.
- At boot, Tasmota loads the `.tapp` files of `/.extensions/`, then those of `/`
  (`embedded/tapp.be`). A file inside is read with `open(tasmota.wd + "file")`.

### Extension Manager catalogue

The Extension Manager builds its catalogue address from the host of `OtaUrl`:
`<scheme>//<host>/extensions/extensions.jsonl`. If that file does not exist, it falls back to
the official catalogue (`embedded/extension_manager.be`, `load_manifest()`).

With the firmware's current `OtaUrl` (`github.com`), the official catalogue is shown. Three
ways:

1. Submit TasmoFlow to Tasmota's official catalogue.
2. Publish a catalogue at `https://gnatali.github.io/extensions/` (`extensions` repository
   with GitHub Pages) and point `OtaUrl` to the same host, for example a firmware published on
   `gnatali.github.io`. This is a setting, not a rebuild.
3. Install the `.tapp` by hand with Tasmota's file manager, as the prototype does.

## Zigbee API in Berry

| Need | API |
| --- | --- |
| Device list | `for d: zigbee`; `zigbee.find(address or name)` |
| Device fields | `shortaddr`, `longaddr`, `name`, `model`, `manufacturer`, `lqi`, `battery`, `battery_lastseen`, `lastseen`, `reachable`, `router`, `hidden`; `d.info()` for the last attributes |
| Events | `zigbee.add_handler(object)`; methods `frame_received`, `attributes_raw`, `attributes_refined`, `attributes_final` |
| Network | `zigbee.info()`: channel, PAN ID, coordinator addresses |
| Commands | `tasmota.cmd("ZbSend ...")`, `ZbBind`, `ZbPermitJoin`, `ZbName`... |

TasmoFlow listens to `attributes_final`, called once per decoded message
(`xdrv_23_zigbee_2a_devices_impl.ino`).

## Tuya devices

Since 9 November 2026, the `tasmota32-zbgw03-matter` firmware includes a local Tuya driver
([driver guide](https://github.com/gnatali/tasmota32-zbgw03-matter/blob/main/docs/tuya-local.en.md),
[examples](https://github.com/gnatali/tasmota32-zbgw03-matter/blob/main/docs/tuya-local-examples.en.md)).
TasmoFlow always goes through this driver: it does not reimplement the Tuya protocol and never
handles a local key.

### Three device families in a single list

| Family | State | Command | Events |
| --- | --- | --- | --- |
| Zigbee paired with the ZB-GW03 | Berry `zigbee` API | `ZbSend` | `attributes_final` |
| Tuya Zigbee paired with the ZB-GW03 (TS0601, EF00 cluster) | Berry `zigbee` API; DPs translated by a `.zb` plugin | `ZbSend` (writing DPs to be checked) | `attributes_final` |
| Tuya Wi-Fi (protocols 3.3, 3.4, 3.5) | `TuyaStatus` | `TuyaSend` | `Tuya` rule |
| Zigbee sub-device of a Tuya gateway | `TuyaStatus` | `TuyaSend` | `Tuya` rule |

### Driver API used by TasmoFlow

| Need | Command or event | Response |
| --- | --- | --- |
| Driver state | `TuyaEnable` | `{"TuyaEnable":{"Enabled":true,"State":"running"}}` (`State`: `running`, `disabled`, `waiting for Zigbee`...) |
| Device state | `TuyaStatus [device]` | `Connected`, `Ip`, `Version`, `Dps` (only the DPs kept in memory) |
| Configuration without keys | `TuyaConfig [device]` | `tuya.json` entries, key replaced by `***` |
| Command | `TuyaSend <device>,<dp or code>,<value\|toggle>` | `{"TuyaSend":"Done"}` or the error (`Device not connected`...) |
| Enable, disable | `TuyaActive <name>[,<name>...],<0\|1>` | devices, sub-devices or Matter bindings |
| Add, edit, delete | `TuyaAdd <json>` (`"key":"***"` keeps the key), `TuyaDel`, `TuyaReload` | |
| Discovery, import | `TuyaScan [s]`, `TuyaImport [file] [all\|ids]`, `TuyaCloud` (saved credentials) | result published at the end: `{"TuyaScan":{...}}`, `{"TuyaCloud":{...}}` |
| Matter | `TuyaMatter [names]` | endpoints created, `Restart 1` required |
| State change | `tasmota.add_rule("Tuya", ...)` | `{"Tuya":{"Name":"Ventilateur","Dps":{"62":3}}}` |
| Readings | `SENSOR` telemetry | `{"Tuya":{"Pince":{"Puissance":592,...}}}` |

The Tasmota rule `Tuya#Dps#<dp>` does not see the device name: TasmoFlow filters in Berry, as
the driver's documentation recommends.

### Meaning of the DPs

The driver only keeps the DPs it uses: those of the Matter bindings (`relay`, `relay_power`,
`light0` to `light3`, `fan`, `temp`, `humidity`), of the `sensors`, the boolean DPs and those
of `keep`. The Matter bindings give their meaning: TasmoFlow derives the controls to show from
them (switch, dimmer, colour temperature, colour, speed). Without a binding, it offers to
toggle the boolean DPs. The `codes` table (imported devices) stays in `tuya.json`: reading it
goes through `TuyaConfig`, which loads the whole file.

### Tuya Zigbee paired with the ZB-GW03

Tuya TS0601 devices send their DPs in the `EF00` cluster. Without a plugin, Tasmota shows them
raw (`EF00/0401`). A `.zb` plugin in the file system translates them into standard attributes;
Tasmota provides about ten of them (`tasmota/zigbee/` in its repository):

```
#Z2Tv1
:TS0601,_TZE200_3towulqd
EF00/0401=0406/0000   # Occupancy
EF00/020C=0400/0000   # Illuminance
EF00/0204=0001/0021,mul:2
```

TasmoFlow (v0.3) will report the raw DPs, offer a plugin from Tasmota's library or build one
with a mapping editor, then load it (`ZbLoad`).

### In the interface (v0.1)

`loadTuya()` runs after the Zigbee devices, one command at a time (each loads driver data):

1. `TuyaEnable`: no `TuyaEnable` key in the answer (`{"Command":"Unknown"}`) means no driver;
   `Enabled: false` means disabled; any `State` other than `running` is shown as waiting. In
   the first two cases **no Tuya screen is shown**.
2. `TuyaStatus`: every device and sub-device (name, `Connected`, `Ip`, `Version`, `Dps`).
3. `/api/status`, then `TuyaConfig` **only if at least 32 KB are free** (the driver refuses
   below 30 KB, and `TuyaConfig` loads the whole `tuya.json`). Otherwise the cards fall back to
   toggles for the boolean DPs and say so.

Changes arrive through the event stream: the extension adds a Berry rule
`tasmota.add_rule("Tuya", closure, 'tasmoflow')` while its server runs (a closure, because
`check_not_method` refuses methods; the id lets `remove_rule` remove only TasmoFlow's rule;
`tasmota_class.be`). Its value is the `{"Name","Dps"}` map itself.

Controls come from the Matter bindings of `tuya.json` (`controlsFor` in `app/src/tuya_model.js`):

| Binding `type` | Controls |
| --- | --- |
| `relay`, `relay_power` | switch on `dp` (default 1); `relay_power`: power, voltage, current readings (`dp_power`, `div_power`...) |
| `light0` to `light3` | switch on `dp` (default 20); `light1`+: dimmer on `dp_bri` (22, `bri_min` 10 to `bri_max` 1000, shown 0-100 %); `light2`: colour temperature on `dp_ct` (23, 0-1000) |
| `fan` | switch on `dp` (60) and speed on `dp_speed` (62, `speed_min` 1 to `speed_max` 6) |
| `temp`, `humidity` | reading on `dp`, divided by `div` (10) |
| `sensors` (device) | one reading per label: `[dp, divisor, unit]` |
| none | `toggle` on each boolean DP |

`TuyaSend <device>,<dp>,toggle` flips a switch; sliders send the raw value. The state shown is
the one reported back by the device (no optimistic display). The colour of `light3` is not
offered yet. Device names containing a comma cannot be addressed by `TuyaSend`.

### Memory

The driver waits for **45 KB free** to start, and requires **30 KB** to modify `tuya.json`,
**35 KB** for the cloud import. TasmoFlow checks the free memory (`tasmota.memory()`) before
these actions. Measured on a gateway running both the driver and TasmoFlow, each time after
`tasmota.gc()` (`Heap` and Berry `HeapUsed` of `Status 4`, 9 November 2026):

| Moment | Free heap | Berry `HeapUsed` | TasmoFlow cost |
| --- | --- | --- | --- |
| Before installation | 84 KB | 25 KB | |
| Extension loaded | 67 KB | 47 KB | 17 KB |
| Interface open | 65 KB | 48 KB | 19 KB |

The first readings of 6 November, without `tasmota.gc()` (90.4, 66.1 then 60.6 KB), counted
garbage that Berry had not collected yet. TasmoFlow was 2 to 4 KB above its 15 KB target. v0.1 starts the port 8384 server only while an
interface is open, compiles `tf_http.be` at that moment, records events only while it runs, and
removes the unused code of `tf_http.be` (chunked encoding, two helpers). Measured on 9 November
2026 after `tasmota.gc()`, against the same 84 KB / 25 KB baseline:

| Moment | Free heap | Berry `HeapUsed` | TasmoFlow cost |
| --- | --- | --- | --- |
| v0.1, extension loaded (API server not started) | 75 KB | 35 KB | **9 KB** |
| v0.1, interface open (cached `import`) | 63 KB | 48 KB | 21 KB |
| v0.1, interface open (uncached loading) | 59 KB | 48 KB | 25 KB |
| v0.1, 5 minutes after closing it (`TFL: API server stopped`) | 69 KB | 39 KB | **15 KB** |

At rest the 15 KB target is met (17 KB before). With an interface open the cost is 2 to 6 KB
above v0.0: `tf_http.be` compiled (about 12 KB) plus the server; the free heap also depends on
the connections open at that moment. The uncached loading works: after the server stops, 10 KB
of the 16 KB added come back (Berry: 9 of 13 KB). **About 6 KB (Berry: 4 KB) stay allocated**
compared with the state before the first opening; the cause is not identified yet (see
`docs/tracking.en.md`). After the first use the cost is 15 KB, right on the target. `UfsFree` was
148 KB of 320 KB on the same gateway.

### What TasmoFlow does not do

- Show, store or send a local key or the Tuya cloud credentials: entering them stays on the
  driver's page (`/tuya`).
- Work without the driver: on a Tasmota without the Tuya driver, or with the driver disabled
  (`TuyaEnable 0`), the Tuya screens are hidden.

## Rules

TasmoFlow manages every rule of the gateway (decision of 9 November 2026): Tasmota rule sets,
Berry rules and its own automations. Findings from Tasmota's code at the firmware's commit
`a281cece` (`tasmota/include/tasmota.h`, `xdrv_10_rules.ino`, `embedded/tasmota_class.be`):

| Item | Limit | Commands |
| --- | --- | --- |
| Tasmota rule sets | 3 (`Rule1` to `Rule3`), 512 characters each; beyond that, Unishox compression up to about 2 KB | `Rule<n> <text>`, `Rule<n> +<text>` (append), `Rule<n> ""` (clear); `0`/`1`/`2` off, on, toggle; `4`/`5`/`6` "once" option; `8`/`9`/`10` "stop on error" option |
| Variables | `Var1` to `Var16` (lost at restart), `Mem1` to `Mem16` (kept) | `Var<n>`, `Mem<n>` |
| Timers | `RuleTimer1` to `RuleTimer8` | `RuleTimer<n> <s>` |
| Berry rules | no limit; `tasmota._rules` lists each trigger (`trig.rule`) and its id | `tasmota.add_rule`, `tasmota.remove_rule` |

Plan (v0.2 step 1, **written**, to check on the gateway: the **Rules** screen, `extension/tf_rules.be`,
`app/src/rules.js`, `rules_lint.js`; the sentence editor and automations come next):

- **Reading.** The three rule sets (text, state, options), the loaded Berry triggers and
  `autoexec.be` (only the first two so far; TasmoFlow's own `tasmoflow` Tuya rule is hidden). An `on ... do ... endon` whose syntax is recognised is shown as a sentence; the
  others stay as text.
- **Writing.** Every change goes through a copy of the previous version on the gateway (one-click
  restore), a syntax check (Tasmota rule) or a compilation (Berry) before saving, and the
  display of the space left in the rule set. Implemented: the gateway copies the current text to
  `/tf_rule<n>.bak` (one previous copy per rule set), writes `Rule<n> <text>`, reads the rule set
  back and puts the old text back if it differs. The text travels in chunks of 300 characters
  (`/api/rule_set`) because the port 8384 server only reads a short request line. A restore
  swaps the two texts, so it can be undone. The interface checks `on <trigger> do ... endon`
  (advisory, `rules_lint.js`); the Tasmota rule engine has no syntax-check command. The Berry
  compilation check comes with Berry editing.
- **Engine of choice.** A TasmoFlow automation becomes either a Tasmota rule (independent of
  Berry, limited space) or Berry code (no limit, advanced conditions and timers).
- **Conflicts.** Two rules acting on the same device are reported: for example a Tasmota rule
  and a Google Home automation that both toggle the same light cancel each other.
- **Crash protection.** After several quick crashes, Tasmota starts without Berry and disables
  every rule: TasmoFlow reports it and offers to enable them again.

## Test plan on the gateway

Results of 6 and 9 November 2026 (gateway with the Tuya driver). `[x]` passed, `[ ]` to do. v0.0 is complete; the open checks below belong to v0.1.

- [x] Copy `TasmoFlow.tapp` to `/.extensions/` (or `/`) and restart: the log shows `TFL: TasmoFlow 0.0.1, API on port 8384` (`API sur le port 8384` in the version tested on 6 November)
- [x] Install while running (`tasmota.load("/.extensions/TasmoFlow.tapp")` in the Berry console): the button and `/tf` answer without a restart
- [x] The "TasmoFlow" button appears in the main menu
- [x] With `WebPassword` set, in a private window (otherwise the browser sends the password already entered for Tasmota), `/tf` asks for the password; `curl -i "http://<gateway>/tf?r=1"` answers `401 Unauthorized`
- [x] `http://<gateway>/tf` typed in the address bar (without the button) opens the interface
- [x] Without internet access, `/tf` loads the local copy (Diagnostics tab: "local"); since v0.1 this copy is the light interface (banner, header "· lite"), to check again
- [x] `open(tasmota.wd + "app.js.gz", "rb")` reads the file inside the `.tapp`, and the browser decompresses the local copy (`lite.js.gz` since v0.1)
- [ ] v0.1: with the browser offline (or `gnatali.github.io` blocked), `/tf` shows the light interface: devices with toggles, console and diagnostics work, the Gateways and Events tabs are absent, "Retry" loads the full interface once GitHub answers
- [x] The device list matches `ZbStatus1`
- [x] A Zigbee button press shows up in the Events tab within 2 s
- [x] "Toggle" switches a light on and off; "Pair" opens pairing for 60 s
- [x] Memory, each time after `tasmota.gc()` in the Berry console: 84 KB free before installation, 67 KB with the extension loaded, 65 KB with the interface open, i.e. 17 then 19 KB (target: 15 KB, see [Memory](#memory))
- [x] Two tabs open plus a third: the gateway stays stable (3 Chrome tabs and 1 Android)
- [ ] An interface opened on gateway A reads gateway B's `/api/status` (B's token, Gateways screen); with B's API server stopped, the screen wakes it through `/tf?w=1`
- [x] With GitHub Pages enabled (tag `v0.0.1`), `/tf` loads the GitHub copy (header: "v0.0.1 · github")
- [x] Chrome, Firefox, Safari on iPhone: the interface loads and the event stream stays open
- [x] Matter keeps working (Google Home still controls its devices)
- [x] The Tuya driver still starts at boot with TasmoFlow installed (`TuyaEnable`: `"State":"running"`)
- [x] v0.1: after a restart, port 8384 does not answer until `/tf` is opened; the log shows `TFL: API server started on port 8384`, then `TFL: API server stopped` 5 minutes after the last tab is closed, and `/tf` starts it again (the port can be listened to again)
- [ ] v0.1: `curl "http://<gateway>/tf?w=1"` answers `ok` without a password and starts the server
- [ ] v0.1: the Tuya cards match `TuyaStatus`; a switch, a dimmer and a fan speed act on the real devices; a change made on a device (button, Smart Life) reaches the interface within 2 s
- [ ] v0.1: with the Tuya driver disabled (`TuyaEnable 0`) or absent, the Tuya section is hidden
- [x] v0.1: memory at rest after `tasmota.gc()`: 75 KB free, Berry 35 KB, i.e. 9 KB (target 15 KB); with an interface open 63 KB / 48 KB (cached `import`, see [Memory](#memory))
- [x] v0.1: with the uncached loading, the memory partly returns 5 minutes after the last tab is closed: 59 KB free / Berry 48 KB with the interface open, 69 KB / 39 KB after (75 KB / 35 KB before the first opening)
- [ ] v0.2: Rules screen: the three rule sets show the text of `Rule1` to `Rule3`; saving a rule of more than 600 characters (several chunks) reads back identical, even with line breaks (otherwise the old text is put back and an error is shown); "Previous copy" then "Restore" brings the old text back
- [ ] v0.2: enabling/disabling, "once only" and "stop on error" act on the real rule set; the Berry rules list matches `Br print(tasmota._rules)`
- [ ] v0.2: the light interface (GitHub blocked) shows the Rules tab with enable/disable and restore, without the editor
- [ ] v0.2: memory with the rule API loaded (`tf_rules.be` is compiled with the API server): free heap and Berry after `tasmota.gc()`, interface open
- [ ] v0.1: find what stays allocated after the first opening (6 KB free heap, 4 KB Berry), and check that `TuyaConfig` through the interface does not make the driver refuse (32 KB threshold)
