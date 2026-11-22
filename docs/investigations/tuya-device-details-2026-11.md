# Feasibility: a details sheet for each Tuya device (21 November 2026)

Goal (Guillaume's plan, `PLAN_FAISABILITE_TUYA.md`): a sheet per local Tuya device in TasmoFlow, with
identity, data points (code, type, range) and live state. This note answers the plan's seven questions
from the sources (firmware `berry/tuya_local.be`, branch `main` of the firmware repository; TasmoFlow
`app/src/`, `extension/`), and lists what is left to measure on the gateway.

**Verdict (updated 22 November with the gateway's measurements): go, without a firmware change for a first version** (identity, codes, live values, sensors,
Matter bindings). Types and ranges come from a static catalogue in the browser (tuya-local, MIT):
**go, if it matches on the DPs**: on Guillaume's 6 Wi-Fi devices, the `productKey` alone finds the right
entry for 1 and a wrong one for another; matching on the DP numbers finds 5 of 6, the sixth being a Tuya gateway with no DP (see the measurements). Cloud API from the browser: **no-go** (CORS, and the project's rule on credentials).

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

## Measured on the gateway (22 November 2026, Guillaume)

Free heap after `Br tasmota.gc()` (`Status 4`): 53 KB before, **57 KB** after two `TuyaConfig <device>`,
56 KB after two `TuyaStatus <device>`, **56 KB** after `TuyaScan 10`: nothing kept, no lasting cost (the
peak during the scan was not taken). The 10 s scan found the 6 Wi-Fi devices, **each with its
`product_key`**.

- `TuyaConfig <device>` answers `name`, `id`, `ip`, `version`, `key` (`***`), `codes`, `matter`, `keep`
  (when set): as expected. A 4-channel radio relay has 17 codes, an RGB light 11.
- `TuyaStatus <device>` keeps few DPs: 4 of the relay's 17 (its booleans), 5 of the light's 11
  (booleans and `keep`). Live values of the others only come with the `Tuya` events.

Catalogue coverage (tuya-local of 21 November; the product ids themselves stay out of the repository):
5 distinct `product_key` for 6 devices (the two pergola lights share one).

| Device | By `product_key` | By DPs (the device's `codes`, Jaccard on the DP numbers) |
| --- | --- | --- |
| 4-channel radio relay | 3 files, **all wrong** (1-gang plug, dual switch, 1-channel relay): a generic `key…` id shared by many products | `moes_quad_switch` (14 of its 14 DPs in the device's 17): right |
| RGB light (×2) | not found | `rgbw_lightbulbv2` (11 of 11), then `rgbcw_lightbulb`: plausible |
| Power clamp | 1 file, `pc321ty_energy_meter`: right | not checked |
| CCT bulb (`light2`) | 2 files (CCT, RGBCW) | `calex_s45cleare27_light`, CCT (11 of its 12 DPs in the device's 12, first of the whole catalogue): right, the DPs decide between the two |
| Tuya gateway (no sub-device configured) | not found | no `codes`: a hub has no DPs of its own; its sub-devices would be matched on their DPs |

**What it changes**: the `product_key` alone is not enough. Generic ids (`key…`, the Tuya module's,
not the product's) are shared by unrelated products, and some products are missing. The sheet must
match on the DPs (the `codes` of `tuya.json` give every DP number of an imported device, not only the
kept ones), the `product_key` narrowing the candidates. With that, **5 of the 6 devices** are found (83 %; 5 of 5 if the gateway, which has no DP, is left
out), above the plan's 70 %: 2 sure (`product_key` and DPs agree), 3 by the DPs only (the relay, and the
two pergola lights, whose best entry is plausible rather than certain). The catalogue then gives the DP
types and ranges a name: "probably a Moes quad switch", never shown as certain.

## Proposed steps

1. **Sheet v1, interface only** (no `.tapp` change): opened from a Tuya card, it shows name, id, IP,
   protocol version, connected; the DPs with their code (`codes`), live value (`TuyaStatus` and events),
   sensors (`sensors`, divided, with unit) and Matter bindings. Each value says where it comes from.
2. **Identify**: a rule on `TuyaScan` in `tasmoflow.be` (`.tapp` to install again), `productKey` kept in
   the browser.
3. **Catalogue**: CI script tuya-local YAML → a small index of every file's DP numbers (to match on the
   device's `codes`) and one file per catalogue entry (types, ranges, values, labels) on GitHub Pages;
   the `product_key` only narrows the candidates (see the measurements).
4. Only if 3 leaves gaps: firmware patch of the import (2), then TS0601 (7).

## To do on the gateway (Guillaume)

Done on 22 November: `TuyaConfig`, `TuyaStatus` and `TuyaScan 10` with `Heap` (see the measurements). Left:

1. A Tuya gateway with sub-devices configured: `TuyaConfig` of a sub-device (its `codes`, if the cloud
   import gave some), to check the matching on the DPs for sub-devices.
2. `Heap` during a scan (the peak).
