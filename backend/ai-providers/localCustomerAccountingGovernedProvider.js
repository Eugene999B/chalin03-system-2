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
  LocalEquipmentFinanceGovernedProvider,
} = require("./localEquipmentFinanceGovernedProvider");

const CUSTOMER_ACCOUNTING_TOOL_KEY = "spare_parts.customer_accounting_collections_diagnostics";
const CUSTOMER_ACCOUNTING_HEADING = /customer accounting and collections diagnostics/i;
const CUSTOMER_ACCOUNTING_PRODUCT_PATTERN = /\b(?:customer debt|customer debts|customer receivable|customer receivables|accounts receivable|debt aging|debt collection|collections accounting|accounting intelligence|management ledger|customer accounting|credit sales?|debt payment)\b/i;
const CUSTOMER_ACCOUNTING_CAUSAL_PATTERN = /\b(?:why\s+(?:is|are|was|were)[^?]*(?:customer debt|receivables?|collections?|debt aging)|customer debt (?:high|rising|growing)|receivables? (?:high|rising|growing|poor)|collections? (?:poor|weak|low|slow)|debt payments? (?:low|slow)|aged debt|old debt|debt aging|cash collection pressure|receivable pressure)\b/i;

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function periodText(data = {}) {
  const period = Array.isArray(data?.period) ? data.period : [];
  const start = clean(period[0], 20);
  const end = clean(period[1], 20);
  if (!start || !end) return "";
  return start === end ? ` on ${start}` : ` from ${start} to ${end}`;
}

function composeCustomerAccountingProductAnswer() {
  return [
    "CHALIN customer accounting follows a controlled chain: Customer → Sale → Amount Paid + Unpaid Balance → Receivable/Debt → Aging/Follow-up → Later Debt Payment. A later debt payment reduces an existing receivable and improves cash; it is not a second sale or new revenue.",
    "",
    "Two balance views must stay separate: the selected-period sales balance is unpaid value on sales in that period, while current active debt is the current receivable position. They can overlap, so CHALIN Intelligence must not simply add them together. Aging prioritizes collection work but does not automatically mean a bad-debt write-off.",
    "",
    "Advanced Accounting Intelligence also combines sales, collections, expenses, purchases, returns and stock controls into management ledger/P&L/audit views. Those are management intelligence, not certified statutory accounts; purchases are not certified period COGS, supplier purchase balances are not customer receivables, and current live customer/accounting figures require governed branch evidence. Customer-identity matching is a separate sensitive suggestion-only path and does not merge records automatically.",
  ].join("\n");
}

function composeCustomerAccountingAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.performance_view || !Array.isArray(data?.drivers)) return null;

  const view = data.performance_view;
  const branchName = clean(data.branch_name || data.branch_code || "", 120);
  const location = branchName ? ` at ${branchName}` : "";
  const period = periodText(data);
  const driverLines = data.drivers.slice(0, 7).map((driver, index) => {
    const title = clean(driver.key || driver.category || "driver", 120).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 850);
    return `${index + 1}. ${title}: ${explanation} [${item.citation}]`;
  });

  return [
    `The live customer/accounting collections diagnosis${location}${period} shows ${formatMoney(view.sales_total)} of selected-period sales, ${formatMoney(view.sales_paid)} paid and ${formatMoney(view.period_sales_balance)} still unpaid on those sales. Collection rate is ${Number(view.collection_rate || 0).toFixed(2)}%. [${item.citation}]`,
    `Current active receivables are ${formatMoney(view.total_debt_balance)} across ${Number(view.active_debt_count || 0).toLocaleString("en-GH")} debt record(s). That current debt balance can overlap the selected-period sales balance, so the two must not be added together as if they were separate debt amounts. [${item.citation}]`,
    `Debt payments in the selected period are ${formatMoney(view.debt_payments)} against ${formatMoney(view.new_debt_amount)} of new debt. Debt payments are collections of existing receivables, not a second sale. [${item.citation}]`,
    `Older configured aging buckets contain ${Number(view.older_debt_count || 0).toLocaleString("en-GH")} debt record(s) totaling ${formatMoney(view.older_debt_total)}. Aging is a follow-up/risk signal, not automatic write-off evidence. [${item.citation}]`,
    "Main evidence-backed drivers:",
    ...driverLines,
    `Accounting/privacy boundary: ${clean(data?.certainty?.warning || "This is aggregate branch accounting/collections evidence, not customer-level identity data or certified statutory accounts.", 1000)} [${item.citation}]`,
  ].join("\n\n");
}

function offeredCustomerAccountingTool(tools = []) {
  return (Array.isArray(tools) ? tools : []).find((tool) =>
    clean(tool?.key, 180).toLowerCase() === CUSTOMER_ACCOUNTING_TOOL_KEY &&
    Number(tool?.risk_level || 0) === 1
  ) || null;
}

function shouldUseCustomerAccountingTool({ messages = [], tools = [], providerContext = {} } = {}) {
  if (
    providerContext?.public_safe_social_turn === true ||
    providerContext?.public_safe_system_turn === true ||
    providerContext?.public_safe_general_turn === true ||
    clean(providerContext?.workspace_code, 60).toLowerCase() !== "spare_parts" ||
    evidenceFromMessages(messages).length > 0
  ) {
    return null;
  }
  const question = recentUserContext(messages) || latestUserQuestion(messages);
  if (!CUSTOMER_ACCOUNTING_CAUSAL_PATTERN.test(question)) return null;
  return offeredCustomerAccountingTool(tools);
}

function localCustomerAccountingToolCall(tool, messages = []) {
  return Object.freeze({
    id: "local_customer_accounting_collections_diagnostics",
    tool_key: clean(tool?.key, 180).toLowerCase(),
    input: inferredDateInput(messages),
  });
}

class LocalCustomerAccountingGovernedProvider extends LocalEquipmentFinanceGovernedProvider {
  async generate({ messages = [], tools = [], provider_context = {} } = {}) {
    if (provider_context?.public_safe_system_turn === true) {
      const question = latestUserQuestion(messages);
      if (CUSTOMER_ACCOUNTING_PRODUCT_PATTERN.test(question)) {
        const text = composeCustomerAccountingProductAnswer();
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

    const accountingTool = shouldUseCustomerAccountingTool({
      messages,
      tools,
      providerContext: provider_context,
    });
    if (accountingTool) {
      const text = `Checking the approved ${clean(accountingTool.title || accountingTool.key, 180)} evidence before answering.`;
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "local_read_only_tool",
        tool_calls: [localCustomerAccountingToolCall(accountingTool, messages)],
        provider_store_enabled: false,
      };
    }

    const accountingEvidence = evidenceFromMessages(messages).find((item) =>
      CUSTOMER_ACCOUNTING_HEADING.test(item.heading)
    );
    const accountingAnswer = composeCustomerAccountingAnswer(accountingEvidence);
    if (accountingAnswer) {
      return {
        text: accountingAnswer,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(accountingAnswer.length / 4),
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
  CUSTOMER_ACCOUNTING_CAUSAL_PATTERN,
  CUSTOMER_ACCOUNTING_HEADING,
  CUSTOMER_ACCOUNTING_PRODUCT_PATTERN,
  CUSTOMER_ACCOUNTING_TOOL_KEY,
  LocalCustomerAccountingGovernedProvider,
  composeCustomerAccountingAnswer,
  composeCustomerAccountingProductAnswer,
  localCustomerAccountingToolCall,
  offeredCustomerAccountingTool,
  periodText,
  shouldUseCustomerAccountingTool,
};
