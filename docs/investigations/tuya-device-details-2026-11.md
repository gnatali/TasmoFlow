# Feasibility: a details sheet for each Tuya device (21 November 2026)

Goal (Guillaume's plan, `PLAN_FAISABILITE_TUYA.md`): a sheet per local Tuya device in TasmoFlow, with
identity, data points (code, type, range) and live state. This note answers the plan's seven questions
from the sources (firmware `berry/tuya_local.be`, branch `main` of the firmware repository; TasmoFlow
`app/src/`, `extension/`), and lists what is left to measure on the gateway.

**Verdict: go, without a firmware change for a first version** (identity, codes, live values, sensors,
Matter bindings). Types and ranges come from a static catalogue in the browser (tuya-local, MIT):
**go**, but its coverage of Guillaume's devices is still to be measured (it needs their `productKey`,
from `TuyaScan`). Cloud API from the browser: **no-go** (CORS, and the project's rule on credentials).

## 1. What the firmware holds

| Field | Where | Kept | Read with |
| --- | --- | --- | --- |
| `name`, `id`, `ip`, `version`, `enabled` | `/tuya.json`, device entry | file | `TuyaConfig <device>` (one entry, read entry by entry since 18 November, no memory guard) |
| `key` | `/tuya.json` | file | never: `TuyaConfig` answers `***`; TasmoFlow never shows, stores or sends it |
| `cid`, `parent` (sub-device of a Tuya gateway) | `/tuya.json`, `children` of the gateway | file | `TuyaConfig <device>` |
| `codes` (`{"switch_led": 20}`: code → DP) | `/tuya.json`, written by the import (`TuyaImport.codes()`), not in RAM | file | `TuyaConfig <device>` |
| `sensors` (`label → [dp, divider, unit]`) | `/tuya.json`, deduced at import (`TuyaImport.auto()`) or by hand | file + RAM | `TuyaConfig <device>` |
| `matter` (bindings, `ep`, DPs, dividers) | `/tuya.json` | file + RAM | `TuyaConfig <device>` |
| `keep` | `/tuya.json` | file + RAM | `TuyaConfig <device>` |
| Connected, IP, version, **DPs kept** | RAM (`TuyaNode.dps`) | RAM | `TuyaStatus [device]`. Only the booleans, the DPs used by a binding or a sensor, and `keep` (`"keep": "all"`: every DP) |
| **Every DP that changes** (used or not) | not kept | none | the `Tuya` rule event `{"Tuya":{"Name":...,"Dps":{...}}}`, already in TasmoFlow's event stream (`tasmoflow.be`, `push_event("tuya")`) |
| `product_key` | `TuyaScan` result (UDP announcement `productKey`), `scan_result` in RAM until the next scan | RAM | `TuyaScan [s]`: answers "discovery started", the list is published at the end as `{"TuyaScan":{"Devices":[{"id","ip","version","product_key"}]}}` |
| `category`, `product_name` | not in `tuya.json`. Read from `/devices.json` (tinytuya) if it is still on the file system, or from the cloud identification (`TuyaCloud` `names_only`), for the Tuya Local web page only (`scan_info`) | not kept | none for TasmoFlow |
| `mapping` (code, **type, values, ranges**) | read at import (`devices.json` or cloud `/v1.1/devices/<id>/specifications`) to deduce bindings, sensors and dividers, then **dropped** | not kept | none |

Gateway sub-devices: no `productKey` of their own (the UDP announcement is the hub's).

## 2. What the import keeps

Only `codes` (code → DP number), plus what it deduces: `sensors`, `matter`, dividers. `category`,
`product_name`, `product_key` and the types, values and ranges of `mapping` are not written to
`tuya.json`. Without a firmware change the sheet can show **the DP number, its code and its live value**,
not its type or range.

To have them from the firmware, two patches are possible (to weigh against the RAM, not needed for a
first version):

- import: write `category`, `product_name` and a short form of `mapping` per DP (`[type, min, max,
  scale, unit]` or the enum's values) into `tuya.json`: ~0.3 to 1 KB more per device on the file
  system, nothing more in RAM (the entry is read on demand, like `codes`); reimport needed;
- a `TuyaSpec <device>` command reading one device's `mapping` from `/devices.json` entry by entry,
  key left out: depends on that file staying on the gateway (it holds every local key: better not).

## 3. From the browser to the gateway

Everything already goes through `/api/cmd` of the port 8384 server (`tasmoflow.be`, `api_cmd()`:
`tasmota.cmd(c, true)`, the answer as JSON). The interface reads `TuyaStatus` and `TuyaConfig <device>`
(`app/src/state.js`, `loadTuya`), and gets the DPs that change through `/api/events` (Server-Sent
Events). The sheet needs nothing new for this:

```
sheet opened -> GET :8384/api/cmd?c=TuyaConfig <device>   (identity, codes, sensors, matter, key masked)
             -> already in memory: TuyaStatus (connected, ip, version, DPs kept)
             -> already streamed: tuya events (every DP that changes)
             -> GitHub Pages: catalogue/<productKey>.json (types, ranges, labels), if known
```

`productKey`: `TuyaScan` publishes its result once, at the end. TasmoFlow would catch it with one more
rule on `TuyaScan` in `tasmoflow.be` (like the `Tuya` rule; a `.tapp` change) and keep the
`id → productKey` pairs in the browser (`localStorage`, per gateway), so the scan is run once (a
"Identify" button), not each time.

## 4. Memory

- The sheet adds **no Berry code** if it only uses `TuyaConfig <device>` and `TuyaStatus`: 0 KB at rest.
  `TuyaConfig <device>` reads `tuya.json` entry by entry (no `read_conf()`); its peak is one entry
  (~1 KB per device, ~3 times that while `json.load` holds it).
- The `TuyaScan` rule in `tasmoflow.be`: a few hundred bytes while the API server runs. The scan
  itself needs 15 KB free (`SCAN_MIN_HEAP`) and its result is ~100 B per device in RAM.
- The catalogue is fetched by the browser from GitHub Pages: nothing on the gateway.
- **To measure on the gateway** (after `Br tasmota.gc()`, `Status 4`): `Heap` before and after
  `TuyaConfig <device>` (also the open v0.1 test plan item, 32 KB threshold), and before, during and
  after `TuyaScan 10`, with the interface open (43 KB free measured on 21 November: the scan's 15 KB
  fit, the Tuya driver's 45 KB start does not concern a driver already running).

## 5. Static catalogue in the browser

- **Source: tuya-local** (github.com/make-all/tuya-local, `custom_components/tuya_local/devices/*.yaml`,
  **MIT**, copyright notice to keep). Read on 21 November 2026: 1,794 device files, 1,581 with a
  `products:` list, **2,018 distinct product ids**. Each file gives the DPs (`id`, `type`, `name`,
  `mapping` of values, `range`, `unit`, `scale`) grouped into Home Assistant entities.
- Its product id **is the `productKey`** of the local UDP announcement: tuya-local's own discovery
  compares the announced `productKey` with the `products` of its files
  (`custom_components/tuya_local/discovery.py`). Without a known id, tuya-local matches on the DPs
  the device reports (`match_quality()`): the browser can do the same with the live DPs, which helps
  gateway sub-devices.
- Size: an index `productKey → file` is 127 KB of JSON, **48 KB gzip** for 2,018 ids. Better: one
  small file per product id (`catalogue/<productKey>.json`, a few hundred bytes), built from the YAML
  by a script in CI, published with the interface on GitHub Pages; the sheet fetches only its device's
  file. GitHub Pages answers `Access-Control-Allow-Origin: *` (checked): no CORS issue. No SRI per file
  (they change with the catalogue), but they are data, never code; cache in `localStorage` or
  IndexedDB; offline, the sheet shows the firmware's data and says the catalogue is out of reach.
- Other sources: zigbee-herdsman-converters (MIT, Zigbee only, see 7); Blakadder's templates are for
  devices flashed with Tasmota, not Tuya protocol devices: not useful here.
- **Coverage still to measure**: needs the `product_key` of Guillaume's devices (`TuyaScan 10` in the
  console; product ids are not secrets, but they stay out of the repository like the ids). Criterion of
  the plan: 70 % of the devices found with a readable set of DPs.

## 6. Tuya cloud API from the browser: no-go

- CORS: `openapi.tuyaeu.com` answers `Access-Control-Allow-Origin: https://iot.tuya.com,https://platform.tuya.com`
  only (checked on 21 November 2026, preflight and GET): a page served by the gateway cannot read it.
- And the project's rule: TasmoFlow never shows, stores or sends a Tuya local key or cloud credential;
  a signed call from the page would need the Access Secret in the browser.
- The firmware's cloud import (`TuyaCloud`, credentials in `/tuya_cloud.json` on the gateway, 35 KB
  free) stays the way to get the specifications; a firmware patch could keep them (see 2).

## 7. Tuya Zigbee devices (TS0601)

- Tasmota's `ZbInfo` gives `ModelId` (`TS0601`) and `Manufacturer` (`_TZE200_xxxx`), already in
  TasmoFlow's device list. The DP mapping is not in Tasmota (decoded by `.zb` plugins, per device).
- zigbee-herdsman-converters (MIT, `src/devices/tuya.ts`, 1.5 MB of TypeScript): 896 distinct
  `_TZE…` manufacturer names, 344 `tuyaDatapoints` tables. Usable through a build script that extracts
  `fingerprint → [dp, name, converter]`, harder than tuya-local's YAML (code, not data).
- Decision proposed: the sheet covers Wi-Fi and gateway Tuya devices first; TS0601 later, with the
  `ZbSend` DP writing still to try (v0.3).

## Proposed steps

1. **Sheet v1, interface only** (no `.tapp` change): opened from a Tuya card, it shows name, id, IP,
   protocol version, connected; the DPs with their code (`codes`), live value (`TuyaStatus` and events),
   sensors (`sensors`, divided, with unit) and Matter bindings. Each value says where it comes from.
2. **Identify**: a rule on `TuyaScan` in `tasmoflow.be` (`.tapp` to install again), `productKey` kept in
   the browser.
3. **Catalogue**: CI script tuya-local YAML → `catalogue/<productKey>.json` on GitHub Pages; the sheet
   adds type, range, values and labels; fallback on the live DPs (`match_quality`-like).
4. Only if 3 leaves gaps: firmware patch of the import (2), then TS0601 (7).

## To do on the gateway (Guillaume)

1. `TuyaConfig <device>` for one Wi-Fi device, one gateway and one sub-device: the fields returned
   (key masked); `Heap` before and after (`Br tasmota.gc()` then `Status 4`).
2. `TuyaStatus <device>`: the DPs kept, compared with those the Smart Life app shows.
3. `TuyaScan 10`: wait 10 s, then the `TuyaScan` line in the console: is `product_key` filled for each
   Wi-Fi device? `Heap` before, during and after.
4. Send the list of `product_key` (privately, not in the repository): the catalogue coverage is
   measured from it.
