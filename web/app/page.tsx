"use client";

import { useEffect, useMemo, useState } from "react";

type Screen = "results" | "trial" | "tasks" | "new-run" | "compare" | "settings";
type TrialStatus = "Passed" | "Failed";
type Check = { name: string; passed: boolean; detail: string };
type TraceStep = { actor: string; text: string };
type Trial = {
  id: string;
  runId: string;
  taskId: string;
  status: TrialStatus;
  task: string;
  model: string;
  category: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
  trace: TraceStep[];
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  checks: Check[];
  finalMessage: string;
  createdAt: string;
};
type Task = { id: string; taskKey: string; name: string; prompt: string; tools: string[]; fixture: Record<string, unknown>; maxSteps: number; assertions: string[]; version: number; createdAt: string };
type Run = { id: string; name: string; status: string; taskIds: string[]; models: string[]; promptVariant: string; trialsPerCell: number; temperature: number; budgetCapCents: number; baselineRunId: string | null; totalTrials: number; completedTrials: number; successCount: number; costMicros: number; latencyMs: number; createdAt: string; completedAt: string };
type SettingsData = { defaultN: number; defaultTemperature: number; budgetWarningCents: number; retentionDays: number; enabledModels: string[] };
type PlatformData = { tasks: Task[]; runs: Run[]; trials: Trial[]; comparisonTrials: Trial[]; settings: SettingsData; providers: { anthropic: boolean; openai: boolean; gemini: boolean; referenceAgent: boolean } };
type ResumeUpload = {
  label: string;
  name: string;
  mediaType: "application/pdf" | "text/plain";
  data: string;
  size: number;
};

const MAX_RESUME_BYTES = 4 * 1024 * 1024;

async function readResume(file: File, label: string): Promise<ResumeUpload> {
  if (file.size > MAX_RESUME_BYTES) throw new Error(`${file.name} is larger than 4 MB`);
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "pdf" && extension !== "txt" && extension !== "md") {
    throw new Error("Upload a PDF, TXT, or Markdown resume");
  }

  if (extension === "pdf") {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
    return { label, name: file.name, mediaType: "application/pdf", data: dataUrl.split(",")[1] ?? "", size: file.size };
  }

  return { label, name: file.name, mediaType: "text/plain", data: await file.text(), size: file.size };
}

const navItems: Array<{ id: Screen; label: string; icon: string; group: string }> = [
  { id: "new-run", label: "New test", icon: "+", group: "Inputs" },
  { id: "tasks", label: "Test setup", icon: "T", group: "Inputs" },
  { id: "settings", label: "Settings", icon: "S", group: "Inputs" },
  { id: "results", label: "Results", icon: "R", group: "Outputs" },
  { id: "compare", label: "Compare", icon: "C", group: "Outputs" },
];

export default function Home() {
  const [screen, setScreen] = useState<Screen>("new-run");
  const [statusFilter, setStatusFilter] = useState<"All" | TrialStatus>("All");
  const [selectedTrial, setSelectedTrial] = useState<Trial | null>(null);
  const [connection, setConnection] = useState<"checking" | "ready" | "missing">("checking");
  const [platform, setPlatform] = useState<PlatformData | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const response = await fetch("/api/platform", { cache: "no-store" });
      const data = await response.json() as PlatformData & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load the platform");
      setPlatform(data);
      setConnection(data.providers.anthropic || data.providers.openai || data.providers.gemini ? "ready" : "missing");
      setSelectedTrial((current) => current && data.comparisonTrials.some((trial) => trial.id === current.id) ? current : data.trials[0] ?? null);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the platform");
      setConnection("missing");
    }
  }

  async function mutate(body: Record<string, unknown>) {
    const response = await fetch("/api/platform", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as PlatformData & { error?: string };
    if (!response.ok) throw new Error(data.error || "Operation failed");
    setPlatform(data);
    setSelectedTrial(data.trials[0] ?? null);
    return data;
  }

  const visibleTrials = useMemo(
    () => statusFilter === "All" ? (platform?.trials ?? []) : (platform?.trials ?? []).filter((trial) => trial.status === statusFilter),
    [statusFilter, platform],
  );

  function navigate(next: Screen) {
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTrial(trial: Trial) {
    setSelectedTrial(trial);
    navigate("trial");
  }

  return (
    <div className="app-shell">
      <Sidebar screen={screen} navigate={navigate} connection={connection} />
      <main className="workspace">
        <Topbar screen={screen} />
        <div className="page-canvas">
          {!platform && !loadError && <div className="loading-state"><span className="loading-spinner" /><h2>Loading the evaluation workspace…</h2><p>Opening the persistent task and run store.</p></div>}
          {!platform && loadError && <div className="loading-state"><h2>Could not open the workspace</h2><p>{loadError}</p><button className="primary-button" onClick={refresh}>Try again</button></div>}
          {platform && <>
          {screen === "results" && (
            <RunResults
              run={platform.runs[0]}
              trials={platform.trials}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              visibleTrials={visibleTrials}
              openTrial={openTrial}
              navigate={navigate}
            />
          )}
          {screen === "trial" && selectedTrial && <TrialDetail trial={selectedTrial} navigate={navigate} />}
          {screen === "tasks" && <TaskLibrary tasks={platform.tasks.filter((task) => task.taskKey === "candidate-comparison")} saveTask={mutate} />}
          {screen === "new-run" && <NewRun tasks={platform.tasks.filter((task) => task.taskKey === "candidate-comparison")} runs={platform.runs} settings={platform.settings} providers={platform.providers} launchRun={mutate} navigate={navigate} />}
          {screen === "compare" && <CompareRuns runs={platform.runs} trials={platform.comparisonTrials} openTrial={openTrial} />}
          {screen === "settings" && <Settings providers={platform.providers} settings={platform.settings} saveSettings={mutate} />}
          </>}
        </div>
      </main>
    </div>
  );
}

function Sidebar({
  screen,
  navigate,
  connection,
}: {
  screen: Screen;
  navigate: (screen: Screen) => void;
  connection: "checking" | "ready" | "missing";
}) {
  const groups = ["Inputs", "Outputs"];
  return (
    <aside className="sidebar">
      <button className="logo" onClick={() => navigate("results")} aria-label="Agent evaluation reliability results">
        <span>AE</span>
        <strong>Agent Reliability</strong>
      </button>

      <button className="new-run-cta" onClick={() => navigate("new-run")}>+ Start a test</button>

      <nav aria-label="Product navigation">
        {groups.map((group) => (
          <div className="nav-group" key={group}>
            <p>{group}</p>
            {navItems.filter((item) => item.group === group).map((item) => (
              <button
                key={item.id}
                className={screen === item.id || (screen === "trial" && item.id === "results") ? "active" : ""}
                onClick={() => navigate(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className={`api-status ${connection}`}><i /><span>{connection === "ready" ? "Live model connected" : connection === "checking" ? "Checking providers" : "Provider keys optional"}</span></div>
        <a href="https://github.com/raamnandhakumar-eng/OutcomeTrace-AI-Agent-Evaluation-and-Reliability-Platform" target="_blank" rel="noreferrer">GitHub repository ↗</a>
      </div>
    </aside>
  );
}

function Topbar({ screen }: { screen: Screen }) {
  const labels: Record<Screen, string> = {
    results: "Results",
    trial: "Trial detail",
    tasks: "Test setup",
    "new-run": "New test",
    compare: "Compare",
    settings: "Settings",
  };
  return (
    <header className="topbar">
      <div><span>Agent Evaluation Platform</span><b>/</b><strong>{labels[screen]}</strong></div>
      <div className="topbar-right"><span className="live-pill"><i /> System healthy</span><button className="avatar" aria-label="Account menu">RN</button></div>
    </header>
  );
}

function RunResults({
  run,
  trials,
  statusFilter,
  setStatusFilter,
  visibleTrials,
  openTrial,
  navigate,
}: {
  run: Run;
  trials: Trial[];
  statusFilter: "All" | TrialStatus;
  setStatusFilter: (value: "All" | TrialStatus) => void;
  visibleTrials: Trial[];
  openTrial: (trial: Trial) => void;
  navigate: (screen: Screen) => void;
}) {
  const total = trials.length;
  const passed = trials.filter((trial) => trial.status === "Passed").length;
  const rate = total ? passed / total : 0;
  const [ciLow, ciHigh] = wilsonInterval(passed, total);
  const avgLatency = total ? trials.reduce((sum, trial) => sum + trial.latencyMs, 0) / total : 0;
  const totalCost = trials.reduce((sum, trial) => sum + trial.costMicros, 0);
  const models = Array.from(new Set(trials.map((trial) => trial.model)));
  const tasks = Array.from(new Set(trials.map((trial) => trial.task)));
  const hallucinations = trials.filter((trial) => trial.category.startsWith("hallucinated"));
  const modelRows = models.map((model) => {
    const cell = trials.filter((trial) => trial.model === model);
    const successes = cell.filter((trial) => trial.status === "Passed").length;
    const hallucinated = cell.filter((trial) => trial.category.startsWith("hallucinated")).length;
    return {
      model,
      trials: cell.length,
      successRate: cell.length ? 100 * successes / cell.length : 0,
      hallucinationRate: cell.length ? 100 * hallucinated / cell.length : 0,
      latency: cell.length ? cell.reduce((sum, trial) => sum + trial.latencyMs, 0) / cell.length : 0,
      cost: cell.length ? cell.reduce((sum, trial) => sum + trial.costMicros, 0) / cell.length : 0,
    };
  }).sort((a, b) => b.successRate - a.successRate || a.hallucinationRate - b.hallucinationRate);
  const failures = trials.filter((trial) => trial.status === "Failed");
  const errors = Array.from(new Set(failures.map((trial) => trial.category))).map((category) => ({ category, count: failures.filter((trial) => trial.category === category).length })).sort((a, b) => b.count - a.count);
  const maxError = Math.max(1, ...errors.map((error) => error.count));
  return (
    <section className="screen results-screen">
      <div className="page-heading">
        <div>
          <button className="eyebrow-button">{run.id} · {run.status.toUpperCase()}</button>
          <h1>{run.name}</h1>
          <p>{total} stored trials across {tasks.length} task and {models.length} {models.length === 1 ? "model" : "models"}. Finished {new Date(run.completedAt || run.createdAt).toLocaleString()}.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={() => navigate("compare")}>Compare to baseline</button>
          <button className="primary-button" onClick={() => navigate("new-run")}>Run again</button>
        </div>
      </div>

      <div className="metric-grid">
        <article className="metric-card hero-metric">
          <div className="metric-top"><span>Overall success</span><span className="metric-trend neutral">Outcome-scored</span></div>
          <div className="metric-main"><strong>{(rate * 100).toFixed(1)}%</strong><MiniBars /></div>
          <p>95% Wilson CI <b>{(ciLow * 100).toFixed(1)}–{(ciHigh * 100).toFixed(1)}%</b></p>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>Average cost</span><span className="metric-trend up">Recorded</span></div>
          <strong>{formatCost(total ? totalCost / total : 0)}</strong><p>per trial · {formatCost(totalCost)} total</p>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>Average latency</span><span className="metric-trend neutral">Server measured</span></div>
          <strong>{formatLatency(avgLatency)}</strong><p>{trials.reduce((max, trial) => Math.max(max, trial.steps), 0)} max steps observed</p>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>Hallucination rate</span><span className={`metric-trend ${hallucinations.length ? "down" : "up"}`}>Grounded scorer</span></div>
          <strong>{total ? (100 * hallucinations.length / total).toFixed(1) : "0.0"}%</strong><p>{hallucinations.length} unsupported or false claims</p>
        </article>
      </div>

      <article className="panel model-comparison-panel">
        <PanelTitle title="LLM reliability comparison" detail="Same candidate sandbox, same prompt, same programmatic scorer" />
        <div className="table-wrap">
          <table className="model-comparison-table">
            <thead><tr><th>Model</th><th>Success</th><th>Hallucinations</th><th>Avg latency</th><th>Avg cost</th><th>Trials</th></tr></thead>
            <tbody>{modelRows.map((row, index) => <tr key={row.model}><th><span className="rank-number">{index + 1}</span>{row.model}</th><td><strong className="green-text">{row.successRate.toFixed(1)}%</strong></td><td><span className={row.hallucinationRate ? "hallucination-value" : "clean-value"}>{row.hallucinationRate.toFixed(1)}%</span></td><td>{formatLatency(row.latency)}</td><td>{formatCost(row.cost)}</td><td>{row.trials}</td></tr>)}</tbody>
          </table>
        </div>
      </article>

      <div className="analysis-grid">
        <article className="panel matrix-panel">
          <PanelTitle title="Task × model performance" detail="Success rate from persisted trial outcomes" />
          <div className="table-wrap">
            <table className="matrix-table">
              <thead><tr><th>Task</th>{models.map((model) => <th key={model}>{model}</th>)}</tr></thead>
              <tbody>{tasks.map((task) => <MatrixRow key={task} task={task} values={models.map((model) => { const cell = trials.filter((trial) => trial.task === task && trial.model === model); return cell.length ? Math.round(100 * cell.filter((trial) => trial.status === "Passed").length / cell.length) : 0; })} />)}</tbody>
            </table>
          </div>
          <div className="matrix-legend"><span>Lower</span><i /><i /><i /><i /><span>Higher success</span></div>
        </article>

        <article className="panel errors-panel">
          <PanelTitle title="Why trials failed" detail={`${failures.length} failed trials`} />
          <div className="error-total"><strong>{failures.length}</strong><span>failures</span></div>
          <div className="error-bars">
            {errors.map((error, index) => <ErrorBar key={error.category} label={humanize(error.category)} count={error.count} width={error.count / maxError * 100} tone={["red", "orange", "purple", "blue", "gray"][index % 5]} />)}
            {!errors.length && <p className="empty-note">No failures in this run.</p>}
          </div>
        </article>
      </div>

      <article className="panel trials-panel">
        <div className="trial-panel-head">
          <PanelTitle title="Individual trials" detail="Open a failure to inspect the trace and final environment" />
          <div className="filter-group" aria-label="Filter trials by status">
            {(["All", "Failed", "Passed"] as const).map((filter) => (
              <button key={filter} className={statusFilter === filter ? "active" : ""} onClick={() => setStatusFilter(filter)}>{filter}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="trials-table">
            <thead><tr><th>Trial</th><th>Task</th><th>Model</th><th>Result</th><th>Error category</th><th>Steps</th><th>Latency</th><th>Cost</th></tr></thead>
            <tbody>
              {visibleTrials.map((trial) => (
                <tr key={trial.id} className={trial.status === "Failed" ? "failed-row" : ""}>
                  <td><button className="trial-link" onClick={() => openTrial(trial)}>{trial.id} <span>↗</span></button></td>
                  <td>{trial.task}</td><td>{trial.model}</td>
                  <td><Status status={trial.status} /></td>
                  <td><span className={trial.status === "Failed" ? "error-label" : "verified-label"}>{humanize(trial.category)}</span></td>
                  <td>{trial.steps}</td><td>{formatLatency(trial.latencyMs)}</td><td>{formatCost(trial.costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot"><span>Showing {visibleTrials.length} of {total} trials</span><div><b>Live data</b></div></div>
      </article>
    </section>
  );
}

function TrialDetail({ trial, navigate }: { trial: Trial; navigate: (screen: Screen) => void }) {
  const failed = trial.status === "Failed";
  return (
    <section className="screen trial-screen">
      <button className="back-button" onClick={() => navigate("results")}>← Back to run results</button>
      <div className="page-heading trial-heading">
        <div><div className="trial-id-line"><code>{trial.id}</code><Status status={trial.status} /></div><h1>{failed ? humanize(trial.category) : "Verified agent outcome"}</h1><p>{trial.task} · {trial.model} · {new Date(trial.createdAt).toLocaleString()}</p></div>
        <button className="secondary-button" onClick={() => downloadTrial(trial)}>Export trace</button>
      </div>

      <div className="trial-summary-strip">
        <div><span>Result</span><strong className={failed ? "red-text" : "green-text"}>{trial.status}</strong></div>
        <div><span>Steps</span><strong>{trial.steps} / 10</strong></div>
        <div><span>Tokens</span><strong>{trial.inputTokens.toLocaleString()} in · {trial.outputTokens.toLocaleString()} out</strong></div>
        <div><span>Latency</span><strong>{formatLatency(trial.latencyMs)}</strong></div>
        <div><span>Cost</span><strong>{formatCost(trial.costMicros)}</strong></div>
      </div>

      <div className="trace-layout">
        <div className="trace-main">
          <article className="panel trace-panel">
            <PanelTitle title="Agent trace" detail="Every model message, tool call, and tool result" />
            <div className="trace-timeline">
              {trial.trace.map((event, index) => <TraceEvent key={`${event.actor}-${index}`} number={String(index + 1).padStart(2, "0")} type={humanize(event.actor)} meta={event.actor === "scorer" ? "environment check" : "recorded step"} text={event.text} danger={event.actor === "scorer" && failed} code={event.actor === "tool"} />)}
            </div>
          </article>

          <article className="panel environment-panel">
            <PanelTitle title="Environment before vs. after" detail="The transcript can make a claim. The database must prove it." />
            <div className="env-columns">
              <div className="environment-snapshot"><div><strong>Before</strong><span>Seeded state</span></div><pre>{JSON.stringify(trial.beforeState, null, 2)}</pre></div>
              <div className="env-arrow">→</div>
              <div className={`environment-snapshot ${failed ? "alert" : ""}`}><div><strong>After</strong><span>{JSON.stringify(trial.beforeState) === JSON.stringify(trial.afterState) ? "Unchanged" : "Mutated"}</span></div><pre>{JSON.stringify(trial.afterState, null, 2)}</pre>{failed && <p>At least one expected assertion was not satisfied.</p>}</div>
            </div>
          </article>

          <article className="panel expected-panel">
            <PanelTitle title="Expected vs. actual final state" detail="Ground truth, not model wording" />
            <div className="expected-grid"><div><span>Expected assertions</span><pre>{trial.checks.map((check) => check.name).join("\n")}</pre></div><div className={failed ? "actual-failed" : ""}><span>Actual verdicts</span><pre>{trial.checks.map((check) => `${check.passed ? "PASS" : "FAIL"}  ${check.name}\n      ${check.detail}`).join("\n")}</pre></div></div>
          </article>
        </div>

        <aside className="evaluation-aside">
          <article className="panel verdict-card">
            <span className="aside-label">Outcome verdict</span>
            <div className={`verdict-icon ${failed ? "fail" : "pass"}`}>{failed ? "×" : "✓"}</div>
            <h2>{trial.checks.filter((check) => check.passed).length} of {trial.checks.length} checks passed</h2>
            <p>{failed ? "The agent said done. The environment did not change." : "The final database state matches every assertion."}</p>
            {failed && <div className="taxonomy-callout"><span>Error category</span><strong>{humanize(trial.category)}</strong></div>}
          </article>
          <article className="panel assertion-card">
            <span className="aside-label">Assertions</span>
            {trial.checks.map((check) => <Assertion key={check.name} label={check.name} passed={check.passed} detail={check.detail} />)}
          </article>
        </aside>
      </div>
    </section>
  );
}

function TaskLibrary({ tasks, saveTask }: { tasks: Task[]; saveTask: (body: Record<string, unknown>) => Promise<PlatformData> }) {
  const first = tasks[0];
  const [activeId, setActiveId] = useState(first?.id ?? "new");
  const [name, setName] = useState(first?.name ?? "");
  const [prompt, setPrompt] = useState(first?.prompt ?? "");
  const [maxSteps, setMaxSteps] = useState(first?.maxSteps ?? 10);
  const [toolsText, setToolsText] = useState((first?.tools ?? []).join("\n"));
  const [fixtureText, setFixtureText] = useState(JSON.stringify(first?.fixture ?? {}, null, 2));
  const [assertionsText, setAssertionsText] = useState((first?.assertions ?? []).join("\n"));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeTask = tasks.find((task) => task.id === activeId);

  function loadTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    setActiveId(task.id); setName(task.name); setPrompt(task.prompt); setMaxSteps(task.maxSteps);
    setToolsText(task.tools.join("\n")); setFixtureText(JSON.stringify(task.fixture, null, 2)); setAssertionsText(task.assertions.join("\n"));
    setSaved(false); setError("");
  }

  async function persistTask() {
    setSaving(true); setError("");
    try {
      const fixture = JSON.parse(fixtureText) as Record<string, unknown>;
      const data = await saveTask({ action: "save_task", task: { taskKey: activeTask?.taskKey, name, prompt, maxSteps, tools: toolsText.split("\n").map((item) => item.trim()).filter(Boolean), fixture, assertions: assertionsText.split("\n").map((item) => item.trim()).filter(Boolean) } });
      const savedTask = data.tasks.find((task) => task.name === name);
      if (savedTask) setActiveId(savedTask.id);
      setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save task"); }
    finally { setSaving(false); }
  }

  return (
    <section className="screen task-screen">
      <div className="page-heading">
        <div><span className="page-kicker">AGENT EVALUATION + RELIABILITY</span><h1>Define the candidate-review task</h1><p>Set the job requirements, candidate data, allowed tools, and checks that prove the agent ranked them correctly.</p></div>
      </div>
      <div className="task-layout">
        <aside className="panel task-index">
          <div className="task-search"><input aria-label="Search tasks" placeholder="Search tasks" /><span>⌕</span></div>
          <div className="task-index-list">
            {tasks.map((task) => (
              <button key={task.id} className={activeId === task.id ? "active" : ""} onClick={() => loadTask(task.id)}>
                <div><strong>{task.name}</strong><span>v{task.version} · {new Date(task.createdAt).toLocaleDateString()}</span></div>
                <small>{task.assertions.length} checks</small>
              </button>
            ))}
          </div>
          <div className="task-index-foot"><span>Candidate agent test</span><strong>Ready</strong></div>
        </aside>

        <div className="task-editor">
          <article className="panel editor-panel">
            <div className="editor-title"><div><span>{activeId === "new" ? "DRAFT" : "TASK DEFINITION"}</span><h2>{activeId === "new" ? "Create a task" : activeTask?.name}</h2></div><div className="version-pill">{activeId === "new" ? "Unsaved" : `Version ${activeTask?.version}`}</div></div>
            <div className="form-grid">
              <label className="form-field full"><span>Task name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name this task" /></label>
              <label className="form-field full"><span>Goal prompt</span><textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should the agent accomplish?" /></label>
              <label className="form-field full"><span>Allowed tools · one per line</span><textarea className="code-input" rows={4} value={toolsText} onChange={(event) => setToolsText(event.target.value)} placeholder="orders_get\nrefunds_create" /></label>
              <label className="form-field"><span>Maximum steps</span><input type="number" min="1" max="50" value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))} /></label>
              <label className="form-field"><span>Fixture format</span><select defaultValue="json"><option value="json">JSON fixture</option><option value="sql">SQLite seed</option></select></label>
              <label className="form-field full"><span>Environment fixture</span><textarea className="code-input" rows={8} value={fixtureText} onChange={(event) => setFixtureText(event.target.value)} /></label>
              <label className="form-field full"><span>Success criteria · one scorer key per line</span><textarea className="code-input" rows={6} value={assertionsText} onChange={(event) => setAssertionsText(event.target.value)} /></label>
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="editor-actions"><span>{saved ? "✓ Saved as a new persistent version" : "Changes create a new immutable task version"}</span><div><button className="secondary-button" onClick={() => { try { JSON.parse(fixtureText); setError(""); } catch { setError("Fixture must be valid JSON"); } }}>Validate fixture</button><button className="primary-button" onClick={persistTask} disabled={!name || !prompt || saving}>{saving ? "Saving…" : "Save task"}</button></div></div>
          </article>

          <article className="panel fixture-preview">
            <PanelTitle title="Initial-state preview" detail="What every trial receives before the agent starts" />
            <div className="fixture-stats"><div><span>Tools</span><strong>{toolsText.split("\n").filter(Boolean).length}</strong></div><div><span>Assertions</span><strong>{assertionsText.split("\n").filter(Boolean).length}</strong></div><div><span>Storage</span><strong className="green-text">D1</strong></div></div>
            <pre>{fixtureText}</pre>
          </article>
        </div>
      </div>
    </section>
  );
}

function NewRun({ tasks, runs, settings, providers, launchRun, navigate }: { tasks: Task[]; runs: Run[]; settings: SettingsData; providers: PlatformData["providers"]; launchRun: (body: Record<string, unknown>) => Promise<PlatformData>; navigate: (screen: Screen) => void }) {
  const [mode, setMode] = useState<"saved" | "custom">("saved");
  const [selectedTasks, setSelectedTasks] = useState(tasks.map((task) => task.id));
  const [selectedModels, setSelectedModels] = useState(["OutcomeTrace Reference Agent"]);
  const [trialCount, setTrialCount] = useState(settings.defaultN);
  const [baselineRunId, setBaselineRunId] = useState(runs[0]?.id ?? "");
  const [runName, setRunName] = useState("Candidate comparison");
  const [customPrompt, setCustomPrompt] = useState("Compare all three candidates against the job requirements. Score each candidate, list matching and missing skills, explain the decision, and rank them from strongest to weakest.");
  const [customInput, setCustomInput] = useState("Paste the role, responsibilities, and required skills here.");
  const [resumeFiles, setResumeFiles] = useState<Array<ResumeUpload | null>>([null, null, null]);
  const [resumeBusy, setResumeBusy] = useState<number | null>(null);
  const [expectedResult, setExpectedResult] = useState("");
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  const comparisonModels = [
    { name: "OutcomeTrace Reference Agent", provider: "referenceAgent" as const, detail: "Built-in baseline · no API key" },
    { name: "Claude Sonnet 5", provider: "anthropic" as const, detail: "ANTHROPIC_API_KEY" },
    { name: "GPT-5.6 Terra", provider: "openai" as const, detail: "OPENAI_API_KEY" },
    { name: "Gemini 2.5 Flash", provider: "gemini" as const, detail: "GEMINI_API_KEY" },
  ];

  function toggleItem(item: string, current: string[], setter: (items: string[]) => void) {
    setter(current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  }

  const availableLiveModels = comparisonModels.filter((option) => option.provider !== "referenceAgent" && providers[option.provider]).map((option) => option.name);
  const cells = mode === "custom" ? selectedModels.length : selectedTasks.length * selectedModels.length;
  const totalTrials = cells * trialCount;
  const uploadedResumeCount = resumeFiles.filter(Boolean).length;
  const hasLiveModel = selectedModels.some((model) => model !== "OutcomeTrace Reference Agent");

  function toggleModel(model: string, available: boolean) {
    if (!available) return;
    const next = selectedModels.includes(model) ? selectedModels.filter((value) => value !== model) : [...selectedModels, model];
    setSelectedModels(next);
    if (next.some((value) => value !== "OutcomeTrace Reference Agent") && trialCount > 3) setTrialCount(3);
  }

  async function addResume(index: number, file: File | undefined) {
    if (!file) return;
    setResumeBusy(index);
    setError("");
    try {
      const upload = await readResume(file, `Candidate ${String.fromCharCode(65 + index)}`);
      setResumeFiles((current) => current.map((item, itemIndex) => itemIndex === index ? upload : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the resume");
    } finally {
      setResumeBusy(null);
    }
  }

  async function launch() {
    setRunning(true); setComplete(false); setError("");
    try {
      await launchRun(mode === "custom"
        ? { action: "launch_run", models: selectedModels, customTask: { name: runName, prompt: customPrompt, input: customInput, expectedResult, attachments: resumeFiles.filter(Boolean) }, trialCount: Math.min(3, trialCount), temperature: 0, baselineRunId: baselineRunId || null, budgetCapCents: settings.budgetWarningCents }
        : { action: "launch_run", taskIds: selectedTasks, models: selectedModels, trialCount, temperature: 0, baselineRunId: baselineRunId || null, promptVariant: "candidate-comparison-v1", budgetCapCents: settings.budgetWarningCents });
      setComplete(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not launch run"); }
    finally { setRunning(false); }
  }

  return (
    <section className="screen new-run-screen">
      <section className="product-hero">
        <div className="product-hero-copy">
          <span>AGENT RELIABILITY TESTING</span>
          <h1>Evaluate agents by what they do, not what they say.</h1>
          <p>Run the same hiring task on multiple AI models. The platform checks the actual saved ranking first, then uses the trace to explain what went wrong.</p>
          <div className="scoring-principles"><div><b>1</b><span><strong>Outcome first</strong><small>Did the final result match the expected result?</small></span></div><div><b>2</b><span><strong>Trace second</strong><small>Did the model invent facts or misuse the process?</small></span></div></div>
        </div>
        <div className="how-it-works">
          <span>HOW IT WORKS</span>
          <ol><li><b>01</b><div><strong>Add the task</strong><small>Use the example or upload three resumes.</small></div></li><li><b>02</b><div><strong>Run the models</strong><small>Claude, GPT, and Gemini get the same input.</small></div></li><li><b>03</b><div><strong>Compare results</strong><small>See accuracy, hallucinations, cost, and speed.</small></div></li></ol>
        </div>
      </section>
      <article className="model-overview" aria-label="Models available for comparison">
        <strong>Models</strong>
        <div className="model-overview-list">
          {comparisonModels.map((option) => <div key={option.name} className={providers[option.provider] ? "available" : "key-needed"}>
            <i>{providers[option.provider] ? "✓" : "○"}</i>
            <span><strong>{option.name}</strong><small>{providers[option.provider] ? "Ready" : "API key needed"}</small></span>
          </div>)}
        </div>
      </article>
      <div className="mode-picker" role="tablist" aria-label="Run type">
        <button className={mode === "saved" ? "active" : ""} onClick={() => { setMode("saved"); setSelectedModels(["OutcomeTrace Reference Agent"]); setTrialCount(settings.defaultN); }}>Use example</button>
        <button className={mode === "custom" ? "active" : ""} onClick={() => { setMode("custom"); setSelectedModels(availableLiveModels); setTrialCount(Math.min(3, settings.defaultN)); }}>Upload resumes</button>
      </div>
      <div className="run-config-layout">
        <div className="run-form-stack">
          <article className="panel config-section">
            <div className="config-number">01</div><div className="config-body"><h2>{mode === "custom" ? "Add job and resumes" : "Example task"}</h2><p>{mode === "custom" ? "Paste one job description and upload three resumes." : "Use a ready-made hiring task to see how outcome scoring works."}</p>
              {mode === "saved" ? <div className="selection-list">{tasks.map((task) => <label key={task.id} className={selectedTasks.includes(task.id) ? "selected" : ""}><input type="checkbox" checked={selectedTasks.includes(task.id)} onChange={() => toggleItem(task.id, selectedTasks, setSelectedTasks)} /><span><strong>{task.name}</strong><small>{task.assertions.length} assertions · {task.tools.length} tools · v{task.version}</small></span></label>)}</div>
              : <div className="custom-input-grid">
                  <label className="form-field full"><span>Evaluation name</span><input value={runName} onChange={(event) => setRunName(event.target.value)} placeholder="Product manager candidate comparison" /></label>
                  <label className="form-field full"><span>Evaluation instruction</span><textarea rows={5} value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} /></label>
                  <label className="form-field full"><span>Job description</span><textarea className="code-input" rows={9} value={customInput} onChange={(event) => setCustomInput(event.target.value)} /></label>
                  <div className="resume-field full">
                    <div className="resume-field-heading"><span>Candidate resumes</span><small>{uploadedResumeCount}/3 uploaded</small></div>
                    <div className="resume-upload-grid">
                      {[0, 1, 2].map((index) => {
                        const resume = resumeFiles[index];
                        const candidate = `Candidate ${String.fromCharCode(65 + index)}`;
                        return <div className={`resume-upload-card ${resume ? "ready" : ""}`} key={candidate}>
                          <span className="resume-file-icon">{resume ? "✓" : "↑"}</span>
                          <strong>{candidate}</strong>
                          <small>{resume ? resume.name : "PDF, TXT, or MD · 4 MB max"}</small>
                          <label className="resume-upload-button">
                            <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={(event) => { void addResume(index, event.target.files?.[0]); event.currentTarget.value = ""; }} />
                            {resumeBusy === index ? "Reading…" : resume ? "Replace resume" : "Choose resume"}
                          </label>
                          {resume && <button className="resume-remove" type="button" onClick={() => setResumeFiles((current) => current.map((item, itemIndex) => itemIndex === index ? null : item))}>Remove</button>}
                        </div>;
                      })}
                    </div>
                  </div>
                  <label className="form-field full"><span>Expected top candidate</span><textarea rows={3} value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} placeholder="Enter Candidate A, Candidate B, Candidate C, or the person's name" /></label>
                  <p className="input-note">Resumes are sent only to the models you select below. The uploaded files are not saved after the evaluation.</p>
                </div>}
            </div>
          </article>
          <article className="panel config-section">
            <div className="config-number">02</div><div className="config-body"><h2>Choose models</h2><p>{mode === "custom" ? "Each model gets the same job and resumes." : "Each model gets the same example and scorer."}</p><div className="model-selection">
              {mode === "custom"
                ? comparisonModels.filter((option) => option.provider !== "referenceAgent").map((option) => {
                    const available = providers[option.provider];
                    const selected = selectedModels.includes(option.name);
                    return <label key={option.name} className={`${selected ? "selected" : ""} ${available ? "" : "unavailable"}`}><input type="checkbox" checked={selected} disabled={!available} onChange={() => toggleModel(option.name, available)} /><span><strong>{option.name}</strong><small>{available ? "Connected and ready" : `Add ${option.detail} in Settings`}</small></span><i>{selected ? "✓" : available ? "+" : "!"}</i></label>;
                  })
                : comparisonModels.map((option) => {
                    const available = providers[option.provider];
                    const selected = selectedModels.includes(option.name);
                    return <label key={option.name} className={`${selected ? "selected" : ""} ${available ? "" : "unavailable"}`}><input type="checkbox" checked={selected} disabled={!available} onChange={() => toggleModel(option.name, available)} /><span><strong>{option.name}</strong><small>{available ? option.detail : `Add ${option.detail} in Settings`}</small></span><i>{selected ? "✓" : available ? "+" : "!"}</i></label>;
                  })}
            </div></div>
          </article>
          <article className="panel config-section">
            <div className="config-number">03</div><div className="config-body"><h2>Choose repeats</h2><p>More repeats give you a better reliability estimate.</p><div className="parameter-grid">
              <label className="form-field"><span>Run type</span><select value={mode === "custom" ? "custom-input-v1" : "reference-v1"} disabled><option value="reference-v1">reference-v1</option><option value="custom-input-v1">custom-input-v1</option></select></label>
              <label className="form-field"><span>Baseline run</span><select value={baselineRunId} onChange={(event) => setBaselineRunId(event.target.value)}><option value="">No baseline</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.name}</option>)}</select></label>
              <div className="form-field"><span>Trials per model</span><div className="count-picker">{(mode === "custom" ? [1,2,3] : hasLiveModel ? [1,2,3] : [5,10,20]).map((count) => <button key={count} className={trialCount === count ? "active" : ""} onClick={() => setTrialCount(count)}>{count}</button>)}</div></div>
              <label className="form-field"><span>Budget cap</span><div className="money-input"><b>$</b><input type="number" value={(settings.budgetWarningCents / 100).toFixed(2)} readOnly /></div></label>
            </div></div>
          </article>
        </div>

        <aside className="run-launch-aside">
          <article className="panel launch-card">
            <span className="aside-label">Run summary</span>
            <h2>{totalTrials} trials</h2>
            <p>{mode === "custom" ? `${selectedModels.length} ${selectedModels.length === 1 ? "model" : "models"} × ${trialCount} repeats · ${uploadedResumeCount}/3 resumes` : `${selectedModels.length} ${selectedModels.length === 1 ? "model" : "models"} × ${trialCount} repeats`}</p>
            <div className="summary-lines"><div><span>Estimated cost</span><strong>{mode === "custom" || hasLiveModel ? "Provider billed" : "$0.00"}</strong></div><div><span>Environment</span><strong>Same seed per model</strong></div><div><span>Baseline</span><strong>{baselineRunId || "None"}</strong></div></div>
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button launch-button" disabled={running || (mode === "saved" ? !selectedTasks.length || !selectedModels.length : !selectedModels.length || !customPrompt.trim() || !customInput.trim() || !expectedResult.trim() || uploadedResumeCount !== 3)} onClick={launch}>{running ? "Running input…" : mode === "custom" && !selectedModels.length ? "Connect a model to run" : mode === "custom" && uploadedResumeCount !== 3 ? "Upload three resumes" : "Launch evaluation"}</button>
          </article>
          {(running || complete) && <article className="panel live-progress"><div className="progress-title"><span>Latest run</span><strong>{running ? "Running" : "Complete"}</strong></div><div className="progress-track"><i style={{ width: running ? "55%" : "100%" }} /></div><div className="progress-numbers"><strong>{running ? "Resetting and scoring" : `${totalTrials} / ${totalTrials}`}</strong><span>{running ? "…" : "100%"}</span></div>{complete && <button className="secondary-button" onClick={() => navigate("results")}>View run results →</button>}</article>}
        </aside>
      </div>
    </section>
  );
}

function CompareRuns({ runs, trials, openTrial }: { runs: Run[]; trials: Trial[]; openTrial: (trial: Trial) => void }) {
  const candidate = runs[0];
  const baseline = runs[1];
  if (!baseline) return <section className="screen compare-screen"><div className="page-heading"><div><span className="page-kicker">REGRESSION ANALYSIS</span><h1>Run one more evaluation</h1><p>The platform needs two saved candidate-agent runs before it can calculate a reliability change.</p></div></div></section>;
  const candidateTrials = trials.filter((trial) => trial.runId === candidate.id);
  const baselineTrials = trials.filter((trial) => trial.runId === baseline.id);
  const taskNames = Array.from(new Set([...candidateTrials, ...baselineTrials].map((trial) => trial.task)));
  const rows = taskNames.map((task) => {
    const baseCell = baselineTrials.filter((trial) => trial.task === task);
    const candidateCell = candidateTrials.filter((trial) => trial.task === task);
    const base = baseCell.length ? 100 * baseCell.filter((trial) => trial.status === "Passed").length / baseCell.length : 0;
    const candidateRate = candidateCell.length ? 100 * candidateCell.filter((trial) => trial.status === "Passed").length / candidateCell.length : 0;
    const diff = candidateRate - base;
    const margin = 1.96 * Math.sqrt((base / 100 * (1 - base / 100) / Math.max(1, baseCell.length)) + (candidateRate / 100 * (1 - candidateRate / 100) / Math.max(1, candidateCell.length))) * 100;
    return { task, base, candidate: candidateRate, diff, ci: `${(diff - margin).toFixed(1)} to ${(diff + margin).toFixed(1)}`, sig: Math.abs(diff) > margin, failures: candidateCell.filter((trial) => trial.status === "Failed").length };
  });
  const baseRate = baselineTrials.length ? 100 * baselineTrials.filter((trial) => trial.status === "Passed").length / baselineTrials.length : 0;
  const candidateRate = candidateTrials.length ? 100 * candidateTrials.filter((trial) => trial.status === "Passed").length / candidateTrials.length : 0;
  const overallDiff = candidateRate - baseRate;
  const newFailures = candidateTrials.filter((trial) => trial.status === "Failed");
  return (
    <section className="screen compare-screen">
      <div className="page-heading"><div><span className="page-kicker">REGRESSION ANALYSIS</span><h1>Compare two runs</h1><p>Separate real performance changes from normal trial noise.</p></div><button className="secondary-button">Export comparison</button></div>
      <article className="panel comparison-picker">
        <label><span>Baseline</span><select value={baseline.id} disabled><option value={baseline.id}>{baseline.id} · {baseline.name}</option></select><small>{baseline.promptVariant} · {new Date(baseline.createdAt).toLocaleDateString()}</small></label>
        <div className="versus">VS</div>
        <label><span>Candidate</span><select value={candidate.id} disabled><option value={candidate.id}>{candidate.id} · {candidate.name}</option></select><small>{candidate.promptVariant} · {new Date(candidate.createdAt).toLocaleDateString()}</small></label>
        <button className="primary-button">Latest two runs</button>
      </article>
      <div className="comparison-hero">
        <article className="panel regression-verdict"><div className="regression-icon">{overallDiff < 0 ? "↓" : "↑"}</div><div><span>Overall success rate</span><h2>Performance {overallDiff < 0 ? "dropped" : "changed"} <b>{Math.abs(overallDiff).toFixed(1)} points</b></h2><p>{baseRate.toFixed(1)}% baseline → {candidateRate.toFixed(1)}% candidate · based on stored outcomes</p></div><strong>{overallDiff < 0 ? "Regression" : "No regression"}</strong></article>
        <article className="panel compare-stat"><span>Candidate failures</span><strong>{newFailures.length}</strong><p>Open any trace below</p></article>
        <article className="panel compare-stat"><span>Cost change</span><strong className="green-text">$0</strong><p>Reference executor is local</p></article>
      </div>
      <article className="panel regression-table-panel">
        <PanelTitle title="Change by task" detail="Two-proportion test with 95% confidence intervals" />
        <div className="table-wrap"><table className="regression-table"><thead><tr><th>Task</th><th>Baseline</th><th>Candidate</th><th>Change</th><th>95% CI</th><th>Significance</th><th>Failures</th></tr></thead><tbody>{rows.map((row) => <tr key={row.task} className={row.sig ? "significant-row" : ""}><th>{row.task}</th><td>{row.base.toFixed(1)}%</td><td>{row.candidate.toFixed(1)}%</td><td><span className={row.diff < 0 ? "negative-diff" : "positive-diff"}>{row.diff > 0 ? "+" : ""}{row.diff.toFixed(1)} pts</span></td><td>{row.ci}</td><td><span className={row.sig ? "significant" : "not-significant"}>{row.sig ? "Significant" : "Not significant"}</span></td><td>{row.failures ? <button onClick={() => { const found = candidateTrials.find((trial) => trial.task === row.task && trial.status === "Failed"); if (found) openTrial(found); }}>{row.failures} traces ↗</button> : "—"}</td></tr>)}</tbody></table></div>
      </article>
      <div className="comparison-bottom">
        <article className="panel new-failure-panel"><PanelTitle title="Candidate failures" detail="Open the stored trace and final environment" /><div>{newFailures.slice(0,4).map((trial) => <button key={trial.id} onClick={() => openTrial(trial)}><span><code>{trial.id}</code><strong>{trial.task}</strong></span><span><small>{humanize(trial.category)}</small>↗</span></button>)}</div></article>
        <article className="panel interpretation-card"><span>READ THIS FIRST</span><h2>{overallDiff < 0 ? "The candidate needs inspection." : "No overall drop detected."}</h2><p>These numbers come from final sandbox assertions. Open a failure to see the trace beside the actual environment mutation.</p>{newFailures[0] && <button onClick={() => openTrial(newFailures[0])}>Open representative failure →</button>}</article>
      </div>
    </section>
  );
}

function Settings({ providers, settings, saveSettings }: { providers: PlatformData["providers"]; settings: SettingsData; saveSettings: (body: Record<string, unknown>) => Promise<PlatformData> }) {
  const [defaultN, setDefaultN] = useState(settings.defaultN);
  const [budget, setBudget] = useState(settings.budgetWarningCents / 100);
  const [retention, setRetention] = useState(settings.retentionDays);
  const [models, setModels] = useState(settings.enabledModels);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function toggleModel(model: string) { setModels((current) => current.includes(model) ? current.filter((value) => value !== model) : [...current, model]); }
  async function persist() {
    setSaving(true); setError("");
    try { await saveSettings({ action: "save_settings", settings: { defaultN, defaultTemperature: 0, budgetWarningCents: Math.round(budget * 100), retentionDays: retention, enabledModels: models } }); setSaved(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save settings"); }
    finally { setSaving(false); }
  }
  return (
    <section className="screen settings-screen">
      <div className="page-heading"><div><span className="page-kicker">WORKSPACE CONFIGURATION</span><h1>Settings</h1><p>Manage model access, trial count, and cost controls.</p></div><button className="primary-button" onClick={persist} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
      {saved && <div className="save-banner">✓ Workspace settings saved</div>}
      {error && <div className="form-error">{error}</div>}
      <div className="settings-layout">
        <div className="settings-main">
          <article className="panel settings-section"><div className="settings-head"><div><h2>Provider connections</h2><p>Secrets stay in the server environment and never return to this page.</p></div></div><div className="provider-list">
            <ProviderRow provider="Anthropic" detail="Claude Sonnet 5" status={providers.anthropic ? "Connected" : "Key required"} connected={providers.anthropic} />
            <ProviderRow provider="OpenAI" detail="GPT-5.6 Terra" status={providers.openai ? "Connected" : "Key required"} connected={providers.openai} />
            <ProviderRow provider="Google" detail="Gemini 2.5 Flash" status={providers.gemini ? "Connected" : "Key required"} connected={providers.gemini} />
            <ProviderRow provider="Reference" detail="OutcomeTrace Reference Agent" status="Connected" connected />
          </div><div className="secret-note"><strong>Secure key setup</strong><p>Add provider keys as encrypted environment variables in the Site settings. Do not paste keys into this dashboard or chat.</p></div></article>
          <article className="panel settings-section"><div className="settings-head"><div><h2>Model registry</h2><p>The reference agent works now. Live models become selectable when their server key exists.</p></div></div><div className="registry-list">{[
            { name: "OutcomeTrace Reference Agent", id: "outcometrace/reference-v1", available: true },
            { name: "Claude Sonnet 5", id: "anthropic/claude-sonnet-5", available: providers.anthropic },
            { name: "GPT-5.6 Terra", id: "openai/gpt-5.6-terra", available: providers.openai },
            { name: "Gemini 2.5 Flash", id: "google/gemini-2.5-flash", available: providers.gemini },
          ].map((model) => <label key={model.name}><div><strong>{model.name}</strong><span>{model.id}</span></div><input type="checkbox" disabled={!model.available} checked={model.available && models.includes(model.name)} onChange={() => toggleModel(model.name)} /></label>)}</div></article>
        </div>
        <aside className="settings-aside">
          <article className="panel defaults-card"><span className="aside-label">Run defaults</span><label className="form-field"><span>Trials per cell</span><input type="number" min="1" max="20" value={defaultN} onChange={(event) => setDefaultN(Number(event.target.value))} /></label><label className="form-field"><span>Run budget warning</span><div className="money-input"><b>$</b><input type="number" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></div></label><label className="form-field"><span>Trace retention</span><select value={retention} onChange={(event) => setRetention(Number(event.target.value))}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></label></article>
          <article className="panel workspace-card"><span className="aside-label">Workspace</span><div className="workspace-identity"><span>AE</span><div><strong>Candidate Agent Lab</strong><small>Evaluation workspace</small></div></div><div className="workspace-detail"><span>Default N</span><strong>{defaultN}</strong></div><div className="workspace-detail"><span>Active models</span><strong>{models.length}</strong></div></article>
        </aside>
      </div>
    </section>
  );
}

function ProviderRow({ provider, detail, status, connected }: { provider: string; detail: string; status: string; connected?: boolean }) {
  return <div className="provider-row"><div className="provider-mark">{provider.slice(0, 1)}</div><div><strong>{provider}</strong><span>{detail}</span></div><span className={`provider-status ${connected ? "connected" : ""}`}><i />{status}</span><button>{connected ? "Manage" : "Setup guide"}</button></div>;
}

function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="panel-title"><div><h2>{title}</h2><p>{detail}</p></div><button aria-label={`More options for ${title}`}>•••</button></div>;
}

function MiniBars() {
  return <div className="mini-bars" aria-hidden="true">{[42, 54, 48, 67, 61, 78, 72, 84, 79, 91, 85, 82].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>;
}

function MatrixRow({ task, values }: { task: string; values: number[] }) {
  return <tr><th>{task}</th>{values.map((value, index) => <td key={`${value}-${index}`}><span className={`heat heat-${Math.floor(value / 10)}`}>{value}%</span></td>)}</tr>;
}

function ErrorBar({ label, count, width, tone }: { label: string; count: number; width: number; tone: string }) {
  return <div className="error-row"><div><span>{label}</span><strong>{count}</strong></div><div className="bar-track"><i className={tone} style={{ width: `${width}%` }} /></div></div>;
}

function Status({ status }: { status: TrialStatus }) {
  return <span className={`status-badge ${status.toLowerCase()}`}><i />{status}</span>;
}

function TraceEvent({ number, type, meta, text, warning, danger, code }: { number: string; type: string; meta: string; text: string; warning?: string; danger?: boolean; code?: boolean }) {
  return <div className={`trace-event ${danger ? "danger" : ""}`}><div className="trace-number">{number}</div><div className="trace-dot" /><div className="trace-content"><div><strong>{type}</strong><span>{meta}</span></div>{code ? <pre>{text}</pre> : <p>{text}</p>}{warning && <div className="trace-warning">! {warning}</div>}</div></div>;
}

function Assertion({ label, passed, detail }: { label: string; passed: boolean; detail: string }) {
  return <div className="assertion"><span className={passed ? "pass" : "fail"}>{passed ? "✓" : "×"}</span><div><code>{label}</code><small>{detail}</small></div></div>;
}

function formatLatency(milliseconds: number) { return `${(milliseconds / 1000).toFixed(2)}s`; }
function formatCost(micros: number) { return `$${(micros / 1_000_000).toFixed(3)}`; }
function humanize(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function wilsonInterval(successes: number, total: number): [number, number] {
  if (!total) return [0, 0];
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
function downloadTrial(trial: Trial) {
  const blob = new Blob([JSON.stringify(trial, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${trial.id}.json`; anchor.click();
  URL.revokeObjectURL(url);
}
