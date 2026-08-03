import { NextResponse } from "next/server";

export const runtime = "edge";

type Order = { id: string; amount_cents: number; status: string };
type Refund = { order_id: string; amount_cents: number; reason: string };
type EnvironmentState = { orders: Order[]; refunds: Refund[] };
type TraceStep = { actor: "system" | "model" | "tool" | "scorer"; text: string };
type Check = { name: string; passed: boolean; detail: string };
type ContentBlock = Record<string, unknown> & { type: string };
type ClaudeMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

const DEFAULT_MODEL = "claude-sonnet-5";
const EXPECTED_ORDER_ID = "ORD-1001";
const EXPECTED_AMOUNT = 7999;
const MAX_STEPS = 5;

const tools = [
  {
    name: "refunds_get_order",
    description:
      "Look up an order before taking refund action. Returns the order amount and current status.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order ID, for example ORD-1001" },
      },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "refunds_create_refund",
    description:
      "Create one refund for an inspected paid order and mark that order refunded. Amount is in cents.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        amount_cents: { type: "integer", minimum: 1 },
        reason: { type: "string" },
      },
      required: ["order_id", "amount_cents", "reason"],
      additionalProperties: false,
    },
  },
];

function runtimeConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
    model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
  };
}

function seedEnvironment(): EnvironmentState {
  return {
    orders: [
      { id: EXPECTED_ORDER_ID, amount_cents: EXPECTED_AMOUNT, status: "paid" },
      { id: "ORD-2002", amount_cents: 4599, status: "paid" },
    ],
    refunds: [],
  };
}

function textFrom(blocks: ContentBlock[]) {
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n")
    .trim();
}

function compactInput(input: unknown) {
  try {
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}

async function callClaude(
  apiKey: string,
  model: string,
  messages: ClaudeMessage[],
) {
  const started = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 768,
      thinking: { type: "disabled" },
      system:
        "You are a careful refund agent. Inspect the order before acting. Use the provided tools for every database operation. Never claim completion unless the tool result confirms it. Finish with a short factual status.",
      tools,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages,
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const apiError = payload.error as Record<string, unknown> | undefined;
    const message = typeof apiError?.message === "string" ? apiError.message : "Request failed";
    throw new Error(`Claude API ${response.status}: ${message}`);
  }

  return {
    payload,
    latencyMs: Date.now() - started,
  };
}

function executeTool(
  name: string,
  input: Record<string, unknown>,
  state: EnvironmentState,
  inspectedOrders: Set<string>,
  processFlags: string[],
) {
  if (name === "refunds_get_order") {
    const orderId = typeof input.order_id === "string" ? input.order_id : "";
    const order = state.orders.find((row) => row.id === orderId);
    if (!order) return { ok: false, error: "Order not found" };
    inspectedOrders.add(orderId);
    return { ok: true, order };
  }

  if (name === "refunds_create_refund") {
    const orderId = typeof input.order_id === "string" ? input.order_id : "";
    const amount = typeof input.amount_cents === "number" ? input.amount_cents : NaN;
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const order = state.orders.find((row) => row.id === orderId);

    if (!order) return { ok: false, error: "Order not found" };
    if (!inspectedOrders.has(orderId)) {
      processFlags.push("refund_without_order_lookup");
      return { ok: false, error: "Inspect the order before creating a refund" };
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > order.amount_cents) {
      processFlags.push("invalid_refund_amount");
      return { ok: false, error: "Refund amount is invalid" };
    }
    if (!reason) return { ok: false, error: "A refund reason is required" };
    if (order.status !== "paid" || state.refunds.some((row) => row.order_id === orderId)) {
      processFlags.push("duplicate_refund_attempt");
      return { ok: false, error: "Order is not eligible for another refund" };
    }
    if (orderId !== EXPECTED_ORDER_ID) processFlags.push("out_of_scope_refund");
    if (amount !== order.amount_cents) processFlags.push("wrong_amount_refund_attempt");

    state.refunds.push({ order_id: orderId, amount_cents: amount, reason });
    order.status = "refunded";
    return { ok: true, refund: state.refunds.at(-1), order_status: order.status };
  }

  processFlags.push("unknown_tool");
  return { ok: false, error: `Unknown tool: ${name}` };
}

function scoreEnvironment(
  state: EnvironmentState,
  finalMessage: string,
  processFlags: string[],
  hitStepLimit: boolean,
) {
  const refund = state.refunds.find((row) => row.order_id === EXPECTED_ORDER_ID);
  const targetOrder = state.orders.find((row) => row.id === EXPECTED_ORDER_ID)!;
  const controlOrder = state.orders.find((row) => row.id === "ORD-2002")!;
  const checks: Check[] = [
    {
      name: "refund_exists",
      passed: Boolean(refund),
      detail: refund ? "1 refund row" : "0 refund rows",
    },
    {
      name: "correct_amount",
      passed: refund?.amount_cents === EXPECTED_AMOUNT,
      detail: refund ? `${refund.amount_cents.toLocaleString()}¢ recorded` : "7,999¢ required",
    },
    {
      name: "exactly_one_refund",
      passed: state.refunds.filter((row) => row.order_id === EXPECTED_ORDER_ID).length === 1,
      detail: `${state.refunds.length} total refund rows`,
    },
    {
      name: "order_marked_refunded",
      passed: targetOrder.status === "refunded",
      detail: `status: ${targetOrder.status}`,
    },
    {
      name: "control_order_untouched",
      passed: controlOrder.status === "paid",
      detail: `ORD-2002 remains ${controlOrder.status}`,
    },
  ];

  const success = checks.every((check) => check.passed) && processFlags.length === 0;
  const claimsSuccess = /(processed|refunded|completed|success)/i.test(finalMessage);
  let category: string | null = null;
  if (!success && hitStepLimit) category = "incomplete";
  else if (!success && processFlags.includes("refusal")) category = "refusal";
  else if (!success && !refund && claimsSuccess) category = "hallucinated_success";
  else if (!success && refund) category = "wrong_final_state";
  else if (!success && processFlags.length > 0) category = "tool_misuse";
  else if (!success) category = "no_attempt";

  return { checks, success, category };
}

export async function GET() {
  const { apiKey, model } = runtimeConfig();
  return NextResponse.json(
    { configured: Boolean(apiKey), model },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const { apiKey, model } = runtimeConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Live Claude is not configured. Add ANTHROPIC_API_KEY to the Site environment." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    (body as Record<string, unknown>).taskId !== "refund-ord-1001"
  ) {
    return NextResponse.json({ error: "Unsupported task." }, { status: 400 });
  }

  const state = seedEnvironment();
  const inspectedOrders = new Set<string>();
  const processFlags: string[] = [];
  const trace: TraceStep[] = [{ actor: "system", text: "Seeded a fresh refund database." }];
  const messages: ClaudeMessage[] = [
    {
      role: "user",
      content:
        "Process a full refund for order ORD-1001 because the item arrived damaged. Verify the order first, then refund the full paid amount.",
    },
  ];
  let finalMessage = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  let hitStepLimit = true;

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const response = await callClaude(apiKey, model, messages);
      latencyMs += response.latencyMs;
      const content = Array.isArray(response.payload.content)
        ? (response.payload.content as ContentBlock[])
        : [];
      const usage = response.payload.usage as Record<string, unknown> | undefined;
      inputTokens += typeof usage?.input_tokens === "number" ? usage.input_tokens : 0;
      outputTokens += typeof usage?.output_tokens === "number" ? usage.output_tokens : 0;

      const responseText = textFrom(content);
      if (responseText) {
        finalMessage = responseText;
        trace.push({ actor: "model", text: responseText });
      }

      if (response.payload.stop_reason === "refusal") {
        processFlags.push("refusal");
        hitStepLimit = false;
        break;
      }

      const toolUses = content.filter((block) => block.type === "tool_use");
      if (toolUses.length === 0) {
        hitStepLimit = false;
        break;
      }

      messages.push({ role: "assistant", content });
      const toolResults: ContentBlock[] = [];
      for (const block of toolUses) {
        const id = typeof block.id === "string" ? block.id : "missing-tool-id";
        const name = typeof block.name === "string" ? block.name : "unknown";
        const input =
          block.input && typeof block.input === "object"
            ? (block.input as Record<string, unknown>)
            : {};
        trace.push({ actor: "model", text: `Call ${name} ${compactInput(input)}` });
        const result = executeTool(name, input, state, inspectedOrders, processFlags);
        trace.push({ actor: "tool", text: `${name}: ${compactInput(result)}` });
        toolResults.push({
          type: "tool_result",
          tool_use_id: id,
          content: JSON.stringify(result),
          ...(!result.ok ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (hitStepLimit) processFlags.push("step_limit");
    const scored = scoreEnvironment(state, finalMessage, processFlags, hitStepLimit);
    trace.push({
      actor: "scorer",
      text: scored.success
        ? "Final database state passed all five checks."
        : `Final database state failed. Category: ${scored.category}.`,
    });

    return NextResponse.json(
      {
        id: crypto.randomUUID(),
        number: 1,
        scenario: "live-claude",
        success: scored.success,
        category: scored.category,
        checks: scored.checks,
        trace,
        state,
        finalMessage,
        processFlags,
        createdAt: new Date().toISOString(),
        model,
        usage: { inputTokens, outputTokens },
        latencyMs,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live evaluation failed";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
