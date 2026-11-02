#!/bin/bash
# Run the Express API server. The uid-web frontend is a separate static
# artifact served at "/" — it is no longer built or served from here.
cd "$(dirname "$0")"

echo "Starting Express API Server..."
node --enable-source-maps ./dist/index.mjs
