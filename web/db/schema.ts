import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    taskKey: text("task_key").notNull(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    toolsJson: text("tools_json").notNull(),
    fixtureJson: text("fixture_json").notNull(),
    maxSteps: integer("max_steps").notNull(),
    assertionsJson: text("assertions_json").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("tasks_key_version_idx").on(table.taskKey, table.version)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    taskIdsJson: text("task_ids_json").notNull(),
    modelsJson: text("models_json").notNull(),
    promptVariant: text("prompt_variant").notNull(),
    trialsPerCell: integer("trials_per_cell").notNull(),
    temperature: real("temperature").notNull(),
    budgetCapCents: integer("budget_cap_cents").notNull(),
    baselineRunId: text("baseline_run_id"),
    totalTrials: integer("total_trials").notNull(),
    completedTrials: integer("completed_trials").notNull(),
    successCount: integer("success_count").notNull(),
    costMicros: integer("cost_micros").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("runs_created_at_idx").on(table.createdAt)],
);

export const trials = sqliteTable(
  "trials",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    taskId: text("task_id").notNull(),
    taskName: text("task_name").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    category: text("category").notNull(),
    steps: integer("steps").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costMicros: integer("cost_micros").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    traceJson: text("trace_json").notNull(),
    beforeStateJson: text("before_state_json").notNull(),
    afterStateJson: text("after_state_json").notNull(),
    checksJson: text("checks_json").notNull(),
    finalMessage: text("final_message").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("trials_run_id_idx").on(table.runId),
    index("trials_status_idx").on(table.status),
  ],
);

export const workspaceSettings = sqliteTable("workspace_settings", {
  id: text("id").primaryKey(),
  defaultN: integer("default_n").notNull(),
  defaultTemperature: real("default_temperature").notNull(),
  budgetWarningCents: integer("budget_warning_cents").notNull(),
  retentionDays: integer("retention_days").notNull(),
  enabledModelsJson: text("enabled_models_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});
