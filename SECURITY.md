# Credential handling

Codex caches contain bearer and refresh tokens. Do not paste auth caches,
vaults, Keychain values, device codes or login callback URLs into issues.

Windows uses DPAPI. macOS uses an AES-256-GCM vault with a random key held in
login Keychain. Linux defaults to private files (0700 directory, 0600 files);
these files are not encrypted. To use an unlocked Linux desktop keyring,
install secret-tool and choose Secret Service before saving your first slot:

```sh
codexsw 1 --storage secret-service
```

A failed selected keyring never silently falls back to plaintext. Backend
selection is persisted per Codex home. Backups are local; this tool does not
provide token synchronization or token sharing.

The active auth.json and official login scratch home necessarily use Codex's
file format. Switching does not revoke other sessions. Existing clients can
hold tokens in memory or refresh their old login back to disk; switch while
they are idle and restart/reload them promptly.

OS-backed encryption and permissions do not protect against malware running
as your user. Locked keyrings, managed policies, custom homes and WSL must be
handled in their respective environments. Report sanitized errors and
reproduce problems with fake credentials.
