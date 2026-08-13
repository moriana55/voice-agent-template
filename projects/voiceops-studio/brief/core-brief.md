# VoiceOps Studio multilingual revision brief

## Objective

Turn the existing Turkish/English voice-agent prototype into a demonstrable,
single-deployment multilingual product without weakening its streaming,
privacy, telephony, or structured call-record flow.

## Approved scope

- Ten selectable locales: English, Turkish, Spanish, German, French, Italian,
  Portuguese, Dutch, Polish, and Russian.
- One locale value controls interface copy, scenarios, browser speech fallback,
  ASR, LLM instructions, Fish voice selection, Twilio speech recognition, and
  persisted call records.
- Preserve the current warm editorial UI and existing integrations.
- Keep a deterministic local demo path when provider services are unavailable.

## Claim boundaries

- Verified: type-check, automated tests, production build, desktop/mobile UI,
  and an interactive French appointment scenario.
- Implemented but provider-dependent: live Fish/Claude/OpenAI voice quality and
  Twilio behavior for every locale.
- Not claimed: production deployment approval, legal compliance certification,
  or human-level accuracy for arbitrary names and dates.
