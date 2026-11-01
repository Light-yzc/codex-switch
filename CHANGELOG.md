# Changelog

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
