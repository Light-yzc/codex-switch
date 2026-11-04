import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, rejectLink, isMissing, fail } from './storage.js';

const marker = '# codexsw: CPA mode\n';
const managedAuthMarker = '# codexsw: generated CPA token helper';
const keyPlaceholder = 'REPLACE_WITH_CPA_API_KEY';
const tableHeader = /^[ \t]*\[[^\]\r\n]+\][ \t]*(?:#.*)?$/m;

function read(file) {
  try { rejectLink(file); return fs.readFileSync(file, 'utf8'); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

function privateSection(text) {
  const headers = [...text.matchAll(/^[ \t]*\[codexsw\][ \t]*(?:#.*)?$/gm)];
  if (headers.length > 1) throw fail('CPA config contains duplicate [codexsw] sections.');
  if (!headers.length) return { publicText: text, section: null };
  const from = headers[0].index;
  const afterHeader = from + headers[0][0].length;
  const next = tableHeader.exec(text.slice(afterHeader));
  const to = next ? afterHeader + next.index : text.length;
  return { publicText: text.slice(0, from) + text.slice(to), section: text.slice(from, to) };
}

function getKey(text) {
  const section = privateSection(text).section;
  if (section === null) throw fail('CPA key is not configured. Run codexsw edit 0 and set [codexsw].api_key.');
  const matches = [...section.matchAll(/^[ \t]*api_key[ \t]*=[ \t]*("(?:[^"\\]|\\.)*"|'[^']*')[ \t]*(?:#.*)?$/gm)];
  if (matches.length !== 1) throw fail('CPA config needs one quoted [codexsw].api_key value.');
  let key;
  try { key = matches[0][1].startsWith('"') ? JSON.parse(matches[0][1]) : matches[0][1].slice(1, -1); }
  catch { throw fail('CPA api_key is not a valid quoted string.'); }
  if (!key || key === keyPlaceholder || key.trim() !== key || /[\r\n]/.test(key)) {
    throw fail('CPA api_key is missing or invalid. Run codexsw edit 0.');
  }
  return key;
}

export function readCpaKey(file) {
  const text = read(file);
  if (text === null) throw fail('CPA key file is missing. Run codexsw edit 0.');
  return getKey(text);
}

// Keep the private [codexsw] table outside Codex's active configuration.
// Command-backed auth must not coexist with environment/direct-token auth.
function withoutLegacyAuth(text) {
  const header = /^[ \t]*\[model_providers\.cpa\][ \t]*(?:#.*)?$/m.exec(text);
  if (!header) throw fail('CPA config must define [model_providers.cpa].');
  if (/^[ \t]*\[model_providers\.cpa\.auth\][ \t]*(?:#.*)?$/m.test(text)) {
    throw fail('Remove the custom [model_providers.cpa.auth] section; codexsw manages it.');
  }
  const from = header.index + header[0].length;
  const next = tableHeader.exec(text.slice(from));
  const to = next ? from + next.index : text.length;
  const provider = text.slice(from, to).replace(/^[ \t]*(?:env_key|requires_openai_auth|experimental_bearer_token)[ \t]*=[^\r\n]*(?:\r?\n|$)/gm, '');
  return text.slice(0, from) + provider + text.slice(to);
}

function withoutGeneratedAuth(text) {
  // Only strip our managed stanza, leaving user edits made in CPA mode.
  return text.replace(/(?:\r?\n)?# codexsw: generated CPA token helper\r?\n\[model_providers\.cpa\.auth\]\r?\ncommand = [^\r\n]*\r?\nargs = [^\r\n]*\r?\n/g, '');
}

export class CpaConfig {
  constructor(paths) {
    this.active = path.join(paths.home, 'config.toml');
    this.saved = path.join(paths.state, 'config.cpa.toml');
    this.official = path.join(paths.state, 'config.official.toml');
  }
  isActive() { return (read(this.active) || '').startsWith(marker); }
  prepare(log) {
    let target = read(this.saved);
    if (target === null) {
      target = [
        '# Edit base_url, model and [codexsw].api_key, then run codexsw 0.',
        '# Do not commit or share this private file.',
        'model_provider = "cpa"',
        'model = "REPLACE_WITH_CPA_MODEL"',
        'cli_auth_credentials_store = "file"',
        '',
        '[model_providers.cpa]',
        'name = "CPA"',
        'base_url = "REPLACE_WITH_CPA_BASE_URL"',
        'wire_api = "responses"',
        '',
        '[codexsw]',
        'api_key = "' + keyPlaceholder + '"',
        '',
      ].join('\n');
      atomicWrite(this.saved, target);
    } else if (privateSection(target).section === null) {
      // Upgrade older CPA configs without discarding endpoint or model settings.
      target = target.trimEnd() + '\n\n[codexsw]\napi_key = "' + keyPlaceholder + '"\n';
      atomicWrite(this.saved, target);
      log('CPA config upgraded: fill in [codexsw].api_key to stop using CPA_API_KEY.');
    }
    if (process.platform !== 'win32') fs.chmodSync(this.saved, 0o600);
    log('CPA config: ' + this.saved);
    log('Edit base_url, model and [codexsw].api_key, then run codexsw 0.');
    return this.saved;
  }
  enable() {
    const target = read(this.saved);
    if (target === null || target.includes('REPLACE_WITH_CPA_')) throw fail('CPA is not configured. Run codexsw edit 0, then edit ' + this.saved + '.');
    if (!/^[ \t]*model_provider[ \t]*=[ \t]*["']cpa["'][ \t]*$/m.test(target)) {
      throw fail('CPA config must select model_provider = "cpa".');
    }
    getKey(target);
    const publicConfig = withoutLegacyAuth(privateSection(target).publicText).trimEnd();
    const helper = fileURLToPath(new URL('../bin/cpa-key.js', import.meta.url));
    const generated = '\n\n' + managedAuthMarker + '\n[model_providers.cpa.auth]\ncommand = '
      + JSON.stringify(process.execPath) + '\nargs = [' + JSON.stringify(helper) + ', ' + JSON.stringify(this.saved) + ']\n';
    if (this.isActive()) { atomicWrite(this.active, marker + publicConfig + generated); return; }
    atomicWrite(this.official, read(this.active) ?? '');
    atomicWrite(this.active, marker + publicConfig + generated);
  }
  restore() {
    if (!this.isActive()) return () => {};
    const original = read(this.active);
    const official = read(this.official);
    if (official === null) throw fail('Official config backup is missing. The current config was left unchanged.');
    // Preserve changes made in CPA mode without copying the API key to config.toml.
    const oldPrivate = privateSection(read(this.saved) ?? '').section;
    const modified = withoutGeneratedAuth(original.slice(marker.length));
    const cleaned = privateSection(modified).publicText.trimEnd();
    const newSaved = (cleaned + '\n\n' + (oldPrivate || '').trimStart()).trimEnd() + '\n';
    atomicWrite(this.saved, newSaved);
    atomicWrite(this.active, official);
    return () => atomicWrite(this.active, original);
  }
}
