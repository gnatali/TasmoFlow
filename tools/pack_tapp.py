#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Builds the TasmoFlow extension.

Writes into dist/:
  TasmoFlow.tapp          extension to install on the gateway (uncompressed zip, like
                          Tasmota's official extensions)
  pages/vX.Y.Z/app.js     full interface to publish on GitHub Pages

The .tapp holds lite.js.gz, the light interface served by the gateway when GitHub cannot be
reached (the full one only lives on GitHub Pages, to spare the 320 KB file system). The SRI
hash of app.js is written into tasmoflow.be: the /tf page refuses a GitHub copy that differs
from the installed version's.

Test build (`--dev`): the .tapp loads https://<cdn>/dev/app.js with no SRI pin and a cache-busting
query, so one published dev/app.js can be replaced at every run without a release or a new
.tapp. Writes dist/dev/TasmoFlow.tapp and dist/pages/dev/{app.js,TasmoFlow.tapp}. The .tapp
only has to be installed again when extension/ or the light interface changed.

Usage: python3 tools/pack_tapp.py [--cdn URL] [--dev [--build-id ID]]
"""

import argparse
import base64
import gzip
import hashlib
import json
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
APP = ROOT / "dist" / "app.js"      # built by `npm run build` from app/src/
LITE = ROOT / "dist" / "lite.js"
DIST = ROOT / "dist"

# budgets from the specification (non-functional requirements)
MAX_APP_GZ = 120 * 1024             # full interface (GitHub Pages)
MAX_LITE_GZ = 25 * 1024             # light interface (file system of the gateway)
MAX_TAPP = 150 * 1024

# fixed date in the zip and the gzip: two builds of the same code give the same file
ZIP_DATE = (2026, 1, 1, 0, 0, 0)


def version_hex(version):
    """'1.2.3' -> '0x01020300', Tasmota version format (build byte set to 0)."""
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if not m:
        sys.exit(f"invalid VERSION: {version!r} (expected X.Y.Z)")
    major, minor, patch = (int(x) for x in m.groups())
    if max(major, minor, patch) > 255:
        sys.exit(f"invalid VERSION: {version!r} (each number <= 255)")
    return f"0x{major:02X}{minor:02X}{patch:02X}00"


def substitute(text, values, name):
    for key, value in values.items():
        text = text.replace(f"@@{key}@@", value)
    left = re.findall(r"@@[A-Z_]+@@", text)
    if left:
        sys.exit(f"{name}: markers not replaced {sorted(set(left))}")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cdn", default="https://gnatali.github.io/TasmoFlow/",
                        help="GitHub Pages address of the interface ('': local copy only)")
    parser.add_argument("--dev", action="store_true", help="test build (see above)")
    parser.add_argument("--build-id", default="", help="with --dev: id shown in the version, e.g. a commit")
    args = parser.parse_args()
    if args.cdn and not args.cdn.endswith("/"):
        args.cdn += "/"

    version = (ROOT / "VERSION").read_text().strip()
    for f in (APP, LITE):
        if not f.exists():
            sys.exit(f"{f.relative_to(ROOT)} missing: run `npm ci && npm run build` first")
    app = APP.read_bytes()
    app_gz = gzip.compress(app, compresslevel=9, mtime=0)
    lite_gz = gzip.compress(LITE.read_bytes(), compresslevel=9, mtime=0)
    sri = "sha384-" + base64.b64encode(hashlib.sha384(app).digest()).decode()

    shown = version
    app_dir = f"v{version}"
    if args.dev:
        shown = f"{version}-dev" + (f".{args.build_id}" if args.build_id else "")
        app_dir = "dev"
        sri = ""                                # the file changes at every run: no pin
        if not args.cdn:
            sys.exit("--dev needs a --cdn address")
    values = {"VERSION": shown, "VERSION_HEX": version_hex(version), "CDN": args.cdn, "APP_DIR": app_dir,
              "SRI": sri}
    files = {
        "autoexec.be": (EXT / "autoexec.be").read_bytes(),
        "manifest.json": substitute((EXT / "manifest.json").read_text(), values, "manifest.json").encode(),
        "tasmoflow.be": substitute((EXT / "tasmoflow.be").read_text(), values, "tasmoflow.be").encode(),
        "tf_http.be": (EXT / "tf_http.be").read_bytes(),
        "tf_rules.be": (EXT / "tf_rules.be").read_bytes(),
        "lite.js.gz": lite_gz,
    }
    json.loads(files["manifest.json"])          # the manifest must stay valid JSON

    DIST.mkdir(exist_ok=True)
    out = DIST / "dev" if args.dev else DIST
    out.mkdir(exist_ok=True)
    tapp = out / "TasmoFlow.tapp"
    with zipfile.ZipFile(tapp, "w", compression=zipfile.ZIP_STORED) as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)

    pages = DIST / "pages" / app_dir
    pages.mkdir(parents=True, exist_ok=True)
    (pages / "app.js").write_bytes(app)
    if args.dev:
        (pages / "TasmoFlow.tapp").write_bytes(tapp.read_bytes())

    tapp_size = tapp.stat().st_size
    print(f"TasmoFlow {shown} ({values['VERSION_HEX']})")
    for name, data in files.items():
        print(f"  {name:<14} {len(data):>7} B")
    print(f"  app.js (GitHub Pages only) {len(app):>7} B (uncompressed), {len(app_gz)} B gzipped / budget {MAX_APP_GZ} B")
    print(f"  {tapp.relative_to(ROOT)}: {tapp_size} B / budget {MAX_TAPP} B")
    print(f"  lite.js.gz: {len(lite_gz)} B / budget {MAX_LITE_GZ} B")
    print(f"  SRI: {sri or '(none, test build)'}")

    errors = []
    if len(lite_gz) > MAX_LITE_GZ:
        errors.append(f"lite.js.gz exceeds its budget ({len(lite_gz)} > {MAX_LITE_GZ} B)")
    if len(app_gz) > MAX_APP_GZ:
        errors.append(f"app.js.gz exceeds its budget ({len(app_gz)} > {MAX_APP_GZ} B)")
    if tapp_size > MAX_TAPP:
        errors.append(f"TasmoFlow.tapp exceeds its budget ({tapp_size} > {MAX_TAPP} B)")
    if errors:
        sys.exit("\n".join(errors))


if __name__ == "__main__":
    main()
