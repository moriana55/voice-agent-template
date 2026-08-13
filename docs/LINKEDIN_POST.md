# LinkedIn draft

I’ve been building **VoiceOps Studio**, a multilingual voice-operations prototype that turns customer speech into structured appointment, pricing, and support workflows.

The current version includes:

- 10-language browser and telephone flows
- live speech synthesis with Fish Audio S2 Pro
- optional Claude/OpenAI conversation with a deterministic local decision fallback
- streaming audio, silence detection, and interruption support
- consent-aware call records with optional AES-256-GCM encryption
- locale-aware Twilio webhooks with signature verification
- CI, 18 automated tests, a production build, and an HTTP/telephony smoke suite

In a local presentation run on August 13, I observed the first Fish audio response at **1.02 seconds**. That is a single environment-specific observation, not a production SLA.

The part I care about most is degradation behavior: when the model provider is unavailable, the workflow does not freeze or pretend to be fully live. It reports the degraded state, keeps the structured call flow running locally, and continues real Fish speech when that service is healthy.

I’m sharing the engineering evidence and current limitations openly because reliable AI products are built around boundaries and failure modes, not only the happy-path demo.

Repository: https://github.com/moriana55/voiceops-studio
Live demo: https://voiceops-studio-production.up.railway.app/#/present

#VoiceAI #AIEngineering #TypeScript #React #NodeJS #OpenSource #DevTools

## Recommended media

1. Lead with `docs/assets/voiceops-studio-console.jpg`.
2. Add a 20–30 second screen recording: select Turkish, run the appointment scenario, switch to English, then show the structured call record.
3. Use `docs/assets/voiceops-studio-mobile.jpg` as the second image if posting a carousel.

Do not describe Fish Audio as a partner or sponsor. Safe wording: “live speech synthesis with Fish Audio S2 Pro.”
