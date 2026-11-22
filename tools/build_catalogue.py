#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Tuya product catalogue for the details sheet, built from tuya-local's device files.

tuya-local (https://github.com/make-all/tuya-local, MIT licence, its notice is copied next to the
catalogue) describes ~1,800 Tuya products in YAML: the product ids (`products: - id:`, the
`productKey` a device announces on the local network, what TuyaScan reports) and the DPs, grouped into
Home Assistant entities (type, range, unit, values). Measured on Guillaume's gateway on 22 November
2026 (docs/investigations/tuya-device-details-2026-11.md): a generic product id is shared by unrelated
products, so the interface matches a device on its DP numbers, the product id only narrowing the
candidates. Hence two kinds of files:

  index.json      {"ref": <tuya-local commit>, "files": [[stem, name, [dp, ...], [product id, ...]], ...]}
                  every file's DP numbers and product ids: what the matching needs, fetched once
  d/<stem>.json   {"name", "products": [{"id", "manufacturer", "model"}], "dps": {"<dp>": {"type",
                  "names": [...], "unit", "min", "max", "scale", "step", "values": [...]}}}
                  one product's details, fetched for the device shown

Usage: tools/build_catalogue.py <tuya-local checkout> <output dir>
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import yaml


def dp_info(dp, entity):
    """What a dps entry of an entity says of its DP."""
    out = {"type": str(dp.get("type", ""))}
    label = dp.get("name", "")
    if label in ("", "sensor", "switch", "value", "option", "brightness", "light", "fan", "speed") or label == entity.get("entity"):
        label = (entity.get("name") or entity.get("class") or entity.get("entity") or "") + ("" if label in ("", entity.get("entity")) else " · " + label)
    else:
        label = (entity.get("name") + " · " + label) if entity.get("name") else label
    out["names"] = [label.strip(" ·")] if label.strip(" ·") else []
    rng = dp.get("range")
    if isinstance(rng, dict):
        if "min" in rng:
            out["min"] = rng["min"]
        if "max" in rng:
            out["max"] = rng["max"]
    if dp.get("unit"):
        out["unit"] = str(dp["unit"])
    values = []
    for m in dp.get("mapping") or []:
        if not isinstance(m, dict):
            continue
        if "scale" in m and "scale" not in out:
            out["scale"] = m["scale"]
        if "step" in m and "step" not in out:
            out["step"] = m["step"]
        if "dps_val" in m and m["dps_val"] is not None and not isinstance(m["dps_val"], (dict, list)):
            v = m["dps_val"]
            if v not in values:
                values.append(v)
    if values:
        out["values"] = values[:24]
    return out


def merge(a, b):
    """Two entries for the same DP (several entities read it): names joined, the rest kept."""
    for n in b.get("names", []):
        if n not in a.setdefault("names", []):
            a["names"].append(n)
    for k, v in b.items():
        if k != "names" and k not in a:
            a[k] = v
    return a


def product(path):
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        return None
    dps = {}
    entities = [doc.get("primary_entity")] + list(doc.get("secondary_entities") or []) + list(doc.get("entities") or [])
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        for dp in ent.get("dps") or []:
            if not isinstance(dp, dict) or not isinstance(dp.get("id"), int):
                continue
            k = str(dp["id"])
            info = dp_info(dp, ent)
            dps[k] = merge(dps[k], info) if k in dps else info
    products = []
    for p in doc.get("products") or []:
        if isinstance(p, dict) and p.get("id"):
            products.append({k: str(p[k]) for k in ("id", "manufacturer", "model") if p.get(k)})
    return {"name": str(doc.get("name", path.stem)), "products": products, "dps": dps}


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    devices = src / "custom_components" / "tuya_local" / "devices"
    (out / "d").mkdir(parents=True, exist_ok=True)
    ref = subprocess.run(["git", "-C", str(src), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    files, skipped = [], 0
    for path in sorted(devices.glob("*.yaml")):
        try:
            p = product(path)
        except yaml.YAMLError:
            p = None
        if not p or not p["dps"]:
            skipped += 1
            continue
        stem = path.stem
        (out / "d" / (stem + ".json")).write_text(json.dumps(p, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        files.append([stem, p["name"], sorted(int(k) for k in p["dps"]), [x["id"] for x in p["products"]]])
    (out / "index.json").write_text(json.dumps({"ref": ref, "files": files}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for name in ("LICENSE.md", "LICENSE"):
        if (src / name).exists():
            shutil.copy(src / name, out / "LICENSE.md")
            break
    print(f"catalogue: {len(files)} products, {skipped} files skipped, index {(out / 'index.json').stat().st_size} B")


if __name__ == "__main__":
    main()
