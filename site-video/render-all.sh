#!/usr/bin/env bash
# Render all three formats for one site in a single filming pass.
#   ./render-all.sh https://www.example.com [any extra render.js options]
set -e
cd "$(dirname "$0")"
URL="$1"; shift || true
if [ -z "$URL" ]; then echo "Usage: ./render-all.sh https://www.example.com [--caption example.com] [--accent '#ff5a1f']"; exit 1; fi
node render.js --url "$URL" --layout wide,tall,laptop "$@"
