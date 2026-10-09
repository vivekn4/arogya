# Contributing to Arogya

Thanks for helping make Arogya calmer, safer, and more human. A few ground rules:

## Principles

1. **Keep it free.** No paid APIs, keys, or signups in the default path. The out-of-the-box experience must run at $0.
2. **Keep it calm.** Language is reassuring, never alarming — especially around serious symptoms.
3. **Keep it safe.** The disclaimer gate, crisis screen, emergency detection, and the system prompt's hard rules (no medication advice, no diagnoses) are load-bearing. Changes touching them get extra review and must be tested end-to-end.

## Workflow

- Fork, branch from `main`, open a pull request with a clear description and screenshots for UI changes.
- **Frontend:** zero build step — edit `index.html` / `styles.css` / `app.js` directly and test by serving the `frontend/` folder locally. Keep the design tokens in `styles.css` as the single source of truth.
- **Backend:** Node ≥ 18. `cd backend && npm install && npm start`. Run `node --check server.js` before pushing.
- **Safety-prompt changes:** update `SYSTEM_PROMPT` in `backend/server.js`, then verify with real `POST /api/chat` calls covering: normal flow, vague input, off-topic input, and (carefully) the crisis/emergency phrases.

## What we won't merge

- Anything requiring a paid service or signup for core functionality.
- Medication/diagnosis features, or anything that weakens the safety guardrails.
- Tracking, analytics beyond anonymous counts, or any user-data storage.

## Code style

- Keep it readable over clever. Small, well-named functions.
- No secrets in code, comments, or examples — use placeholders like `AI_API_KEY=` (empty) or `your-key-here`.
