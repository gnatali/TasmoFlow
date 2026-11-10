# Investigation: a long URL restarts the gateway (port 8384 server)

Brief for a new session. English only (internal working note, not user documentation). Read
`CLAUDE.md`, `.claude/rules/project.md` and `.claude/rules/berry-pitfalls.md` first.

## Result (10 November 2026)

- **Hypothesis 1 confirmed by the source** (firmware commit `TASMOTA_REF`
  43d9409e67c4a28adac34925e1a1c6813f315ce0): `re.match2()` (`be_re_lib.c`) runs re1.5's
  `recursiveloop()`, which calls itself at every `Split`/`RSplit`; a greedy `+` compiles to
  `L: e; RSplit L` (`compilecode.c`), so `(\S+)` takes one C frame per URI character, and
  `re1_5_stack_chk()` is an empty macro. The loop task's stack is 8 KB (`SET_ESP32_STACK_SIZE`).
  The lazy `(.*?)` of the headers stays at a constant depth, which explains why long headers
  never crashed. Details and file list: `docs/architecture.en.md`, "Request parsing without
  regular expressions".
- **Fix candidate A done** in `extension/tf_http.be` (branch `ccr-77cdec39-duy9lp`, from the
  same commit as `claude/tf-http-long-url`): request line and headers parsed with
  `string.find()`, no `re`. Limits: request line 512 characters (`414 uri_too_long`), headers
  4 KB (`431 headers_too_long`), body 3,000 bytes (`413 body_too_long`), invalid line
  `400 bad_request`; the answers are JSON like the API's errors, then the connection closes.
- `tests/tf_http_test.be` runs the parser on standard Berry in CI (`berry -s`): 112 to 900
  characters, byte-by-byte delivery, POST bodies, invalid lines, odd headers.
- **Left**: Guillaume's check on the gateway (test build, `.tapp` to install again,
  `Restart 1`): 130, 90, 50, 190, 512 answer; 900 answers `{"error":"uri_too_long"}`; no
  restart. Then `tools/mock_gateway.py` can stop cutting request lines over 120 characters.

## The problem

A request to the port 8384 server (`extension/tf_http.be`, a copy of Tasmota's
`webserver_async.be`) whose **request line is long makes the whole gateway restart**. The browser
sees `net::ERR_CONNECTION_RESET`; after the reboot `Status 1` says
`"RestartReason":"Software reset CPU"` (a panic restarts the chip that way as well).

Measured by Guillaume on the real ZB-GW03 (10 November 2026), with
`http://<gateway>:8384/api/status?t=<32 hex token>&p=<a repeated N times>` (`/api/status`
ignores `p`, so nothing else is involved):

| `p` length | request line `GET ... HTTP/1.1` | result |
| --- | --- | --- |
| 130 | 192 characters | restart |
| 90 | 152 characters | restart |
| 50 | 112 characters | works |

Other facts:

- A `GET /api/rule_set?...&x=<67-character text, URL-encoded>` (about 175 characters) restarted
  the gateway **before any handler ran** (the handler only stores the text): the crash is in the
  request parsing, not in TasmoFlow's code.
- Requests of about 150 characters (`/api/cmd?t=...&c=ZbSend...`) worked for weeks, so the
  threshold is somewhere between **112 and 152 characters** and may depend on the heap or the
  call depth.
- The same Tasmota commands typed in the Tasmota console or run with `Br tasmota.cmd(...)` never
  crashed.
- Long **headers** do not crash it (a `Referer` or a mobile `User-Agent` easily reach 150
  characters): only the request line.

## Where it is

`extension/tf_http.be`, `parse_http_req_line()`: the request line is read with
`re.match2(self.server.re_http_srv, self.buf_in, self.buf_in_offset)`, where
`re_http_srv = re.compilebytes("^(\\w+) (\\S+) HTTP\\/(\\d\\.\\d)\r\n")`. Headers use
`re_http_srv_header = "([A-Za-z0-9-]+): (.*?)\r\n"` (lazy, no crash).

## Hypotheses (none proven)

1. **Stack overflow in the `re` engine (re1.5)**: the greedy `\S+` recurses once per character
   (`recursiveloop`), and the call comes from deep inside Berry (tcp loop, then driver callback,
   then the regex). This is the main suspect, and it fits "a panic restarts with `Software reset
   CPU`". To check in Tasmota's / Berry's source (`lib/libesp32/berry_tasmota/`,
   `lib/libesp32/berry/` and its `re1.5`): the recursion, `MAX_...` limits, whether the Berry `re`
   module guards the depth.
2. A limit on the incoming buffer (`cnx.read()` returning a partial line and a bad state in
   `parse_http_req_line()`, which gives up after 100 bytes without a match). This would close
   the connection, **not restart the chip**, so it does not explain the restart by itself.
3. Something outside `tf_http.be` (the TCP layer, `tcpserver`/`tcpclientasync` in C) with long
   first packets. Unlikely given the request-line-only behaviour.

## What to do

1. **Read the source before touching anything.** The firmware commit is `TASMOTA_REF` in the
   workflow of https://github.com/gnatali/tasmota32-zbgw03-matter (a clone may exist at
   `/home/user/gnatali/tasmota32-zbgw03-matter`; ask for access with `add_repo` otherwise).
   Look at how the regex is run (`be_re.c`, `re1.5/`) and its recursion. Cite the files in
   `docs/architecture.en.md` (project rule).
2. **Fix candidate A** (preferred if hypothesis 1 holds): replace the regex in
   `parse_http_req_line()` with plain string handling: take the first line with
   `string.find(s, "\r\n")` (look at no more than about 1 KB; wait for the rest while the line is
   not complete, refuse beyond 1 KB), `string.split(line, " ")`, check three parts and the
   `HTTP/x.y` version. No recursion. Keep `req_verb`, `req_uri`, `req_version` as they are.
   Also consider the same for the header regexes (they work, but use the same engine).
3. **Fix candidate B**: if the regex is not the cause, find out what is (see "Experiments").
4. Keep the POST body support and the interface using POST (they are right anyway: long data in
   a URL is a bad idea). The fix is about not restarting on a long URL (also a security and
   robustness matter: any local client could restart the gateway).
5. This environment **cannot compile Berry** (clone and make are refused) and has no gateway.
   Re-read every Berry line, and let the CI check the syntax. **Guillaume tests on the
   gateway**: a Berry regression in the request parser breaks every request, so prefer a small,
   obviously correct change and keep it reviewable.

## Experiments (ask Guillaume, one gateway restart each)

Use the test build workflow: run `Build` by hand on the branch (`mcp__github__actions_run_trigger`
with `build.yml`), then Guillaume installs `https://gnatali.github.io/TasmoFlow/dev/TasmoFlow.tapp`
(only needed again when `extension/` changed) and does `Restart 1`. The header then shows
`dev.<commit>`.

- Re-run the three `/api/status?...&p=aaaa` URLs above (his token is in his browser URL; never
  put it in a commit): 130, 90, 50. After the fix, **130 and 90 must answer** and a request of
  900 characters must be refused cleanly (no restart).
- To locate the crash if the source reading is not enough: build a `dev` `.tapp` whose
  `parse_http_req_line()` logs (`log("TFL: line", 2)`) before and after the match, and ask for the
  console. A restart loses the log: use `Br` commands typed in the console that call the same
  `re.match2` on a long string to test the engine alone, for example
  `Br import re print(re.match2(re.compilebytes("^(\\w+) (\\S+) HTTP\\/(\\d\\.\\d)\r\n"), bytes().fromstring("GET /" + "a"*150 + " HTTP/1.1\r\n"), 0))`
  (adjust the quoting for the console). If that restarts the gateway, the engine is the cause.

## Done when

- A 130-, 190- and 900-character request line no longer restarts the gateway (checked by
  Guillaume on the ZB-GW03; the console command above no longer needed).
- `tools/mock_gateway.py` stops cutting the connection above 120 characters, **only if** the fix
  is verified (the cut is a guard against regressions); otherwise leave it.
- `.claude/rules/berry-pitfalls.md` (the "never put long data in a URL" item),
  `docs/architecture.en.md` and `.fr.md` (the 10 November paragraph in the Rules section and the
  API table), `docs/tracking.en.md` and `.fr.md` are updated in the same commits (EN reference,
  FR translation).
- Before pushing: `npm run build`, `node --check dist/app.js dist/lite.js`,
  `python3 tools/pack_tapp.py`, `node tests/e2e.js`.
- Branch: this one (`claude/tf-http-long-url`), created from `claude/modest-pascal-8854i4` (v0.2
  step 1, Rules screen). Open a pull request only when Guillaume asks.
