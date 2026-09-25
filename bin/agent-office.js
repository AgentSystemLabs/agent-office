#!/usr/bin/env node
import('../dist/server/server/cli.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
