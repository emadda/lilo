#!/usr/bin/env bash
# It is also possible to bundle `bun` by adding it as a dependency in package.json and referencing it from `node_modules`.
DIR=$(dirname "$0")
exec "$DIR/../node_modules/bun/bin/bun" "$DIR/cli.ts" "$@"
