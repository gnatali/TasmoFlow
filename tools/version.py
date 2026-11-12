#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Resolves the TasmoFlow version: the git tag is the only source (there is no VERSION file).

Order: TF_VERSION (explicit, e.g. tests) > GITHUB_REF_NAME when it is a `vX.Y.Z` tag (release
build) > the latest `vX.Y.Z` tag reachable from HEAD (`git describe`) > 0.0.0 (no tag: shallow
clone, source archive). Prints X.Y.Z; other scripts import resolve()."""
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FORMAT = re.compile(r"\d+\.\d+\.\d+")


def check(version, origin):
    if not FORMAT.fullmatch(version):
        sys.exit(f"invalid version from {origin}: {version!r} (expected X.Y.Z)")
    return version


def resolve():
    explicit = os.environ.get("TF_VERSION", "").strip()
    if explicit:
        return check(explicit, "TF_VERSION")
    ref = os.environ.get("GITHUB_REF_NAME", "")
    if os.environ.get("GITHUB_REF_TYPE") == "tag" or re.fullmatch(r"v\d+\.\d+\.\d+", ref):
        return check(ref.removeprefix("v"), f"tag {ref}")
    try:
        tag = subprocess.run(["git", "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        return check(tag.removeprefix("v"), f"git tag {tag}")
    except (OSError, subprocess.CalledProcessError):
        return "0.0.0"


if __name__ == "__main__":
    print(resolve())
