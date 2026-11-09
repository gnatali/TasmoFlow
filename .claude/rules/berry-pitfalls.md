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
- The port 8384 server reads **one short request line** (a partial line over 100 bytes is
  refused): never send long data in a query. Rule texts go in 300-character chunks
  (`/api/rule_set`).
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
