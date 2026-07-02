#!/usr/bin/env bash
# Deploy the chaching dashboard on kinto (launchd com.chaching.dashboard).
#
# The base path is baked at BUILD time (CHACHING_BASE_PATH — see CLAUDE.md
# "Serve base path vs origin"), and reception's Caddyfile proxies /chaching*
# WITHOUT stripping the prefix, so a bare `npm run build` 404s the live
# dashboard. This script makes the deploy impossible to half-do:
#
#   1. build with the base path baked in
#   2. probe the ARTIFACT on a scratch port (not the live process — a live
#      probe right after kickstart can hit a restart race and lie)
#   3. kickstart the launchd agent
#   4. verify the live port serves the base path + the expected version
#
# Any step failing exits non-zero and leaves the previous process running.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE_PATH="${CHACHING_BASE_PATH:-/chaching}"
LIVE_PORT=42619
SCRATCH_PORT=45990
AGENT="gui/$(id -u)/com.chaching.dashboard"
VERSION="$(node -p "require('./package.json').version")"

echo "==> building v${VERSION} with CHACHING_BASE_PATH=${BASE_PATH}"
CHACHING_BASE_PATH="$BASE_PATH" npm run build

echo "==> probing the built artifact on :${SCRATCH_PORT}"
PORT=$SCRATCH_PORT HOST=127.0.0.1 node build/index.js &
PROBE_PID=$!
trap 'kill "$PROBE_PID" 2>/dev/null || true' EXIT
sleep 3
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${SCRATCH_PORT}${BASE_PATH}/")"
kill "$PROBE_PID" 2>/dev/null || true
trap - EXIT
if [ "$code" != "200" ]; then
	echo "FAIL: artifact serves ${BASE_PATH}/ with HTTP ${code} — base path not baked; NOT deploying" >&2
	exit 1
fi
echo "    artifact OK (${BASE_PATH}/ -> 200)"

echo "==> kickstarting ${AGENT}"
launchctl kickstart -k "$AGENT"
sleep 5

live="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${LIVE_PORT}${BASE_PATH}/")"
if [ "$live" != "200" ]; then
	echo "FAIL: live process serves ${BASE_PATH}/ with HTTP ${live}" >&2
	exit 1
fi
if ! curl -s "http://127.0.0.1:${LIVE_PORT}${BASE_PATH}/" | grep -q "v${VERSION}"; then
	echo "FAIL: live process is up but not serving v${VERSION} (stale build?)" >&2
	exit 1
fi
echo "==> deployed: v${VERSION} live on :${LIVE_PORT}${BASE_PATH}/"
