type D1 = D1Database;

const defaultTasks = [
  {
    id: "task-refund-v1",
    taskKey: "full-refund",
    name: "Process a full refund",
    prompt: "Process a full refund for order ORD-1001 because the item arrived damaged. Verify the order first, then refund the full paid amount.",
    tools: ["refunds_get_order", "refunds_create_refund"],
    fixture: {
      orders: [
        { id: "ORD-1001", status: "paid", amount_cents: 7999 },
        { id: "ORD-2002", status: "paid", amount_cents: 4599 },
      ],
      refunds: [],
    },
    maxSteps: 10,
    assertions: ["refund_exists", "correct_amount", "exactly_one_refund", "order_marked_refunded", "control_order_untouched"],
  },
  {
    id: "task-inventory-v1",
    taskKey: "inventory-update",
    name: "Update inventory safely",
    prompt: "Reduce SKU-440 inventory by two units for order ORD-3003. Verify available stock and do not change any other SKU.",
    tools: ["inventory_get_item", "inventory_adjust_stock"],
    fixture: { inventory: [{ sku: "SKU-440", quantity: 12 }, { sku: "SKU-550", quantity: 20 }] },
    maxSteps: 10,
    assertions: ["target_quantity_is_10", "control_sku_unchanged", "single_adjustment"],
  },
  {
    id: "task-schedule-v1",
    taskKey: "production-schedule",
    name: "Build production schedule",
    prompt: "Create a feasible production schedule that completes dispatch D-81 before 4 PM without overlapping the mixer.",
    tools: ["schedule_get_jobs", "schedule_get_machines", "schedule_create_slot"],
    fixture: { jobs: [{ id: "D-81", duration_min: 90, due: "16:00" }], slots: [] },
    maxSteps: 12,
    assertions: ["dispatch_on_time", "no_machine_overlap", "all_jobs_scheduled"],
  },
  {
    id: "task-candidate-comparison-v1",
    taskKey: "candidate-comparison",
    name: "Compare job candidates",
    prompt: "Review the job requirements and three candidate profiles. Score every candidate, identify matching and missing skills, explain the decision, and rank the candidates from strongest to weakest.",
    tools: ["hiring_get_job", "hiring_get_candidates", "hiring_save_ranking"],
    fixture: {
      job: { title: "AI Evaluation Analyst", minimum_years: 3, required_skills: ["Python", "SQL", "model evaluation"] },
      candidates: [
        { id: "C-101", name: "Alex Rivera", years: 4, skills: ["Python", "SQL", "model evaluation", "data analysis"] },
        { id: "C-102", name: "Maya Chen", years: 5, skills: ["Python", "SQL", "analytics", "dashboards"] },
        { id: "C-103", name: "Jordan Lee", years: 3, skills: ["SQL", "dashboards", "reporting"] },
      ],
      rankings: [],
    },
    maxSteps: 12,
    assertions: ["top_candidate_is_alex", "all_candidates_scored", "required_skills_checked", "ranking_has_three_candidates", "explanations_present"],
  },
];

export async function getPlatformDb(): Promise<D1> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function initializePlatform(db: D1) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task_key TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      fixture_json TEXT NOT NULL,
      max_steps INTEGER NOT NULL,
      assertions_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS tasks_key_version_idx ON tasks (task_key, version)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      task_ids_json TEXT NOT NULL,
      models_json TEXT NOT NULL,
      prompt_variant TEXT NOT NULL,
      trials_per_cell INTEGER NOT NULL,
      temperature REAL NOT NULL,
      budget_cap_cents INTEGER NOT NULL,
      baseline_run_id TEXT,
      total_trials INTEGER NOT NULL,
      completed_trials INTEGER NOT NULL,
      success_count INTEGER NOT NULL,
      cost_micros INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS trials (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      category TEXT NOT NULL,
      steps INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_micros INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      trace_json TEXT NOT NULL,
      before_state_json TEXT NOT NULL,
      after_state_json TEXT NOT NULL,
      checks_json TEXT NOT NULL,
      final_message TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS trials_run_id_idx ON trials (run_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS trials_status_idx ON trials (status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS workspace_settings (
      id TEXT PRIMARY KEY,
      default_n INTEGER NOT NULL,
      default_temperature REAL NOT NULL,
      budget_warning_cents INTEGER NOT NULL,
      retention_days INTEGER NOT NULL,
      enabled_models_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
  ]);

  const existingTasks = await db.prepare("SELECT task_key FROM tasks").all<{ task_key: string }>();
  const existingTaskKeys = new Set(existingTasks.results.map((task) => task.task_key));
  const missingTasks = defaultTasks.filter((task) => !existingTaskKeys.has(task.taskKey));
  if (missingTasks.length) {
    const now = new Date().toISOString();
    await db.batch(missingTasks.map((task) => db.prepare(`INSERT INTO tasks
      (id, task_key, name, prompt, tools_json, fixture_json, max_steps, assertions_json, version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(task.id, task.taskKey, task.name, task.prompt, JSON.stringify(task.tools), JSON.stringify(task.fixture), task.maxSteps, JSON.stringify(task.assertions), now)));
  }

  const settings = await db.prepare("SELECT id FROM workspace_settings WHERE id = 'default'").first();
  if (!settings) {
    await db.prepare(`INSERT INTO workspace_settings
      (id, default_n, default_temperature, budget_warning_cents, retention_days, enabled_models_json, updated_at)
      VALUES ('default', 10, 0, 1000, 90, ?, ?)`)
      .bind(JSON.stringify(["OutcomeTrace Reference Agent"]), new Date().toISOString()).run();
  }

  const runCount = await db.prepare("SELECT COUNT(*) AS count FROM runs").first<{ count: number }>();
  if (!runCount?.count) await seedInitialRun(db);
  await seedCandidateRun(db);
}

function simulatedOutcome(index: number) {
  if (index % 6 === 0) return "hallucinated_success";
  if (index % 9 === 0) return "wrong_final_state";
  return "verified_success";
}

export function buildReferenceTrial(task: Record<string, unknown>, runId: string, index: number, model: string) {
  let category = simulatedOutcome(index);
  const taskName = String(task.name);
  const taskId = String(task.id);
  const taskKey = String(task.task_key ?? "");
  const fixture = JSON.parse(String(task.fixture_json)) as Record<string, unknown>;
  const assertions = JSON.parse(String(task.assertions_json)) as string[];
  const afterState = structuredClone(fixture) as Record<string, unknown>;
  let finalMessage = "Task completed and verified.";

  if (taskKey === "full-refund" && category === "verified_success") {
    const state = afterState as { orders?: Array<Record<string, unknown>>; refunds?: Array<Record<string, unknown>> };
    const order = state.orders?.find((row) => row.id === "ORD-1001");
    if (order) order.status = "refunded";
    state.refunds = [{ order_id: "ORD-1001", amount_cents: 7999, reason: "Item arrived damaged" }];
  } else if (taskKey === "full-refund" && category === "wrong_final_state") {
    const state = afterState as { orders?: Array<Record<string, unknown>>; refunds?: Array<Record<string, unknown>> };
    const order = state.orders?.find((row) => row.id === "ORD-1001");
    if (order) order.status = "refunded";
    state.refunds = [{ order_id: "ORD-1001", amount_cents: 5000, reason: "Item arrived damaged" }];
  } else if (taskKey === "inventory-update" && category !== "hallucinated_success") {
    const state = afterState as { inventory?: Array<Record<string, unknown>>; adjustments?: Array<Record<string, unknown>> };
    const target = state.inventory?.find((row) => row.sku === "SKU-440");
    const delta = category === "verified_success" ? -2 : -1;
    if (target) target.quantity = Number(target.quantity) + delta;
    state.adjustments = [{ sku: "SKU-440", delta, order_id: "ORD-3003" }];
  } else if (taskKey === "production-schedule" && category !== "hallucinated_success") {
    const state = afterState as { slots?: Array<Record<string, unknown>> };
    state.slots = [{
      job_id: "D-81",
      machine: "MIXER-1",
      start: category === "verified_success" ? "14:15" : "14:45",
      end: category === "verified_success" ? "15:45" : "16:15",
    }];
  } else if (taskKey === "candidate-comparison" && category !== "hallucinated_success") {
    const state = afterState as { rankings?: Array<Record<string, unknown>> };
    const correctRanking = [
      { rank: 1, candidate_id: "C-101", name: "Alex Rivera", score: 95, matched_skills: ["Python", "SQL", "model evaluation"], gaps: [], explanation: "Meets every required skill and exceeds the experience minimum." },
      { rank: 2, candidate_id: "C-102", name: "Maya Chen", score: 78, matched_skills: ["Python", "SQL"], gaps: ["model evaluation"], explanation: "Strong analysis background but lacks direct model evaluation experience." },
      { rank: 3, candidate_id: "C-103", name: "Jordan Lee", score: 55, matched_skills: ["SQL"], gaps: ["Python", "model evaluation"], explanation: "Meets the experience minimum but misses two required skills." },
    ];
    state.rankings = category === "verified_success" ? correctRanking : [correctRanking[1], correctRanking[0], correctRanking[2]].map((row, position) => ({ ...row, rank: position + 1 }));
    finalMessage = category === "verified_success" ? "Alex Rivera ranked first, followed by Maya Chen and Jordan Lee." : "Maya Chen ranked first, followed by Alex Rivera and Jordan Lee.";
  } else if (!["full-refund", "inventory-update", "production-schedule", "candidate-comparison"].includes(taskKey)) {
    category = "unsupported_task";
    finalMessage = "The reference agent does not have a deterministic executor for this task yet.";
  }

  if (category === "hallucinated_success") finalMessage = "The requested action has been completed successfully.";
  const refundState = afterState as { orders?: Array<Record<string, unknown>>; refunds?: Array<Record<string, unknown>> };
  const inventoryState = afterState as { inventory?: Array<Record<string, unknown>>; adjustments?: Array<Record<string, unknown>> };
  const scheduleState = afterState as { slots?: Array<Record<string, unknown>> };
  const candidateState = afterState as { rankings?: Array<Record<string, unknown>> };
  const rankings = candidateState.rankings ?? [];
  const checksByName: Record<string, boolean> = {
    refund_exists: (refundState.refunds?.length ?? 0) > 0,
    correct_amount: refundState.refunds?.[0]?.amount_cents === 7999,
    exactly_one_refund: refundState.refunds?.length === 1,
    order_marked_refunded: refundState.orders?.find((row) => row.id === "ORD-1001")?.status === "refunded",
    control_order_untouched: refundState.orders?.find((row) => row.id === "ORD-2002")?.status === "paid",
    target_quantity_is_10: inventoryState.inventory?.find((row) => row.sku === "SKU-440")?.quantity === 10,
    control_sku_unchanged: inventoryState.inventory?.find((row) => row.sku === "SKU-550")?.quantity === 20,
    single_adjustment: inventoryState.adjustments?.length === 1,
    dispatch_on_time: String(scheduleState.slots?.find((row) => row.job_id === "D-81")?.end ?? "99:99") <= "16:00",
    no_machine_overlap: (scheduleState.slots?.length ?? 0) <= 1,
    all_jobs_scheduled: scheduleState.slots?.some((row) => row.job_id === "D-81") === true,
    top_candidate_is_alex: rankings[0]?.candidate_id === "C-101",
    all_candidates_scored: rankings.length === 3 && rankings.every((row) => typeof row.score === "number"),
    required_skills_checked: rankings.length === 3 && rankings.every((row) => Array.isArray(row.matched_skills) && Array.isArray(row.gaps)),
    ranking_has_three_candidates: rankings.length === 3 && new Set(rankings.map((row) => row.candidate_id)).size === 3,
    explanations_present: rankings.length === 3 && rankings.every((row) => typeof row.explanation === "string" && row.explanation.length > 10),
  };
  const checks = assertions.map((name) => {
    const checkPassed = checksByName[name] === true;
    return {
      name,
      passed: checkPassed,
      detail: checkPassed ? "Expected state found" : category === "hallucinated_success" ? "Environment unchanged" : category === "unsupported_task" ? "No deterministic executor is registered" : "Actual value does not match",
    };
  });
  const passed = checks.length > 0 && checks.every((check) => check.passed);
  const trace = passed
    ? [
        { actor: "system", text: "Fresh fixture loaded." },
        { actor: "model", text: "Inspect the target state." },
        { actor: "tool", text: "Target state returned." },
        { actor: "model", text: "Apply the requested mutation." },
        { actor: "tool", text: "Mutation committed." },
        { actor: "scorer", text: "All environment checks passed." },
      ]
    : [
        { actor: "system", text: "Fresh fixture loaded." },
        { actor: "model", text: finalMessage },
        { actor: "scorer", text: `Environment checks failed: ${category}.` },
      ];
  const latencyMs = 620 + ((index * 173) % 1200);
  return {
    id: `TR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    runId,
    taskId,
    taskName,
    model,
    status: passed ? "Passed" : "Failed",
    category,
    steps: trace.length,
    inputTokens: 180 + (index % 5) * 31,
    outputTokens: 74 + (index % 4) * 19,
    costMicros: 0,
    latencyMs,
    trace,
    beforeState: fixture,
    afterState,
    checks,
    finalMessage,
    createdAt: new Date().toISOString(),
  };
}

async function seedInitialRun(db: D1) {
  const tasks = await db.prepare("SELECT * FROM tasks ORDER BY name").all<Record<string, unknown>>();
  const runId = "RUN-001";
  const model = "OutcomeTrace Reference Agent";
  const generated = tasks.results.flatMap((task, taskIndex) =>
    Array.from({ length: 5 }, (_, index) => buildReferenceTrial(task, runId, taskIndex * 5 + index + 1, model)),
  );
  const now = new Date().toISOString();
  const successCount = generated.filter((trial) => trial.status === "Passed").length;
  const latencyMs = generated.reduce((sum, trial) => sum + trial.latencyMs, 0);
  await db.batch([
    db.prepare(`INSERT INTO runs
      (id, name, status, task_ids_json, models_json, prompt_variant, trials_per_cell, temperature, budget_cap_cents, baseline_run_id, total_trials, completed_trials, success_count, cost_micros, latency_ms, created_at, completed_at)
      VALUES (?, ?, 'completed', ?, ?, 'reference-v1', 5, 0, 1000, NULL, ?, ?, ?, 0, ?, ?, ?)`)
      .bind(runId, "Reference agent smoke test", JSON.stringify(tasks.results.map((task) => task.id)), JSON.stringify([model]), generated.length, generated.length, successCount, latencyMs, now, now),
    ...generated.map((trial) => trialInsert(db, trial)),
  ]);
}

async function seedCandidateRun(db: D1) {
  const existing = await db.prepare("SELECT id FROM runs WHERE id = 'RUN-CANDIDATE-DEMO'").first();
  if (existing) return;
  const task = await db.prepare("SELECT * FROM tasks WHERE task_key = 'candidate-comparison' ORDER BY version DESC LIMIT 1").first<Record<string, unknown>>();
  if (!task) return;
  const runId = "RUN-CANDIDATE-DEMO";
  const model = "OutcomeTrace Reference Agent";
  const generated = Array.from({ length: 12 }, (_, index) => buildReferenceTrial(task, runId, index + 1, model));
  const now = new Date().toISOString();
  const successCount = generated.filter((trial) => trial.status === "Passed").length;
  const latencyMs = generated.reduce((sum, trial) => sum + trial.latencyMs, 0);
  await db.batch([
    db.prepare(`INSERT INTO runs
      (id, name, status, task_ids_json, models_json, prompt_variant, trials_per_cell, temperature, budget_cap_cents, baseline_run_id, total_trials, completed_trials, success_count, cost_micros, latency_ms, created_at, completed_at)
      VALUES (?, ?, 'completed', ?, ?, 'candidate-ranking-v1', 12, 0, 1000, NULL, ?, ?, ?, 0, ?, ?, ?)`)
      .bind(runId, "Candidate ranking benchmark", JSON.stringify([String(task.id)]), JSON.stringify([model]), generated.length, generated.length, successCount, latencyMs, now, now),
    ...generated.map((trial) => trialInsert(db, trial)),
  ]);
}

export function trialInsert(db: D1, trial: ReturnType<typeof buildReferenceTrial>) {
  return db.prepare(`INSERT INTO trials
    (id, run_id, task_id, task_name, model, status, category, steps, input_tokens, output_tokens, cost_micros, latency_ms, trace_json, before_state_json, after_state_json, checks_json, final_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(trial.id, trial.runId, trial.taskId, trial.taskName, trial.model, trial.status, trial.category, trial.steps, trial.inputTokens, trial.outputTokens, trial.costMicros, trial.latencyMs, JSON.stringify(trial.trace), JSON.stringify(trial.beforeState), JSON.stringify(trial.afterState), JSON.stringify(trial.checks), trial.finalMessage, trial.createdAt);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}
