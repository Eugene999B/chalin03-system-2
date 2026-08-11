"use strict";

const {
  LOCAL_MODEL_KEY,
  evidenceFromMessages,
  formatMoney,
  inferredDateInput,
  latestUserQuestion,
  parseEvidenceJson,
  recentUserContext,
} = require("./localGovernedProvider");
const {
  LocalEquipmentHireGovernedProvider,
} = require("./localEquipmentHireGovernedProvider");

const FINANCE_PERFORMANCE_TOOL_KEY = "equipment_finance.performance_diagnostics";
const FINANCE_PERFORMANCE_HEADING = /installment finance performance diagnostics/i;
const FINANCE_PRODUCT_PATTERN = /\b(?:equipment finance|installment finance|instalment finance|finance portfolio|finance arrears|finance cash[- ]?flow|credit application|installment account|instalment account|machine finance|equipment credit)\b/i;
const FINANCE_CAUSAL_PATTERN = /\b(?:equipment finance performance|installment finance performance|instalment finance performance|finance performance|finance underperform|why\s+(?:is|are|was|were)[^?]*(?:finance|arrears|overdue|collection|portfolio|credit application|kyc|sale inventory)|poor\s+(?:finance|collections?|cash conversion)|high\s+(?:arrears|overdue)|low\s+(?:collections?|cash conversion)|reconciliation pressure|credit pipeline pressure|finance pipeline pressure)\b/i;

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function financePeriodText(data = {}) {
  const start = clean(data?.scope?.date_from, 20);
  const end = clean(data?.scope?.date_to, 20);
  if (!start && !end) return "";
  if (start && end && start === end) return ` on ${start}`;
  if (start && end) return ` from ${start} to ${end}`;
  return ` as of ${end || start}`;
}

function composeFinanceProductAnswer() {
  return [
    "CHALIN Equipment Installment Finance is a company-wide Finance operating flow inside the Equipment workspace. The verified lifecycle is Sales Opportunity/Quotation → Credit Application → KYC/Affordability/Risk → Independent Approval → Agreement Activation → Opening Deposit → Explicit Machine Reservation → Installment Collections → Delivery → Final Settlement → Ownership Transfer.",
    "",
    "Those stages are deliberately separate: approval is not agreement activation, activation is not machine reservation, and a partial deposit records Finance payment evidence but does not reserve the machine. Delivery and ownership transfer also remain separate controlled gates.",
    "",
    "For performance questions I separate credit-pipeline readiness, sale-capable machine availability, portfolio/outstanding exposure, collections, arrears/aging and reconciliation integrity. Portfolio value and cash collections do not by themselves prove profit; overdue is part of outstanding exposure, and deposits must not be double-counted with collections. Current Finance figures require authorized company-wide aggregate evidence, not Hire-location data.",
  ].join("\n");
}

function composeFinancePerformanceAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.performance_view || !Array.isArray(data?.drivers)) return null;

  const view = data.performance_view;
  const period = financePeriodText(data);
  const cashReference = view.collection_vs_open_schedule_percent == null
    ? "unavailable"
    : `${Number(view.collection_vs_open_schedule_percent).toFixed(2)}%`;
  const driverLines = data.drivers.slice(0, 7).map((driver, index) => {
    const title = clean(driver.key || driver.category || "driver", 120).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 850);
    return `${index + 1}. ${title}: ${explanation} [${item.citation}]`;
  });

  return [
    `The live company-wide Installment Finance diagnosis${period} shows ${Number(view.agreement_count || 0).toLocaleString("en-GH")} agreement(s) with ${formatMoney(view.portfolio_value)} aggregate portfolio value, ${formatMoney(view.lifetime_collections)} lifetime collections and ${formatMoney(view.outstanding_balance)} outstanding. [${item.citation}]`,
    `Delinquency is a subset of that exposure: ${Number(view.overdue_count || 0).toLocaleString("en-GH")} overdue account(s), ${formatMoney(view.overdue_balance)} overdue and ${Number(view.overdue_share_of_outstanding_percent || 0).toFixed(2)}% of outstanding currently overdue. Do not add overdue on top of outstanding as a second balance. [${item.citation}]`,
    `For the selected cash-flow reference, ${formatMoney(view.cash_collected_amount)} was collected against ${formatMoney(view.expected_open_schedule_amount)} of open scheduled amount; the reference percentage is ${cashReference}. This is cash-conversion evidence, not a certified accounting collection rate or profit measure. [${item.citation}]`,
    `Credit/inventory context: ${Number(view.applications_under_review || 0)} application(s) under review, ${Number(view.kyc_pending_applications || 0)} with KYC pending, ${Number(view.high_risk_applications || 0)} high/critical-risk application(s), and ${Number(view.available_for_sale || 0)} machine(s) currently marked available for sale. [${item.citation}]`,
    "Main evidence-backed drivers:",
    ...driverLines,
    `Evidence boundary: ${clean(data?.certainty?.warning || "This is aggregate Finance performance evidence, not customer-level data or a certified Finance profit calculation.", 1000)} [${item.citation}]`,
  ].join("\n\n");
}

function offeredFinancePerformanceTool(tools = []) {
  return (Array.isArray(tools) ? tools : []).find((tool) =>
    clean(tool?.key, 150).toLowerCase() === FINANCE_PERFORMANCE_TOOL_KEY &&
    Number(tool?.risk_level || 0) === 1
  ) || null;
}

function shouldUseFinancePerformanceTool({ messages = [], tools = [], providerContext = {} } = {}) {
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
      const text = `Checking the approved ${clean(performanceTool.title || performanceTool.key, 180)} evidence before answering.`;
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
  financePeriodText,
  localFinancePerformanceToolCall,
  offeredFinancePerformanceTool,
  shouldUseFinancePerformanceTool,
};
