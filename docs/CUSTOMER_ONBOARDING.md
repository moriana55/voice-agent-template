# Paid-customer launch gate

This checklist separates product capability from customer-specific authorization. Do not set `CUSTOMER_MODE=true` or route customer traffic until every required decision has an owner and dated evidence.

## Required customer decisions

| Decision | Required input | Runtime mapping | Acceptance evidence |
| --- | --- | --- | --- |
| Business identity | Legal/business name, public product and agent names, support email | `PUBLIC_BUSINESS_NAME`, `PUBLIC_PRODUCT_NAME`, `PUBLIC_AGENT_NAME`, `PUBLIC_SUPPORT_EMAIL` | Customer approves the visible identity and support route |
| Verified operating context | Services, hours, prices the agent may quote, escalation rules, prohibited claims | `BUSINESS_CONTEXT` | Prepared scenarios contain no invented business facts |
| Privacy notice and lawful basis | Customer-approved notice URL, jurisdictions, controller/processor roles, provider review | `PUBLIC_PRIVACY_URL` | Legal/privacy owner signs off the browser notice and telephone disclosure |
| Temporary session retention | Explicit value from 5 to 1440 minutes | `WEB_SESSION_TTL_MINUTES` | Restart continuity works and expired sessions are pruned |
| Completed-record retention | Explicit value from 1 to 3650 days, or storage disabled | `RECORD_RETENTION_DAYS`, `RECORD_STORAGE` | Separate storage consent, list/delete, encryption, and expiry are verified |
| Usage and cost ceiling | Included minutes, overage rule, hard monthly limit | `PLAN_*`, `USAGE_HARD_LIMIT_MINUTES` | Quota rejection and usage report match the contract |
| Intelligence provider | Anthropic or OpenAI account and approved data terms | Provider secret and model variables | One prepared live turn succeeds without fallback |
| Voice provider | Fish Audio account, selected voices, approved data terms | Fish secret, model, and reference IDs | All sold locales return the approved voice |
| Recovery level | Railway Pro backups or an approved off-platform encrypted export target | Platform configuration | A dated restore drill passes before customer mode |
| Incident ownership | Operational owner, privacy owner, customer escalation contact | Notification/runbook configuration | A simulated monitor failure reaches the responsible person |

Never paste provider secrets, customer records, transcripts, or phone numbers into repository issues or this document. Store secrets only in the deployment platform.

## Channel and integration selection

Enable only the channels included in the signed customer scope:

- Browser voice/text requires acknowledged processing notice. Durable restart state is encrypted and TTL-bounded; it is not a completed customer record.
- Twilio requires an owned number, signed-webhook verification, encrypted TTL-bounded active-call sessions, an approved telephone disclosure, and a non-customer inbound/outbound test. Keep `TELEPHONY_RECORD_STORAGE=disabled` unless the customer's legal basis explicitly covers it.
- Google Calendar requires the target calendar, time zone, duration, and OAuth account owner.
- HubSpot requires a private app with only contact read/write permissions and an approved phone-based deduplication rule.
- Generic CRM/calendar webhooks require an exact hostname allowlist, a 32+ character token, idempotency support, and an owner for delivery failures.
- Stripe is optional product billing infrastructure; use test mode until product, tax, cancellation, and refund terms are approved.

### Property-management systems and Buildium

There is no claimed direct Buildium adapter in this repository. If a customer requests Buildium or another property-management system, keep the generic signed webhook boundary until these items are confirmed from the customer's account and the provider's current API contract:

1. Exact object and action: prospect/lead creation, task, appointment, work order, resident lookup, or another flow.
2. Authentication model, account/tenant identifier, required scopes, sandbox availability, and rate limits.
3. Source-of-truth and deduplication keys; a phone number alone may not be a safe tenant boundary.
4. Webhook signature/replay rules, retry behavior, idempotency, deletion, and retention semantics.
5. Fields that may leave VoiceOps and fields that must never be sent.

A direct adapter needs contract tests, fail-closed credential checks, tenant-isolation review, and a sandbox end-to-end run before it can be included in customer scope.

## Technical launch sequence

1. Create a customer-specific environment; do not reuse the public portfolio environment for real customer data.
2. Mount a dedicated volume and set `DATA_DIR=/app/data`, `WEB_REPLICA_COUNT=1`, and `WEB_SESSION_STORAGE=encrypted-file`.
3. Generate unique 32+ character admin, encryption, webhook, and usage-hash secrets. Record the rotation owner and recovery location outside the repository.
4. Set the approved business, privacy, retention, quota, origin, and provider variables.
5. Confirm `/api/health/ready` is `200` and the protected operations view reports every selected integration as ready.
6. Run the prepared browser flow, restart-resume check, deletion check, quota boundary, and any selected integration sandbox flow.
7. Run the bounded load smoke only against an isolated demo-mode environment. Live-provider load requires a separately approved cost budget.
8. Create and restore a backup, run the monitoring failure simulation, and record the deployed revision plus rollback artifact.
9. Obtain customer acceptance, then enable traffic and monitor the first controlled calls.

## Executable launch evidence

The checklist above is enforced by `npm run launch:gate`. Copy [`launch-evidence.example.json`](launch-evidence.example.json) outside the repository, bind it to the exact approved customer HTTPS origin, replace every pending item only after the named owner has produced dated evidence, and set `APP_REVISION` in the customer environment to the exact reviewed 40-character git commit SHA. The gate checks the command target against that approved origin before reading the admin key, and deliberately rejects the public portfolio environment, fallback provider modes, incomplete customer approvals, missing selected integrations, ephemeral sessions, unencrypted records, revision drift, and local fixture backups.

Keep `ADMIN_API_KEY` and the backup passphrase in separate permission-`0600` files. Then run:

```bash
npm run launch:gate -- \
  --base-url https://customer-voice.example.com \
  --admin-key-file /secure/secrets/customer-admin.key \
  --evidence /secure/evidence/customer-launch.json \
  --backup /secure/offsite/customer-latest.vopsbackup \
  --backup-key-file /secure/secrets/customer-backup.key \
  --output /secure/evidence/customer-launch-report.json
```

The encrypted backup must have been streamed from the Railway volume, have a cryptographically authenticated version-2 manifest, be at most 24 hours old by default, and pass checksum, AES-GCM authentication, archive-path, and archive-type verification. Use `--backup-max-age-hours` only to set an explicitly approved value from 1 to 168 hours. The output is a non-secret, permission-`0600` report containing the target origin, evidence hash, reviewed revision, backup checksum, and each pass/fail result. The command refuses to overwrite an existing report and exits non-zero on any failed gate. A green report is necessary but does not replace the recorded approvals referenced by the evidence file.

## Launch blockers in the current public environment

- Railway native backup/PITR is unavailable on the current Hobby workspace; the Backups screen requires Pro.
- Fish Audio is live, but no live model provider is configured, so the public deployment runs in `fish-live` mode with the deterministic local engine.
- Twilio, customer branding/context, support/privacy ownership, and customer integrations still require customer-specific accounts and decisions.
- The public portfolio deployment must not be treated as a customer data environment.
