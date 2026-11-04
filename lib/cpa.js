import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, rejectLink, isMissing, fail } from './storage.js';

const marker = '# codexsw: CPA mode\n';
function read(file) {
  try { rejectLink(file); return fs.readFileSync(file, 'utf8'); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

export class CpaConfig {
  constructor(paths) {
    this.active = path.join(paths.home, 'config.toml');
    this.saved = path.join(paths.state, 'config.cpa.toml');
    this.official = path.join(paths.state, 'config.official.toml');
  }
  isActive() { return (read(this.active) || '').startsWith(marker); }
  prepare(log) {
    if (read(this.saved) === null) atomicWrite(this.saved, `model_provider = "cpa"\nmodel = "REPLACE_WITH_CPA_MODEL"\ncli_auth_credentials_store = "file"\n\n[model_providers.cpa]\nname = "CPA"\nbase_url = "REPLACE_WITH_CPA_BASE_URL"\nwire_api = "responses"\nexperimental_bearer_token = "REPLACE_WITH_CPA_API_KEY"\nrequires_openai_auth = false\n`);
    log(`CPA config: ${this.saved}`);
    log('Edit this file in your editor; set base_url and model. Then run codexsw 0.');
    return this.saved;
  }
  enable() {
    const target = read(this.saved);
    if (target === null || target.includes('REPLACE_WITH_CPA_')) throw fail(`CPA is not configured. Run codexsw edit 0, then edit ${this.saved}.`);
    if (!/^\s*model_provider\s*=\s*["']cpa["']\s*$/m.test(target) || !/^\s*\[model_providers\.cpa\]\s*$/m.test(target)) {
      throw fail('CPA config must select model_provider = "cpa" and define [model_providers.cpa].');
    }
    if (this.isActive()) { atomicWrite(this.active, marker + target); return; }
    atomicWrite(this.official, read(this.active) ?? '');
    atomicWrite(this.active, marker + target);
  }
  restore() {
    if (!this.isActive()) return () => {};
    const original = read(this.active);
    const official = read(this.official);
    if (official === null) throw fail('Official config backup is missing. The current config was left unchanged.');
    // Keep edits made in CPA mode for the next visit.
    atomicWrite(this.saved, original.slice(marker.length));
    atomicWrite(this.active, official);
    return () => atomicWrite(this.active, original);
  }
}
