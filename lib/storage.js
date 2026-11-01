import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isSlot } from './slots.js';

export function fail(message) {
  const error = new Error(message);
  error.safeMessage = message;
  return error;
}

export function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase().slice(0, 16);
}

export function isMissing(error) { return error?.code === 'ENOENT'; }

export function rejectLink(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw fail('Refusing to use a credential file or directory that is a symbolic link.');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export function atomicWrite(file, data, mode = 0o600) {
  rejectLink(file);
  const temporary = `${file}.codexsw-${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') fs.chmodSync(file, mode);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (error) { if (!isMissing(error)) throw error; }
  }
}

const dpapiScript = `
$ErrorActionPreference = 'Stop'
$stage = 'load-security'
try {
  # A PowerShell 7 parent can export its own module path. This helper runs in
  # Windows PowerShell 5.1 and must load that runtime's built-in modules.
  $env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
  Add-Type -AssemblyName System.Security
  $stage = 'parse-request'
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.operation -eq 'secure-directory') {
    $stage = 'directory-acl'
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($userSid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $request.path -AclObject $acl
    [Console]::Out.Write('OK')
  } else {
    $bytes = [Convert]::FromBase64String($request.data)
    $entropy = [Text.Encoding]::UTF8.GetBytes('codexsw.dpapi.v1')
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($request.operation -eq 'protect') {
      $stage = 'protect'
      $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
    } else {
      $stage = 'unprotect'
      $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)
    }
    [Console]::Out.Write([Convert]::ToBase64String($result))
    [Array]::Clear($bytes, 0, $bytes.Length)
    [Array]::Clear($result, 0, $result.Length)
  }
} catch {
  # Never print an exception message: parser errors can contain credentials.
  $cause = $_.Exception.GetBaseException()
  [Console]::Error.WriteLine('CODEXSW_DPAPI_ERROR:' + $stage + ':' + $cause.GetType().FullName + ':' + $cause.HResult)
  exit 1
}
`;

export function safePowerShellError(result, operation) {
  const allowed = ['secure-directory', 'protect', 'unprotect'];
  const step = allowed.includes(operation) ? operation : 'unknown-operation';
  const diagnostic = String(result.stderr || '').match(/CODEXSW_DPAPI_ERROR:([a-z-]+):([A-Za-z0-9.]+):(-?\d+)/);
  let detail;
  if (diagnostic) detail = diagnostic.slice(1).join('; ');
  else if (/^[A-Z_]+$/.test(result.error?.code || '')) detail = result.error.code;
  else if (/ScriptContainedMaliciousContent/.test(result.stderr || '')) detail = 'PowerShell security policy';
  else detail = `exit ${Number.isInteger(result.status) ? result.status : 'unknown'}`;
  return fail(`Windows credential protection failed (${step}; ${detail}).`);
}

function powershellRequest(request) {
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive',
    '-EncodedCommand', Buffer.from(dpapiScript, 'utf16le').toString('base64'),
  ], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw safePowerShellError(result, request.operation);
  return result.stdout.trim();
}

export function secureDirectory(directory) {
  rejectLink(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    powershellRequest({ operation: 'secure-directory', path: directory });
  } else {
    if (fs.statSync(directory).uid !== process.getuid()) throw fail('The state directory belongs to another user.');
    fs.chmodSync(directory, 0o700);
  }
}

export function resolvePaths({ codexHome, stateDirectory } = {}) {
  const home = path.resolve(codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  // Keep the original Windows PowerShell vault location and hash compatible.
  const homeHash = hash(process.platform === 'win32' ? home.toLowerCase() : home);
  let state = stateDirectory;
  if (!state) {
    if (process.platform === 'win32') state = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CodexSwitch', homeHash);
    else if (process.platform === 'darwin') state = path.join(os.homedir(), 'Library', 'Application Support', 'codexsw', homeHash);
    else state = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'codexsw', homeHash);
  }
  return { home, state: path.resolve(state), auth: path.join(home, 'auth.json') };
}

export class VaultStore {
  constructor(directory, { backend, run = spawnSync, platform = process.platform } = {}) {
    this.directory = directory;
    this.run = run;
    this.platform = platform;
    this.manifest = path.join(directory, 'storage.json');
    let selected;
    try {
      rejectLink(this.manifest);
      selected = JSON.parse(fs.readFileSync(this.manifest, 'utf8')).backend;
      if (!['dpapi', 'keychain', 'file', 'secret-service'].includes(selected)) throw new Error();
    } catch (error) {
      if (!isMissing(error)) throw fail('Invalid storage configuration. It was not overwritten.');
    }
    if (backend && selected && backend !== selected) throw fail(`This vault already uses ${selected}; refusing to silently change its storage.`);
    this.backend = selected || backend || (platform === 'win32' ? 'dpapi' : platform === 'darwin' ? 'keychain' : 'file');
    if (this.backend === 'dpapi' && platform !== 'win32') throw fail('DPAPI storage is available on Windows only.');
    if (this.backend === 'keychain' && platform !== 'darwin') throw fail('Keychain storage is available on macOS only.');
    if (this.backend === 'secret-service' && platform !== 'linux') throw fail('Secret Service storage is available on Linux only.');
    if (platform === 'win32' && this.backend !== 'dpapi') throw fail('Windows account backups must use DPAPI.');
    this.service = `codexsw.${hash(path.resolve(directory))}`;
    const filename = this.backend === 'dpapi' ? 'accounts.dpapi' : this.backend === 'keychain' ? 'accounts.keychain' : 'accounts.json';
    this.file = path.join(directory, filename);
  }

  command(executable, args, input) {
    return this.run(executable, args, { input, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  }

  keychainKey(create = false) {
    if (this.cachedKey) return this.cachedKey;
    const read = () => this.command('/usr/bin/security', ['find-generic-password', '-s', this.service, '-a', 'vault-key', '-w']);
    let result = read();
    if (result.status === 44 && create) {
      const key = crypto.randomBytes(32).toString('base64');
      // Keep secrets out of argv; this short command contains only a random key.
      const saved = this.command('/usr/bin/security', ['-i'],
        `add-generic-password -U -s ${this.service} -a vault-key -w ${key}\n`);
      result = read();
      if (saved.error || saved.status !== 0 || result.stdout?.trim() !== key) {
        throw fail('Cannot save to the macOS Keychain. Unlock your login keychain and retry.');
      }
    }
    if (result.error || result.status !== 0 || Buffer.from(result.stdout.trim(), 'base64').length !== 32) {
      throw fail('Cannot read the macOS Keychain. Unlock your login keychain and retry.');
    }
    this.cachedKey = Buffer.from(result.stdout.trim(), 'base64');
    return this.cachedKey;
  }

  readText() {
    if (this.backend === 'secret-service') {
      const result = this.command('secret-tool', ['lookup', 'application', 'codexsw', 'profile', this.service]);
      if (!result.error && result.status === 1 && !result.stderr?.trim()) return null;
      if (result.error || result.status !== 0) throw fail('Cannot read Secret Service. Install secret-tool and unlock the desktop keyring.');
      return Buffer.from(result.stdout.trim(), 'base64').toString('utf8');
    }
    let bytes;
    try {
      rejectLink(this.file);
      bytes = fs.readFileSync(this.file);
      if (this.platform !== 'win32') fs.chmodSync(this.file, 0o600);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (this.backend === 'dpapi') {
      return Buffer.from(powershellRequest({ operation: 'unprotect', data: bytes.toString('base64') }), 'base64').toString('utf8');
    }
    if (this.backend === 'keychain') {
      try {
        const envelope = JSON.parse(bytes.toString('utf8'));
        if (envelope.version !== 1) throw new Error();
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.keychainKey(), Buffer.from(envelope.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
      } catch (error) {
        throw error.safeMessage ? error : fail('Cannot decrypt the account vault. Its file or Keychain key is invalid.');
      }
    }
    return bytes.toString('utf8');
  }

  read(home) {
    const text = this.readText();
    if (text === null) return { version: 1, codex_home: home, accounts: {} };
    try {
      const vault = JSON.parse(text.replace(/^\uFEFF/, ''));
      const sameHome = this.platform === 'win32' ? vault.codex_home?.toLowerCase() === home.toLowerCase() : vault.codex_home === home;
      if (vault.version !== 1 || !sameHome || !vault.accounts || typeof vault.accounts !== 'object' || Array.isArray(vault.accounts)) throw new Error();
      for (const [slot, entry] of Object.entries(vault.accounts)) {
        if (!isSlot(slot) || typeof entry?.auth !== 'string') throw new Error();
      }
      return vault;
    } catch {
      throw fail('Cannot read the account vault. It is corrupt or belongs to a different Codex home; it was not overwritten.');
    }
  }

  write(vault) {
    const text = JSON.stringify(vault);
    const encoded = Buffer.from(text).toString('base64');
    if (this.backend === 'keychain') {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.keychainKey(true), iv);
      const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      atomicWrite(this.file, JSON.stringify({
        version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'),
      }));
    } else if (this.backend === 'secret-service') {
      const result = this.command('secret-tool', [
        'store', '--label=Codex account switch', 'application', 'codexsw', 'profile', this.service,
      ], encoded);
      if (result.error || result.status !== 0 || this.readText() !== text) {
        throw fail('Cannot save to Secret Service. Install secret-tool and unlock the desktop keyring.');
      }
    } else if (this.backend === 'dpapi') {
      atomicWrite(this.file, Buffer.from(powershellRequest({ operation: 'protect', data: encoded }), 'base64'));
    } else {
      atomicWrite(this.file, text);
    }
    atomicWrite(this.manifest, JSON.stringify({ version: 1, backend: this.backend }) + '\n');
  }
}

export function acquireLock(directory) {
  const file = path.join(directory, 'switch-v2.lock');
  const owner = { pid: process.pid, hostname: os.hostname(), id: crypto.randomUUID() };
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw fail('Another codexsw command is running. If it crashed, run codexsw unlock.');
    throw error;
  }
  try { fs.writeFileSync(descriptor, JSON.stringify(owner)); }
  finally { fs.closeSync(descriptor); }
  return () => {
    try {
      rejectLink(file);
      if (JSON.parse(fs.readFileSync(file, 'utf8')).id === owner.id) fs.unlinkSync(file);
    } catch (error) { if (!isMissing(error)) throw fail('Could not release the switch lock. Run codexsw unlock after this process exits.'); }
  };
}

export function unlock(directory) {
  const file = path.join(directory, 'switch-v2.lock');
  let owner;
  try { rejectLink(file); owner = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (isMissing(error)) return;
    throw fail('Cannot inspect the switch lock. Check that no codexsw process is running before removing it manually.');
  }
  if (owner.hostname !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) {
    throw fail('The lock belongs to another host or is invalid. It was not removed.');
  }
  try {
    process.kill(owner.pid, 0);
    throw fail('The lock owner is still running. Finish or cancel that codexsw command first.');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error.safeMessage ? error : fail('Cannot confirm that the lock owner has exited.');
  }
  fs.unlinkSync(file);
}
