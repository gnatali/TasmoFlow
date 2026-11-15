# Bug analysis: extension and interface (15 November 2026)

Review of this repository at commit `62ec380`, looking for potential bugs, sorted by priority,
with improvement ideas. The companion report for the firmware and its Tuya driver is in the
firmware repository (`docs/investigations/bug-analysis-2026-11.md`); its finding F1 (no Tuya
connection after 24.9 days of uptime) also affects what TasmoFlow shows.

Goal of the project, used to rank the findings: a small Tasmota gateway that runs a small home
automation setup with no cloud dependency (Tuya or other) and that keeps working without
internet access.

## Scope and method

- Read in full: `extension/*.be`, the shared and core modules of `app/src/` (state, API client,
  loader, update, devices, Tuya, rules model, rules screen, rule pickers, guided mode,
  gateways), the workflow and the packaging tools. Skimmed: the sentence editor's widgets, the
  colour panel, the texts, the styles.
- Tasmota internals were checked in its source at the firmware's `TASMOTA_REF` (`43d9409`).
- Baseline run here: `npm run build`, `node --check`, `pack_tapp.py` (41,499 B of 41,534),
  `tests/rules_model_test.js` (28 checks) and `tests/e2e.js` (28 tests) **all pass**. Berry was not run
  (the Berry files were read; CI compiles them).
- T1 was reproduced with the simulated gateway. The other findings come from reading the code
  and Tasmota's source; none was tried on the real gateway. No fix was made.

Priorities: **P1** breaks a core function in normal use; **P2** wrong behaviour or loss of
function in a plausible situation; **P3** robustness, rare cases; **P4** minor.

## Summary

| Id | Priority | Finding | Status |
| --- | --- | --- | --- |
| T1 | P1 | After a gateway restart, an open interface shows "live" but ignores every event until the new sequence numbers pass the old ones | Reproduced (simulated gateway) |
| T2 | P2 | An exception in `/api/status`, `/api/devices`, `/api/cmd` or `/api/events` leaves the request unanswered for ever; the interface then stays on "loading" | Read in the code and Tasmota's source |
| T3 | P2 | Events pile up without limit in RAM for a client that stopped reading; the event history is limited by count, not by size | Read in the code |
| T4 | P2 | `/api/devices` and `TuyaConfig` build their whole answer in RAM: memory grows with the number of devices | Read in the code, to measure |
| T5 | P3 | The Tuya cards never learn that a device disconnected | Read in the code |
| T6 | P3 | A fourth open interface makes the interfaces evict each other every 3 seconds | Read in the code |
| T7 | P3 | The rule write keeps one text for all clients: two interfaces saving together can store the other's text and report success | Read in the code |
| T8 | P3 | `lite.js` is cached for a day under an address without a version: after an update a browser can run the previous light interface | Read in the code |
| T9 | P3 | Port 8384 has no connection limit and no timeout for an incomplete request | Read in the code |
| T10 | P4 | A power cut between the two renames of an update leaves no `TasmoFlow.tapp` | Read in the code |
| T11 | P4 | Zigbee toggle and pairing buttons show nothing when the command fails | Read in the code |
| T12 | P4 | `Content-Length` is only recognised in two spellings; a request without the token still keeps the server awake; every reconnection replays the whole event history | Read in the code |

## Findings

### T1 (P1): events ignored after a gateway restart

The extension numbers events from 1 at every start (`self.seq = 0`, `tasmoflow.be` line 92).
The interface keeps the last number it saw and drops anything not above it
(`if (!current(gw) || ev.seq <= lastSeq) return;`, `state.js` line 141). `lastSeq` is only reset
when another gateway is chosen. So when the gateway restarts while a page is open (power cut,
`Restart 1` from the Console screen, Matter endpoints created, firmware update), the page
reconnects, the badge says "live", and **every event is dropped until the gateway has sent more
events than before the restart**. Device cards, Tuya states and the guided mode's "press the
button" stop following reality without any sign of it. Reloading the page is the only way out.

Reproduced with `tools/mock_gateway.py --full` and Chromium, Events screen, the simulated
gateway stopped and started again (its counter starts again at 1):

```
before restart       13 events, newest 1:54:33 PM, badge "live"
after restart +10 s  13 events, newest 1:54:33 PM, badge "live"
after restart +20 s  13 events, newest 1:54:33 PM, badge "live"
after restart +30 s  14 events, newest 1:55:03 PM, badge "live"
```

Thirteen events were lost here; on a gateway that sent 500 events before restarting, the next
500 are lost. The end-to-end tests cannot see it: the simulated gateway keeps its counter
across its simulated restart.

Fix: tell a restart apart from a repeat. Simplest: the extension draws a random start id in
`init()` and sends it in every event (`"boot":...`) and in `/api/status`; the interface resets
`lastSeq` to 0 and reloads devices and Tuya state when it changes. Without touching the
extension: on `es.onopen` after an error, read `/api/status` and reset when `events_seq` is
below `lastSeq`. In both cases reload the device list after a reconnection, since events were
missed while the gateway was away. Test: make the simulated restart reset `seq`, then check
that a card follows an event sent after it.

### T2 (P2): an exception in an API handler leaves the request unanswered

The port 8384 server runs from Tasmota's fast loop, which is deliberately not guarded
(`tasmota_class.be`, `fast_loop`: "this is not guarded in try/except for performance reasons.
The inner function must not raise exceptions"). `tf_rules.be` and `tf_update.be` catch
everything and answer with the exception text. The handlers of `tasmoflow.be` do not:
`api_status`, `api_devices`, `api_cmd`, `api_events`, `send_lite`. If one raises, the
connection is already marked `dispatched`, nothing is sent and nothing closes it. The
interface's `fetch` has no timeout, and `/api/status` is the first request of `start()`: the
page stays on "loading" with no error.

A way to get there with today's code: `cmdv()` (line 169) calls `.find()` on the result of
`tasmota.cmd()`, which is a string, not a map, whenever the answer is not valid JSON (the case
this project's own Berry notes warn about). `api_status` calls it four times.

Fix: one guard for all routes, in `webserver_async.dispatch` or in a small wrapper used by
`web.on()`: `try` the handler, answer `500 {"error":"exception ..."}` if nothing was sent yet.
Make `cmdv()` test `isinstance(r, map)`. On the client, an `AbortController` timeout in
`api.js` (10 s) turns a silent wait into a visible error.

### T3 (P2): event buffers without a size limit

- `push_event` (line 473) writes each event to every open stream. `_write` in `tf_http.be`
  (line 144) appends to `buf_out` with no upper bound and sends what the socket takes. A client
  that stopped reading without closing (a laptop that went to sleep, a phone that left Wi-Fi)
  stays "connected" until TCP gives up, which takes minutes; meanwhile every Zigbee and Tuya
  event and every ping is kept in RAM for it.
- The history for reconnecting clients holds `MAX_EVENTS = 50` events whatever their size. A
  Zigbee message is 150 to 300 bytes, a full Tuya status more: 50 of them are 10 to 20 KB,
  beside a 15 KB budget for the whole extension at rest.

On this gateway an allocation failure is not a slow page, it is a restart.

Fix: close a stream whose `buf_out` exceeds a few KB (the browser reconnects and asks for what
it missed), and limit the history by bytes (for instance 6 KB) as well as by count. Worth a
heap measurement with a paused client before and after.

### T4 (P2): answers built whole in RAM

- `api_devices` (line 404) writes every Zigbee device, with its full `info()`, into the output
  buffer in one loop. The extension's own rule for files ("stream it in 1 KB chunks, at the
  client's pace") is not applied here. Fine for a few devices; with 30 or 40 the answer is well
  over 10 KB, held as strings and as bytes at the same time.
- `loadTuya()` runs `TuyaConfig` through `/api/cmd`. On the gateway that is: the whole
  `tuya.json` loaded as a map by the driver, dumped to a string, parsed again into a map by
  `tasmota.cmd()`, dumped again by `api_cmd`, then copied into the output buffer. The file is
  about 1 KB per device after a cloud import. The interface only guards with `MIN_HEAP_KB = 32`,
  read before the command, and runs the command again at every opening and every Refresh.
  The tracking file already lists "`TuyaConfig` memory use" as left to check.

Fix: send the devices one per fast-loop turn when the buffer is empty (the `tf_streamer`
pattern with an iterator instead of a file). For Tuya, ask the configuration device by device
(`TuyaConfig <name>`; the firmware report suggests making that command read one entry instead
of the whole file) and keep it for the session instead of reading it again at every Refresh.

### T5 (P3): a Tuya device that disconnects stays "connected"

The stream only carries DP changes. `state.js` (lines 149 to 152) sets `connected: true` on each of
them and nothing ever sets it back to false, so a lamp cut at the wall switch keeps its
"connected" label and its enabled buttons until Refresh; pressing one shows
`Device not connected`. Needs the driver to publish connection changes (firmware report, F5);
until then, a `TuyaStatus` every minute or so while the Devices screen is shown would do.

### T6 (P3): more than three interfaces

`api_events` (line 458) closes the oldest stream beyond `MAX_FEEDS = 3`. The evicted
`EventSource` reconnects by itself 3 seconds later (`retry: 3000`), which evicts the next
oldest, and so on: with four tabs or devices open, they take turns for ever, each reconnection
replaying the history. Fix: refuse the newcomer instead (an event `{"type":"full"}` then
close), and have the interface stop reconnecting and say that too many interfaces are open; or
send the evicted client a last event that tells it to stop.

### T7 (P3): one pending rule text for everybody

`tf_rules.be` keeps the text to write in `self.buf` and its rule set in `self.n` between the
requests of a save (`rule_set`, then `rule_apply` bak, put, check). Two interfaces saving the
same rule set at the same moment share them: the first can write the second's text, and its
`check` passes because it compares with the same shared text. Both screens say "saved". A
single administrator makes it unlikely. Fix: `rule_set` returns a short id that `rule_apply`
must repeat, or `check` receives a hash of the text from the client.

### T8 (P3): a stale `lite.js` after an update

`send_lite` (line 374) sends `Cache-Control: max-age=86400` and the loader asks for
`/lite.js` with no version in the address (line 263). For a day after an update, a browser can
therefore run the previous light interface against the new extension: when GitHub cannot be
reached, or when another update is offered (the update code itself is in `lite.js`). Fix:
`add(c.api + "/lite.js?v=" + c.version, ...)`; the server already ignores the query.

### T9 (P3): no connection limit, no request timeout on port 8384

A connection that sends nothing, or half a request, is kept until the server stops
(`tf_http.be`: `TODO what about max_clients ?`). Each can hold up to 4 KB of headers and 3 KB
of body before any token check, and `/tf?w=1` starts the server without a password. A
misbehaving program on the local network, or a page open in a browser on it, can exhaust the
gateway's memory. The network is trusted by design; a limit of 8 connections and a 10-second
timeout for an incomplete request cost little.

### T10 to T12 (P4)

- **T10**: `tf_update.apply` renames `<tapp>` to `.bak`, then `.new` to `<tapp>`
  (`tf_update.be` lines 152 and 153). A power cut between the two leaves only `.bak` and `.new`:
  no extension at the next boot, reinstall by hand. The window is a few milliseconds; a line in
  the user guide about renaming `TasmoFlow.tapp.bak` is enough.
- **T11**: `ZbSend` toggle and `ZbPermitJoin` (`views.js`) ignore the command's answer and have
  no `.catch`: a refused or failed command shows nothing, unlike the Tuya cards.
- **T12**: three small things in the server. `event_http_header` only recognises
  `Content-Length` and `content-length` (header names are case-insensitive: any other spelling
  makes a POST body look empty). `authorized()` calls `touch()` before it checks the token, so
  requests without it keep the server and its RAM alive. The server reads `since` from the
  address, which an `EventSource` never updates: each automatic reconnection replays the whole
  history; reading the `Last-Event-ID` header the browser sends would avoid it.

## Checked and found sound

The request parser limits (414, 431, 413) and its string-only parsing, the token on every
`/api/*` route, the update's checks (size, zip header, SHA-256, room on the file system), the
copy before every rule write and the restore, the sentence model (a block that is not edited
is written back unchanged), the loader's guard against two interfaces starting, key masking
(TasmoFlow never asks for a local key).

## Improvement ideas

Ordered by what they bring to a cloud-free setup that works without internet.

1. **The full interface without internet.** Today, with no internet access for the browser,
   only the light interface is left: devices and update, no rules, no console, no diagnostics.
   That is the main gap with the goal. The `.tapp` budget rules out shipping it, but the
   gateway can keep an optional copy outside the `.tapp`: `app.js` is 33.6 KB gzipped, the
   browser can relay it once (same mechanism as the update: pieces to `/api/...`, its hash
   checked against the pinned SRI), stored as `/tf_app.js.gz` and served by port 8384 when
   GitHub cannot be reached. Offered as a button ("keep a copy for offline use") with the free
   space shown, it changes nothing for those who do not want it.
2. **Clock without internet.** Without NTP the gateway's clock is unset after a power cut:
   `Time#Minute` rules, timers and the times of the Events screen are wrong. The interface can
   see it (`ts` before 2020) and offer to set the clock from the browser (`Time <epoch>`), and
   the guide can recommend pointing `NtpServer1` at the home router, which usually serves time.
3. **Tuya devices as rule triggers** without Berry: needs the rule-friendly event proposed in
   the firmware report (idea 1 there); the pickers and the guided mode then work for Tuya as
   they do for Zigbee.
4. **Timers and schedules**: a screen for Tasmota's `Timers` (time of day, days, sunrise and
   sunset with latitude and longitude), the most common automation after "button switches lamp".
5. **Run the real Berry modules in CI.** Only `tf_http.be` has a test; `tf_rules.be`,
   `tf_update.be` and `tasmoflow.be` are only compiled, and the simulated gateway is a separate
   Python program whose behaviour can drift (T1 passed all 28 end-to-end tests). The firmware's bench shows
   the way: Tasmota's Berry with stubbed `tasmota`, `persist`, `path` and a scripted client.
   First candidates: `tf_rules.rule()` and `step()`, `tf_update.room()` and `apply()`,
   `push_event` with a slow client.
6. **Faster start without internet**: the loader waits up to 1.5 s for `latest.json`, then up
   to 3 s for `app.js`, at every opening. Remembering the last failure for a few minutes
   (`sessionStorage`) would go straight to the local copy.
7. **Health line** in the Devices screen: free heap after `gc`, uptime, clock set or not, Tuya
   devices connected out of configured, with a warning below a threshold. On a gateway where
   memory decides everything, it tells the user before something breaks.
8. **One-click backup** of what TasmoFlow owns: the three rule sets, their options and the
   `.bak` copies as a file kept by the browser, and the reverse. `tuya.json` stays out of it
   (keys), with a reminder to save it through Tasmota's file manager.
9. **Token hygiene**: a button to draw a new token (it never changes today and travels in
   every address), and a reminder in the guide that `WebPassword` is what protects the `/tf`
   page that hands it out.
10. **Pin the test tools**: `git clone --depth 1` of Berry and `playwright@1` follow upstream;
    a commit and an exact version make a red build mean a change in this repository.
