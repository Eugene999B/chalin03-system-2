"use strict";

const {
  LOCAL_MODEL_KEY,
  LocalGovernedProvider,
  evidenceFromMessages,
  formatMoney,
  latestUserQuestion,
  parseEvidenceJson,
  recentUserContext,
} = require("./localGovernedProvider");

const HIRE_PERFORMANCE_TOOL_KEY = "equipment_hire.performance_diagnostics";
const HIRE_PERFORMANCE_HEADING = /equipment hire performance diagnostics/i;
const HIRE_PRODUCT_PATTERN = /\b(?:equipment hire|hire fleet|hire contract|hire quotation|hire receivable|hire invoice|hire return|hire location|hire yard|hire base)\b/i;
const HIRE_CAUSAL_PATTERN = /\b(?:equipment hire performance|hire performance|hire underperform|hire fleet performance|why\s+(?:is|are|was|were)[^?]*(?:hire|fleet|billing|collection|receivable|quotation|contract|closure)|poor\s+(?:hire|fleet|collection)|low\s+(?:hire|fleet|collection)|billing pressure|collection pressure|cash conversion|uninvoiced work|closure backlog|return backlog)\b/i;

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function composeHireProductAnswer() {
  return [
    "CHALIN Equipment Hire is a location-scoped operating business. The verified flow is Authorized Hire Location → Customer/Enquiry → Availability and Rate Check → Quotation/Approval → Contract → Asset Assignment/Dispatch → Approved Work Log → Invoice/Payment → Return Inspection/Closure.",
    "",
    "For performance questions I separate commercial pipeline, fleet readiness, work-to-invoice completeness, receivables/cash conversion and return/closure controls. Open quotation value is pipeline, invoiced amount is billing evidence, and paid amount is cash collection; none of those alone proves profit.",
    "",
    "The current governed Hire aggregates do not contain the operating-cost evidence required to certify Hire profit or margin, and fleet assignment counts are not a time-based utilization percentage. For current location figures I must use authorized Equipment Hire live evidence.",
  ].join("\n");
}

function composeHirePerformanceAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.performance_view || !Array.isArray(data?.drivers)) return null;

  const view = data.performance_view;
  const locationName = clean(
    data?.scope?.hire_location_name || data?.scope?.hire_location_code || "",
    120
  );
  const location = locationName ? ` for ${locationName}` : "";
  const collectionRate = Number(view.collection_rate || 0);
  const driverLines = data.drivers.slice(0, 6).map((driver, index) => {
    const title = clean(driver.key || driver.category || "driver", 120).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 800);
    return `${index + 1}. ${title}: ${explanation} [${item.citation}]`;
  });

  return [
    `The live Equipment Hire performance diagnosis${location} shows ${Number(view.total_assets || 0).toLocaleString("en-GH")} active fleet asset(s), ${Number(view.assets_on_hire || 0).toLocaleString("en-GH")} asset(s) counted on Hire assignments and ${Number(view.maintenance_assets || 0).toLocaleString("en-GH")} asset(s) in maintenance/breakdown status. [${item.citation}]`,
    `Billing and cash conversion are separate: ${formatMoney(view.invoiced_amount)} invoiced, ${formatMoney(view.paid_amount)} paid, ${formatMoney(view.outstanding_amount)} outstanding and ${formatMoney(view.overdue_amount)} overdue. Collection rate is ${Number.isFinite(collectionRate) ? collectionRate.toFixed(2) : "0.00"}%. [${item.citation}]`,
    `Commercial pipeline currently includes ${formatMoney(view.open_quotation_value)} of open quotation value; that is pipeline exposure, not recognized revenue or profit. [${item.citation}]`,
    "Main evidence-backed drivers:",
    ...driverLines,
    `Evidence boundary: ${clean(data?.certainty?.warning || "This is Equipment Hire operational and receivables evidence, not a certified Hire profit or fleet-utilization calculation.", 900)} [${item.citation}]`,
  ].join("\n\n");
}

function offeredHirePerformanceTool(tools = []) {
  return (Array.isArray(tools) ? tools : []).find((tool) =>
    clean(tool?.key, 150).toLowerCase() === HIRE_PERFORMANCE_TOOL_KEY &&
    Number(tool?.risk_level || 0) === 1
  ) || null;
}

function shouldUseHirePerformanceTool({ messages = [], tools = [], providerContext = {} } = {}) {
  if (
    providerContext?.public_safe_social_turn === true ||
    providerContext?.public_safe_system_turn === true ||
    providerContext?.public_safe_general_turn === true ||
    evidenceFromMessages(messages).length > 0
  ) {
    return null;
  }
  const question = recentUserContext(messages) || latestUserQuestion(messages);
  if (!HIRE_CAUSAL_PATTERN.test(question)) return null;
  return offeredHirePerformanceTool(tools);
}

function localHirePerformanceToolCall(tool) {
  return Object.freeze({
    id: "local_equipment_hire_performance_diagnostics",
    tool_key: clean(tool?.key, 150).toLowerCase(),
    input: {},
  });
}

class LocalEquipmentHireGovernedProvider extends LocalGovernedProvider {
  async generate({ messages = [], tools = [], provider_context = {} } = {}) {
    if (provider_context?.public_safe_system_turn === true) {
      const question = latestUserQuestion(messages);
      if (HIRE_PRODUCT_PATTERN.test(question)) {
        const text = composeHireProductAnswer();
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

    const performanceTool = shouldUseHirePerformanceTool({
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
        tool_calls: [localHirePerformanceToolCall(performanceTool)],
        provider_store_enabled: false,
      };
    }

    const hireEvidence = evidenceFromMessages(messages).find((item) =>
      HIRE_PERFORMANCE_HEADING.test(item.heading)
    );
    const hireAnswer = composeHirePerformanceAnswer(hireEvidence);
    if (hireAnswer) {
      return {
        text: hireAnswer,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(hireAnswer.length / 4),
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
  HIRE_CAUSAL_PATTERN,
  HIRE_PERFORMANCE_TOOL_KEY,
  HIRE_PRODUCT_PATTERN,
  LocalEquipmentHireGovernedProvider,
  composeHirePerformanceAnswer,
  composeHireProductAnswer,
  localHirePerformanceToolCall,
  offeredHirePerformanceTool,
  shouldUseHirePerformanceTool,
};
