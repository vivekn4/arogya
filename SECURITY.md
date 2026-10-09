# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | ✅        |
| 1.x     | ❌        |

## Reporting a vulnerability

Arogya deals with health-adjacent content, so safety reports are treated as urgent.

- **How to report:** open a private security advisory on GitHub, or email the maintainer. (TODO: add the security contact email before public launch.)
- **What to include:** a description of the issue, steps to reproduce, and the impact you see — especially anything that could surface unsafe medical advice, leak user data, or bypass the crisis/emergency safeguards.
- **What to expect:** acknowledgement within 72 hours and a fix or mitigation plan for confirmed issues. Please do not disclose the issue publicly until we've had a chance to address it.

## Data handling

- **No accounts, no storage.** Conversations are processed in real time and are never persisted by the backend.
- **Logging is metadata-only.** The backend logs request counts, timings, and status codes — never message contents.
- **Upstream AI providers** receive the conversation text needed to generate a reply. Review your provider's data policy before switching `AI_PROVIDER` / `AI_BASE_URL` (the default free provider is documented in the README).
- **No secrets in the repo.** API keys live in environment variables only (see `backend/.env.example`). Never commit a `.env` file.

## Scope notes

- Arogya is a **wellness companion, not a medical device**. It must never diagnose, prescribe, or replace professional care. Changes to the system prompt's safety rules are reviewed as medical-content changes, not copy tweaks.
- Dependency updates that touch `express`, `helmet`, `cors`, or `express-rate-limit` should be smoke-tested against `POST /api/chat` validation and the `/health` + `/ready` endpoints before release.
