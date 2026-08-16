# VoiceOps Studio operations runbook

This runbook covers the repository’s current deployment contract. Platform-specific commands, alert destinations, owners, and escalation contacts must be filled in before production use.

The production SLO, monitor, incident-routing, and privacy contract is documented in [`OBSERVABILITY.md`](OBSERVABILITY.md).

## Service contract

- Process: `node dist/index.cjs`
- Default port: `5177`
- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- Browser status: `GET /api/status`
- Public white-label config: `GET /api/product`
- Protected usage report: `GET /api/admin/usage?period=YYYY-MM`
- Protected integration readiness: `GET /api/admin/integrations`
- Protected outbound call: `POST /api/admin/telephony/outbound`
- Protected subscription Checkout: `POST /api/admin/billing/checkout`
- Stripe webhook: `POST /api/integrations/stripe/webhook`
- Persistent data: `DATA_DIR/call-records.jsonl`, `DATA_DIR/usage-events.jsonl`, and encrypted `DATA_DIR/web-sessions.enc.json` when their respective storage modes are enabled
- Railway volume mount: `/app/data` with `DATA_DIR=/app/data`
- Container startup normalizes ownership only on `/app/data`, then drops to the unprivileged `node` user before starting the service.
- Production readiness responses expose only the boolean `ready`; inspect structured logs and the authenticated operations view for diagnostics.
- On `SIGTERM`/`SIGINT`, readiness turns false, new connections stop, and active requests get up to `GRACEFUL_SHUTDOWN_MS` (default 9000 ms) to finish before forced termination.

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
3. Set `DATA_ENCRYPTION_KEY` and `ADMIN_API_KEY` when records are enabled. Production startup rejects unencrypted record storage.
4. Set `PUBLIC_BASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` before enabling telephone traffic.
5. Set `USAGE_HARD_LIMIT_MINUTES` to a positive contractual ceiling and tune `TURN_MAX_CONCURRENCY`. Production startup rejects live provider credentials without a positive ceiling and `ALLOWED_ORIGINS`.
6. Put every generic CRM/calendar webhook hostname in `INTEGRATION_WEBHOOK_ALLOWED_HOSTS`; production rejects HTTP, private/loopback literals, redirects, missing tokens, and non-allowlisted hosts.
7. For customer traffic set `WEB_SESSION_STORAGE=encrypted-file`; startup decrypts and validates the store before accepting traffic. Keep `WEB_REPLICA_COUNT=1`: the attached volume survives restarts but is not a multi-replica shared session store.
8. Keep `TELEPHONY_RECORD_STORAGE=disabled` until the customer's recording basis and notice are approved.
9. Verify liveness, readiness, one acknowledged browser turn, one restart-resumed browser turn, one separately consented saved record, one rejected non-acknowledged turn, one usage report, one signed Twilio request, and every configured integration shown as ready in the operations view.
10. Send a staged `SIGTERM` and confirm `shutdown_started` followed by a non-forced `shutdown_completed` event.
11. Run `LOAD_BASE_URL=<isolated-demo-url> npm run smoke:load`; never set `LOAD_ALLOW_LIVE=true` without an explicit provider-cost budget.
12. Confirm log ingestion and alert delivery in the target platform.
13. Record the deployed git revision and the previous known-good artifact.

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

Deploy the previously recorded, tested artifact using the hosting platform’s normal rollback mechanism. Re-run liveness and the prepared smoke flow after rollback. Database migrations are not currently used, but encrypted call records and durable web sessions require the same `DATA_ENCRYPTION_KEY` to remain readable.

## Backup and restore boundary

The repository implements encrypted application storage, atomic session-file replacement, and retention pruning; it does not create infrastructure snapshots. Railway's Backups screen currently reports that backups/PITR require the Pro plan for this Hobby workspace. Before customer mode is enabled, either upgrade and configure daily plus weekly volume backups or approve a separately secured off-platform export target. A restore drill must create an isolated replacement volume, retain the original, use the matching encryption key, and pass readiness, record decryption, and restart-resume checks before traffic is switched.
