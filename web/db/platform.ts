export type PlatformStore = {
  tasks: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  trials: Record<string, unknown>[];
  settings: Record<string, unknown>;
};

type CompletedRun = {
  id: string;
  name: string;
  taskIds: string[];
  models: string[];
  promptVariant: string;
  trialsPerCell: number;
  temperature: number;
  budgetCapCents: number;
  baselineRunId: string | null;
  createdAt: string;
};

const platformGlobal = globalThis as typeof globalThis & {
  outcomeTracePlatformStore?: PlatformStore;
};

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

export function getPlatformStore(): PlatformStore {
  platformGlobal.outcomeTracePlatformStore ??= createPlatformStore();
  return platformGlobal.outcomeTracePlatformStore;
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

function taskStorageRow(task: (typeof defaultTasks)[number], createdAt: string) {
  return {
    id: task.id,
    task_key: task.taskKey,
    name: task.name,
    prompt: task.prompt,
    tools_json: JSON.stringify(task.tools),
    fixture_json: JSON.stringify(task.fixture),
    max_steps: task.maxSteps,
    assertions_json: JSON.stringify(task.assertions),
    version: 1,
    created_at: createdAt,
  } satisfies Record<string, unknown>;
}

function trialStorageRow(trialValue: unknown) {
  const trial = trialValue as Record<string, unknown>;
  return {
    id: trial.id,
    run_id: trial.runId,
    task_id: trial.taskId,
    task_name: trial.taskName,
    model: trial.model,
    status: trial.status,
    category: trial.category,
    steps: trial.steps,
    input_tokens: trial.inputTokens,
    output_tokens: trial.outputTokens,
    cost_micros: trial.costMicros,
    latency_ms: trial.latencyMs,
    trace_json: JSON.stringify(trial.trace),
    before_state_json: JSON.stringify(trial.beforeState),
    after_state_json: JSON.stringify(trial.afterState),
    checks_json: JSON.stringify(trial.checks),
    final_message: trial.finalMessage,
    created_at: trial.createdAt,
  } satisfies Record<string, unknown>;
}

function runStorageRow(run: CompletedRun, trials: unknown[]) {
  const rows = trials as Array<Record<string, unknown>>;
  return {
    id: run.id,
    name: run.name,
    status: "completed",
    task_ids_json: JSON.stringify(run.taskIds),
    models_json: JSON.stringify(run.models),
    prompt_variant: run.promptVariant,
    trials_per_cell: run.trialsPerCell,
    temperature: run.temperature,
    budget_cap_cents: run.budgetCapCents,
    baseline_run_id: run.baselineRunId,
    total_trials: rows.length,
    completed_trials: rows.length,
    success_count: rows.filter((trial) => trial.status === "Passed").length,
    cost_micros: rows.reduce((sum, trial) => sum + Number(trial.costMicros ?? 0), 0),
    latency_ms: rows.reduce((sum, trial) => sum + Number(trial.latencyMs ?? 0), 0),
    created_at: run.createdAt,
    completed_at: run.createdAt,
  } satisfies Record<string, unknown>;
}

function createPlatformStore(): PlatformStore {
  const createdAt = "2026-08-02T22:20:27.291Z";
  const tasks = defaultTasks.map((task) => taskStorageRow(task, createdAt));
  const model = "OutcomeTrace Reference Agent";
  const initialTrials = tasks.flatMap((task, taskIndex) =>
    Array.from({ length: 5 }, (_, index) => buildReferenceTrial(task, "RUN-001", taskIndex * 5 + index + 1, model)),
  );
  const candidateTask = tasks.find((task) => task.task_key === "candidate-comparison")!;
  const candidateTrials = Array.from(
    { length: 12 },
    (_, index) => buildReferenceTrial(candidateTask, "RUN-CANDIDATE-DEMO", index + 1, model),
  );
  const initialRun: CompletedRun = {
    id: "RUN-001",
    name: "Reference agent smoke test",
    taskIds: tasks.map((task) => String(task.id)),
    models: [model],
    promptVariant: "reference-v1",
    trialsPerCell: 5,
    temperature: 0,
    budgetCapCents: 1000,
    baselineRunId: null,
    createdAt,
  };
  const candidateRun: CompletedRun = {
    id: "RUN-CANDIDATE-DEMO",
    name: "Candidate ranking benchmark",
    taskIds: [String(candidateTask.id)],
    models: [model],
    promptVariant: "candidate-ranking-v1",
    trialsPerCell: 12,
    temperature: 0,
    budgetCapCents: 1000,
    baselineRunId: null,
    createdAt: "2026-08-03T01:44:29.245Z",
  };
  return {
    tasks,
    runs: [runStorageRow(candidateRun, candidateTrials), runStorageRow(initialRun, initialTrials)],
    trials: [...initialTrials, ...candidateTrials].map(trialStorageRow),
    settings: {
      id: "default",
      default_n: 10,
      default_temperature: 0,
      budget_warning_cents: 1000,
      retention_days: 90,
      enabled_models_json: JSON.stringify([model]),
      updated_at: createdAt,
    },
  };
}

export function latestTaskRows(store: PlatformStore) {
  const latest = new Map<string, Record<string, unknown>>();
  for (const task of store.tasks) {
    const key = String(task.task_key);
    if (!latest.has(key) || Number(task.version) > Number(latest.get(key)?.version)) latest.set(key, task);
  }
  return [...latest.values()].sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export function saveTaskVersion(
  store: PlatformStore,
  task: { name: string; prompt: string; taskKey: string; tools: unknown; fixture: unknown; maxSteps: number; assertions: unknown },
) {
  const version = Math.max(
    0,
    ...store.tasks.filter((row) => row.task_key === task.taskKey).map((row) => Number(row.version)),
  ) + 1;
  store.tasks.push({
    id: `task-${task.taskKey}-v${version}-${crypto.randomUUID().slice(0, 6)}`,
    task_key: task.taskKey,
    name: task.name,
    prompt: task.prompt,
    tools_json: JSON.stringify(task.tools),
    fixture_json: JSON.stringify(task.fixture),
    max_steps: task.maxSteps,
    assertions_json: JSON.stringify(task.assertions),
    version,
    created_at: new Date().toISOString(),
  });
}

export function saveWorkspaceSettings(store: PlatformStore, settings: Record<string, unknown>) {
  store.settings = {
    id: "default",
    default_n: Number(settings.defaultN) || 10,
    default_temperature: Number(settings.defaultTemperature) || 0,
    budget_warning_cents: Number(settings.budgetWarningCents) || 1000,
    retention_days: Number(settings.retentionDays) || 90,
    enabled_models_json: JSON.stringify(settings.enabledModels ?? ["OutcomeTrace Reference Agent"]),
    updated_at: new Date().toISOString(),
  };
}

export function saveCompletedRun(store: PlatformStore, run: CompletedRun, trials: unknown[]) {
  store.runs.unshift(runStorageRow(run, trials));
  store.trials.push(...trials.map(trialStorageRow));
}

export function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}
