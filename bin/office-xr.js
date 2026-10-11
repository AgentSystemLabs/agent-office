#!/usr/bin/env node
import('../dist/server/server/xr-playtests/bridge-cli.js').then(m => m.runBridge()).catch(err => { console.error(err.message); process.exitCode = 1; });
