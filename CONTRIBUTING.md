# Contributing

Use Node.js 20 or newer. No third-party runtime dependencies are needed.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

Tests create isolated temporary homes and fake ChatGPT accounts. Never use
your actual `auth.json` as a fixture. Windows tests exercise real DPAPI;
macOS tests exercise a temporary native Keychain item and remove it.
Linux tests check actual POSIX modes. Mocked keyring tests check the command
contract and failure handling; they do not prove desktop keyring availability.

Changes should preserve freshly refreshed tokens, leave the current login
in place on failed or duplicate login, and avoid putting secrets in command
arguments, output or the package.

The CI workflow runs on Windows, macOS and Linux. A Windows run alone
is not proof of native macOS or Linux behavior.
