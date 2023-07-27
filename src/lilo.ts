#!/usr/bin/env bun
// Add shebang so that package.json `bin` property can reference it as a binary.
// Note: User must have `bun` installed globally (about 60MB).
import * as _ from "./cli";

// Prevent bun from removing "unused" import on build.
const x = {_};
