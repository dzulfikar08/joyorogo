# Encrypted backups

`joyorogo-keystore.tar.gpg` is the Android release signing keystore
(`apps/native/keystore/joyorogo-release.jks` and `keystore.properties`), encrypted with GPG
(AES-256, symmetric). Without it, existing installs and the in-app updater cannot take new
releases: Android only accepts updates signed with the same key.

The passphrase is **not** in git. It lives in `~/.config/joyorogo/keystore-backup-passphrase` on
the machine that made the backup. Keep a copy in a password manager.

Restore (from the repo root):

```bash
gpg --decrypt secrets/joyorogo-keystore.tar.gpg | tar -C apps/native -xf -
```

That recreates `apps/native/keystore/` (gitignored), which `scripts/build-release-apk.sh` uses.

Refresh the backup after changing the keystore:

```bash
tar -C apps/native -cf - keystore | gpg --symmetric --cipher-algo AES256 \
  --passphrase-file ~/.config/joyorogo/keystore-backup-passphrase --batch --pinentry-mode loopback \
  -o secrets/joyorogo-keystore.tar.gpg
```
