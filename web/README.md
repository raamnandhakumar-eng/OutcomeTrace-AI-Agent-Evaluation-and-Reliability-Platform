# AI Agent Evaluation and Reliability Platform — Website

The working dashboard for outcome-first agent evaluation.

The core rule is simple: **evaluate agents by what they do, not what they say.** A trial
passes only when the sandbox reaches the expected final state. The trace is a secondary
signal used to explain failures, unsafe shortcuts, and tool misuse.

## What the website includes

- Candidate-review task setup with a job description and three resume uploads
- Built-in deterministic agent plus Claude, GPT, and Gemini model options
- Repeated trials with success, hallucination, cost, and latency metrics
- Seeded task, run, and trial records in a Vercel-safe demo store
- Failure categories and a step-by-step trace viewer
- Baseline-versus-candidate regression comparison

## Local development

Requirements: Node.js `>=20` and npm.

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run lint
npm run build
```

The UI lives in `app/`, API routes are under `app/api/`, and the demo store lives in `db/`.

## Provider configuration

The reference agent runs without a key. Live providers require their corresponding API
credentials in the deployment environment. Keys are server-side only; do not commit them.

## Deployment

The production site is hosted on Vercel as a native Next.js application. Set the Vercel
project root directory to `web` when importing this repository.

The built-in reference agent works without credentials. The demo store can reset when a
serverless instance restarts; connect a managed database before using it for durable records.
