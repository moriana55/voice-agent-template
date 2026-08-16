# Production observability contract

This document defines the minimum operator evidence for VoiceOps Studio. Logs and incident issues must never contain call transcripts, phone numbers, email addresses, provider credentials, audio, or record payloads.

## Ownership and service objectives

- Operational owner: repository owner and Railway workspace owner.
- Demo availability objective: 99.5% successful five-minute readiness probes per calendar month.
- Voice objective: the daily synthetic returns streamed text and Fish Audio with first audio below 3 seconds.
- Error objective: no unexplained HTTP 5xx response may remain untriaged for more than one monitoring interval.
- Data objective: volume usage stays below 80%, retention pruning succeeds, and a restorable backup exists before customer mode is enabled.

## Journey coverage

| Journey | Detection | Diagnosis | Response |
| --- | --- | --- | --- |
| Web app unavailable | Five-minute liveness/readiness workflow | Railway deployment and HTTP logs, deployment ID | Follow availability incident steps in `RUNBOOK.md`; roll back if caused by a release |
| Fish Audio unavailable or slow | Daily real streaming synthetic | `provider_fallback`, request duration, provider status | Check provider/quota, keep deterministic fallback active, escalate provider outage |
| Deployment rejected | Railway `/api/health/ready` gate and GitHub deployment status | `startup_rejected`, deployment config, commit SHA | Correct variables through Railway, redeploy the same reviewed commit |
| Record retention failure | `record_retention_failed` structured event | Volume state and retention configuration | Stop customer onboarding, preserve the volume, correct configuration, rerun pruning |
| Integration delivery failure | `integration_delivery_failed` or `integration_webhook_failed` | Integration name and safe error category | Disable affected integration if necessary; retry only with the same idempotency key |
| Capacity or abuse | HTTP 429 responses, quota and concurrency rejection | Usage report, bounded rate/concurrency settings | Verify legitimate traffic, adjust contractual limits only through a reviewed change |
| Session store unreadable | Deployment fails with `startup_rejected` before listening | Encrypted session file and encryption-key version | Preserve the volume, restore the matching key or known-good backup; never replace the store silently |
| Session retention failure | `web_session_prune_failed` structured event | Volume permissions, encryption key, session file integrity | Stop onboarding, preserve the volume, correct the cause, and verify TTL pruning before restoring traffic |
| Telephone session retention failure | `telephony_session_prune_failed` structured event | Volume permissions, encryption key, telephone session integrity | Keep the phone number out of service, preserve evidence, and verify restart plus TTL behavior before reopening |

## Automated monitors

`.github/workflows/production-monitor.yml` performs:

- liveness and readiness probes every five minutes;
- a real Fish Audio streaming synthetic once per day at 05:17 UTC;
- deduplicated GitHub incident issue creation on failure;
- automatic incident closure only after the same probe succeeds again;
- optional manual failure simulation to verify issue routing without taking production down.

GitHub issue/email delivery depends on repository notification settings and must be tested after the workflow is merged. Railway deployment healthchecks protect releases but are not continuous monitoring.

## Privacy and cardinality rules

- Correlate requests with `x-request-id`; do not use phone, email, call transcript, or raw provider response as a log field.
- Keep event names, provider names, HTTP methods, and normalized paths bounded.
- Never place API keys, authorization headers, webhook bodies, audio, or encrypted record blobs in incident issues.
- Store customer evidence only in the protected data path and apply the configured retention period.

## Acceptance checks

1. Manually dispatch `Production Monitor` with `simulate_failure=true`.
2. Confirm one assigned `Production health check failed` issue is created.
3. Dispatch it again with simulation disabled.
4. Confirm liveness/readiness pass and the incident is closed with a recovery link.
5. Dispatch with `run_voice_synthetic=true` and confirm `meta`, `text_delta`, `audio`, and `done` events.
6. Confirm Railway runtime error logs and HTTP 5xx logs remain empty after the checks.
7. Run the isolated demo-mode load smoke and retain its request count, concurrency, error rate, and p95 result with the release evidence.
