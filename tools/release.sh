#!/bin/bash
# Release stamping: after committing code changes, pin index.html's script
# tags (and the runtime asset base) to this exact commit on jsDelivr.
# Immutable URLs defeat every cache layer between us and any device —
# query-string busting (?v=) proved unreliable: some CDN edges ignore the
# query and serve stale bodies.
#
# Usage: bash tools/release.sh   (run with a clean tree, after code commit)
set -euo pipefail
cd "$(dirname "$0")/.."

SHA=$(git rev-parse HEAD)
BASE="https://cdn.jsdelivr.net/gh/oversized93/Mobile-App-Test@${SHA}/"

python3 - "$SHA" "$BASE" <<'PYEOF'
import re, sys
sha, base = sys.argv[1], sys.argv[2]
src = open('index.html').read()
# Rewrite every local script src (any current form) to the pinned base
def repl(m):
    path = m.group(1).split('?')[0]
    return f'<script src="{base}{path}">'
src = re.sub(r'<script src="(?:https://cdn\.jsdelivr\.net/gh/[^@]+@[0-9a-f]+/)?((?:lib/)?[A-Za-z0-9_.-]+\.js)(?:\?[^"]*)?">', repl, src)
# Set/update the runtime asset base for GLB loads
stamp = f'<script>window.ASSET_BASE = "{base}";</script>'
if 'window.ASSET_BASE' in src:
    src = re.sub(r'<script>window\.ASSET_BASE = "[^"]*";</script>', stamp, src)
else:
    src = src.replace('<script src="' + base + 'lib/three.min.js">', stamp + '\n<script src="' + base + 'lib/three.min.js">')
open('index.html','w').write(src)
print('stamped to', base)
PYEOF

git add index.html
git commit -m "Release stamp: pin scripts to ${SHA:0:10} (jsDelivr immutable)" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
echo "Stamped release. Push to publish."
