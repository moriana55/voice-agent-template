# VoiceOps Studio integrations

All provider credentials are server-side environment variables. The protected `/#/admin` view only returns readiness and missing variable names; it never returns secret values.

## Twilio Voice

Set:

```dotenv
PUBLIC_BASE_URL=https://your-public-domain.example
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+15551234567
```

Configure the number's incoming voice webhook as:

```text
POST https://your-public-domain.example/api/telephony/incoming
```

The operations view can initiate an outbound call to an E.164 number. Twilio requests the same incoming workflow URL and reports progress to `/api/telephony/status`. Every Twilio webhook is signature-verified. Each generated `<Gather>` URL carries a server nonce; signed retries reuse the cached TwiML response and completed nonce IDs remain protected by persistent usage idempotency.

## Google Calendar

Create an OAuth client, obtain a refresh token with the Calendar Events scope, and set:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=
BUSINESS_TIME_ZONE=Europe/Istanbul
APPOINTMENT_DURATION_MINUTES=30
```

When a separately consented appointment call is completed, VoiceOps exchanges the refresh token server-side and inserts a deterministic event. Event IDs are derived from the VoiceOps record ID so retries do not create duplicate appointments.

## HubSpot CRM

Create a private app with `crm.objects.contacts.read` and `crm.objects.contacts.write`, then set:

```dotenv
HUBSPOT_ACCESS_TOKEN=
```

Completed consented records search contacts by phone number. An existing contact is updated; otherwise a new contact is created.

## Stripe Billing

Create a recurring Price and a webhook endpoint, then set:

```dotenv
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
```

Webhook URL:

```text
POST https://your-public-domain.example/api/integrations/stripe/webhook
```

Subscribe at least to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. The operations view creates a server-side subscription Checkout Session. Webhook signatures are checked with a five-minute tolerance and accepted billing events are written to `DATA_DIR/billing-events.jsonl` without card data.

## Generic CRM and calendar webhooks

For systems without a direct adapter, set `CRM_WEBHOOK_URL`/`CRM_WEBHOOK_TOKEN` and `CALENDAR_WEBHOOK_URL`/`CALENDAR_WEBHOOK_TOKEN`. Add each exact destination hostname to `INTEGRATION_WEBHOOK_ALLOWED_HOSTS`. Deliveries use HTTPS in production, reject redirects and private/loopback IP literals, use bearer authentication and an idempotency key, and apply bounded timeouts with one retry for transient failures.

## Deployment gate

1. Mount persistent `DATA_DIR` storage.
2. Open `/#/admin` with `ADMIN_API_KEY` and confirm configured providers show **Hazır**.
3. Place one non-customer outbound test call.
4. Complete one consented appointment and verify the Calendar event and HubSpot contact.
5. Complete one Stripe test-mode Checkout and verify the signed webhook event.
6. Keep production traffic disabled until privacy terms, provider data processing, backup/restore, monitoring, and incident ownership are approved for that customer.
