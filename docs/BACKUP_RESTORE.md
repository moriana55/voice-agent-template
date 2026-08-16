# Encrypted off-platform backup and restore

Railway's native volume backups are the preferred recovery path when the workspace is on Pro. The current public workspace is on Hobby, where the Backups screen is locked. This repository therefore also provides a streaming encrypted export that never writes a plaintext volume archive to local disk.

## Security model

- `script/encrypted-backup.mjs` streams `tar` output directly through AES-256-GCM.
- The backup key is derived with scrypt and must come from a permission-`0600` file containing at least 32 characters.
- Every new backup has a non-secret version-2 manifest with the encrypted byte count and SHA-256 transport checksum. AES-GCM authenticates the archive, while an HMAC key-separated from the backup encryption key authenticates the manifest metadata, including its creation time and source kind.
- Creation automatically decrypts and lists the archive, rejects traversal, symbolic links, and special-file entries, then retains the backup only if verification passes.
- Restore verifies the backup first, extracts into a new staging directory, validates the restored tree, and atomically renames it. It refuses an existing destination.
- The backup passphrase and the application's `DATA_ENCRYPTION_KEY` are separate recovery secrets. Both are required to recover and read encrypted customer records.

Keep the backup, manifest, and recovery secrets outside the repository. Store the backup passphrase separately from the backup object.

Legacy version-1 manifests remain decryptable for recovery compatibility, but their metadata is not authenticated and they are therefore rejected as paid-customer launch evidence. Create a fresh version-2 Railway stream before launch.

## Create a local fixture backup

Create a recovery passphrase outside the repository:

```bash
umask 077
openssl rand -base64 48 > /secure/secrets/voiceops-backup.key
chmod 600 /secure/secrets/voiceops-backup.key
```

Back up a local data directory:

```bash
npm run backup -- create \
  --source /path/to/voiceops-data \
  --output /secure/offsite/voiceops-2026-08-16.vopsbackup \
  --key-file /secure/secrets/voiceops-backup.key
```

The command refuses to overwrite an existing backup or manifest.

## Stream the Railway volume

Prerequisites:

1. Railway CLI is authenticated and linked to the exact project, production environment, and service.
2. A dedicated SSH public key is registered with Railway. Registering a key changes account access and requires the account owner's explicit approval.
3. The output directory is an approved off-platform target with restricted access and retention controls.

Run:

```bash
npm run backup -- create-railway \
  --output /secure/offsite/voiceops-$(date -u +%Y%m%dT%H%M%SZ).vopsbackup \
  --key-file /secure/secrets/voiceops-backup.key \
  --mount-path /app/data
```

The process executes `tar` inside the service and encrypts stdout locally. No plaintext archive is created. Copy both the `.vopsbackup` file and its `.manifest.json` file to the approved target.

## Verify and restore drill

Verify after every transfer:

```bash
npm run backup -- verify \
  --backup /secure/offsite/voiceops-2026-08-16.vopsbackup \
  --key-file /secure/secrets/voiceops-backup.key
```

Restore only to a new, non-existing local directory:

```bash
npm run backup -- restore \
  --backup /secure/offsite/voiceops-2026-08-16.vopsbackup \
  --destination /secure/restore-drills/voiceops-2026-08-16 \
  --key-file /secure/secrets/voiceops-backup.key
```

For a real Railway recovery, never extract over the mounted production volume. Create an isolated environment and new volume, upload the verified restored directory, set the original `DATA_ENCRYPTION_KEY`, deploy the recorded application revision, and confirm:

1. Startup and `/api/health/ready` succeed.
2. The protected record list decrypts and the expected record count/date boundary is present.
3. Usage events parse and the monthly summary is consistent.
4. A prepared web session can complete and resume after a restart.
5. The original volume remains retained and unmodified until customer acceptance.

Record the backup timestamp, manifest SHA-256, restore environment, application revision, operator, verification results, RPO, and elapsed restore time. Delete the drill environment according to the approved retention policy after evidence is captured.
