import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Windows installer selects one npm when PATH contains multiple installations', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexsw-installer-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('codexsw-installer-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const npmFile = (process.env.PATH || process.env.Path || '').split(path.delimiter)
    .map(directory => path.join(directory.replace(/^"|"$/g, ''), 'npm.cmd'))
    .find(file => fs.existsSync(file));
  assert.ok(npmFile, 'npm must be available to test installation');
  const directories = ['npm first', 'npm second'].map(name => path.join(root, name));
  for (const directory of directories) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'npm.cmd'), `@echo off\r\ncall "${npmFile}" %*\r\nexit /b %errorlevel%\r\n`);
  }
  const prefix = path.join(root, 'installed package');
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const installer = fileURLToPath(new URL('../install.ps1', import.meta.url));
  const env = { ...process.env, PATH: [...directories, process.env.PATH || process.env.Path || ''].join(path.delimiter) };
  const installed = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', installer,
    '-InstallDirectory', prefix, '-NoPathUpdate',
  ], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const version = spawnSync(process.execPath, [path.join(prefix, 'node_modules', 'codex-account-switch', 'bin', 'codexsw.js'), '--version'], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(version.status, 0, version.stderr);
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version.stdout.trim(), `codexsw ${manifest.version}`);
  assert.ok(fs.existsSync(path.join(prefix, 'codexsw.cmd')));
});
