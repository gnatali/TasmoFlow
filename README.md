# TasmoFlow

[Français](README.fr.md) · **English**

No-code web interface to control and manage a Tasmota Zigbee gateway, its Zigbee and Tuya
devices, and to create automations between them. First target: the eWeLink ZB-GW03 gateway
running the [tasmota32-zbgw03-matter](https://github.com/gnatali/tasmota32-zbgw03-matter)
firmware.

> **Status: v0.1 (control) under way**, on top of the v0.0 prototype, released as
> [v0.0.1](https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1) and checked on a real
> gateway on 9 November 2026. What is left to check on the gateway:
> [test plan](docs/architecture.en.md#test-plan-on-the-gateway) and
> [tracking](docs/tracking.en.md).

## What v0.0 does

- Adds a **TasmoFlow** button to the Tasmota main menu and a `/tf` page.
- Loads the interface from GitHub Pages (pinned version, SRI hash), or from the extension's
  light interface kept in the extension if GitHub does not answer within 3 s (since v0.1, the
  full interface only lives on GitHub Pages).
- Lists Zigbee devices and updates them live.
- Toggles a light, opens pairing, sends a Tasmota command, shows diagnostics (memory, file
  system, where the interface came from).
- French and English, desktop and mobile, light and dark themes.

## What v0.1 adds (in progress)

- Interface rebuilt on Preact + htm, built with esbuild into two bundles from the same
  sources: the **full** one (26.4 KB gzipped, GitHub Pages) and a **light** one (13.4 KB, in the
  `.tapp`: device control and the update only) that the gateway serves when GitHub cannot be
  reached. Everything else (rules, console, diagnostics, gateways) is in the full one only, so
  the `.tapp` is about 40 KB (83 KB in v0.2.0).
- The port 8384 API server only runs while an interface is open (RAM is the critical resource).
- **Gateways** screen: use several gateways from one interface (copy a gateway's link, paste it
  in another one's screen).
- Local Tuya devices next to the Zigbee ones, through the firmware's Tuya driver: switches,
  dimmers, colour temperature, fan speed, readings, live updates; hidden when the driver is
  absent or disabled.

The firmware is not modified. How it works: [docs/architecture.en.md](docs/architecture.en.md).

## Installing on the gateway

1. Build the extension (Node 22 and Python 3), or take `TasmoFlow.tapp` from a release:

   ```sh
   npm ci
   npm run build
   python3 tools/pack_tapp.py
   ```

   `npm run build` bundles the interface (`app/src/`) into `dist/app.js` (full, for GitHub
   Pages) and `dist/lite.js` (light, kept in the `.tapp`). `pack_tapp.py` writes
   `dist/TasmoFlow.tapp`, with the Berry files of `extension/` minified (no comments), and
   prints the sizes and their budgets.

2. In Tasmota: **Tools → Manage File system**, upload `dist/TasmoFlow.tapp` (to the root, or
   to `/.extensions/`).
3. Restart the gateway, then open `http://<gateway address>/tf` or click **TasmoFlow** in the
   main menu.

The API listens on port **8384** of the gateway, only while an interface is open: opening
`/tf` starts it, and it stops after 5 minutes without a client.

To uninstall: delete `TasmoFlow.tapp` and restart.

### Updating

When a newer version is published, opening `/tf` shows the **light interface** (instead of the
GitHub one) with a banner and an **Update** button; **Later** (`/tf?u=0`) opens the usual
interface for this visit. The button downloads the new `TasmoFlow.tapp` from GitHub Pages, sends it
to the gateway, which checks its size and SHA-256 and installs it (the previous one is kept as
`TasmoFlow.tapp.bak` next to it), then restarts: the page waits (2 minutes at most, then it points
to Tasmota's home page) and reloads on the new version. A test build looks for the latest test
build instead (a different commit counts as an update). The first update to a version that has
this function is done by hand as above.

## Development without a gateway

```sh
npm ci
npm run build
python3 tools/mock_gateway.py --full
```

Then open <http://localhost:8080/tf> (without `--full`, only the light interface is found, as
when GitHub cannot be reached). The simulated gateway serves the real `/tf` page,
extracted from `extension/tasmoflow.be`, and the same API, with three fake Zigbee devices
sending events and four fake Tuya devices answering like the firmware's driver (`--no-tuya`:
a gateway without the driver).

End-to-end tests (Playwright): `node tests/e2e.js` (builds the interface and the `.tapp`
first). They start two simulated gateways themselves and check the loader (GitHub, wrong SRI
hash, slow GitHub, nothing available), a walkthrough of the interface, the Tuya devices and
the Gateways screen.

## Repository layout

| Path | Content |
| --- | --- |
| `app/src/` | Interface (Preact + htm), bundled by `tools/build_app.js` into `dist/app.js` (full, `main.js`) and `dist/lite.js` (light, `main_lite.js`) |
| `package.json` | Dependencies of the interface (`preact`, `htm`) and of its build (`esbuild`) |
| `extension/tasmoflow.be` | Berry extension: button, `/tf` page, API, events |
| `extension/tf_http.be` | Asynchronous HTTP server, copied from Tasmota |
| `extension/autoexec.be`, `manifest.json` | Entry point and description of the `.tapp` |
| `tools/build_app.js` | Bundles the interface (`npm run build`) |
| `tools/pack_tapp.py` | Builds the `.tapp` and checks the size budgets |
| `tools/mock_gateway.py` | Simulated gateway for development |
| `tools/check_syntax.be` | Berry syntax check |
| `tests/e2e.js` | End-to-end tests in Chromium, against the simulated gateway |
| `.github/workflows/build.yml` | Checks, build, release and publication on GitHub Pages |
| `docs/architecture.en.md` | Architecture, findings from Tasmota's code, test plan |
| `docs/tracking.en.md` | Progress, measurements, open decisions and next steps |
| `CLAUDE.md`, `.claude/rules/` | Instructions for Claude Code |

## Roadmap

TasmoFlow handles three device families: Zigbee, Tuya Zigbee paired with the gateway (TS0601)
and local Tuya (Wi-Fi and Tuya gateway), the latter through the firmware's Tuya driver (see
[docs/architecture.en.md](docs/architecture.en.md#tuya-devices)).

| Version | Content |
| --- | --- |
| v0.0 | Prototype: architecture checked on the gateway (done, v0.0.1, 9 November 2026) |
| v0.1 | Control: several gateways, Zigbee and Tuya dashboard, extension under 15 KB of RAM |
| v0.2 | All rules (`Rule1` to `Rule3`, Berry, TasmoFlow automations): reading, sentence editor, backup before writing; Zigbee and Tuya triggers and actions |
| v0.3 | Advanced Zigbee and Tuya: groups, scenes, bindings, Tuya discovery and import, TS0601 plugins, Matter |
| v0.4 | Administration: OTA, backups, network, console |
| v1.0 | Stable release |

## Publishing

Each `vX.Y.Z` tag (equal to the content of `VERSION`) publishes `TasmoFlow.tapp` in a release
and the interface under `https://gnatali.github.io/TasmoFlow/vX.Y.Z/`. Older versions stay
online.

Create the tag either with git (`git tag vX.Y.Z origin/main && git push origin vX.Y.Z`: the
workflow creates the release), or on github.com with **Releases → Draft a new release → Choose
a tag → Create new tag** on `main`, then **Publish release** (the workflow attaches
`TasmoFlow.tapp` to that release). GitHub has no screen to create a tag without a release.

Each tag also publishes `latest.json` (version, size, SHA-256) and a copy of `TasmoFlow.tapp` on
GitHub Pages: that is what the update button reads. Test builds publish `dev/latest.json` the same way.

After the first tag, enable GitHub Pages once: **Settings → Pages → Build and deployment →
Deploy from a branch**, branch `gh-pages`, folder `/ (root)`.

### Test build (no release, no tag)

To try a change on the gateway without a release: **Actions → Build → Run workflow**, on the
branch to try. After the tests, the run publishes the full interface at
`https://gnatali.github.io/TasmoFlow/dev/app.js` (replaced at every run; the header shows the
build, e.g. `dev.1a2b3c4`) and a test extension at
`https://gnatali.github.io/TasmoFlow/dev/TasmoFlow.tapp`.

Install that `.tapp` once (it replaces `TasmoFlow.tapp`, then `Restart 1`). It loads the `dev/`
interface at every opening, with no SRI pin and no cache, so a new run is enough: reload the
page. Install the `.tapp` again only when `extension/` or the light interface changed (the
changes tell you). Only use it for tests: the release `.tapp` stays pinned to its version and
hash.

## License

GPL v3, like Tasmota. `extension/tf_http.be` is a copy of `webserver_async.be` (Stephan
Hadinger and Theo Arends, Tasmota project).
