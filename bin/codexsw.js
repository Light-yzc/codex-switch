#!/usr/bin/env node
import { main } from '../lib/core.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // Only our own messages are safe to print. JSON parsers may include tokens.
  console.error(`codexsw: ${error.safeMessage || 'Operation failed. No credentials were printed.'}`);
  process.exitCode = 1;
}
