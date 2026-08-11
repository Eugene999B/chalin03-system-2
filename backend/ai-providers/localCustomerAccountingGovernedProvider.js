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
const CUSTOMER_ACCOUNTING_PRODUCT_PATTERN = /\b(?:customer debt|customer debts|customer receivable|customer receivables|accounts receivable|debt aging|debt collection|collections accounting|accounting intelligence|management ledger|customer accounting|credit sales?|debt payment|customer commercial|customer 360|top customer|customer contribution)\b/i;
const CUSTOMER_ACCOUNTING_CAUSAL_PATTERN = /\b(?:why\s+(?:is|are|was|were)[^?]*(?:customer debt|receivables?|collections?|debt aging)|customer debt (?:high|rising|growing)|receivables? (?:high|rising|growing|poor)|collections? (?:poor|weak|low|slow)|debt payments? (?:low|slow)|aged debt|old debt|debt aging|cash collection pressure|receivable pressure)\b/i;

const CUSTOMER_COMMERCIAL_TOOL_KEY = "spare_parts.customer_commercial_360";
const CUSTOMER_COMMERCIAL_TOP_HEADING = /spare parts customer contribution and debt ranking/i;
const CUSTOMER_COMMERCIAL_ACCOUNT_HEADING = /spare parts customer commercial 360/i;
const CUSTOMER_COMMERCIAL_TOP_PATTERN = /\b(?:top customers?|best customer|highest[- ]value customer|largest customer|which customer[^?]*(?:contributed|bought|purchased|spent|sales)|who (?:bought|purchased|spent) (?:the )?most|customer contribution)\b/i;
const CUSTOMER_COMMERCIAL_ACCOUNT_PATTERN = /\b(?:customer commercial|customer 360|customer account|customer purchase history|what does\s+.+?\s+owe|how much does\s+.+?\s+owe|what did\s+.+?\s+(?:buy|purchase)|what has\s+.+?\s+(?:bought|purchased)|how much is\s+.+?\s+(?:owing|outstanding)|outstanding (?:debt|balance) (?:for|of)\s+.+)\b/i;
const CUSTOMER_COMMERCIAL_FOLLOWUP_PATTERN = /\b(?:he|she|they|them|that customer|this customer|the customer)\b[\s\S]{0,90}\b(?:owe|owing|outstanding|debt|buy|bought|purchase|purchased|spend|spent|account)\b/i;

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

function scopePeriodText(scope = {}) {
  const start = clean(scope?.start_date, 20);
  const end = clean(scope?.end_date, 20);
  if (!start || !end) return "";
  return start === end ? ` on ${start}` : ` from ${start} to ${end}`;
}

function composeCustomerAccountingProductAnswer() {
  return [
    "CHALIN customer accounting follows a controlled chain: Customer → Sale → Amount Paid + Unpaid Balance → Receivable/Debt → Aging/Follow-up → Later Debt Payment. A later debt payment reduces an existing receivable and improves cash; it is not a second sale or new revenue.",
    "",
    "Two balance views must stay separate: the selected-period sales balance is unpaid value on sales in that period, while current active debt is the current receivable position. They can overlap, so CHALIN Intelligence must not simply add them together. Aging prioritizes collection work but does not automatically mean a bad-debt write-off.",
    "",
    "For authorized customer-level questions, Customer Commercial 360 can rank customers by valid non-void sales value in the selected period and then show one exact customer's selected-period purchases plus current open/overdue debt. That ranking is sales contribution, not customer profit. Customer resolution is exact-only, phone numbers are masked, and the path requires sensitive-read plus Spare Parts audit authority.",
    "",
    "Advanced Accounting Intelligence also combines sales, collections, expenses, purchases, returns and stock controls into management ledger/P&L/audit views. Those are management intelligence, not certified statutory accounts; purchases are not certified period COGS, supplier purchase balances are not customer receivables, and current live customer/accounting figures require governed branch evidence. Duplicate-customer matching remains a separate sensitive suggestion-only path and does not merge records automatically.",
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

function composeCustomerCommercialAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.mode) return null;
  const branchName = clean(
    data?.scope?.branch_name || data?.scope?.branch_code || "",
    120
  );
  const location = branchName ? ` at ${branchName}` : "";
  const period = scopePeriodText(data?.scope || {});

  if (data.mode === "top_customers") {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    if (customers.length === 0) {
      return `No valid customer sales were found${location}${period} in the governed customer ranking. [${item.citation}]`;
    }
    const lines = customers.slice(0, 5).map((customer, index) => {
      const id = Number(customer.customer_id || 0);
      const identity = id > 0 ? `Customer ID ${id}` : clean(customer.identity_key || "customer", 80);
      return `${index + 1}. ${clean(customer.customer_name || "Customer", 160)} (${identity}${customer.phone_masked ? `, ${clean(customer.phone_masked, 80)}` : ""}) — ${formatMoney(customer.total_sales)} valid sales, ${Number(customer.contribution_share_percent || 0).toFixed(2)}% of branch-period sales; current debt ${formatMoney(customer.current_outstanding_debt)}, overdue ${formatMoney(customer.current_overdue_debt)}. [${item.citation}]`;
    });
    const top = customers[0];
    const topId = Number(top.customer_id || 0);
    return [
      `The top customer by valid sales value${location}${period} is ${clean(top.customer_name || "Customer", 160)}${topId > 0 ? ` (Customer ID ${topId})` : ""}, with ${formatMoney(top.total_sales)} of sales and ${Number(top.contribution_share_percent || 0).toFixed(2)}% of branch-period sales. [${item.citation}]`,
      `Their current open debt is ${formatMoney(top.current_outstanding_debt)}, of which ${formatMoney(top.current_overdue_debt)} is overdue. That debt is a current receivable snapshot and is separate from the selected-period sales ranking. [${item.citation}]`,
      "Top governed customer ranking:",
      ...lines,
      `Boundary: “contribution” here means valid sales value, not customer profit or margin. Phone numbers are masked. [${item.citation}]`,
    ].join("\n\n");
  }

  const status = clean(data.resolution_status || "resolved", 40).toLowerCase();
  if (status === "not_found") {
    return `I could not find that exact customer identity in the authorized branch. I did not use fuzzy matching or guess a person. [${item.citation}]`;
  }
  if (status === "ambiguous") {
    const candidates = (Array.isArray(data.candidates) ? data.candidates : [])
      .slice(0, 8)
      .map((candidate, index) => {
        const id = Number(candidate.customer_id || 0);
        return `${index + 1}. ${clean(candidate.customer_name || "Customer", 160)}${id > 0 ? ` — Customer ID ${id}` : ""}${candidate.phone_masked ? ` — ${clean(candidate.phone_masked, 80)}` : ""}`;
      });
    return [
      "More than one exact customer identity matches that reference, so I did not choose one automatically.",
      ...candidates,
      `Use the exact Customer ID to continue. Phone numbers remain masked. [${item.citation}]`,
    ].join("\n");
  }

  const customer = data.customer || {};
  if (!customer.customer_name) return null;
  const id = Number(customer.customer_id || 0);
  const itemLines = (Array.isArray(customer.top_purchased_items) ? customer.top_purchased_items : [])
    .slice(0, 8)
    .map((product, index) =>
      `${index + 1}. ${clean(product.product_name || "Item", 160)} — qty ${Number(product.quantity || 0).toLocaleString("en-GH")}, sales value ${formatMoney(product.sales_value)}. [${item.citation}]`
    );
  return [
    `${clean(customer.customer_name, 160)}${id > 0 ? ` (Customer ID ${id})` : ""}${customer.phone_masked ? `, ${clean(customer.phone_masked, 80)}` : ""}${location} has current open debt of ${formatMoney(customer.current_outstanding_debt)}, including ${formatMoney(customer.current_overdue_debt)} overdue across ${Number(customer.active_debt_count || 0).toLocaleString("en-GH")} active debt record(s). [${item.citation}]`,
    `In the selected activity period${period}, this customer recorded ${formatMoney(customer.selected_period_sales)} of valid sales across ${Number(customer.sales_count || 0).toLocaleString("en-GH")} sale(s). The current debt figure is a present receivable snapshot and is not added to those sales. [${item.citation}]`,
    itemLines.length ? "Top purchased items in that activity period:" : "No purchased-item lines were found in that activity period.",
    ...itemLines,
    `Identity/privacy boundary: exact identity only; no fuzzy person selection, no merge/write authority, and phone numbers are masked. [${item.citation}]`,
  ].join("\n\n");
}

function offeredCustomerAccountingTool(tools = []) {
  return (Array.isArray(tools) ? tools : []).find((tool) =>
    clean(tool?.key, 180).toLowerCase() === CUSTOMER_ACCOUNTING_TOOL_KEY &&
    Number(tool?.risk_level || 0) === 1
  ) || null;
}

function offeredCustomerCommercialTool(tools = []) {
  return (Array.isArray(tools) ? tools : []).find((tool) =>
    clean(tool?.key, 180).toLowerCase() === CUSTOMER_COMMERCIAL_TOOL_KEY &&
    Number(tool?.risk_level || 0) === 1
  ) || null;
}

function latestAssistantCustomerId(messages = []) {
  for (let index = (Array.isArray(messages) ? messages.length : 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "assistant") continue;
    const match = String(message?.content || "").match(/\bCustomer ID\s*#?(\d+)\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function customerIdFromQuestion(question = "") {
  const match = clean(question, 2000).match(/\bcustomer\s+(?:id\s*)?#?(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function customerQueryFromQuestion(question = "") {
  const text = clean(question, 2000);
  const patterns = [
    /\b(?:what does|how much does)\s+(.{2,90}?)\s+(?:owe|owing)\b/i,
    /\bwhat did\s+(.{2,90}?)\s+(?:buy|purchase)\b/i,
    /\bwhat has\s+(.{2,90}?)\s+(?:bought|purchased)\b/i,
    /\b(?:customer account|customer 360|customer commercial|purchase history)\s+(?:for|of)\s+(.{2,90}?)(?:\?|$)/i,
    /\b(?:outstanding debt|outstanding balance)\s+(?:for|of)\s+(.{2,90}?)(?:\?|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = clean(match[1], 180).replace(/[?.!,;:]+$/g, "");
    if (/^(?:he|she|they|them|him|her|that customer|this customer|the customer)$/i.test(candidate)) {
      return "";
    }
    return candidate;
  }
  return "";
}

function customerCommercialToolInput(messages = []) {
  const question = latestUserQuestion(messages);
  const dateInput = inferredDateInput(messages);
  if (CUSTOMER_COMMERCIAL_TOP_PATTERN.test(question)) {
    return Object.freeze({ mode: "top_customers", limit: 5, ...dateInput });
  }

  const directId = customerIdFromQuestion(question);
  if (directId) {
    return Object.freeze({ mode: "customer_account", customer_id: directId, ...dateInput });
  }

  const exactQuery = customerQueryFromQuestion(question);
  if (exactQuery) {
    return Object.freeze({ mode: "customer_account", customer_query: exactQuery, ...dateInput });
  }

  if (CUSTOMER_COMMERCIAL_FOLLOWUP_PATTERN.test(question)) {
    const priorId = latestAssistantCustomerId(messages);
    if (priorId) {
      return Object.freeze({ mode: "customer_account", customer_id: priorId, ...dateInput });
    }
  }
  return null;
}

function shouldUseCustomerCommercialTool({ messages = [], tools = [], providerContext = {} } = {}) {
  if (
    providerContext?.public_safe_social_turn === true ||
    providerContext?.public_safe_system_turn === true ||
    providerContext?.public_safe_general_turn === true ||
    clean(providerContext?.workspace_code, 60).toLowerCase() !== "spare_parts" ||
    evidenceFromMessages(messages).length > 0
  ) {
    return null;
  }
  const tool = offeredCustomerCommercialTool(tools);
  if (!tool) return null;
  const question = latestUserQuestion(messages);
  if (
    !CUSTOMER_COMMERCIAL_TOP_PATTERN.test(question) &&
    !CUSTOMER_COMMERCIAL_ACCOUNT_PATTERN.test(question) &&
    !CUSTOMER_COMMERCIAL_FOLLOWUP_PATTERN.test(question) &&
    !customerIdFromQuestion(question)
  ) {
    return null;
  }
  const input = customerCommercialToolInput(messages);
  return input ? Object.freeze({ tool, input }) : null;
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

function localCustomerCommercialToolCall(resolved = {}) {
  return Object.freeze({
    id: "local_customer_commercial_360",
    tool_key: clean(resolved?.tool?.key, 180).toLowerCase(),
    input: Object.freeze({ ...(resolved?.input || {}) }),
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

    const commercialRead = shouldUseCustomerCommercialTool({
      messages,
      tools,
      providerContext: provider_context,
    });
    if (commercialRead) {
      const text = `Checking the approved ${clean(commercialRead.tool.title || commercialRead.tool.key, 180)} evidence before answering.`;
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "local_read_only_tool",
        tool_calls: [localCustomerCommercialToolCall(commercialRead)],
        provider_store_enabled: false,
      };
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

    const evidence = evidenceFromMessages(messages);
    const commercialEvidence = evidence.find((item) =>
      CUSTOMER_COMMERCIAL_TOP_HEADING.test(item.heading) ||
      CUSTOMER_COMMERCIAL_ACCOUNT_HEADING.test(item.heading)
    );
    const commercialAnswer = composeCustomerCommercialAnswer(commercialEvidence);
    if (commercialAnswer) {
      return {
        text: commercialAnswer,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(commercialAnswer.length / 4),
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    }

    const accountingEvidence = evidence.find((item) =>
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
  CUSTOMER_COMMERCIAL_ACCOUNT_HEADING,
  CUSTOMER_COMMERCIAL_ACCOUNT_PATTERN,
  CUSTOMER_COMMERCIAL_FOLLOWUP_PATTERN,
  CUSTOMER_COMMERCIAL_TOOL_KEY,
  CUSTOMER_COMMERCIAL_TOP_HEADING,
  CUSTOMER_COMMERCIAL_TOP_PATTERN,
  LocalCustomerAccountingGovernedProvider,
  composeCustomerAccountingAnswer,
  composeCustomerAccountingProductAnswer,
  composeCustomerCommercialAnswer,
  customerCommercialToolInput,
  customerIdFromQuestion,
  customerQueryFromQuestion,
  latestAssistantCustomerId,
  localCustomerAccountingToolCall,
  localCustomerCommercialToolCall,
  offeredCustomerAccountingTool,
  offeredCustomerCommercialTool,
  periodText,
  scopePeriodText,
  shouldUseCustomerAccountingTool,
  shouldUseCustomerCommercialTool,
};
