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
- Never read a large file in one go (no PSRAM): stream it in 1 KB chunks
  (`tf_streamer`), at the client's pace (`buf_out_empty()`).
- Files inside a `.tapp` are opened with `open(tasmota.wd + "name")`; a `.tapp` is an
  uncompressed zip (`tools/pack_tapp.py`).
- More pitfalls of Berry under Tasmota (strict mode, solidification, 32-bit integers): see the
  firmware repository's `.claude/rules/berry-pitfalls.md`.
