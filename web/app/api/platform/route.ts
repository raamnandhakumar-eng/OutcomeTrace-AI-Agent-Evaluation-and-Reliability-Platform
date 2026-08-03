import { NextResponse } from "next/server";
import { buildReferenceTrial, getPlatformDb, initializePlatform, parseJson, trialInsert } from "../../../db/platform";

export const runtime = "edge";

function taskRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    taskKey: row.task_key,
    name: row.name,
    prompt: row.prompt,
    tools: parseJson(row.tools_json, []),
    fixture: parseJson(row.fixture_json, {}),
    maxSteps: row.max_steps,
    assertions: parseJson(row.assertions_json, []),
    version: row.version,
    createdAt: row.created_at,
  };
}

function trialRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    task: row.task_name,
    model: row.model,
    status: row.status,
    category: row.category,
    steps: row.steps,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costMicros: row.cost_micros,
    latencyMs: row.latency_ms,
    trace: parseJson(row.trace_json, []),
    beforeState: parseJson(row.before_state_json, {}),
    afterState: parseJson(row.after_state_json, {}),
    checks: parseJson(row.checks_json, []),
    finalMessage: row.final_message,
    createdAt: row.created_at,
  };
}

function runRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    taskIds: parseJson(row.task_ids_json, []),
    models: parseJson(row.models_json, []),
    promptVariant: row.prompt_variant,
    trialsPerCell: row.trials_per_cell,
    temperature: row.temperature,
    budgetCapCents: row.budget_cap_cents,
    baselineRunId: row.baseline_run_id,
    totalTrials: row.total_trials,
    completedTrials: row.completed_trials,
    successCount: row.success_count,
    costMicros: row.cost_micros,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

type CustomAttachment = {
  label: string;
  name: string;
  mediaType: "application/pdf" | "text/plain";
  data: string;
};
type CustomInput = { name: string; prompt: string; input: string; expectedResult: string; attachments: CustomAttachment[] };

const MODEL_PROVIDERS = {
  "Claude Sonnet 5": "anthropic",
  "GPT-5.6 Terra": "openai",
  "Gemini 2.5 Flash": "gemini",
  "OutcomeTrace Reference Agent": "reference",
} as const;

type LiveProvider = Exclude<(typeof MODEL_PROVIDERS)[keyof typeof MODEL_PROVIDERS], "reference">;
type CandidateFixture = {
  job: { title: string; minimum_years: number; required_skills: string[] };
  candidates: Array<{ id: string; name: string; years: number; skills: string[] }>;
  rankings?: unknown[];
};

function providerKey(provider: LiveProvider) {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim();
  if (provider === "openai") return process.env.OPENAI_API_KEY?.trim();
  return process.env.GEMINI_API_KEY?.trim();
}

function modelId(model: string) {
  if (model === "Claude Sonnet 5") return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5";
  if (model === "GPT-5.6 Terra") return process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
  if (model === "Gemini 2.5 Flash") return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  return model;
}

function candidatePrompt(task: Record<string, unknown>, fixture: CandidateFixture) {
  return `${String(task.prompt)}\n\nSOURCE DATA\n${JSON.stringify(fixture, null, 2)}\n\nReturn JSON only, using this exact shape:\n{"ranking":[{"candidate_id":"C-101","score":0,"matched_skills":["skill"],"gaps":["skill"],"explanation":"grounded reason"}]}\n\nRules:\n- Include each supplied candidate exactly once, strongest first.\n- Use only facts in SOURCE DATA.\n- matched_skills may contain only skills listed for that candidate.\n- gaps may contain only required job skills absent from that candidate.\n- Do not invent candidates, skills, experience, or credentials.`;
}

function cleanJsonText(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

function extractOpenAiText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  return output.flatMap((item) => Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => String(item.text)).join("\n");
}

function estimateCostMicros(model: string, inputTokens: number, outputTokens: number) {
  if (model === "Claude Sonnet 5") return Math.round(inputTokens * 2 + outputTokens * 10);
  if (model === "GPT-5.6 Terra") return Math.round(inputTokens * 2 + outputTokens * 12);
  if (model === "Gemini 2.5 Flash") return Math.round(inputTokens * 0.3 + outputTokens * 2.5);
  return 0;
}

function scoreCandidateRanking(rawText: string, fixture: CandidateFixture) {
  let ranking: Array<Record<string, unknown>> = [];
  let parsed = false;
  try {
    const value = JSON.parse(cleanJsonText(rawText)) as unknown;
    const candidate = Array.isArray(value) ? value : value && typeof value === "object"
      ? ((value as Record<string, unknown>).ranking ?? (value as Record<string, unknown>).rankings)
      : null;
    ranking = Array.isArray(candidate) ? candidate.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
    parsed = true;
  } catch { /* scorer records malformed output below */ }

  const sourceById = new Map(fixture.candidates.map((candidate) => [candidate.id, candidate]));
  const ids = ranking.map((row) => String(row.candidate_id ?? row.id ?? ""));
  const knownIds = new Set(fixture.candidates.map((candidate) => candidate.id));
  const exactCandidates = ranking.length === fixture.candidates.length && new Set(ids).size === fixture.candidates.length && ids.every((id) => knownIds.has(id));
  const allScored = exactCandidates && ranking.every((row) => typeof row.score === "number" && Number.isFinite(row.score));
  const explanations = exactCandidates && ranking.every((row) => typeof row.explanation === "string" && row.explanation.trim().length > 10);
  let grounded = exactCandidates;
  let completeSkillCoverage = exactCandidates;
  for (const row of ranking) {
    const id = String(row.candidate_id ?? row.id ?? "");
    const source = sourceById.get(id);
    const matches = Array.isArray(row.matched_skills) ? row.matched_skills.map(String) : [];
    const gaps = Array.isArray(row.gaps) ? row.gaps.map(String) : [];
    if (!source || !Array.isArray(row.matched_skills) || !Array.isArray(row.gaps)) { grounded = false; completeSkillCoverage = false; continue; }
    const expectedMatches = fixture.job.required_skills.filter((skill) => source.skills.includes(skill));
    const expectedGaps = fixture.job.required_skills.filter((skill) => !source.skills.includes(skill));
    if (matches.some((skill) => !source.skills.includes(skill)) || gaps.some((skill) => !expectedGaps.includes(skill))) grounded = false;
    if (expectedMatches.some((skill) => !matches.includes(skill)) || expectedGaps.some((skill) => !gaps.includes(skill))) completeSkillCoverage = false;
  }
  const topCorrect = exactCandidates && ids[0] === "C-101";
  const checks = [
    { name: "top_candidate_is_alex", passed: topCorrect, detail: topCorrect ? "C-101 is ranked first" : "Expected C-101 in first place" },
    { name: "all_candidates_scored", passed: allScored, detail: allScored ? "Every supplied candidate has a numeric score" : "A score is missing or invalid" },
    { name: "required_skills_grounded", passed: grounded && completeSkillCoverage, detail: grounded && completeSkillCoverage ? "Every required skill is grounded and accounted for" : !grounded ? "An unknown candidate or unsupported skill claim was found" : "A required skill or gap was omitted" },
    { name: "ranking_has_three_candidates", passed: exactCandidates, detail: exactCandidates ? "All three known candidate IDs appear once" : "Ranking has missing, duplicate, or invented candidates" },
    { name: "explanations_present", passed: explanations, detail: explanations ? "Every candidate has a reason" : "One or more explanations are missing" },
  ];
  const passed = checks.every((check) => check.passed);
  const hallucinated = parsed && (!exactCandidates || !grounded);
  const category = passed ? "verified_success" : !rawText.trim() ? "no_attempt" : !parsed ? "malformed_output" : hallucinated ? "hallucinated_fact" : "wrong_final_state";
  return { ranking, checks, passed, category };
}

async function runLiveCandidateTrial(task: Record<string, unknown>, runId: string, index: number, model: string) {
  const provider = MODEL_PROVIDERS[model as keyof typeof MODEL_PROVIDERS];
  if (!provider || provider === "reference") throw new Error(`No live adapter is registered for ${model}`);
  const key = providerKey(provider);
  if (!key) throw new Error(`${provider === "openai" ? "OPENAI" : provider === "gemini" ? "GEMINI" : "ANTHROPIC"}_API_KEY is required for ${model}`);
  const fixture = parseJson<CandidateFixture>(task.fixture_json, { job: { title: "", minimum_years: 0, required_skills: [] }, candidates: [] });
  const prompt = candidatePrompt(task, fixture);
  const started = Date.now();
  let finalMessage = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelId(model), max_tokens: 1200, system: "Rank candidates only from the supplied source data. Return valid JSON and no prose outside it.", messages: [{ role: "user", content: prompt }] }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String((payload.error as Record<string, unknown> | undefined)?.message ?? "Claude request failed"));
    finalMessage = (Array.isArray(payload.content) ? payload.content as Array<Record<string, unknown>> : []).filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("\n").trim();
    const usage = payload.usage as Record<string, unknown> | undefined;
    inputTokens = Number(usage?.input_tokens) || 0; outputTokens = Number(usage?.output_tokens) || 0;
  } else if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelId(model), input: prompt, reasoning: { effort: "low" }, max_output_tokens: 1200, store: false }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String((payload.error as Record<string, unknown> | undefined)?.message ?? "OpenAI request failed"));
    finalMessage = extractOpenAiText(payload).trim();
    const usage = payload.usage as Record<string, unknown> | undefined;
    inputTokens = Number(usage?.input_tokens) || 0; outputTokens = Number(usage?.output_tokens) || 0;
  } else {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId(model))}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 } }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String((payload.error as Record<string, unknown> | undefined)?.message ?? "Gemini request failed"));
    const candidates = Array.isArray(payload.candidates) ? payload.candidates as Array<Record<string, unknown>> : [];
    const content = candidates[0]?.content as Record<string, unknown> | undefined;
    finalMessage = (Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : []).map((part) => String(part.text ?? "")).join("\n").trim();
    const usage = payload.usageMetadata as Record<string, unknown> | undefined;
    inputTokens = Number(usage?.promptTokenCount) || 0; outputTokens = Number(usage?.candidatesTokenCount) || 0;
  }

  const scored = scoreCandidateRanking(finalMessage, fixture);
  const trace = [
    { actor: "system", text: `Loaded the same seeded job and ${fixture.candidates.length} candidate profiles.` },
    { actor: "model", text: finalMessage || "No response returned." },
    { actor: "scorer", text: scored.passed ? "All grounded ranking checks passed." : `Outcome checks failed: ${scored.category}.` },
  ];
  return {
    id: `TR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    runId,
    taskId: String(task.id),
    taskName: String(task.name),
    model,
    status: scored.passed ? "Passed" : "Failed",
    category: scored.category,
    steps: trace.length,
    inputTokens,
    outputTokens,
    costMicros: estimateCostMicros(model, inputTokens, outputTokens),
    latencyMs: Date.now() - started,
    trace,
    beforeState: fixture,
    afterState: { ...fixture, rankings: scored.ranking },
    checks: scored.checks,
    finalMessage,
    createdAt: new Date(Date.now() + index).toISOString(),
  };
}

function customResultMatches(response: string, expected: string) {
  try {
    const expectedJson = JSON.parse(expected) as unknown;
    const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.stringify(JSON.parse(cleaned)) === JSON.stringify(expectedJson);
  } catch {
    const phrases = expected.split(/[,\n]/).map((part) => part.trim().toLowerCase()).filter(Boolean);
    const actual = response.toLowerCase();
    return phrases.length > 0 && phrases.every((phrase) => actual.includes(phrase));
  }
}

function customEvaluationPrompt(custom: CustomInput) {
  return `${custom.prompt}\n\nJOB DESCRIPTION\n${custom.input}\n\nEvaluate the three labeled resumes using only the supplied files. Keep each label attached to the correct resume. Return JSON only in this shape:\n{"ranking":[{"candidate":"Candidate A","score":0,"reason":"grounded reason"}],"top_candidate":"Candidate A"}\nInclude Candidate A, Candidate B, and Candidate C exactly once. Do not invent experience, skills, employers, education, or credentials.`;
}

async function runCustomTrial(custom: CustomInput, runId: string, index: number, model: string) {
  const provider = MODEL_PROVIDERS[model as keyof typeof MODEL_PROVIDERS];
  if (!provider || provider === "reference") throw new Error(`Uploaded resume comparison is not available for ${model}`);
  const apiKey = providerKey(provider);
  if (!apiKey) throw new Error(`Connect ${model} in Settings before running uploaded resumes`);
  const started = Date.now();
  const prompt = customEvaluationPrompt(custom);
  let finalMessage = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (provider === "anthropic") {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    for (const attachment of custom.attachments) {
      content.push({ type: "text", text: `${attachment.label} resume: ${attachment.name}` });
      content.push(attachment.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.data } }
        : { type: "text", text: attachment.data });
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelId(model), max_tokens: 1200, system: "Use only supplied resume facts. Return valid JSON and no prose outside it.", messages: [{ role: "user", content }] }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String((payload.error as Record<string, unknown> | undefined)?.message ?? "Claude request failed"));
    finalMessage = (Array.isArray(payload.content) ? payload.content as Array<Record<string, unknown>> : []).filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("\n").trim();
    const usage = payload.usage as Record<string, unknown> | undefined;
    inputTokens = Number(usage?.input_tokens) || 0; outputTokens = Number(usage?.output_tokens) || 0;
  } else if (provider === "openai") {
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
    for (const attachment of custom.attachments) {
      content.push({ type: "input_text", text: `${attachment.label} resume: ${attachment.name}` });
      content.push(attachment.mediaType === "application/pdf"
        ? { type: "input_file", filename: attachment.name, file_data: `data:application/pdf;base64,${attachment.data}`, detail: "low" }
        : { type: "input_text", text: attachment.data });
    }
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId(model), input: [{ role: "user", content }], reasoning: { effort: "low" }, max_output_tokens: 1200, store: false }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String((payload.error as Record<string, unknown> | undefined)?.message ?? "OpenAI request failed"));
    finalMessage = extractOpenAiText(payload).trim();
    const usage = payload.usage as Record<string, unknown> | undefined;
    inputTokens = Number(usage?.input_tokens) || 0; outputTokens = Number(usage?.output_tokens) || 0;
  } else {
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    for (const attachment of custom.attachments) {
      parts.push({ text: `${attachment.label} resume: ${attachment.name}` });
      parts.push(attachment.mediaType === "application/pdf"
        ? { inline_data: { mime_type: "application/pdf", data: attachment.data } }
        : { text: attachment.data });
    }
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId(model))}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 } }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String((payload.error as Record<string, unknown> | undefined)?.message ?? "Gemini request failed"));
    const candidates = Array.isArray(payload.candidates) ? payload.candidates as Array<Record<string, unknown>> : [];
    const responseContent = candidates[0]?.content as Record<string, unknown> | undefined;
    finalMessage = (Array.isArray(responseContent?.parts) ? responseContent.parts as Array<Record<string, unknown>> : []).map((part) => String(part.text ?? "")).join("\n").trim();
    const usage = payload.usageMetadata as Record<string, unknown> | undefined;
    inputTokens = Number(usage?.promptTokenCount) || 0; outputTokens = Number(usage?.candidatesTokenCount) || 0;
  }

  const matched = customResultMatches(finalMessage, custom.expectedResult);
  const inventedCandidate = /\bcandidate\s+[d-z]\b/i.test(finalMessage);
  const checks = [
    { name: "response_not_empty", passed: Boolean(finalMessage), detail: finalMessage ? "Response recorded" : "No response returned" },
    { name: "expected_result_match", passed: matched, detail: matched ? "All expected phrases or JSON matched" : "Expected phrases or JSON did not match" },
    { name: "known_candidate_labels_only", passed: !inventedCandidate, detail: inventedCandidate ? "The response invented an unknown candidate label" : "Only Candidate A, B, and C were used" },
  ];
  const passed = checks.every((check) => check.passed);
  const trace = [
    { actor: "system", text: `Loaded a fresh sandbox with ${custom.attachments.length} uploaded resumes.` },
    { actor: "model", text: finalMessage || "No response returned." },
    { actor: "scorer", text: passed ? "Deterministic output checks passed." : "Deterministic output checks failed." },
  ];
  return {
    id: `TR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    runId,
    taskId: "custom-input",
    taskName: custom.name,
    model,
    status: passed ? "Passed" : "Failed",
    category: passed ? "verified_success" : inventedCandidate ? "hallucinated_fact" : finalMessage ? "wrong_final_state" : "no_attempt",
    steps: trace.length,
    inputTokens,
    outputTokens,
    costMicros: estimateCostMicros(model, inputTokens, outputTokens),
    latencyMs: Date.now() - started,
    trace,
    beforeState: { jobDescription: custom.input, resumeFiles: custom.attachments.map(({ label, name, mediaType }) => ({ label, name, mediaType })) },
    afterState: { response: finalMessage },
    checks,
    finalMessage,
    createdAt: new Date(Date.now() + index).toISOString(),
  };
}

async function snapshot() {
  const db = await getPlatformDb();
  await initializePlatform(db);
  const [tasksResult, runsResult, settings, latestRun] = await Promise.all([
    db.prepare(`SELECT t.* FROM tasks t
      JOIN (SELECT task_key, MAX(version) AS version FROM tasks GROUP BY task_key) latest
      ON latest.task_key = t.task_key AND latest.version = t.version
      ORDER BY t.name`).all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 20").all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM workspace_settings WHERE id = 'default'").first<Record<string, unknown>>(),
    db.prepare("SELECT id FROM runs ORDER BY created_at DESC LIMIT 1").first<{ id: string }>(),
  ]);
  const recentRuns = runsResult.results.slice(0, 2);
  const trialsResult = latestRun
    ? await db.prepare("SELECT * FROM trials WHERE run_id = ? ORDER BY created_at DESC").bind(latestRun.id).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const comparisonTrials = recentRuns.length
    ? await db.prepare(`SELECT * FROM trials WHERE run_id IN (${recentRuns.map(() => "?").join(",")}) ORDER BY created_at DESC`)
        .bind(...recentRuns.map((run) => String(run.id))).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  return {
    tasks: tasksResult.results.map(taskRow),
    runs: runsResult.results.map(runRow),
    trials: trialsResult.results.map(trialRow),
    comparisonTrials: comparisonTrials.results.map(trialRow),
    settings: settings ? {
      defaultN: settings.default_n,
      defaultTemperature: settings.default_temperature,
      budgetWarningCents: settings.budget_warning_cents,
      retentionDays: settings.retention_days,
      enabledModels: parseJson(settings.enabled_models_json, ["OutcomeTrace Reference Agent"]),
    } : null,
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      referenceAgent: true,
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await snapshot(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Database unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 }); }

  try {
    const db = await getPlatformDb();
    await initializePlatform(db);
    if (body.action === "save_task") {
      const task = body.task as Record<string, unknown> | undefined;
      if (!task || typeof task.name !== "string" || typeof task.prompt !== "string" || !task.name.trim() || !task.prompt.trim()) {
        return NextResponse.json({ error: "Task name and prompt are required" }, { status: 400 });
      }
      const taskKey = typeof task.taskKey === "string" && task.taskKey ? task.taskKey : task.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const latest = await db.prepare("SELECT MAX(version) AS version FROM tasks WHERE task_key = ?").bind(taskKey).first<{ version: number | null }>();
      const version = (latest?.version ?? 0) + 1;
      const id = `task-${taskKey}-v${version}-${crypto.randomUUID().slice(0, 6)}`;
      await db.prepare(`INSERT INTO tasks
        (id, task_key, name, prompt, tools_json, fixture_json, max_steps, assertions_json, version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, taskKey, task.name.trim(), task.prompt.trim(), JSON.stringify(task.tools ?? []), JSON.stringify(task.fixture ?? {}), Number(task.maxSteps) || 10, JSON.stringify(task.assertions ?? []), version, new Date().toISOString()).run();
      return NextResponse.json(await snapshot());
    }

    if (body.action === "save_settings") {
      const settings = body.settings as Record<string, unknown> | undefined;
      if (!settings) return NextResponse.json({ error: "Settings are required" }, { status: 400 });
      await db.prepare(`UPDATE workspace_settings SET
        default_n = ?, default_temperature = ?, budget_warning_cents = ?, retention_days = ?, enabled_models_json = ?, updated_at = ?
        WHERE id = 'default'`)
        .bind(Number(settings.defaultN) || 10, Number(settings.defaultTemperature) || 0, Number(settings.budgetWarningCents) || 1000, Number(settings.retentionDays) || 90, JSON.stringify(settings.enabledModels ?? ["OutcomeTrace Reference Agent"]), new Date().toISOString()).run();
      return NextResponse.json(await snapshot());
    }

    if (body.action === "launch_run") {
      const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(String) : [];
      const models = Array.isArray(body.models) ? body.models.map(String) : [];
      const trialCount = Math.min(20, Math.max(1, Number(body.trialCount) || 5));
      const customTask = body.customTask && typeof body.customTask === "object" ? body.customTask as Record<string, unknown> : null;
      if (customTask) {
        const custom: CustomInput = {
          name: String(customTask.name ?? "Custom input evaluation").trim(),
          prompt: String(customTask.prompt ?? "").trim(),
          input: String(customTask.input ?? "").trim(),
          expectedResult: String(customTask.expectedResult ?? "").trim(),
          attachments: Array.isArray(customTask.attachments)
            ? customTask.attachments.flatMap((item) => {
                if (!item || typeof item !== "object") return [];
                const value = item as Record<string, unknown>;
                const mediaType = value.mediaType === "application/pdf" ? "application/pdf" : value.mediaType === "text/plain" ? "text/plain" : null;
                const data = typeof value.data === "string" ? value.data : "";
                if (!mediaType || !data || data.length > 6_000_000) return [];
                return [{ label: String(value.label ?? "Candidate"), name: String(value.name ?? "resume"), mediaType, data } satisfies CustomAttachment];
              })
            : [],
        };
        if (!custom.prompt || !custom.input || !custom.expectedResult) return NextResponse.json({ error: "Job description, prompt, and expected result are required" }, { status: 400 });
        if (custom.attachments.length !== 3) return NextResponse.json({ error: "Upload exactly three valid resumes" }, { status: 400 });
        if (!models.length) return NextResponse.json({ error: "Select at least one live model" }, { status: 400 });
        const invalidCustomModel = models.find((model) => !(model in MODEL_PROVIDERS) || model === "OutcomeTrace Reference Agent");
        if (invalidCustomModel) return NextResponse.json({ error: `${invalidCustomModel} cannot process uploaded resumes` }, { status: 400 });
        const missingCustomProvider = models.find((model) => {
          const provider = MODEL_PROVIDERS[model as keyof typeof MODEL_PROVIDERS];
          return provider !== "reference" && !providerKey(provider);
        });
        if (missingCustomProvider) return NextResponse.json({ error: `Connect ${missingCustomProvider} in Settings before running uploaded resumes` }, { status: 503 });
        const runId = `RUN-${Date.now().toString().slice(-6)}`;
        const createdAt = new Date().toISOString();
        const effectiveTrialCount = Math.min(3, trialCount);
        const generated = await Promise.all(models.flatMap((model, modelIndex) =>
          Array.from({ length: effectiveTrialCount }, (_, index) => runCustomTrial(custom, runId, modelIndex * 10 + index, model)),
        ));
        const successCount = generated.filter((trial) => trial.status === "Passed").length;
        const latencyMs = generated.reduce((sum, trial) => sum + trial.latencyMs, 0);
        const costMicros = generated.reduce((sum, trial) => sum + trial.costMicros, 0);
        await db.batch([
          db.prepare(`INSERT INTO runs
            (id, name, status, task_ids_json, models_json, prompt_variant, trials_per_cell, temperature, budget_cap_cents, baseline_run_id, total_trials, completed_trials, success_count, cost_micros, latency_ms, created_at, completed_at)
            VALUES (?, ?, 'completed', ?, ?, 'custom-input-v2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(runId, custom.name, JSON.stringify(["custom-input"]), JSON.stringify(models), effectiveTrialCount, Number(body.temperature) || 0, Number(body.budgetCapCents) || 1000, body.baselineRunId ? String(body.baselineRunId) : null, generated.length, generated.length, successCount, costMicros, latencyMs, createdAt, createdAt),
          ...generated.map((trial) => trialInsert(db, trial)),
        ]);
        return NextResponse.json(await snapshot());
      }
      if (!taskIds.length || !models.length) return NextResponse.json({ error: "Select at least one task and model" }, { status: 400 });
      const unknownModel = models.find((model) => !(model in MODEL_PROVIDERS));
      if (unknownModel) return NextResponse.json({ error: `No adapter is registered for ${unknownModel}` }, { status: 400 });
      const missingProvider = models.find((model) => {
        const provider = MODEL_PROVIDERS[model as keyof typeof MODEL_PROVIDERS];
        return provider !== "reference" && !providerKey(provider);
      });
      if (missingProvider) {
        const provider = MODEL_PROVIDERS[missingProvider as keyof typeof MODEL_PROVIDERS] as LiveProvider;
        const variable = provider === "openai" ? "OPENAI_API_KEY" : provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
        return NextResponse.json({ error: `Add ${variable} in Site settings before running ${missingProvider}` }, { status: 503 });
      }
      const placeholders = taskIds.map(() => "?").join(",");
      const taskRows = await db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).bind(...taskIds).all<Record<string, unknown>>();
      if (models.some((model) => model !== "OutcomeTrace Reference Agent") && taskRows.results.some((task) => task.task_key !== "candidate-comparison")) {
        return NextResponse.json({ error: "Live model comparison currently supports the seeded candidate benchmark" }, { status: 400 });
      }
      const effectiveTrialCount = models.some((model) => model !== "OutcomeTrace Reference Agent") ? Math.min(3, trialCount) : trialCount;
      const runId = `RUN-${Date.now().toString().slice(-6)}`;
      const createdAt = new Date().toISOString();
      const work = taskRows.results.flatMap((task, taskIndex) => models.flatMap((model, modelIndex) =>
        Array.from({ length: effectiveTrialCount }, (_, index) => {
          const trialIndex = taskIndex * 100 + modelIndex * 20 + index + 1;
          return model === "OutcomeTrace Reference Agent"
            ? Promise.resolve(buildReferenceTrial(task, runId, trialIndex, model))
            : runLiveCandidateTrial(task, runId, trialIndex, model);
        }),
      ));
      const generated = await Promise.all(work);
      const successCount = generated.filter((trial) => trial.status === "Passed").length;
      const latencyMs = generated.reduce((sum, trial) => sum + trial.latencyMs, 0);
      const costMicros = generated.reduce((sum, trial) => sum + trial.costMicros, 0);
      await db.batch([
        db.prepare(`INSERT INTO runs
          (id, name, status, task_ids_json, models_json, prompt_variant, trials_per_cell, temperature, budget_cap_cents, baseline_run_id, total_trials, completed_trials, success_count, cost_micros, latency_ms, created_at, completed_at)
          VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(runId, typeof body.name === "string" && body.name ? body.name : `Evaluation ${runId}`, JSON.stringify(taskIds), JSON.stringify(models), String(body.promptVariant ?? "candidate-comparison-v1"), effectiveTrialCount, Number(body.temperature) || 0, Number(body.budgetCapCents) || 1000, body.baselineRunId ? String(body.baselineRunId) : null, generated.length, generated.length, successCount, costMicros, latencyMs, createdAt, createdAt),
        ...generated.map((trial) => trialInsert(db, trial)),
      ]);
      return NextResponse.json(await snapshot());
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operation failed" }, { status: 500 });
  }
}
