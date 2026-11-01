import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { VaultStore, secureDirectory } from '../lib/storage.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexsw-storage-test-'));
  const vault = { version: 1, codex_home: path.join(directory, 'home'), accounts: { '1': { auth: 'FAKE-SECRET-STORAGE-FIXTURE' } } };
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('codexsw-storage-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, vault };
}

test('macOS storage encrypts the vault and passes only a random key to security on stdin', t => {
  const { directory, vault } = fixture(t);
  let savedKey;
  const calls = [];
  const run = (executable, args, options) => {
    calls.push({ executable, args, options });
    assert.equal(executable, '/usr/bin/security');
    assert.doesNotMatch(args.join(' '), /FAKE-SECRET|add-generic-password/);
    if (args[0] === '-i') {
      savedKey = options.input.match(/ -w (\S+)\n$/)[1];
      assert.equal(Buffer.from(savedKey, 'base64').length, 32);
      assert.doesNotMatch(options.input, /FAKE-SECRET/);
      return { status: 0, stdout: '', stderr: '' };
    }
    return savedKey ? { status: 0, stdout: savedKey + '\n', stderr: '' } : { status: 44, stdout: '', stderr: '' };
  };
  const store = new VaultStore(directory, { platform: 'darwin', run });
  store.write(vault);
  assert.doesNotMatch(fs.readFileSync(store.file, 'utf8'), /FAKE-SECRET/);
  const reloaded = new VaultStore(directory, { platform: 'darwin', run });
  assert.deepEqual(reloaded.read(vault.codex_home), vault);
  const encrypted = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  encrypted.tag = Buffer.alloc(16).toString('base64');
  fs.writeFileSync(store.file, JSON.stringify(encrypted));
  assert.throws(() => reloaded.read(vault.codex_home), /Cannot decrypt/);
  assert.ok(calls.some(call => call.args[0] === '-i'));
});

test('macOS keychain failure does not create a plaintext fallback', t => {
  const { directory, vault } = fixture(t);
  const run = () => ({ status: 36, stdout: '', stderr: 'keychain locked' });
  const store = new VaultStore(directory, { platform: 'darwin', run });
  assert.throws(() => store.write(vault), /Keychain/);
  assert.equal(fs.existsSync(path.join(directory, 'accounts.json')), false);
  assert.equal(fs.existsSync(store.file), false);
});

test('Linux Secret Service keeps credential content out of argv', t => {
  const { directory, vault } = fixture(t);
  let secret;
  const run = (executable, args, options) => {
    assert.equal(executable, 'secret-tool');
    assert.doesNotMatch(args.join(' '), /FAKE-SECRET/);
    if (args[0] === 'store') { secret = options.input; return { status: 0, stdout: '', stderr: '' }; }
    return secret ? { status: 0, stdout: secret + '\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
  };
  const store = new VaultStore(directory, { backend: 'secret-service', platform: 'linux', run });
  store.write(vault);
  assert.deepEqual(store.read(vault.codex_home), vault);
  assert.equal(fs.existsSync(store.file), false, 'only the manifest is stored on disk');
});

test('Linux keyring errors never cause a silent file fallback', t => {
  const { directory, vault } = fixture(t);
  const run = () => ({ status: 1, stdout: '', stderr: 'No session bus' });
  const store = new VaultStore(directory, { backend: 'secret-service', platform: 'linux', run });
  assert.throws(() => store.write(vault), /Secret Service/);
  assert.equal(fs.existsSync(store.file), false);
});

test('Windows DPAPI protects actual bytes and preserves the original vault schema', { skip: process.platform !== 'win32' }, t => {
  const { directory, vault } = fixture(t);
  secureDirectory(directory);
  const store = new VaultStore(directory);
  store.write(vault);
  assert.equal(store.backend, 'dpapi');
  assert.doesNotMatch(fs.readFileSync(store.file).toString('utf8'), /FAKE-SECRET/);
  assert.deepEqual(new VaultStore(directory).read(vault.codex_home), vault);
});

test('macOS native Keychain round trip', { skip: process.platform !== 'darwin' }, t => {
  const { directory, vault } = fixture(t);
  secureDirectory(directory);
  const store = new VaultStore(directory);
  t.after(() => {
    spawnSync('/usr/bin/security', ['delete-generic-password', '-s', store.service, '-a', 'vault-key'], { encoding: 'utf8', timeout: 10000 });
  });
  store.write(vault);
  assert.deepEqual(new VaultStore(directory).read(vault.codex_home), vault);
});
