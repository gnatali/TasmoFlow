#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Builds the TasmoFlow extension.

Writes into dist/:
  TasmoFlow.tapp          extension to install on the gateway (uncompressed zip, like
                          Tasmota's official extensions)
  pages/vX.Y.Z/app.js     full interface to publish on GitHub Pages
  pages/vX.Y.Z/TasmoFlow.tapp, pages/latest.json
                          the .tapp for the update button, and the manifest that says which
                          version is the latest (version, size, sha256, relative path)

The .tapp holds lite.js.gz, the light interface served by the gateway when GitHub cannot be
reached or an update is offered: device control and the update only (the full one only lives on
GitHub Pages, to spare the 320 KB file system). Its Berry files are minified (no comments, no
indentation, see minify_berry()): the commented sources stay in extension/. The SRI hash of
app.js is written into tasmoflow.be: the /tf page refuses a GitHub copy that differs from the
installed version's.

Test build (`--dev`): the .tapp loads https://<cdn>/dev/app.js with no SRI pin and a cache-busting
query, so one published dev/app.js can be replaced at every run without a release or a new
.tapp. Writes dist/dev/TasmoFlow.tapp and dist/pages/dev/{app.js,TasmoFlow.tapp,latest.json}. The .tapp
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

# size budgets (the specification allowed 150 KB for the .tapp, 25 KB for lite.js.gz; Guillaume
# asked on 11 November 2026 for half of v0.2.0's 83,069 B .tapp: device control and update only)
MAX_APP_GZ = 120 * 1024             # full interface (GitHub Pages)
MAX_LITE_GZ = 14 * 1024             # light interface (file system of the gateway)
MAX_TAPP = 83069 // 2

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


def berry_scan(src, name):
    """Splits Berry source into ('str', text), ('com', text), ('sp', text) and ('code', char)
    pieces. Strings are kept whole (no Berry string spans lines); `#` starts a comment to the
    end of the line, `#-` a block comment closed by `-#` (the Berry lexer's rules)."""
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == "\n":
                    sys.exit(f"{name}: line break inside a string")
                j += 2 if src[j] == "\\" else 1
            if j >= n:
                sys.exit(f"{name}: unterminated string")
            yield "str", src[i:j + 1]
            i = j + 1
        elif c == "#":
            if src.startswith("#-", i):
                j = src.find("-#", i + 2)
                if j < 0:
                    sys.exit(f"{name}: unterminated block comment")
                j += 2
            else:
                j = src.find("\n", i)
                j = n if j < 0 else j
            yield "com", src[i:j]
            i = j
        elif c in " \t\r\n":
            j = i
            while j < n and src[j] in " \t\r\n":
                j += 1
            yield "sp", src[i:j]
            i = j
        else:
            yield "code", c
            i += 1


def berry_tokens(src, name):
    """Tokens that matter to Berry: strings, words (names, keywords, numbers), other characters."""
    out, word = [], ""
    for kind, text in berry_scan(src, name):
        if kind == "code" and (text.isalnum() or text == "_"):
            word += text
            continue
        if word:
            out.append(word)
            word = ""
        if kind in ("str", "code"):
            out.append(text)
    if word:
        out.append(word)
    return out


def berry_word(c):
    return c.isalnum() or c == "_"


def needs_space(a, b):
    """Must a blank stay between the characters a and b? Yes between two words (`return x`), and
    between two signs (`= =` is not `==`, `/ ->` is a lambda). Also kept next to a string (`f 'x'`
    is not the f-string `f'x'`) and next to a dot (`1 .. 3` is not `1. .3`). A word and a sign
    need none (`x = 1` is `x=1`)."""
    if a in "'\"." or b in "'\".":
        return True
    return berry_word(a) == berry_word(b)


def minify_berry(src, name, notice):
    """The .tapp carries Berry without comments, indentation or needless blanks (60 % smaller);
    the commented source is in the repository. Strings are left untouched. Line breaks stay (a
    break and a space are the same size), empty lines go. Checked: the token sequence is the same
    as the source's, so no two words were glued together."""
    parts = list(berry_scan(src, name))
    out = []
    for i, (kind, text) in enumerate(parts):
        if kind == "com":
            kind, text = "sp", " "              # a block comment may sit between two words
        if kind != "sp":
            out.append(text)
        elif "\n" in text:
            out.append("\n")
        elif out and i + 1 < len(parts) and parts[i + 1][0] != "com" and parts[i + 1][1].strip():
            if needs_space(out[-1][-1], parts[i + 1][1][0]):
                out.append(" ")
        else:
            out.append(" ")
    lines = [line.strip() for line in "".join(out).split("\n")]
    out = "\n".join(([f"# {notice}"] if notice else []) + [line for line in lines if line]) + "\n"
    if berry_tokens(out, name) != berry_tokens(src, name):
        sys.exit(f"{name}: minified Berry differs from the source")
    return out


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
    # one notice for the extension, one for the code taken from Tasmota (the other files are ours)
    notice = f"TasmoFlow {shown} GPL-3.0-only, source: github.com/gnatali/TasmoFlow"
    notices = {"tasmoflow.be": notice,
               "tf_http.be": notice + ", from Tasmota's webserver_async.be (C) 2023 Stephan Hadinger & Theo Arends"}

    def berry(name):
        src = substitute((EXT / name).read_text(), values, name)
        return minify_berry(src, name, notices.get(name)).encode()

    ext_manifest = json.loads(substitute((EXT / "manifest.json").read_text(), values, "manifest.json"))
    files = {
        "autoexec.be": berry("autoexec.be"),
        "manifest.json": json.dumps(ext_manifest, separators=(",", ":")).encode(),
        "tasmoflow.be": berry("tasmoflow.be"),
        "tf_http.be": berry("tf_http.be"),
        "tf_rules.be": berry("tf_rules.be"),
        "tf_update.be": berry("tf_update.be"),
        "lite.js.gz": lite_gz,
    }

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
    tapp_bytes = tapp.read_bytes()
    # What the update button reads: the version of the channel's latest .tapp, its size and its
    # SHA-256 (the gateway checks both before it replaces itself), and where to get it
    # (relative to the manifest). Test builds publish theirs in dev/, releases at the root.
    manifest = {"version": shown, "size": len(tapp_bytes), "sha256": hashlib.sha256(tapp_bytes).hexdigest()}
    if args.dev:
        (pages / "TasmoFlow.tapp").write_bytes(tapp_bytes)
        manifest["tapp"] = "TasmoFlow.tapp"
        (pages / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    else:
        (pages / "TasmoFlow.tapp").write_bytes(tapp_bytes)
        manifest["tapp"] = f"{app_dir}/TasmoFlow.tapp"
        (DIST / "pages" / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")

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
