import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fail, hash, isMissing, rejectLink, atomicWrite, resolvePaths, secureDirectory, VaultStore, acquireLock, unlock } from './storage.js';
import { isSlot, compareSlots } from './slots.js';
import { CpaConfig } from './cpa.js';

const help = `codexsw - switch local Codex ChatGPT accounts

  codexsw 0               Select the separately configured CPA endpoint
  codexsw edit 0          Show/create the local CPA config file to edit
  codexsw <N>             Select account N; first use opens official login
  codexsw status          List all saved accounts in numeric order
  codexsw list            Alias for status; no command also shows status
  codexsw save <N>        Register the current ChatGPT login as N
  codexsw login <N>       Sign in again, then select account N
  codexsw forget <N>      Remove saved account N; leave the active login unchanged
  codexsw setup          Back up config.toml and enable Codex file credentials
  codexsw unlock         Remove a lock left by an exited codexsw process

N is any positive integer (1, 2, 3, ...), with no leading zeros.
There is no configured account-count or account-number maximum; gaps are allowed.
Example: codexsw 3, codexsw login 10, codexsw forget 42.
An empty vault first saves an existing current login as account 1.

Options:
  --device-auth           Use official device-code login instead of browser login
  --storage BACKEND       dpapi (Windows), keychain (macOS), file or secret-service (Linux)
  --codex-home PATH       Select a Codex home; defaults to CODEX_HOME or ~/.codex
  --state-dir PATH        Override the local account-backup directory

Switching changes auth.json. Restart/reload running clients that use this Codex home.
`;

export function parseArgs(args) {
  const result = { action: 'status' };
  const positionals = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const lower = argument.toLowerCase();
    if (['-h', '--help'].includes(lower)) { result.action = 'help'; return result; }
    if (lower === '--version' || lower === '-v') { result.action = 'version'; return result; }
    if (['--device-auth', '-deviceauth'].includes(lower)) result.deviceAuth = true;
    else if (['--codex-home', '-codexhome', '--state-dir', '-statedirectory', '--storage'].includes(lower)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw fail(`Missing value for ${argument}.`);
      if (lower === '--storage') result.backend = value;
      else if (['--state-dir', '-statedirectory'].includes(lower)) result.stateDirectory = value;
      else result.codexHome = value;
    } else if (argument.startsWith('-')) throw fail('Unknown option. Run codexsw help.');
    else positionals.push(argument);
  }
  result.action = positionals[0] ?? 'status';
  if (result.action === 'list') result.action = 'status';
  if (result.action === 'edit') {
    if (positionals.length !== 2 || positionals[1] !== '0') throw fail('Usage: codexsw edit 0');
    return result;
  }
  if (result.action !== '0' && !isSlot(result.action) && !['status', 'save', 'login', 'forget', 'setup', 'unlock', 'help'].includes(result.action)) {
    if (/^[0-9]/.test(result.action)) throw fail('Account number must be a positive integer starting at 1, with no leading zeros.');
    throw fail('Unknown command. Run codexsw help.');
  }
  const takesSlot = ['save', 'login', 'forget'].includes(result.action);
  if (takesSlot) {
    if (!isSlot(positionals[1]) || positionals.length !== 2) throw fail(`Usage: codexsw ${result.action} <N> (positive integer starting at 1; no leading zeros)`);
    result.slot = positionals[1];
  } else if (positionals.length > 1) throw fail('Unexpected argument. Run codexsw help.');
  if (result.backend && !['dpapi', 'keychain', 'file', 'secret-service'].includes(result.backend)) throw fail('Unknown storage backend.');
  return result;
}

export function authInfo(raw) {
  try {
    const auth = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (auth.auth_mode !== 'chatgpt' ||
        !['access_token', 'refresh_token', 'account_id'].every(key => typeof auth.tokens?.[key] === 'string' && auth.tokens[key])) throw new Error();
    let claims = {};
    if (auth.tokens.id_token) claims = JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub && typeof claims.sub !== 'string' || claims.email && typeof claims.email !== 'string') throw new Error();
    let accessClaims = {};
    try { accessClaims = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url').toString('utf8')); } catch { /* Access tokens may be opaque. */ }
    const namespace = 'https://api.openai.com/auth';
    const plan = claims[namespace]?.chatgpt_plan_type ?? accessClaims?.[namespace]?.chatgpt_plan_type;
    return { subject: claims.sub || '', email: claims.email || '', accountId: auth.tokens.account_id,
      plan: typeof plan === 'string' ? plan : '' };
  } catch {
    throw fail('Invalid ChatGPT login cache. Sign in with ChatGPT before saving it.');
  }
}

export function sameAccount(left, right) {
  // One user can have personal and multiple team workspaces.
  if (left.accountId !== right.accountId) return false;
  if (left.subject && right.subject) return left.subject === right.subject;
  if (left.email && right.email) return left.email.toLowerCase() === right.email.toLowerCase();
  return left.accountId === right.accountId;
}

export function accountLabel(info) {
  return `${info.email || '(ChatGPT account)'} [${info.plan || 'unknown plan'}; workspace: ${info.accountId}]`;
}

// Scan TOML root scalar settings without confusing provider/profile tables.
export function credentialSetting(text) {
  let offset = 0;
  let multiline = null;
  for (const line of text.split(/(?<=\n)/)) {
    let clean = '';
    let quote = null;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      const triple = line.slice(index, index + 3);
      if (multiline) {
        if (triple === multiline) { multiline = null; index += 2; }
        continue;
      }
      if (!quote && (triple === '"""' || triple === "'''")) { multiline = triple; index += 2; continue; }
      if (quote) {
        clean += char;
        if (quote === '"' && char === '\\') clean += line[++index] || '';
        else if (char === quote) quote = null;
      } else if (char === '#') break;
      else { clean += char; if (char === '"' || char === "'") quote = char; }
    }
    const trimmed = clean.trim();
    if (trimmed.startsWith('[')) return { value: 'file', explicit: false };
    const match = clean.match(/^\s*(?:"cli_auth_credentials_store"|'cli_auth_credentials_store'|cli_auth_credentials_store)\s*=\s*(["'])(file|keyring|auto|ephemeral)\1\s*$/);
    if (match) return { value: match[2], explicit: true, start: offset, end: offset + line.length, newline: line.endsWith('\r\n') ? '\r\n' : '\n' };
    if (/^\s*(?:"cli_auth_credentials_store"|'cli_auth_credentials_store'|cli_auth_credentials_store)\s*=/.test(clean)) {
      throw fail('Cannot parse cli_auth_credentials_store safely. Set it to "file" in config.toml.');
    }
    offset += line.length;
  }
  return { value: 'file', explicit: false };
}

function readConfig(home) {
  const file = path.join(home, 'config.toml');
  try { rejectLink(file); return fs.readFileSync(file, 'utf8'); }
  catch (error) { if (isMissing(error)) return ''; throw error; }
}

function requireFileCredentials(home) {
  if (credentialSetting(readConfig(home)).value !== 'file') {
    throw fail('Codex is configured for a different credential store. Run codexsw setup, then codexsw login 1.');
  }
}

function setup(home, log) {
  const file = path.join(home, 'config.toml');
  const text = readConfig(home);
  const setting = credentialSetting(text);
  if (setting.explicit && setting.value === 'file') { log('Codex file credentials are already enabled.'); return; }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const replacement = `cli_auth_credentials_store = "file"${newline}`;
  const updated = setting.explicit ? text.slice(0, setting.start) + replacement + text.slice(setting.end) : replacement + text;
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const backup = `${file}.bak-codexsw-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    atomicWrite(backup, text);
    log(`Config backup: ${backup}`);
  }
  atomicWrite(file, updated);
  log('Enabled Codex file credentials. Run codexsw login 1, then reload/restart your clients.');
}

export class AccountSwitcher {
  constructor(paths, store, { log = console.log, deviceAuth = false, env = process.env } = {}) {
    this.paths = paths;
    this.store = store;
    this.log = log;
    this.deviceAuth = deviceAuth;
    this.env = env;
    this.vault = store.read(paths.home);
    const identities = [];
    for (const [slot, entry] of Object.entries(this.vault.accounts)) {
      if (!isSlot(slot)) throw fail('The account vault contains an invalid account number. It was not overwritten.');
      const info = authInfo(entry.auth);
      if (identities.some(other => sameAccount(info, other))) {
        throw fail('The account vault contains duplicate slots. It was not overwritten.');
      }
      identities.push(info);
    }
  }

  readCurrent() {
    try {
      rejectLink(this.paths.auth);
      const raw = fs.readFileSync(this.paths.auth, 'utf8');
      authInfo(raw);
      return raw;
    } catch (error) { if (isMissing(error)) return null; throw error; }
  }

  findSlot(raw) {
    const info = authInfo(raw);
    return Object.entries(this.vault.accounts).find(([, entry]) => sameAccount(info, authInfo(entry.auth)))?.[0];
  }

  setSaved(slot, raw) {
    const info = authInfo(raw);
    for (const [number, entry] of Object.entries(this.vault.accounts)) {
      const matches = sameAccount(info, authInfo(entry.auth));
      if (slot === number && !matches) throw fail(`Slot ${slot} belongs to another account. Use codexsw forget ${slot} before replacing it.`);
      if (slot !== number && matches) throw fail(`This is already account ${number}. Sign in with your OTHER ChatGPT account.`);
    }
    this.vault.accounts[slot] = { auth: raw, saved_at: new Date().toISOString() };
  }

  saveVault() { this.store.write(this.vault); }

  syncCurrent() {
    const raw = this.readCurrent();
    if (raw === null) return;
    const slot = this.findSlot(raw);
    if (!slot) throw fail('Current login is not saved. Run codexsw save <N> with an unused positive integer first.');
    this.setSaved(slot, raw);
    this.saveVault();
  }

  registerOriginal() {
    if (Object.keys(this.vault.accounts).length) return;
    const raw = this.readCurrent();
    if (raw !== null) { this.setSaved('1', raw); this.saveVault(); }
  }

  status() {
    const current = this.readCurrent();
    const selected = current === null ? null : this.findSlot(current);
    const savedSlots = Object.keys(this.vault.accounts).sort(compareSlots);
    if (!savedSlots.length) this.log('No saved accounts. Run codexsw 1 to get started.');
    for (const slot of savedSlots) {
      this.log(`${slot === selected ? '*' : ' '} ${slot}  ${accountLabel(authInfo(this.vault.accounts[slot].auth))}`);
    }
    this.log('Add another account: codexsw <N> with any unused positive integer.');
    this.log('* = selected in auth.json; restart/reload running clients.');
    this.log(`Account backups: ${this.store.backend}${this.store.backend === 'file' ? ' (directory 0700, file 0600; not encrypted)' : ''}`);
    if (current !== null && !selected) this.log('The current login has not been saved to a slot.');
    if (credentialSetting(readConfig(this.paths.home)).value !== 'file') this.log('Codex is not using file credentials. Run codexsw setup before switching.');
  }

  save(slot) {
    const raw = this.readCurrent();
    if (raw === null) throw fail('No auth.json login to save. Run codexsw login 1 first.');
    this.setSaved(slot, raw);
    this.saveVault();
    this.log(`Saved account ${slot}.`);
    this.status();
  }

  switch(slot, { sync = true, force = false } = {}) {
    if (sync) this.syncCurrent();
    const saved = this.vault.accounts[slot];
    if (!saved) throw fail(`Account ${slot} is not configured.`);
    const previous = this.readCurrent();
    if (!force && previous !== null && sameAccount(authInfo(previous), authInfo(saved.auth))) {
      this.log(`Account ${slot} is already selected. Latest credentials saved.`);
      return;
    }
    let replaced = false;
    try {
      atomicWrite(this.paths.auth, saved.auth);
      replaced = true;
      if (this.readCurrent() !== saved.auth) throw new Error();
    } catch {
      if (replaced && previous !== null) {
        try { atomicWrite(this.paths.auth, previous); }
        catch { throw fail('Switch and rollback failed. Your saved accounts remain in the account vault.'); }
      }
      throw fail('Account switch failed. Saved accounts remain available; check auth.json before retrying.');
    }
    this.log(`Selected account ${slot}: ${accountLabel(authInfo(saved.auth))}`);
    this.log('Restart/reload running Codex clients that use this CODEX_HOME (VS Code: Developer: Reload Window).');
  }

  forget(slot) {
    delete this.vault.accounts[slot];
    this.saveVault();
    this.log(`Removed saved slot ${slot}. The current auth.json was left unchanged.`);
  }

  async login(slot) {
    this.syncCurrent();
    const command = resolveCodex(this.env);
    // Bound the temporary filename without imposing a numeric limit on N.
    const prefix = `login-${hash(slot)}-`;
    const directory = fs.mkdtempSync(path.join(this.paths.state, prefix));
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
    try {
      atomicWrite(path.join(directory, 'config.toml'), 'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n');
      this.log(`Sign in with ChatGPT account ${slot}. Choose the correct browser account and personal/team workspace.`);
      this.log('The current login stays in place until the new login succeeds.');
      await runLogin(command, this.deviceAuth, { ...this.env, CODEX_HOME: directory });
      let raw;
      try { raw = fs.readFileSync(path.join(directory, 'auth.json'), 'utf8'); }
      catch { throw fail('Login produced no auth.json; the current account is unchanged.'); }
      authInfo(raw);
      this.syncCurrent();
      this.setSaved(slot, raw);
      this.saveVault();
    } finally {
      if (path.dirname(directory) !== this.paths.state || !path.basename(directory).startsWith(prefix)) throw fail('Invalid login cleanup path.');
      fs.rmSync(directory, { recursive: true, force: true });
    }
    this.switch(slot, { sync: false, force: true });
  }
}

export function resolveCodex(env = process.env) {
  const directories = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.ps1'] : ['codex'];
  for (const directory of directories) {
    for (const name of names) {
      const file = path.resolve(directory.replace(/^"|"$/g, ''), name);
      try {
        if (!fs.statSync(file).isFile()) continue;
        if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
        if (process.platform === 'win32' && name === 'codex.cmd') {
          const entry = path.join(path.dirname(file), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
          if (fs.existsSync(entry)) return { executable: process.execPath, args: [entry] };
        }
        if (process.platform === 'win32' && /\.(cmd|ps1)$/i.test(file)) {
          const ps = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
          return { executable: ps, args: ['-NoLogo', '-NoProfile', '-Command'], script: true, file };
        }
        return { executable: file, args: [] };
      } catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error; }
    }
  }
  throw fail('Codex CLI was not found on PATH. Install Codex before adding an account.');
}

function runLogin(command, deviceAuth, env) {
  const args = ['login', ...(deviceAuth ? ['--device-auth'] : [])];
  if (command.script) {
    env = { ...env, CODEXSW_LOGIN_COMMAND: command.file };
    args.splice(0, args.length, `$ErrorActionPreference = 'Stop'; & $env:CODEXSW_LOGIN_COMMAND login${deviceAuth ? ' --device-auth' : ''}; exit $LASTEXITCODE`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args, ...args], { env, stdio: 'inherit', windowsHide: true });
    const cancel = () => child.kill('SIGTERM');
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    const cleanup = () => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); };
    child.once('error', () => { cleanup(); reject(fail('Could not start Codex login. The current account is unchanged.')); });
    child.once('exit', (code, signal) => {
      cleanup();
      if (code === 0 && !signal) resolve();
      else reject(fail('Login did not complete; the current account is unchanged.'));
    });
  });
}

export async function main(args, log = console.log) {
  const options = parseArgs(args);
  if (options.action === 'help') { log(help); return 0; }
  if (options.action === 'version') {
    const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    log(`codexsw ${version}`);
    return 0;
  }
  const paths = resolvePaths(options);
  if (options.action === 'setup') { setup(paths.home, log); return 0; }
  if (!fs.existsSync(paths.home)) throw fail('Codex home does not exist. Run codexsw setup, then codexsw 1.');
  secureDirectory(paths.state);
  if (options.action === 'unlock') { unlock(paths.state); log('No stale switch lock remains.'); return 0; }
  const release = acquireLock(paths.state);
  const onExit = () => { try { release(); } catch {} };
  process.once('exit', onExit);
  try {
    const cpa = new CpaConfig(paths);
    if (options.action === 'edit') { cpa.prepare(log); return 0; }
    const store = new VaultStore(paths.state, { backend: options.backend });
    const switcher = new AccountSwitcher(paths, store, { log, deviceAuth: options.deviceAuth });
    if (options.action === '0') {
      cpa.prepare(log);
      // Validate and save outgoing credentials before changing configuration.
      switcher.registerOriginal();
      switcher.syncCurrent();
      cpa.enable();
      log('Selected 0: CPA. Restart/reload Codex clients; API key is loaded from the private CPA config.');
      return 0;
    }
    if (options.action === 'status') {
      log(`${cpa.isActive() ? '*' : ' '} 0  CPA${cpa.isActive() ? ' (config.toml)' : ''}`);
      if (cpa.isActive()) log('CPA is active; account markers below describe saved auth.json only.');
      switcher.status();
    }
    else {
      const selecting = isSlot(options.action) || options.action === 'login';
      const rollbackConfig = selecting ? cpa.restore() : () => {};
      try {
        requireFileCredentials(paths.home);
        if (options.action === 'save') switcher.save(options.slot);
        else if (options.action === 'forget') switcher.forget(options.slot);
        else {
          switcher.registerOriginal();
          const slot = options.slot || options.action;
          if (options.action === 'login' || !switcher.vault.accounts[slot]) await switcher.login(slot);
          else switcher.switch(slot);
        }
      } catch (error) { rollbackConfig(); throw error; }
    }
    return 0;
  } finally {
    process.off('exit', onExit);
    release();
  }
}
