# Changelog

## 0.2.1

- Read CPA slot 0 API keys from local `config.cpa.toml` through Codex command-backed authentication; no client `CPA_API_KEY` environment variable is required.

- Reserve slot 0 for CPA with a private editable config and official-config restoration.

- Show full email addresses, plan types and workspace IDs in account output.
- Save and switch personal and Team workspaces separately under the same user.
- Keep duplicate protection within each user/workspace pair.

## 0.2.0

- Support any number of accounts using positive integer IDs starting at 1.
- Accept sparse and arbitrarily large decimal IDs without numeric rounding.
- Apply the same IDs to switching, save, login, forget and vault validation.
- List every saved account in numeric order without inventing missing slots.
- Preserve existing two-account backups and use bounded login scratch paths.
- Update built-in help, bilingual command references and upgrade instructions.
- Test a 512-account collection, large IDs and legacy vault compatibility.

## 0.1.1

- Load Windows PowerShell's native modules when launched from PowerShell 7.
- Select one npm executable when multiple Node installations are on PATH.
- Report safe credential-error stages and codes without parser input.
- Test user-local Windows installation without changing the user's PATH.

## 0.1.0

- A shared, dependency-free Node.js CLI for Windows, macOS and Linux.
- `codexsw 1` / `codexsw 2`, isolated official login, refresh preservation,
  duplicate-account protection, atomic writes and rollback.
- Windows DPAPI storage compatible with the original PowerShell script.
- macOS encrypted vault with its key held in Keychain; Linux private files
  with optional Secret Service storage.
- User-local installers, npm packaging, bilingual docs and three-platform CI.
