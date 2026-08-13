"use strict";

const PERFORMANCE_TOOL_BY_WORKSPACE = Object.freeze({
  spare_parts: "spare_parts.performance_diagnostics",
  mining: "mining.performance_diagnostics",
  equipment_hire: "equipment_hire.performance_diagnostics",
});

const PERFORMANCE_SIGNAL_PATTERN =
  /\b(?:sales?|revenue|turnover|profit|margin|performance|performing|commercial performance|business performance)\b/i;
const PERFORMANCE_QUESTION_PATTERN =
  /\b(?:how|what|show|summari[sz]e|explain|analy[sz]e|diagnos(?:e|is)|trend|doing|lately|recent(?:ly)?|latest|report|document|pdf|word|excel|csv|performance)\b/i;
const IDENTITY_SPECIFIC_PATTERN =
  /\b(?:which customer|what customer|customer named|customer #|customer id|receipt|invoice number|invoice #|account number|account #|phone number|named customer|specific customer|who bought|who owes|who paid)\b/i;
const RECENT_PATTERN = /\b(?:lately|recent|recently|latest|past\s+7\s+days|last\s+7\s+days)\b/i;
const DOCUMENT_PATTERN =
  /\b(?:pdf|word|docx|excel|xlsx|spreadsheet|csv|document|report|statement|management pack|board pack)\b/i;

function clean(value, maximum = 16000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function latestUserMessage(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (String(source[index]?.role || "").toLowerCase() !== "user") continue;
    const text = clean(source[index]?.content);
    if (text) return text;
  }
  return "";
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month, day));
}

function shiftUtcDays(value, amount) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date;
}

function startOfUtcWeek(value) {
  const date = new Date(value);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return shiftUtcDays(date, mondayOffset);
}

function performanceDateWindow(prompt, now = new Date()) {
  const text = clean(prompt, 8000);
  const current = new Date(now);
  const today = dateOnly(current);
  const explicitDates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(
    (match) => match[1]
  );
  if (explicitDates.length >= 2) {
    return Object.freeze({ start_date: explicitDates[0], end_date: explicitDates[1] });
  }
  if (explicitDates.length === 1) {
    return Object.freeze({ start_date: explicitDates[0], end_date: explicitDates[0] });
  }

  if (/\byesterday\b/i.test(text)) {
    const yesterday = dateOnly(shiftUtcDays(current, -1));
    return Object.freeze({ start_date: yesterday, end_date: yesterday });
  }
  if (/\btoday\b|\bright\s+now\b|\bcurrently\b|\bcurrent\b/i.test(text)) {
    return Object.freeze({ start_date: today, end_date: today });
  }
  if (/\blast\s+week\b/i.test(text)) {
    const thisMonday = startOfUtcWeek(current);
    const lastMonday = shiftUtcDays(thisMonday, -7);
    const lastSunday = shiftUtcDays(thisMonday, -1);
    return Object.freeze({
      start_date: dateOnly(lastMonday),
      end_date: dateOnly(lastSunday),
    });
  }
  if (/\bthis\s+week\b/i.test(text)) {
    return Object.freeze({
      start_date: dateOnly(startOfUtcWeek(current)),
      end_date: today,
    });
  }
  if (/\blast\s+month\b/i.test(text)) {
    const firstThisMonth = utcDate(current.getUTCFullYear(), current.getUTCMonth(), 1);
    const lastPreviousMonth = shiftUtcDays(firstThisMonth, -1);
    const firstPreviousMonth = utcDate(
      lastPreviousMonth.getUTCFullYear(),
      lastPreviousMonth.getUTCMonth(),
      1
    );
    return Object.freeze({
      start_date: dateOnly(firstPreviousMonth),
      end_date: dateOnly(lastPreviousMonth),
    });
  }
  if (/\bthis\s+month\b/i.test(text)) {
    return Object.freeze({
      start_date: dateOnly(utcDate(current.getUTCFullYear(), current.getUTCMonth(), 1)),
      end_date: today,
    });
  }

  // Natural phrases such as "lately" and a time-unspecified management report
  // should be useful without an unnecessary clarification turn. Seven calendar
  // days gives a bounded recent view and keeps the answer current.
  if (RECENT_PATTERN.test(text) || DOCUMENT_PATTERN.test(text) || PERFORMANCE_SIGNAL_PATTERN.test(text)) {
    return Object.freeze({
      start_date: dateOnly(shiftUtcDays(current, -6)),
      end_date: today,
    });
  }

  return Object.freeze({ start_date: today, end_date: today });
}

function offeredTool(tools = [], toolKey) {
  return (Array.isArray(tools) ? tools : []).some(
    (tool) => String(tool?.key || "").trim() === toolKey
  );
}

function hasToolResult(messages = [], toolKey) {
  return (Array.isArray(messages) ? messages : []).some(
    (message) =>
      String(message?.role || "").toLowerCase() === "tool" &&
      String(message?.content || "").includes(toolKey)
  );
}

function performanceToolForContext(providerContext = {}) {
  const workspace = clean(providerContext?.workspace_code, 80).toLowerCase();
  return PERFORMANCE_TOOL_BY_WORKSPACE[workspace] || null;
}

function isAggregatePerformancePrompt(prompt) {
  const text = clean(prompt, 8000);
  if (!text || IDENTITY_SPECIFIC_PATTERN.test(text)) return false;
  if (!PERFORMANCE_SIGNAL_PATTERN.test(text)) return false;
  if (/\bperformance\b|\bperforming\b/i.test(text)) return true;
  if (DOCUMENT_PATTERN.test(text)) return true;
  return PERFORMANCE_QUESTION_PATTERN.test(text);
}

function fastPathDecision({ messages = [], tools = [], providerContext = {} } = {}) {
  const prompt = latestUserMessage(messages);
  const toolKey = performanceToolForContext(providerContext);
  if (!toolKey || !offeredTool(tools, toolKey) || !isAggregatePerformancePrompt(prompt)) {
    return Object.freeze({ active: false, prompt, tool_key: toolKey });
  }
  const alreadyLoaded = hasToolResult(messages, toolKey);
  return Object.freeze({
    active: true,
    prompt,
    tool_key: toolKey,
    evidence_loaded: alreadyLoaded,
    input:
      clean(providerContext?.workspace_code, 80).toLowerCase() === "equipment_hire"
        ? Object.freeze({})
        : performanceDateWindow(prompt),
  });
}

function finalSynthesisInstruction(decision) {
  const period = decision?.input?.start_date
    ? `${decision.input.start_date} through ${decision.input.end_date}`
    : "the governed operational snapshot";
  return [
    "CHALIN operational fast-path synthesis:",
    `- The server already collected the dedicated performance diagnostics for ${period}.`,
    "- Do not ask for another tool and do not ask the user to repeat or narrow the request.",
    "- Answer now from the governed evidence already supplied.",
    "- Lead with the business bottom line, then the most important figures/signals, drivers, risks and useful next actions.",
    "- For a document/report request, write a polished management-ready report body with a clear period, executive summary, performance highlights, drivers/risks and recommendations. Do not say that you merely can prepare the document.",
    "- Keep material CHALIN factual claims tied to the supplied evidence citations.",
  ].join("\n");
}

class OperationalFastPathProvider {
  constructor({ delegate, now = () => new Date() } = {}) {
    if (!delegate || typeof delegate.generate !== "function") {
      throw new Error("OperationalFastPathProvider requires a provider delegate.");
    }
    this.delegate = delegate;
    this.now = now;
    this.key = delegate.key;
  }

  async generate({
    messages = [],
    tools = [],
    max_output_tokens,
    provider_context = {},
    signal,
  } = {}) {
    const decision = fastPathDecision({ messages, tools, providerContext: provider_context });
    if (!decision.active) {
      return this.delegate.generate({
        messages,
        tools,
        max_output_tokens,
        provider_context,
        signal,
      });
    }

    if (!decision.evidence_loaded) {
      const workspace = clean(provider_context?.workspace_code, 80).toLowerCase();
      const input =
        workspace === "equipment_hire"
          ? {}
          : performanceDateWindow(decision.prompt, this.now());
      return {
        text: "Checking the governed performance diagnostics before answering.",
        model_key:
          clean(provider_context?.provider_model_override, 160) ||
          `${clean(this.delegate?.key, 80) || "provider"}-operational-fastpath`,
        input_tokens: 0,
        output_tokens: 0,
        cost_micros: 0,
        finish_reason: "operational_fast_path",
        tool_calls: [
          {
            id: `fast_${decision.tool_key.replace(/[^a-z0-9]+/gi, "_").slice(0, 90)}`,
            tool_key: decision.tool_key,
            input,
          },
        ],
        provider_store_enabled: false,
      };
    }

    const synthesisMessages = [
      ...(Array.isArray(messages) ? messages : []),
      { role: "system", content: finalSynthesisInstruction(decision) },
    ];
    return this.delegate.generate({
      messages: synthesisMessages,
      tools: [],
      max_output_tokens,
      provider_context: Object.freeze({
        ...provider_context,
        operational_fast_path: true,
        operational_fast_path_tool: decision.tool_key,
        operational_fast_path_final_synthesis: true,
      }),
      signal,
    });
  }
}

function wrapOperationalFastPath(delegate, options = {}) {
  return new OperationalFastPathProvider({ delegate, ...options });
}

module.exports = {
  DOCUMENT_PATTERN,
  IDENTITY_SPECIFIC_PATTERN,
  OperationalFastPathProvider,
  PERFORMANCE_QUESTION_PATTERN,
  PERFORMANCE_SIGNAL_PATTERN,
  PERFORMANCE_TOOL_BY_WORKSPACE,
  RECENT_PATTERN,
  fastPathDecision,
  finalSynthesisInstruction,
  hasToolResult,
  isAggregatePerformancePrompt,
  latestUserMessage,
  offeredTool,
  performanceDateWindow,
  performanceToolForContext,
  shiftUtcDays,
  startOfUtcWeek,
  wrapOperationalFastPath,
};
