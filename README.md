# TasmoFlow

[Français](README.fr.md) · **English**

No-code web interface to control and manage a Tasmota Zigbee gateway, its Zigbee and Tuya
devices, and to create automations between them. First target: the eWeLink ZB-GW03 gateway
running the [tasmota32-zbgw03-matter](https://github.com/gnatali/tasmota32-zbgw03-matter)
firmware.

> **Status: v0.0 prototype, in test on a real gateway since 6 November 2026.** It checks the
> architecture before features are written. Results and remaining checks: see the
> [test plan](docs/architecture.en.md#test-plan-on-the-gateway).

## What v0.0 does

- Adds a **TasmoFlow** button to the Tasmota main menu and a `/tf` page.
- Loads the interface from GitHub Pages (pinned version, SRI hash), or from the extension's
  local copy if GitHub does not answer within 3 s.
- Lists Zigbee devices and updates them live.
- Toggles a light, opens pairing, sends a Tasmota command, shows diagnostics (memory, file
  system, where the interface came from).
- French and English, desktop and mobile, light and dark themes.

The firmware is not modified. How it works: [docs/architecture.en.md](docs/architecture.en.md).

## Installing on the gateway

1. Build the extension (Python 3, no dependency):

   ```sh
   python3 tools/pack_tapp.py
   ```

   The command writes `dist/TasmoFlow.tapp` and prints the sizes and their budgets.

2. In Tasmota: **Tools → Manage File system**, upload `dist/TasmoFlow.tapp` (to the root, or
   to `/.extensions/`).
3. Restart the gateway, then open `http://<gateway address>/tf` or click **TasmoFlow** in the
   main menu.

The API listens on port **8384** of the gateway.

To uninstall: delete `TasmoFlow.tapp` and restart.

## Development without a gateway

```sh
python3 tools/pack_tapp.py --cdn ''
python3 tools/mock_gateway.py
```

Then open <http://localhost:8080/tf>. The simulated gateway serves the real `/tf` page,
extracted from `extension/tasmoflow.be`, and the same API, with three fake devices sending
events.

End-to-end tests (Playwright): `node tests/e2e.js`. They start two simulated gateways
themselves and check the loader (GitHub, wrong SRI hash, slow GitHub, nothing available),
then a walkthrough of the interface.

## Repository layout

| Path | Content |
| --- | --- |
| `app/app.js` | Interface, without dependencies or build step (reference before choosing Preact or Lit) |
| `extension/tasmoflow.be` | Berry extension: button, `/tf` page, API, events |
| `extension/tf_http.be` | Asynchronous HTTP server, copied from Tasmota |
| `extension/autoexec.be`, `manifest.json` | Entry point and description of the `.tapp` |
| `tools/pack_tapp.py` | Builds the `.tapp` and checks the size budgets |
| `tools/mock_gateway.py` | Simulated gateway for development |
| `tools/check_syntax.be` | Berry syntax check |
| `tests/e2e.js` | End-to-end tests in Chromium, against the simulated gateway |
| `.github/workflows/build.yml` | Checks, build, release and publication on GitHub Pages |
| `docs/architecture.en.md` | Architecture, findings from Tasmota's code, test plan |

## Roadmap

TasmoFlow handles three device families: Zigbee, Tuya Zigbee paired with the gateway (TS0601)
and local Tuya (Wi-Fi and Tuya gateway), the latter through the firmware's Tuya driver (see
[docs/architecture.en.md](docs/architecture.en.md#tuya-devices)).

| Version | Content |
| --- | --- |
| v0.0 | Prototype: architecture checked on the gateway (in test since 6 November 2026) |
| v0.1 | Control: several gateways, Zigbee and Tuya dashboard, extension under 15 KB of RAM |
| v0.2 | All rules (`Rule1` to `Rule3`, Berry, TasmoFlow automations): reading, sentence editor, backup before writing; Zigbee and Tuya triggers and actions |
| v0.3 | Advanced Zigbee and Tuya: groups, scenes, bindings, Tuya discovery and import, TS0601 plugins, Matter |
| v0.4 | Administration: OTA, backups, network, console |
| v1.0 | Stable release |

## Publishing

Each `vX.Y.Z` tag (equal to the content of `VERSION`) publishes `TasmoFlow.tapp` in a release
and the interface under `https://gnatali.github.io/TasmoFlow/vX.Y.Z/`. Older versions stay
online.

After the first tag, enable GitHub Pages once: **Settings → Pages → Build and deployment →
Deploy from a branch**, branch `gh-pages`, folder `/ (root)`.

## License

GPL v3, like Tasmota. `extension/tf_http.be` is a copy of `webserver_async.be` (Stephan
Hadinger and Theo Arends, Tasmota project).
