#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Assemble l'extension TasmoFlow.

Produit dans dist/ :
  TasmoFlow.tapp          extension a installer sur la passerelle (zip sans compression,
                          comme les extensions officielles de Tasmota)
  pages/vX.Y.Z/app.js     interface a publier sur GitHub Pages

La .tapp contient app.js.gz, copie locale de l'interface servie quand GitHub ne
repond pas. L'empreinte SRI de app.js est inscrite dans tasmoflow.be : la page /tf
refuse une copie GitHub differente de celle de la version installee.

Usage : python3 tools/pack_tapp.py [--cdn URL]
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
APP = ROOT / "app" / "app.js"
DIST = ROOT / "dist"

# budgets du cahier des charges (exigences non fonctionnelles)
MAX_APP_GZ = 120 * 1024
MAX_TAPP = 150 * 1024

# date fixe dans le zip et le gzip : deux assemblages du meme code donnent le meme fichier
ZIP_DATE = (2026, 1, 1, 0, 0, 0)


def version_hex(version):
    """'1.2.3' -> '0x01020300', format des versions Tasmota (octet de build a 0)."""
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if not m:
        sys.exit(f"VERSION invalide : {version!r} (attendu X.Y.Z)")
    major, minor, patch = (int(x) for x in m.groups())
    if max(major, minor, patch) > 255:
        sys.exit(f"VERSION invalide : {version!r} (chaque nombre <= 255)")
    return f"0x{major:02X}{minor:02X}{patch:02X}00"


def substitute(text, values, name):
    for key, value in values.items():
        text = text.replace(f"@@{key}@@", value)
    left = re.findall(r"@@[A-Z_]+@@", text)
    if left:
        sys.exit(f"{name} : marqueurs non remplaces {sorted(set(left))}")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cdn", default="https://gnatali.github.io/TasmoFlow/",
                        help="adresse GitHub Pages de l'interface ('' : copie locale seule)")
    args = parser.parse_args()
    if args.cdn and not args.cdn.endswith("/"):
        args.cdn += "/"

    version = (ROOT / "VERSION").read_text().strip()
    app = APP.read_bytes()
    app_gz = gzip.compress(app, compresslevel=9, mtime=0)
    sri = "sha384-" + base64.b64encode(hashlib.sha384(app).digest()).decode()

    values = {"VERSION": version, "VERSION_HEX": version_hex(version), "CDN": args.cdn, "SRI": sri}
    files = {
        "autoexec.be": (EXT / "autoexec.be").read_bytes(),
        "manifest.json": substitute((EXT / "manifest.json").read_text(), values, "manifest.json").encode(),
        "tasmoflow.be": substitute((EXT / "tasmoflow.be").read_text(), values, "tasmoflow.be").encode(),
        "tf_http.be": (EXT / "tf_http.be").read_bytes(),
        "app.js.gz": app_gz,
    }
    json.loads(files["manifest.json"])          # le manifeste doit rester du JSON valide

    DIST.mkdir(exist_ok=True)
    tapp = DIST / "TasmoFlow.tapp"
    with zipfile.ZipFile(tapp, "w", compression=zipfile.ZIP_STORED) as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)

    pages = DIST / "pages" / f"v{version}"
    pages.mkdir(parents=True, exist_ok=True)
    (pages / "app.js").write_bytes(app)

    tapp_size = tapp.stat().st_size
    print(f"TasmoFlow {version} ({values['VERSION_HEX']})")
    for name, data in files.items():
        print(f"  {name:<14} {len(data):>7} o")
    print(f"  app.js         {len(app):>7} o (non compresse)")
    print(f"  {tapp.relative_to(ROOT)} : {tapp_size} o / budget {MAX_TAPP} o")
    print(f"  app.js.gz : {len(app_gz)} o / budget {MAX_APP_GZ} o")
    print(f"  SRI : {sri}")

    errors = []
    if len(app_gz) > MAX_APP_GZ:
        errors.append(f"app.js.gz depasse le budget ({len(app_gz)} > {MAX_APP_GZ} o)")
    if tapp_size > MAX_TAPP:
        errors.append(f"TasmoFlow.tapp depasse le budget ({tapp_size} > {MAX_TAPP} o)")
    if errors:
        sys.exit("\n".join(errors))


if __name__ == "__main__":
    main()
