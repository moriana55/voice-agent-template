# VoiceOps Studio portfolio case study

**Live demo:** https://voiceops-studio-production.up.railway.app/#/present

## Positioning

VoiceOps Studio demonstrates how a multilingual customer-call product can preserve language context, structured state, live speech, privacy boundaries, provider fallback, and billable usage evidence across browser and telephone channels.

## Problem

Voice-agent demos often stop at speech-to-text and a chat response. A credible service workflow also needs explicit consent, deterministic business state, interruption handling, provider degradation, record lifecycle controls, telephone integration, and evidence that each layer agrees on the selected language.

## Contribution represented by this repository

Repository history attributes the current implementation to Yiğit Ertürk. The work represented here includes the React console, Express streaming API, shared locale and intent contracts, Fish Audio integration, optional Claude/OpenAI integration, Twilio adapter, encrypted record path, CI, tests, and documentation. External services, libraries, fonts, and generated assistance remain credited to their respective providers and authors.

## Selected technical decisions

1. A shared `Locale` contract crosses browser and server boundaries instead of duplicating language state.
2. Deterministic slot extraction owns the business state; generative providers improve conversational phrasing without becoming the only source of truth.
3. Runtime provider health can downgrade the displayed mode from fully live to Fish-only or demo behavior.
4. Raw audio is ephemeral; completed records are bounded, optionally encrypted, and subject to retention pruning.
5. Paid-customer readiness is an explicit runtime gate: missing business identity, privacy contact, encryption, provider intelligence, origins, admin access, or a monthly hard limit makes readiness fail.
6. Usage is metered server-side as active voice seconds and summarized monthly without retaining raw audio or plaintext call identifiers.

## Evidence snapshot — 2026-08-14

| Evidence | Result |
| --- | --- |
| TypeScript check | Passed |
| Automated tests | 23 passed |
| Production build | Passed |
| Production HTTP/Twilio smoke | Passed, 13 checks |
| Fish Audio MP3 generation | Passed |
| Desktop browser review | Passed at 1440 × 900 |
| Mobile browser review | Passed at 390 × 844 with no horizontal overflow |

The 1.02 s first-audio number visible in the screenshot is one observed local run. It is suitable as dated evidence, not as a generalized performance claim.

## Visual evidence

### Desktop operations console

![White-label desktop voice operations console with completed appointment record](assets/voiceops-product-console.png)

### Protected usage and lead dashboard

![Protected operations dashboard with active minutes and prepared lead records](assets/voiceops-admin-dashboard.png)

### Mobile presentation state

<img src="assets/voiceops-product-mobile.png" alt="Mobile white-label VoiceOps Studio presentation console" width="390" />

## Known limits

- A public Railway deployment exists, but real-user traffic, uptime history, and an SLA have not been verified.
- Load, abuse, backup/restore, and disaster-recovery testing remain out of scope.
- Legal and data-processing requirements must be reviewed for each operating jurisdiction.
- Live provider behavior, cost, and latency depend on third-party accounts and network conditions.
- The repository is released under the MIT License.

## Publication gate

- [x] Repository history and intended portfolio ownership reviewed
- [x] `.env` and local records excluded from git
- [x] Screenshots contain prepared demo content rather than customer data
- [x] Test and latency numbers dated and qualified
- [x] README links and setup commands reviewed
- [x] MIT License added before inviting reuse or contributions
- [x] Repository visibility change explicitly approved and completed
- [x] Public portfolio deployment added after production-specific smoke checks
