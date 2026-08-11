"use strict";

const {
  LocalEquipmentHireGovernedProvider,
} = require("./localEquipmentHireGovernedProvider");
const {
  LOCAL_MODEL_KEY,
  evidenceFromMessages,
  formatMoney,
  inferredDateInput,
  latestUserQuestion,
  parseEvidenceJson,
  recentUserContext,
} = require("./localGovernedProvider");

const FINANCE_PERFORMANCE_TOOL_KEY =
  "equipment_finance.performance_diagnostics";
const FINANCE_PERFORMANCE_HEADING =
  /equipment finance portfolio and arrears performance diagnostics/i;
const FINANCE_PRODUCT_PATTERN =
  /\b(?:equipment finance|installment finance|instalment finance|finance portfolio|finance agreement|credit application|repayment schedule|installment schedule|instalment schedule|finance arrears|installment arrears|instalment arrears|ownership transfer)\b/i;
const FINANCE_CAUSAL_PATTERN =
  /\b(?:equipment finance performance|installment finance performance|instalment finance performance|finance portfolio performance|why\s+(?:is|are|was|were)[^?]*(?:finance|installment|instalment|arrears|repayment|portfolio|collection|reconciliation)|finance underperform|installment underperform|instalment underperform|arrears pressure|portfolio pressure|finance collection pressure|finance cash conversion|reconciliation pressure|credit pipeline pressure)\b/i;

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function composeFinanceProductAnswer() {
  return [
    "CHALIN Equipment Installment Finance is a company-wide Finance division inside the Equipment workspace. The verified lifecycle is Credit Application → KYC/Affordability/Risk Review → Approval → Finance Agreement Activation → Installment Schedule → Payment/Allocation → Outstanding/Arrears/Reconciliation → Controlled Delivery/Completion/Ownership Transfer.",
    "",
    "For portfolio questions I keep contracted value, deposits, collections, outstanding balance and arrears separate. Outstanding can include future obligations; arrears are the past-due schedule portion. Approved applications are origination pipeline until governed agreement activation succeeds.",
    "",
    "The cash-flow comparison between actual collections and open scheduled amounts is a management signal, not automatically an on-time collection rate. The current governed Finance aggregates expose no customer rows and do not contain the complete cost/impairment evidence required to certify Finance profit, margin or yield.",
  ].join("\n");
}

function composeFinancePerformanceAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.performance_view || !Array.isArray(data?.drivers)) return null;
  const view = data.performance_view;
  const arrearsShare = view.arrears_share_of_portfolio_outstanding_percent;
  const scheduleRatio = view.collection_to_open_schedule_ratio_percent;
  const driverLines = data.drivers.slice(0, 7).map((driver, index) => {
    const title = clean(
      driver.key || driver.category || "driver",
      120
    ).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 850);
    return `${index + 1}. ${title}: ${explanation} [${item.citation}]`;
  });

  return [
    `The live Equipment Finance diagnosis covers ${Number(view.agreement_count || 0).toLocaleString("en-GH")} installment agreement(s): portfolio value ${formatMoney(view.portfolio_value)}, lifetime collections ${formatMoney(view.lifetime_collections)}, outstanding ${formatMoney(view.portfolio_outstanding_balance)} and calculated arrears ${formatMoney(view.calculated_arrears)}. [${item.citation}]`,
    `Arrears affect ${Number(view.arrears_accounts || 0).toLocaleString("en-GH")} account(s)${arrearsShare == null ? "" : ` and equal ${Number(arrearsShare).toFixed(2)}% of aggregate portfolio outstanding`}; ${Number(view.over_90_accounts || 0).toLocaleString("en-GH")} account(s) are in the over-90-day bucket with ${formatMoney(view.over_90_arrears)} arrears. [${item.citation}]`,
    `For the selected reporting period, ${formatMoney(view.selected_period_collections)} was collected versus ${formatMoney(view.selected_period_open_schedule_amount)} of currently open scheduled amounts${scheduleRatio == null ? "" : ` (${Number(scheduleRatio).toFixed(2)}%)`}. That ratio is a management comparison, not automatically an on-time collection rate. [${item.citation}]`,
    `Origination/control: ${Number(view.applications_under_review || 0)} application(s) under review, ${Number(view.kyc_pending_applications || 0)} with KYC pending, ${Number(view.high_or_critical_risk_applications || 0)} high/critical risk, and ${Number(view.reconciliation_attention_count || 0)} agreement(s) requiring reconciliation attention. [${item.citation}]`,
    "Main evidence-backed drivers:",
    ...driverLines,
    `Evidence boundary: ${clean(data?.certainty?.warning || "This is confidential aggregate Finance evidence, not customer-level data or a certified profit/yield calculation.", 950)} [${item.citation}]`,
  ].join("\n\n");
}

function offeredFinancePerformanceTool(tools = []) {
  return (
    (Array.isArray(tools) ? tools : []).find(
      (tool) =>
        clean(tool?.key, 150).toLowerCase() === FINANCE_PERFORMANCE_TOOL_KEY &&
        Number(tool?.risk_level || 0) === 1
    ) || null
  );
}

function shouldUseFinancePerformanceTool({
  messages = [],
  tools = [],
  providerContext = {},
} = {}) {
  if (
    providerContext?.public_safe_social_turn === true ||
    providerContext?.public_safe_system_turn === true ||
    providerContext?.public_safe_general_turn === true ||
    evidenceFromMessages(messages).length > 0
  ) {
    return null;
  }
  const question = recentUserContext(messages) || latestUserQuestion(messages);
  if (!FINANCE_CAUSAL_PATTERN.test(question)) return null;
  return offeredFinancePerformanceTool(tools);
}

function localFinancePerformanceToolCall(tool, messages = []) {
  return Object.freeze({
    id: "local_equipment_finance_performance_diagnostics",
    tool_key: clean(tool?.key, 150).toLowerCase(),
    input: inferredDateInput(messages),
  });
}

class LocalEquipmentFinanceGovernedProvider extends LocalEquipmentHireGovernedProvider {
  async generate({ messages = [], tools = [], provider_context = {} } = {}) {
    if (provider_context?.public_safe_system_turn === true) {
      const question = latestUserQuestion(messages);
      if (FINANCE_PRODUCT_PATTERN.test(question)) {
        const text = composeFinanceProductAnswer();
        return {
          text,
          model_key: LOCAL_MODEL_KEY,
          input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
          output_tokens: Math.ceil(text.length / 4),
          cost_micros: 0,
          finish_reason: "stop",
          tool_calls: [],
          provider_store_enabled: false,
        };
      }
    }

    const performanceTool = shouldUseFinancePerformanceTool({
      messages,
      tools,
      providerContext: provider_context,
    });
    if (performanceTool) {
      const text = `Checking the approved ${clean(
        performanceTool.title || performanceTool.key,
        180
      )} evidence before answering.`;
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "local_read_only_tool",
        tool_calls: [localFinancePerformanceToolCall(performanceTool, messages)],
        provider_store_enabled: false,
      };
    }

    const financeEvidence = evidenceFromMessages(messages).find((item) =>
      FINANCE_PERFORMANCE_HEADING.test(item.heading)
    );
    const financeAnswer = composeFinancePerformanceAnswer(financeEvidence);
    if (financeAnswer) {
      return {
        text: financeAnswer,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(financeAnswer.length / 4),
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    }

    return super.generate({ messages, tools, provider_context });
  }
}

module.exports = {
  FINANCE_CAUSAL_PATTERN,
  FINANCE_PERFORMANCE_HEADING,
  FINANCE_PERFORMANCE_TOOL_KEY,
  FINANCE_PRODUCT_PATTERN,
  LocalEquipmentFinanceGovernedProvider,
  composeFinancePerformanceAnswer,
  composeFinanceProductAnswer,
  localFinancePerformanceToolCall,
  offeredFinancePerformanceTool,
  shouldUseFinancePerformanceTool,
};
