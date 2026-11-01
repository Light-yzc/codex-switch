import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { authInfo, sameAccount, credentialSetting, parseArgs, AccountSwitcher } from '../lib/core.js';
import { VaultStore, resolvePaths, secureDirectory, acquireLock, unlock, atomicWrite } from '../lib/storage.js';
import { isSlot, compareSlots } from '../lib/slots.js';

const cli = fileURLToPath(new URL('../bin/codexsw.js', import.meta.url));
const sensitive = /FAKE-ACCESS|FAKE-REFRESH|fake\.[A-Za-z0-9_-]+\.signature/;
const backend = process.platform === 'win32' ? 'dpapi' : 'file';

function auth(name, revision = 'initial') {
  const part = Buffer.from(JSON.stringify({ sub: `fake-sub-${name}`, email: `${name}@example.invalid` })).toString('base64url');
  return JSON.stringify({
    auth_mode: 'chatgpt', OPENAI_API_KEY: null,
    tokens: { id_token: `fake.${part}.signature`, access_token: `FAKE-ACCESS-${name}-${revision}`, refresh_token: `FAKE-REFRESH-${name}-${revision}`, account_id: `fake-account-${name}` },
    last_refresh: new Date().toISOString(),
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexsw-node-test-'));
  const home = path.join(root, 'Codex home');
  const state = path.join(root, 'private state');
  const fakeBin = path.join(root, "bin & apostrophe'");
  const selected = path.join(root, 'fixture.json');
  const record = path.join(root, 'login-record.json');
  fs.mkdirSync(home);
  fs.mkdirSync(fakeBin);
  const mockSource = `
import fs from 'node:fs';
import path from 'node:path';
if (process.env.CODEXSW_TEST_FAIL === '1') process.exit(9);
if (!fs.readFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'utf8').includes('cli_auth_credentials_store = "file"')) process.exit(8);
fs.writeFileSync(process.env.CODEXSW_TEST_RECORD, JSON.stringify({ home: process.env.CODEX_HOME, args: process.argv.slice(2) }));
if (process.env.CODEXSW_TEST_GATE) {
  while (!fs.existsSync(process.env.CODEXSW_TEST_GATE)) await new Promise(resolve => setTimeout(resolve, 20));
}
if (process.env.CODEXSW_TEST_NO_AUTH !== '1') fs.copyFileSync(process.env.CODEXSW_TEST_AUTH, path.join(process.env.CODEX_HOME, 'auth.json'));
`;
  fs.writeFileSync(path.join(fakeBin, 'mock-codex.mjs'), mockSource);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(fakeBin, 'codex.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0mock-codex.mjs" %*\r\nexit /b %errorlevel%\r\n`);
  } else {
    // exec via an environment value avoids embedding paths in shell code.
    fs.writeFileSync(path.join(fakeBin, 'codex'), '#!/bin/sh\nexec "$CODEXSW_TEST_NODE" "$(dirname "$0")/mock-codex.mjs" "$@"\n', { mode: 0o755 });
  }
  const env = {
    ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || process.env.Path || ''}`,
    CODEXSW_TEST_NODE: process.execPath, CODEXSW_TEST_AUTH: selected, CODEXSW_TEST_RECORD: record,
    CODEX_HOME: 'parent-home-value',
  };
  const options = ['--codex-home', home, '--state-dir', state, '--storage', backend];
  const authPath = path.join(home, 'auth.json');
  const put = raw => fs.writeFileSync(authPath, raw);
  const read = () => fs.readFileSync(authPath, 'utf8');
  const run = (args, expected = 0, overrides = {}) => {
    const result = spawnSync(process.execPath, [cli, ...args, ...options], {
      env: { ...env, ...overrides }, encoding: 'utf8', timeout: 45000,
    });
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, sensitive, 'credentials must not appear in output');
    assert.equal(result.error, undefined, 'CLI process should complete');
    assert.equal(result.status, expected, output);
    return output;
  };
  t.after(() => {
    // Only remove the exact directory created for this fixture.
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('codexsw-node-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, home, state, fakeBin, selected, record, env, options, authPath, put, read, run };
}

test('argument validation rejects mistakes before touching any credentials', () => {
  assert.equal(parseArgs([]).action, 'status');
  assert.equal(parseArgs(['list']).action, 'status');
  assert.equal(parseArgs(['2', '-DeviceAuth']).deviceAuth, true);
  assert.equal(parseArgs(['status', '-CodexHome', '/somewhere', '-StateDirectory', '/state']).codexHome, '/somewhere');
  for (const args of [['save', '0'], ['login'], ['1', 'extra'], ['unknown'], ['--state-dir'], ['--storage', 'unknown']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('all account commands accept positive decimal strings without a numeric ceiling', () => {
  const numbers = ['1', '3', '10', '42', '9007199254740993', '9'.repeat(400)];
  for (const number of numbers) {
    assert.equal(isSlot(number), true);
    assert.equal(parseArgs([number]).action, number);
    for (const action of ['save', 'login', 'forget']) {
      assert.equal(parseArgs([action, number]).slot, number);
    }
  }
  for (const number of ['0', '-1', '+1', '01', '1.5', '1e3', ' 1', '1 ', '1\n', '1\r\n', '', 'Infinity', 'NaN', '__proto__', '../3', '３']) {
    assert.equal(isSlot(number), false);
    for (const args of [[number], ['save', number], ['login', number], ['forget', number]]) {
      assert.throws(() => parseArgs(args));
    }
  }
  assert.deepEqual(['10', '9007199254740993', '2', '1', '9007199254740992', '100'].sort(compareSlots),
    ['1', '2', '10', '100', '9007199254740992', '9007199254740993']);
});

test('TOML scanner handles comments, quotes, CRLF, multiline strings and tables', () => {
  assert.equal(credentialSetting('cli_auth_credentials_store = "keyring" # comment\n').value, 'keyring');
  assert.equal(credentialSetting("'cli_auth_credentials_store' = 'auto'\r\n").value, 'auto');
  assert.equal(credentialSetting('note = "# not a comment"\ncli_auth_credentials_store="file"\n').value, 'file');
  assert.equal(credentialSetting('note = """\ncli_auth_credentials_store = "keyring"\n"""\ncli_auth_credentials_store="auto"\n').value, 'auto');
  assert.equal(credentialSetting('[profiles.example]\ncli_auth_credentials_store="keyring"\n').value, 'file');
  assert.throws(() => credentialSetting('cli_auth_credentials_store = true\n'));
});

test('identity validation accepts BOM and rejects malformed or API-key caches', () => {
  assert.ok(sameAccount(authInfo(auth('alpha')), authInfo('\uFEFF' + auth('alpha', 'refreshed'))));
  assert.equal(sameAccount(authInfo(auth('alpha')), authInfo(auth('beta'))), false);
  for (const raw of ['FAKE-REFRESH-invalid-json', '{"auth_mode":"apikey"}', '{"auth_mode":"chatgpt","tokens":{}}']) {
    assert.throws(() => authInfo(raw), error => error.safeMessage && !sensitive.test(error.safeMessage));
  }
});

test('Windows, macOS and Linux share the complete two-account workflow', t => {
  const f = fixture(t);
  const alpha = auth('alpha');
  const beta = auth('beta');
  f.put(alpha);
  f.run(['save', '1']);
  assert.equal(f.read(), alpha, 'saving does not rewrite auth.json');
  f.run(['1']);
  f.run(['save', '2'], 1);
  assert.equal(f.read(), alpha, 'duplicate account is rejected');

  fs.writeFileSync(f.selected, beta);
  f.run(['2', '--device-auth']);
  assert.equal(f.read(), beta);
  const record = JSON.parse(fs.readFileSync(f.record, 'utf8'));
  assert.notEqual(record.home, f.home);
  assert.equal(path.dirname(record.home), f.state);
  assert.deepEqual(record.args, ['login', '--device-auth']);
  assert.equal(fs.existsSync(record.home), false, 'login scratch files are removed');

  const refreshed = auth('beta', 'refreshed');
  f.put(refreshed);
  f.run(['1']);
  assert.equal(f.read(), alpha);
  f.run(['2']);
  assert.equal(f.read(), refreshed, 'the latest refreshed credentials survive a round trip');

  const reauthenticated = auth('beta', 'new-browser-login');
  fs.writeFileSync(f.selected, reauthenticated);
  f.run(['login', '2']);
  assert.equal(f.read(), reauthenticated, 'reauthenticating the active account must replace old tokens');
  f.run(['1']);
  fs.writeFileSync(f.selected, alpha);
  f.run(['login', '2'], 1);
  assert.equal(f.read(), alpha, 'wrong browser account does not switch');
  f.run(['2']);
  assert.equal(f.read(), reauthenticated, 'wrong browser account does not corrupt slot 2');

  f.run(['1']);
  f.run(['login', '2'], 1, { CODEXSW_TEST_FAIL: '1' });
  assert.equal(f.read(), alpha, 'failed login preserves account 1');
  f.run(['login', '2'], 1, { CODEXSW_TEST_NO_AUTH: '1' });
  assert.equal(f.read(), alpha, 'missing login result preserves account 1');
  assert.equal(fs.readdirSync(f.state).filter(name => name.startsWith('login-')).length, 0);

  const vaultFile = path.join(f.state, backend === 'dpapi' ? 'accounts.dpapi' : 'accounts.json');
  const original = fs.readFileSync(vaultFile);
  if (backend === 'dpapi') assert.doesNotMatch(original.toString('utf8'), sensitive);
  fs.writeFileSync(vaultFile, 'corrupt vault');
  f.run(['2'], 1);
  assert.equal(f.read(), alpha);
  fs.writeFileSync(vaultFile, original);

  const third = auth('third');
  f.put(third);
  f.run(['1'], 1);
  f.run(['save', '1'], 1);
  assert.equal(f.read(), third, 'an unknown account cannot be lost or overwrite a slot');
  f.put('FAKE-REFRESH-do-not-leak');
  f.run(['1'], 1);
  assert.equal(f.read(), 'FAKE-REFRESH-do-not-leak');

  fs.unlinkSync(f.authPath);
  f.run(['2']);
  assert.equal(f.read(), reauthenticated, 'a saved account restores a missing auth.json');
  f.run(['1']);
  assert.match(f.run(['status']), /\* 1  a\*\*\*@example.invalid/);
  f.run(['forget', '2']);
  assert.equal(f.read(), alpha);
  fs.writeFileSync(f.selected, beta);
  f.run(['2']);
  assert.equal(f.read(), beta, 'forgotten slot can be registered again');
  f.run(['forget', '1']);
  f.run(['2']);
  assert.equal(f.read(), beta, 'forgetting the other slot does not disable this account');
});

test('first numeric selection registers the original account automatically', t => {
  const f = fixture(t);
  f.put(auth('alpha'));
  const output = f.run(['1']);
  assert.match(output, /already selected/);
  assert.match(f.run(['status']), /\* 1/);
});

test('a fresh login can start at a sparse account number without auth.json', t => {
  const f = fixture(t);
  fs.writeFileSync(f.selected, auth('alpha'));
  f.run(['42']);
  assert.equal(f.read(), fs.readFileSync(f.selected, 'utf8'));
  assert.match(f.run(['status']), /\* 42  a\*\*\*@example.invalid/);
});

test('new accounts beyond two support login, refresh, numeric listing, reauth and deletion', t => {
  const f = fixture(t);
  const alpha = auth('alpha');
  const third = auth('third');
  const tenth = auth('tenth');
  const huge = '9007199254740993';
  const long = '9'.repeat(300);
  const longAuth = auth('long');
  f.put(alpha);
  f.run(['1']);
  fs.writeFileSync(f.selected, third);
  f.run(['3']);
  assert.equal(f.read(), third);
  fs.writeFileSync(f.selected, tenth);
  f.run(['10']);
  assert.equal(f.read(), tenth);
  fs.writeFileSync(f.selected, auth('huge'));
  f.run([huge]);
  fs.writeFileSync(f.selected, longAuth);
  f.run([long]);
  const scratch = JSON.parse(fs.readFileSync(f.record, 'utf8')).home;
  assert.ok(path.basename(scratch).length < 60, 'long numeric IDs never become long paths');
  assert.equal(fs.existsSync(scratch), false);
  const status = f.run(['status']);
  const listed = status.split(/\r?\n/).filter(line => /^[ *] [1-9][0-9]*  /.test(line))
    .map(line => line.match(/^[ *] ([1-9][0-9]*)  /)[1]);
  assert.deepEqual(listed, ['1', '3', '10', huge, long]);
  assert.equal(status.includes('not configured'), false, 'status does not invent missing account rows');
  const refreshed = auth('third', 'refreshed');
  f.run(['3']);
  f.put(refreshed);
  f.run(['10']);
  f.run(['3']);
  assert.equal(f.read(), refreshed);
  f.run(['save', '42'], 1);
  assert.equal(f.read(), refreshed, 'duplicates are rejected for all IDs');
  const replacement = auth('third', 'reauthenticated');
  fs.writeFileSync(f.selected, replacement);
  f.run(['login', '3']);
  assert.equal(f.read(), replacement);
  f.run(['1']);
  f.run(['forget', '3']);
  assert.equal(f.read(), alpha);
  fs.writeFileSync(f.selected, auth('new-third'));
  f.run(['3']);
  assert.equal(f.read(), fs.readFileSync(f.selected, 'utf8'));
  f.put(auth('manually-signed-in'));
  f.run(['save', '42']);
  f.run([long]);
  assert.equal(f.read(), longAuth);
});

test('legacy account 1 and 2 backups accept more slots without changing existing entries', t => {
  const f = fixture(t);
  secureDirectory(f.state);
  const store = new VaultStore(f.state, { backend });
  const alpha = auth('alpha');
  const beta = auth('beta');
  store.write({ version: 1, codex_home: f.home, accounts: {
    '1': { auth: alpha, saved_at: 'legacy-1' },
    '2': { auth: beta, saved_at: 'legacy-2' },
  } });
  f.put(auth('third'));
  f.run(['save', '3']);
  const updated = store.read(f.home);
  assert.equal(updated.version, 1);
  assert.deepEqual(updated.accounts['1'], { auth: alpha, saved_at: 'legacy-1' });
  assert.deepEqual(updated.accounts['2'], { auth: beta, saved_at: 'legacy-2' });
  f.run(['2']);
  assert.equal(f.read(), beta);
});

test('large collections are listed once each without a fixed account limit', t => {
  const f = fixture(t);
  const accounts = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [
    String(index + 1), { auth: auth(`person${index + 1}`) },
  ]));
  const vault = { version: 1, codex_home: f.home, accounts };
  const output = [];
  const switcher = new AccountSwitcher({ home: f.home, state: f.state, auth: f.authPath }, {
    read: () => structuredClone(vault), write() {}, backend: 'memory',
  }, { log: line => output.push(line) });
  switcher.status();
  const rows = output.filter(line => /^[ *] [1-9][0-9]*  /.test(line));
  assert.equal(rows.length, 512);
  assert.match(rows[0], /^  1  /);
  assert.match(rows.at(-1), /^  512  /);
  switcher.setSaved('9007199254740993', auth('another-person'));
  assert.equal(Object.keys(switcher.vault.accounts).length, 513);
});

test('setup backs up config, preserves other settings, and blocks keyring/file mismatch', t => {
  const f = fixture(t);
  const originalAuth = auth('alpha');
  f.put(originalAuth);
  const original = '# root\r\ncli_auth_credentials_store = "keyring" # old\r\nmodel = "example"\r\n[model_providers.example]\r\ncli_auth_credentials_store="auto"\r\n';
  const config = path.join(f.home, 'config.toml');
  fs.writeFileSync(config, original);
  f.run(['1'], 1);
  assert.equal(f.read(), originalAuth);
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  f.run(['setup']);
  const updated = fs.readFileSync(config, 'utf8');
  assert.equal(credentialSetting(updated).value, 'file');
  assert.match(updated, /model = "example"/);
  assert.match(updated, /\[model_providers.example\]\r\ncli_auth_credentials_store="auto"/);
  const backups = fs.readdirSync(f.home).filter(name => name.startsWith('config.toml.bak-codexsw-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(f.home, backups[0]), 'utf8'), original);
  f.run(['setup']);
  assert.equal(fs.readdirSync(f.home).filter(name => name.startsWith('config.toml.bak-codexsw-')).length, 1);
  f.run(['1']);
});

test('setup inserts a root setting before tables', t => {
  const f = fixture(t);
  const config = path.join(f.home, 'config.toml');
  fs.writeFileSync(config, '[projects.example]\ntrust_level = "trusted"\n');
  f.run(['setup']);
  assert.ok(fs.readFileSync(config, 'utf8').startsWith('cli_auth_credentials_store = "file"\n[projects.'));
});

test('live locks reject concurrent commands and unlock never removes a live owner', t => {
  const f = fixture(t);
  f.put(auth('alpha'));
  secureDirectory(f.state);
  const release = acquireLock(f.state);
  try {
    f.run(['1'], 1);
    f.run(['unlock'], 1);
    assert.ok(fs.existsSync(path.join(f.state, 'switch-v2.lock')));
  } finally { release(); }
  f.run(['1']);
  const exited = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(f.state, 'switch-v2.lock'), JSON.stringify({ pid: Number(exited.stdout), hostname: os.hostname(), id: 'old' }));
  f.run(['unlock']);
  assert.equal(fs.existsSync(path.join(f.state, 'switch-v2.lock')), false);
  fs.writeFileSync(path.join(f.state, 'switch-v2.lock'), JSON.stringify({ pid: 1, hostname: 'a-different-host.invalid' }));
  assert.throws(() => unlock(f.state));
});

test('switch rollback restores the original file after readback fails', t => {
  const f = fixture(t);
  const alpha = auth('alpha');
  const beta = auth('beta');
  f.put(alpha);
  const vault = { version: 1, codex_home: f.home, accounts: { '1': { auth: alpha }, '2': { auth: beta } } };
  const memoryStore = { read: () => structuredClone(vault), write: () => {}, backend: 'memory' };
  const switcher = new AccountSwitcher({ home: f.home, state: f.state, auth: f.authPath }, memoryStore, { log() {} });
  const realRead = switcher.readCurrent.bind(switcher);
  let reads = 0;
  switcher.readCurrent = () => {
    if (++reads === 3) throw new Error('simulated readback failure');
    return realRead();
  };
  assert.throws(() => switcher.switch('2'), /Account switch failed/);
  assert.equal(f.read(), alpha);
});

test('failure to save outgoing credentials stops before auth.json changes', t => {
  const f = fixture(t);
  const alpha = auth('alpha');
  f.put(alpha);
  const store = {
    read: () => ({ version: 1, codex_home: f.home, accounts: { '1': { auth: alpha }, '2': { auth: auth('beta') } } }),
    write: () => { throw new Error('simulated disk failure'); },
  };
  const switcher = new AccountSwitcher({ home: f.home, state: f.state, auth: f.authPath }, store, { log() {} });
  assert.throws(() => switcher.switch('2'));
  assert.equal(f.read(), alpha);
});

test('duplicate entries in a damaged vault are rejected before any write', t => {
  const f = fixture(t);
  const alpha = auth('alpha');
  f.put(alpha);
  const store = {
    read: () => ({ version: 1, codex_home: f.home, accounts: { '1': { auth: alpha }, '2': { auth: alpha } } }),
    write: () => { throw new Error('must not write'); },
  };
  assert.throws(() => new AccountSwitcher({ home: f.home, auth: f.authPath }, store), /duplicate slots/);
  assert.equal(f.read(), alpha);
});

test('duplicate identity protection also checks sparse and large account numbers', t => {
  const f = fixture(t);
  const alpha = auth('alpha');
  f.put(alpha);
  const store = {
    read: () => ({ version: 1, codex_home: f.home, accounts: {
      '1': { auth: auth('other') }, '3': { auth: alpha }, '9007199254740993': { auth: alpha },
    } }),
    write: () => { throw new Error('must not write'); },
  };
  assert.throws(() => new AccountSwitcher({ home: f.home, auth: f.authPath }, store), /duplicate slots/);
  assert.equal(f.read(), alpha);
});

test('storage backend is persisted and cannot silently downgrade', t => {
  const f = fixture(t);
  secureDirectory(f.state);
  const store = new VaultStore(f.state);
  store.write({ version: 1, codex_home: f.home, accounts: {} });
  const other = store.backend === 'dpapi' ? 'file' : 'secret-service';
  assert.throws(() => new VaultStore(f.state, { backend: other }), /refusing to silently change/);
  assert.equal(new VaultStore(f.state).backend, store.backend);
});

test('private file storage enforces POSIX permissions', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  secureDirectory(f.state);
  const store = new VaultStore(f.state, { backend: 'file' });
  store.write({ version: 1, codex_home: f.home, accounts: {} });
  assert.equal(fs.statSync(f.state).mode & 0o777, 0o700);
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
});

test('atomic writes reject symlinks and preserve the referenced file', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const original = path.join(f.root, 'original');
  const linked = path.join(f.root, 'linked');
  fs.writeFileSync(original, 'keep');
  fs.symlinkSync(original, linked);
  assert.throws(() => atomicWrite(linked, 'replace'), /symbolic link/);
  assert.equal(fs.readFileSync(original, 'utf8'), 'keep');
});

test('browser login captures refreshes made by another client while waiting', async t => {
  const f = fixture(t);
  const alpha = auth('alpha');
  f.put(alpha);
  f.run(['1']);
  fs.writeFileSync(f.selected, auth('beta'));
  const gate = path.join(f.root, 'continue-login');
  const child = spawn(process.execPath, [cli, '2', ...f.options], {
    env: { ...f.env, CODEXSW_TEST_GATE: gate }, stdio: 'pipe',
  });
  let output = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  const finished = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(f.record) && Date.now() < deadline && child.exitCode === null) await delay(20);
  try {
    assert.ok(fs.existsSync(f.record), output);
    f.run(['1'], 1);
    const refreshed = auth('alpha', 'refreshed-during-login');
    f.put(refreshed);
    fs.writeFileSync(gate, 'go');
    assert.equal(await finished, 0, output);
    assert.doesNotMatch(output, sensitive);
    f.run(['1']);
    assert.equal(f.read(), refreshed);
  } finally {
    if (child.exitCode === null) { child.kill(); await finished; }
  }
});

test('path resolution separates different Codex homes and honors explicit state directories', t => {
  const f = fixture(t);
  const first = resolvePaths({ codexHome: f.home });
  const second = resolvePaths({ codexHome: path.join(f.root, 'other') });
  assert.notEqual(first.state, second.state);
  assert.equal(resolvePaths({ codexHome: f.home, stateDirectory: f.state }).state, f.state);
});
