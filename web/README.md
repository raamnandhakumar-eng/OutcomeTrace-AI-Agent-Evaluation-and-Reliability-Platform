# AI Agent Evaluation and Reliability Platform — Website

The working dashboard for outcome-first agent evaluation.

The core rule is simple: **evaluate agents by what they do, not what they say.** A trial
passes only when the sandbox reaches the expected final state. The trace is a secondary
signal used to explain failures, unsafe shortcuts, and tool misuse.

## What the website includes

- Candidate-review task setup with a job description and three resume uploads
- Built-in deterministic agent plus Claude, GPT, and Gemini model options
- Repeated trials with success, hallucination, cost, and latency metrics
- Persisted task, run, and trial records in Cloudflare D1
- Failure categories and a step-by-step trace viewer
- Baseline-versus-candidate regression comparison

## Local development

Requirements: Node.js `>=22.13.0`, Linux, `flock`, `curl`, and GNU `timeout`.

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
```

The UI lives in `app/`, API routes are under `app/api/`, and D1 schema/migrations live in
`db/` and `drizzle/`.

## Provider configuration

The reference agent runs without a key. Live providers require their corresponding API
credentials in the deployment environment. Keys are server-side only; do not commit them.

## Deployment

The production site is hosted with OpenAI Sites using the configuration in
`.openai/hosting.json`.

[Open the live website](https://outcome-trace-dashboard.raam-nandha.chatgpt.site)
