#!/usr/bin/env bash
# Builds the place file and uploads it to a Roblox place through Open Cloud (Assets API).
#
# Usage:
#   ROBLOX_API_KEY_FILE=/path/to/key.txt tools/publish.sh <placeId> [--save-only]
#   ROBLOX_API_KEY=... tools/publish.sh <placeId> [--save-only]
#
# The API key needs the "universe" permission with the "publish" operation for the experience
# (create.roblox.com -> Open Cloud -> API Keys). Never commit the key.
# --save-only uploads a new saved version without making it the live version.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLACE_ID="${1:-}"
if ! [[ "$PLACE_ID" =~ ^[0-9]+$ ]]; then
  echo "usage: tools/publish.sh <placeId> [--save-only]" >&2
  exit 2
fi
PUBLISHED=true
if [ "${2:-}" = "--save-only" ]; then
  PUBLISHED=false
fi

if [ -n "${ROBLOX_API_KEY_FILE:-}" ]; then
  KEY="$(cat "$ROBLOX_API_KEY_FILE")"
else
  KEY="${ROBLOX_API_KEY:?Set ROBLOX_API_KEY or ROBLOX_API_KEY_FILE}"
fi

"$ROOT/tools/build.sh"
PLACE_FILE="$ROOT/build/CrystalSmashers.rbxlx"

echo "Uploading $(basename "$PLACE_FILE") to place $PLACE_ID (published=$PUBLISHED)..."
RESPONSE="$(curl -sS --fail-with-body -X PATCH "https://apis.roblox.com/assets/v1/assets/${PLACE_ID}" \
  -H "x-api-key: ${KEY}" \
  --form-string "request={\"assetId\": ${PLACE_ID}, \"assetType\": \"Place\", \"published\": ${PUBLISHED}}" \
  --form "fileContent=@${PLACE_FILE};type=application/xml")"
OPERATION="$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["path"])')"
echo "Accepted: $OPERATION"

# The upload is processed asynchronously: poll the operation until it is done.
for _ in $(seq 1 60); do
  STATUS="$(curl -sS --fail-with-body "https://apis.roblox.com/assets/v1/${OPERATION}" -H "x-api-key: ${KEY}")"
  if printf '%s' "$STATUS" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("done") else 1)'; then
    if printf '%s' "$STATUS" | python3 -c 'import json,sys; sys.exit(0 if "error" in json.load(sys.stdin) else 1)'; then
      echo "Publish FAILED: $STATUS" >&2
      exit 1
    fi
    echo "Done: $STATUS"
    exit 0
  fi
  sleep 2
done
echo "Timed out waiting for $OPERATION" >&2
exit 1
