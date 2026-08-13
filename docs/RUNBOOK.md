# VoiceOps Studio operations runbook

This runbook covers the repository’s current deployment contract. Platform-specific commands, alert destinations, owners, and escalation contacts must be filled in before production use.

## Service contract

- Process: `node dist/index.cjs`
- Default port: `5177`
- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- Browser status: `GET /api/status`
- Persistent data: `DATA_DIR/call-records.jsonl` when `RECORD_STORAGE` is enabled
- Railway volume mount: `/app/data` with `DATA_DIR=/app/data`

## Runtime modes

| Mode | Meaning | Operator action |
| --- | --- | --- |
| `live` | A configured model provider and Fish speech are available | Monitor latency and provider errors |
| `fish-live` | Fish speech is available; the local decision engine is answering | Restore or rotate the model-provider credential |
| `demo` | External providers are unavailable or intentionally disabled | Do not represent the system as a fully live service |

The mode reflects runtime provider results after a request, not only whether a key exists.

## Deploy checklist

1. Run `npm ci`, `npm run check`, `npm test`, and `npm run build`.
2. Provide required secrets through the deployment platform; never bake `.env` into an image.
3. Set `DATA_ENCRYPTION_KEY` and `ADMIN_API_KEY` when records are enabled.
4. Set `PUBLIC_BASE_URL` and `TWILIO_AUTH_TOKEN` before enabling telephone traffic.
5. Verify liveness, readiness, one consented browser turn, one rejected non-consented turn, and one signed Twilio request.
6. Confirm log ingestion and alert delivery in the target platform.
7. Record the deployed git revision and the previous known-good artifact.

## Common incidents

### Model provider authentication failure

Symptoms: `/api/status` moves to `fish-live`; logs contain `[provider fallback] live turn`.

1. Confirm the provider account and key status outside the application.
2. Rotate the secret in the deployment platform.
3. Restart the service and run one prepared, non-customer scenario.
4. Confirm that `/api/status` returns `live` after a successful turn.

### Fish Audio failure

Symptoms: no streamed audio, `fishAudio` becomes false, or the browser uses local speech.

1. Check provider status, account credit, and credential validity.
2. Keep the deterministic text flow available while voice is degraded.
3. Rotate the key if authentication failed.
4. Verify MP3 generation with a prepared scenario before restoring traffic.

### Elevated API errors or latency

1. Group structured logs by `requestId`, path, status, and `durationMs`.
2. Determine whether failures are isolated to transcription, decision, speech, records, or Twilio.
3. Reduce or stop incoming traffic if records or consent boundaries are affected.
4. Roll back when the issue follows a new application revision.

### Suspected personal-data exposure

1. Stop affected integrations and restrict access to records.
2. Preserve privacy-safe operational evidence; do not copy customer content into tickets.
3. Rotate potentially exposed credentials.
4. Follow the organization’s legal notification and deletion process.

## Rollback

Deploy the previously recorded, tested artifact using the hosting platform’s normal rollback mechanism. Re-run liveness and the prepared smoke flow after rollback. Database migrations are not currently used, but encrypted call records require the same `DATA_ENCRYPTION_KEY` to remain readable.

## Backup and restore boundary

The repository implements local encrypted JSONL storage and retention pruning; it does not implement infrastructure backups. A production owner must configure volume snapshots, retention, access control, and a restore drill. Restores must use the matching encryption key and should be verified in an isolated environment before serving traffic.
