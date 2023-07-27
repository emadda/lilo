# Test `npm install --global`

# Remove prev run.
npm uninstall -g lilo-cli

npm pack --pack-destination /tmp

# Note:
# - `better-sqlite` compiles SQLite from source - takes around 30 seconds on M1.
# - `npm install ./local-dir` does not install `node_modules`, or run the `postinstall` scripts.
npm install --loglevel verbose --global /tmp/lilo-cli-0.0.1.tgz
