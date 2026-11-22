#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Builds the Tuya product catalogue into dist/pages/catalogue/v<format>/<commit>/ (tools/build_catalogue.py)
# from tuya-local at the commit pinned in app/src/catalogue.js (TUYA_LOCAL_REF): the interface asks
# for that same folder. Run by the workflow before publishing GitHub Pages, from the repository root.
set -euo pipefail
ref=$(grep -o "TUYA_LOCAL_REF = '[0-9a-f]\{40\}'" app/src/catalogue.js | grep -o "[0-9a-f]\{40\}")
fmt=$(grep -o "CATALOGUE_FORMAT = [0-9]*" app/src/catalogue.js | grep -o "[0-9]*$")
src="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tuya-local"
rm -rf "$src"
git init -q "$src"
git -C "$src" remote add origin https://github.com/make-all/tuya-local.git
git -C "$src" sparse-checkout set --no-cone '/custom_components/tuya_local/devices/*' '/LICENSE.md'
for i in 1 2 3; do git -C "$src" fetch -q --depth 1 --filter=blob:none origin "$ref" && break; sleep $((i * 5)); done
git -C "$src" checkout -q FETCH_HEAD
python3 -c "import yaml" 2>/dev/null || python3 -m pip install -q pyyaml
python3 tools/build_catalogue.py "$src" "dist/pages/catalogue/v$fmt/$ref"
