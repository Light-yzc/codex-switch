#!/usr/bin/env node
import { readCpaKey } from '../lib/cpa.js';

try {
  if (process.argv.length !== 3) throw new Error('Missing CPA config path.');
  process.stdout.write(readCpaKey(process.argv[2]));
} catch {
  // Never include API key contents or TOML source in diagnostics.
  process.stderr.write('Cannot read CPA API key. Run codexsw edit 0 and check [codexsw].api_key.\n');
  process.exitCode = 1;
}
