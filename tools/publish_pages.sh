#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Publishes dist/pages/ on the cumulative gh-pages branch (GitHub Pages): releases stay under
# /vX.Y.Z/ (a gateway not yet updated still loads its own version), the test build replaces
# /dev/. Run by the workflow, from the repository root, with a token that can push.
# Usage: tools/publish_pages.sh "<commit message>"
set -euo pipefail
pages="${RUNNER_TEMP:?}/pages"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git fetch origin gh-pages; then
  git worktree add "$pages" FETCH_HEAD
  git -C "$pages" checkout -B gh-pages
else
  git worktree add --orphan -b gh-pages "$pages"
fi
if [ -d dist/pages/dev ]; then rm -rf "$pages/dev"; fi
cp -r dist/pages/. "$pages/"
touch "$pages/.nojekyll"
git -C "$pages" add -A
if git -C "$pages" diff --cached --quiet; then
  echo "nothing to publish"
else
  git -C "$pages" commit -m "$1"
  git -C "$pages" push origin gh-pages
fi
