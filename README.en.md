# codexsw

Switch any number of local Codex ChatGPT accounts on Windows, macOS and Linux.

```sh
codexsw 1
codexsw 2
codexsw 3
codexsw 10
codexsw status
```

Account numbers start at 1. There is no configured account-count or number
maximum; practical capacity depends on your machine and credential store.
Requires Node.js 20+, npm and Codex CLI for adding accounts. No third-party
runtime dependencies. [中文](README.md)

## Install

Install directly on any supported OS; Git is not required:

```sh
npm install --global https://github.com/Light-yzc/codex-switch/archive/refs/tags/v0.2.0.tar.gz
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
`npm install --global ./codex-account-switch-0.2.0.tgz`.

## Register and switch

An empty vault first registers your existing login as account 1. Run
`codexsw 2`, `codexsw 3`, `codexsw 10`, or any unused positive integer to add
another account. Each account needs one initial login. If no account is signed
in, run `codexsw setup` first; the first login can use any valid number.

Adding an account runs official `codex login` in a private temporary
`CODEX_HOME`. Failed, cancelled or duplicate login does not replace the active
file. New credentials are activated only after successful registration.

Numbers are decimal positive integers without leading zeros. Gaps are allowed.
`1`, `3`, `42` and `1000` are valid; `0`, negatives, fractions, `01` and `1e3`
are rejected. Large numbers beyond JavaScript's safe-integer range remain exact.

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

## Command reference

`N` below means any positive integer; do not type angle brackets.

| Command | Behavior |
| --- | --- |
| `codexsw N` | Select N, or open official login to add it |
| `codexsw` / `codexsw status` / `codexsw list` | List every saved account in numeric order |
| `codexsw save N` | Register the current login as N; an existing slot must match the same account |
| `codexsw login N` | Reauthenticate N and select it, or add N if unused |
| `codexsw forget N` | Delete saved N without changing the active auth.json |
| `codexsw setup` | Back up config and enable Codex file credentials |
| `codexsw unlock` | Remove a lock whose owner has exited |
| `codexsw help` | Show command help |
| `codexsw --version` | Show installed version |

For example, add 3, reauthenticate 10, or remove 42:

```sh
codexsw 3
codexsw login 10
codexsw forget 42
codexsw 3 --device-auth
```

Status lists saved numbers only, ordered as 1, 2, 3, 10, 42, and so on.
The same user and workspace cannot occupy more than one number. Personal and
Team workspaces under the same email can be saved separately; choose the intended
workspace during login. Status and switch output show the full email, plan and
workspace ID, so multiple Team workspaces remain distinguishable. Missing plan
metadata is shown as `unknown plan`. To replace account 3,
select another saved account, forget 3, then select 3 and sign in again.
Unknown current credentials must be registered with `save N` before switching.
Device login requires account/workspace support.

| Option | Behavior |
| --- | --- |
| `--device-auth` | Use official device-code login when adding or reauthenticating |
| `--storage BACKEND` | Select dpapi, keychain, file or secret-service before initial registration; availability depends on OS |
| `--codex-home PATH` | Select Codex home; defaults to CODEX_HOME or ~/.codex |
| `--state-dir PATH` | Override the local backup directory |
| `-h` / `--help` | Show help |

## Upgrade from the two-account version

Run the install command again, or rerun the user-local installer from the new
source directory. Existing accounts 1 and 2 keep their numbers, credentials
and vault location; no registration is needed again. After adding more
numbers, keep using v0.2.0 or newer: older versions reject the extended vault.

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

Tests cover sparse/long numbers, a 512-account list, old two-account vaults,
multi-account refresh/reauthentication, and safe failure handling.
They use temporary homes, fake credentials and mock official login. Windows
exercises actual DPAPI, macOS has a native Keychain test, and Linux checks
permissions. The CI workflow targets all three OSes, plus Node 20/22/24 on
Linux. Mocked keyring tests are contract checks; the native CI jobs must run
to validate the respective platforms.

MIT. Independent project, not affiliated with OpenAI.


## CPA / slot 0

`codexsw edit 0` creates a private `config.cpa.toml` and prints its path.
Edit `base_url`, `model` and `experimental_bearer_token` in that file.
`codexsw 0` activates this separate configuration.
The endpoint must support Responses API. Restart/reload clients after switching.

Switching to `codexsw 1` (or another account) restores the complete original
`config.toml`, including plugins and project settings. CPA uses its own full
configuration; add any desired shared settings to `config.cpa.toml`.
Changes made to the active config during CPA mode are saved when switching back.
Slot 0 is reserved: `save 0`, `login 0` and `forget 0` are not account operations.
The CPA key is stored in the private CPA config; ChatGPT auth.json stays available
for returning to saved accounts. An unconfigured CPA slot fails without activating the endpoint.
