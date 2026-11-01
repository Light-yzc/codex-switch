# codexsw

Switch between two local Codex ChatGPT accounts on Windows, macOS and Linux.

```sh
codexsw 1
codexsw 2
codexsw status
```

Requires Node.js 20+, npm and Codex CLI for adding accounts. No third-party
runtime dependencies. [中文](README.md)

## Install

Install directly on any supported OS; Git is not required:

```sh
npm install --global https://github.com/Light-yzc/codex-switch/archive/refs/tags/v0.1.0.tar.gz
```

Or download/clone this repository, enter its directory, and run:

```sh
npm install --global .
```

For an installation into your user directory without administrator access:

- Windows PowerShell: `.\install.ps1`
- macOS / Linux: `sh ./install.sh`

The installers pack and copy the application; the source directory can be
removed afterward. Windows uses `%USERPROFILE%\.local\bin` and adds it to user
PATH. Unix uses `~/.local/bin`; add it to your shell configuration if needed:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Windows v1 launchers are backed up and the existing DPAPI vault is compatible.
For an offline package, run `npm pack` and install the resulting `.tgz` with
`npm install --global ./codex-account-switch-0.1.0.tgz`.

## Register and switch

If you are already signed in, run `codexsw 1` to register that account, then
`codexsw 2` to sign in to the second one. Each account needs one initial login.
If no account is signed in, run `codexsw setup` before these commands.

The second login runs official `codex login` in a private temporary
`CODEX_HOME`. Failed, cancelled or duplicate login does not replace the active
file. New credentials are activated only after successful registration.

If Codex uses keyring/auto/ephemeral credential storage, switching stops.
Run `codexsw setup`, then `codexsw login 1`. Setup backs up config.toml and
sets `cli_auth_credentials_store = "file"` without removing other settings.
Organization policy can still override this setting.

Clients that share the same `CODEX_HOME` and use file credentials read the
same auth.json. See [official login caching documentation](https://learn.chatgpt.com/docs/auth#login-caching).
Restart terminal Codex sessions and any shared backend that retains old auth,
reload VS Code with **Developer: Reload Window**, and fully quit/reopen the
desktop client. Check the client's account menu. No computer restart is needed.
The status marker describes the file, not live client memory.

Switch while clients are idle and reload promptly: an old running client can
refresh its old account back to disk. WSL has a separate home by default.

## Commands

```sh
codexsw 1
codexsw 2
codexsw status
codexsw save 1
codexsw login 2
codexsw forget 2
codexsw setup
codexsw unlock
codexsw 2 --device-auth
codexsw help
```

To replace the second account, select 1, forget 2, then select 2 and sign in.
Unknown current credentials must be saved before switching. Device login
requires account/workspace support.

## Backup storage

This storage is separate from Codex's own file-credential setting:

| Platform | Default backup |
| --- | --- |
| Windows | DPAPI encryption for the current Windows user |
| macOS | AES-256-GCM vault, random key in login Keychain |
| Linux | Private files: 0700 directory, 0600 files; not encrypted |

Linux desktop users can install secret-tool and choose
`codexsw 1 --storage secret-service` before registering any accounts. macOS
without an available Keychain can explicitly choose `--storage file` before
registration. Selected keyring errors never silently downgrade to files.

Default directories are `%LOCALAPPDATA%\CodexSwitch\<home hash>` on Windows,
`~/Library/Application Support/codexsw/<home hash>` on macOS, and
`${XDG_STATE_HOME:-~/.local/state}/codexsw/<home hash>` on Linux.
Use `--codex-home PATH` and `--state-dir PATH` to override them.

Freshly refreshed credentials are saved before switching. Keep the vault
local, do not reuse old refresh-token copies across computers, and never
commit real auth files. See [credential handling](SECURITY.md).

## Development

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

Tests use temporary homes, fake credentials and mock official login. Windows
exercises actual DPAPI, macOS has a native Keychain test, and Linux checks
permissions. The CI workflow targets all three OSes, plus Node 20/22/24 on
Linux. Mocked keyring tests are contract checks; the native CI jobs must run
to validate the respective platforms.

MIT. Independent project, not affiliated with OpenAI.
