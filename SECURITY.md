# Security policy

## Supported code

Security fixes are applied to the current `main` branch. This prototype does not publish versioned security-support guarantees.

## Report a vulnerability

Please use GitHub’s private vulnerability reporting or a private security advisory for this repository. If that option is unavailable, contact the repository owner through the GitHub profile before disclosing details publicly.

Do not include API keys, access tokens, customer speech, contact details, or production URLs in an issue. There is currently no bug-bounty program or guaranteed response SLA.

## Secret handling

- Runtime credentials belong in environment variables or the deployment platform’s secret store.
- `.env`, local data, build output, and dependencies are excluded from git.
- `.dockerignore` prevents runtime secrets and local records from entering the Docker build context.
- Suspected exposed credentials should be revoked at the provider before repository cleanup begins.

## Scope boundary

Repository controls do not certify a deployment as secure or compliant. Cloud permissions, deployed secrets, provider settings, alert delivery, backups, and legal requirements must be reviewed in the target environment.
