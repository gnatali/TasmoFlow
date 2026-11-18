# Ways to reduce the `.tapp` (18 November 2026)

Not done yet: a list of options to handle later, measured or estimated on branch `claude/awesome-planck-mow2gg`
after the T1 fix. Why it matters: the `.tapp` is **41,526 B of a 41,534 B budget** (half of
v0.2.0, decision of 11 November 2026, `pack_tapp.py`), so **8 B are left** and anything new in the
light interface or the extension needs a saving first.

## What is in it

The `.tapp` is an uncompressed zip (Tasmota only reads stored files): every byte of Berry counts
in full.

| File | Size | Role |
| --- | --- | --- |
| `lite.js.gz` | 14,163 B | light interface (gzip level 9) |
| `tasmoflow.be` | 10,814 B | extension, including the `/tf` loader (1,189 B of readable JS inside a Berry string) |
| `tf_http.be` | 7,421 B | port 8384 server |
| `tf_rules.be` | 4,330 B | rule API (full interface only) |
| `tf_update.be` | 3,803 B | update |
| zip headers, `manifest.json`, `autoexec.be` | ~1,000 B | |

The light interface, minified, before gzip: Preact 10.8 KB, texts (`i18n.js`) 5.2 KB, `state.js`
3.1 KB, CSS 2.8 KB, `update.js` 2.7 KB, `views.js` 2.7 KB, `tuya.js` 2.0 KB, `tuya_model.js`
1.6 KB, htm 1.2 KB (esbuild metafile).

## Options, from the simplest

| # | Option | Gain | Risk, effort |
| --- | --- | --- | --- |
| 1 | **Zopfli instead of gzip** for `lite.js.gz` (`pack_tapp.py`) | **-377 B, measured** (14,163 to 13,786, 50 iterations) | None: still standard gzip for the browser and the extension. Build dependency (Python `zopfli` package, in CI too) |
| 2 | **Minify the `/tf` loader JS** in `tasmoflow.be` at packing (esbuild) | about -400 B of 1,189 (estimate) | Low. The simulated gateway has its own copy of the loader (`loader_html()`), so the end-to-end tests do not cover the real one: add a test that takes the loader out of `tasmoflow.be` |
| 3 | **Shorter Berry log and error messages** (8 log strings, 424 B) | -100 to -150 B (estimate) | Low. Keep the boot line `TFL: TasmoFlow <version>, API on port 8384 once an interface is opened`, used to tell the installed version |
| 4 | **Shorter texts in the light interface**, mostly the long update messages (`updateTimeout`, `updateConfirm`, `updateSpaceDetail`...), French and English | -200 to -400 B gzipped (estimate) | Low; wording to agree with Guillaume |
| 5 | **Rename Berry local variables** in `minify_berry()` (`cnx` to `c`...) | 1 to 2 KB of 26 KB of Berry (estimate) | Medium: Berry cannot be compiled here, CI compiles every file and runs the parser test on `tf_http.be` only. Locals only, never members, methods or names used across files |
| 6 | **Precompile htm templates** at build (templates become `h()` calls, no htm runtime) | -300 to -500 B gzipped net (estimate, to measure) | Medium: build plugin, touches every view |
| 7 | **Take `tf_rules.be` out of the `.tapp`**: the full interface (which needs internet anyway) installs it on the gateway at first use, relayed by the browser with a SHA-256 check like the update | **-4.3 KB** | High: code kept on the file system, module version to follow, one more install path. `tf_update.be` must stay (the light interface updates) |
| 8 | Replace Preact with a small hand-made renderer in the light interface | large | Reopens the Preact + htm decision of 9 November 2026, rewrites the shared views: not advised |
| 9 | Raise the budget | | Decision of 11 November 2026: Guillaume's call only |

Ruled out: Brotli (browsers only accept `Content-Encoding: br` over HTTPS, the gateway serves
HTTP); deflate inside the zip (Tasmota reads stored files only); merging Berry files to save zip
headers (about 100 B per file, and the separate files are loaded lazily to save RAM).

## Recommendation

Options 1 to 3 in one small PR: about **-900 B** without changing what the interface does. Then
option 4 if the light interface needs more room, and option 7 only if kilobytes are needed.
After each change: `npm run build`, `python3 tools/pack_tapp.py`, `node tests/e2e.js`; the `.tapp`
must be installed again on the gateway for options 2, 3 and 5 (Berry) and 1, 4 and 6 (light
interface).
