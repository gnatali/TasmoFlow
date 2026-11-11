---
paths:
  - "extension/**"
  - "**/*.be"
  - "tools/check_syntax.be"
---
# Berry pitfalls met in TasmoFlow

- A line starting with `#-` opens a **block comment** (closed by `-#`): never use `#-----`
  separators. Use `#####` lines.
- `re` is **not** a global name: `import re` before using it, including in static initialisers
  (`tf_http.be`). Tasmota's embedded copy works without it only because it is precompiled.
- `tools/check_syntax.be` predeclares the real firmware globals (`tasmota`, `log`, `tcpserver`,
  `format`). Never add an importable module there (`re`, `json`, `string`...): it would hide a
  missing `import`, as it once did.
- The Berry `webserver` module cannot add response headers (no CORS, no `Content-Encoding`):
  use the port 8384 server for that.
- `webserver.check_privileged_access()` also requires a `Referer` from the gateway (unless
  `SetOption128 1`) and sends nothing when it is missing: `/tf` first answers with a page that
  reloads itself (`?r=1` avoids a loop).
- `web_add_handler()` is not called for an extension loaded after the web server started: call
  it from `init()` when `webserver.state() != 0`, and guard against a second registration.
- **Never run `re` on input of unbounded length**: Tasmota's matcher (re1.5 `recursiveloop`)
  calls itself once per character matched by a greedy `+` or `*`, with no depth limit, in the
  8 KB stack of the loop task. `(\S+)` on a request line of 152 characters restarted the
  gateway (`Software reset CPU`, browser: `ERR_CONNECTION_RESET`; 112 passed). `tf_http.be` now
  parses with `string.find()` and refuses a request line over 512 characters (414), headers
  over 4 KB (431), a body over 3,000 bytes (413). Details and sources: `docs/architecture.en.md`.
- After refusing a request (414, 400, 431, 413) `tf_http.be` keeps reading and dropping the input
  until the sender is quiet (200 ms, 2 s at most) before closing: closing a socket with unread
  data makes lwIP reset the connection and the browser shows `ERR_CONNECTION_RESET`, not the
  error answer.
- Long data still goes in a **POST body** (`cnx.body()`, `Content-Length`), not in a URL:
  `/api/cmd` and `/api/rule_set`. The simulated gateway cuts the connection on a request line
  over 120 characters until the string parser is checked on the gateway.
- A negative slice bound counts from the end: `s[0 .. i - 1]` with `i == 0` is the **whole**
  string, not `''`. Check the index before slicing (`tf_http.be`).
- `tests/tf_http_test.be` runs `tf_http.be` on standard Berry in CI (`berry -s`, strict like
  Tasmota) with stubbed `tasmota`, `tcpserver`, `log`, `format` (f-strings call it). Extend it
  for any change to the request parser: a regression there breaks every request.
- `tasmota.cmd()` returns a **map only if the answer is valid JSON**, else the raw string (see
  `exec_rules` in `tasmota_class.be`): calling `.find()` on it raises. `Rule<n>` copies the rule
  text as is, so a line break or a quote can make its answer invalid (`tf_rules.rule()` cuts
  the text out by hand). Never let a handler of the port 8384 server raise: the browser only
  sees "Failed to fetch". Answer with the exception text.
- Never read a large file in one go (no PSRAM): stream it in 1 KB chunks
  (`tf_streamer`), at the client's pace (`buf_out_empty()`).
- Files inside a `.tapp` are opened with `open(tasmota.wd + "name")`; a `.tapp` is an
  uncompressed zip (`tools/pack_tapp.py`).
- More pitfalls of Berry under Tasmota (strict mode, solidification, 32-bit integers): see the
  firmware repository's `.claude/rules/berry-pitfalls.md`.
- A `.tapp`'s folder is in `sys.path` **only while Tasmota loads it** (`tasmota.load()` pushes
  then pops it, and resets `tasmota.wd`). An `import` of one of its files at run time (inside a
  method, after load) raises "module not found": push `self.wd` onto `sys.path()` around it
  (`load_module()`, used for `tf_http` and `tf_rules`). The simulated gateway cannot catch this.
- An exception in a `webserver.on` handler makes Tasmota send nothing (browser:
  `ERR_EMPTY_RESPONSE`): catch everything that can fail before the page is sent.
- Uploading a new `.tapp` does not reload the running extension: restart (`Restart 1`) before
  testing, and never keep a `TasmoFlow.tapp` in both `/.extensions/` and `/` (both are loaded,
  the first one keeps `/tf` and port 8384). Every build shows the same `VERSION` in the header
  until a release is tagged, so an old build is easy to mistake for the new one: the banner of
  the light interface, `curl "http://<gateway>/tf?w=1"` answering `ok` and the boot log line
  `TFL: TasmoFlow <version>, API on port 8384 once an interface is opened` tell them apart.
