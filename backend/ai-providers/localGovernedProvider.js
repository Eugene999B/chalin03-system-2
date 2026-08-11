"use strict";

const { CHALIN_PRODUCT_CONTEXT } = require("../services/aiProductKnowledgeService");

const MAX_EVIDENCE_ITEMS = 5;
const MAX_EXCERPT_LENGTH = 12000;
const MAX_READABLE_FACTS = 14;
const LOCAL_MODEL_KEY = "chalin-local-governed-v1";

const LOCAL_LIVE_TOOL_KEYS = Object.freeze([
  "system.group_intelligence",
  "spare_parts.performance_diagnostics",
  "spare_parts.operations_snapshot",
  "spare_parts.inventory_health",
  "spare_parts.collections_health",
  "mining.performance_diagnostics",
  "mining.operations_snapshot",
  "mining.stock_fuel_health",
  "mining.production_cost_health",
  "equipment_hire.performance_diagnostics",
  "equipment_hire.operations_snapshot",
  "equipment_hire.fleet_health",
  "equipment_hire.receivables_health",
  "equipment_finance.portfolio_health",
  "equipment_finance.arrears_health",
  "equipment_finance.cashflow_health",
  "equipment_finance.sales_pipeline",
]);

const TOOL_HINTS = Object.freeze([
  Object.freeze({
    key: "system.group_intelligence",
    pattern: /\b(?:whole[- ]system|group performance|group intelligence|across all (?:businesses|workspaces|operations)|all (?:businesses|workspaces|operations)|company[- ]wide operations|overall chalin performance)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.arrears_health",
    pattern: /\b(arrears?|overdue|delinquen|late payment|past due)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.cashflow_health",
    pattern: /\b(cash\s*flow|collection trend|scheduled payment|payment method|expected collection)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.sales_pipeline",
    pattern: /\b(credit application|kyc|affordability|sales pipeline|finance application|application pipeline)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.portfolio_health",
    pattern: /\b(installment|finance portfolio|financed equipment|portfolio health)\b/i,
  }),
  Object.freeze({
    key: "equipment_hire.performance_diagnostics",
    pattern: /\b(?:equipment hire performance|hire performance|hire underperform|hire commercial performance|billing lag|billing pressure|cash conversion|closure backlog|return backlog|why\s+(?:is|are|was|were)[^?]*(?:hire|fleet|collection|receivable|billing|invoice|quotation|contract|revenue)|hire revenue (?:low|down)|hire collections? (?:low|down))\b/i,
  }),
  Object.freeze({
    key: "equipment_hire.fleet_health",
    pattern: /\b(fleet|asset availability|maintenance|breakdown|utili[sz]ation|on hire)\b/i,
  }),
  Object.freeze({
    key: "equipment_hire.receivables_health",
    pattern: /\b(hire receivable|hire invoice|uninvoiced|hire collection|hire overdue)\b/i,
  }),
  Object.freeze({
    key: "equipment_hire.operations_snapshot",
    pattern: /\b(hire operation|quotation|hire contract|work log|equipment hire)\b/i,
  }),
  Object.freeze({
    key: "mining.stock_fuel_health",
    pattern: /\b(fuel|stockpile|diesel|tank|ore stock|mining stock)\b/i,
  }),
  Object.freeze({
    key: "mining.performance_diagnostics",
    pattern: /\b(?:mining performance|mine performance|site performance|low production|production (?:low|down)|mining underperform|mine underperform|operating efficiency|cost per unit (?:high|rising)|why\s+(?:is|are|was|were)[^?]*(?:production|utili[sz]ation|mining cost|cost per unit))\b/i,
  }),
  Object.freeze({
    key: "mining.production_cost_health",
    pattern: /\b(production|cost per|operating cost|mining cost|equipment utili[sz]ation|incident)\b/i,
  }),
  Object.freeze({
    key: "mining.operations_snapshot",
    pattern: /\b(mining|mine|site operation|dispatch|crew|site closing)\b/i,
  }),
  Object.freeze({
    key: "spare_parts.performance_diagnostics",
    pattern: /\b(?:profit|margin|why\s+(?:is|are|was|were)|performance|cash[- ]?poor|cash pressure|expense pressure|discount pressure|sales pressure|commercial performance|store performance|branch performance)\b/i,
  }),
  Object.freeze({
    key: "spare_parts.inventory_health",
    pattern: /\b(inventory|stock|low stock|negative stock|product quantity|stock value)\b/i,
  }),
  Object.freeze({
    key: "spare_parts.collections_health",
    pattern: /\b(debt|debtor|collection|credit sale|outstanding balance|receivable)\b/i,
  }),
  Object.freeze({
    key: "spare_parts.operations_snapshot",
    pattern: /\b(spare parts|sales?|sold|selling|sell|purchase|return|expense|branch operation)\b/i,
  }),
]);

const WORKSPACE_DEFAULT_TOOLS = Object.freeze({
  spare_parts: Object.freeze(["spare_parts.operations_snapshot"]),
  mining: Object.freeze(["mining.operations_snapshot"]),
  equipment_hire: Object.freeze([
    "equipment_hire.performance_diagnostics",
    "equipment_hire.operations_snapshot",
    "equipment_finance.portfolio_health",
  ]),
});

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function evidenceFromMessages(messages = []) {
  const seen = new Set();
  const evidence = [];
  const pattern = /\[(E\d+)\]\s+([^\n]+)\n([\s\S]*?)(?=\n\n\[E\d+\]|$)/g;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!["system", "developer"].includes(String(message?.role || "").toLowerCase())) {
      continue;
    }
    const content = String(message?.content || "");
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) && evidence.length < MAX_EVIDENCE_ITEMS) {
      const citation = match[1];
      if (seen.has(citation)) continue;
      const heading = clean(match[2], 360);
      const excerpt = clean(match[3], MAX_EXCERPT_LENGTH);
      if (!excerpt) continue;
      seen.add(citation);
      evidence.push({ citation, heading, excerpt });
    }
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
  }

  return evidence;
}

function latestUserQuestion(messages = []) {
  for (let index = (Array.isArray(messages) ? messages.length : 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    const question = clean(message?.content, 2000);
    if (question) return question;
  }
  return "";
}

function recentUserContext(messages = [], limit = 4) {
  const turns = [];
  for (let index = (Array.isArray(messages) ? messages.length : 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    const question = clean(message?.content, 2000);
    if (!question) continue;
    turns.unshift(question);
    if (turns.length >= limit) break;
  }
  return turns.join(" \n ");
}

function offeredReadOnlyToolMap(tools = []) {
  const allowed = new Set(LOCAL_LIVE_TOOL_KEYS);
  const result = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    const key = clean(tool?.key, 150).toLowerCase();
    if (!allowed.has(key)) continue;
    if (Number(tool?.risk_level || 0) !== 1) continue;
    result.set(key, tool);
  }
  return result;
}

function chooseLocalReadTool({ messages = [], tools = [], providerContext = {} } = {}) {
  if (
    providerContext?.public_safe_social_turn === true ||
    providerContext?.public_safe_system_turn === true ||
    providerContext?.public_safe_general_turn === true
  ) {
    return null;
  }
  if (evidenceFromMessages(messages).length > 0) return null;

  const offered = offeredReadOnlyToolMap(tools);
  if (offered.size === 0) return null;

  // A short answer such as "at main store" can be completing the prior
  // question, so tool choice uses the recent user thread rather than treating
  // the last sentence as an isolated request.
  const question = recentUserContext(messages) || latestUserQuestion(messages);
  for (const hint of TOOL_HINTS) {
    if (hint.pattern.test(question) && offered.has(hint.key)) {
      return offered.get(hint.key);
    }
  }

  const workspace = clean(providerContext?.workspace_code, 50).toLowerCase();
  for (const key of WORKSPACE_DEFAULT_TOOLS[workspace] || []) {
    if (offered.has(key)) return offered.get(key);
  }

  if (offered.size === 1) return [...offered.values()][0];
  return null;
}

function readableLabel(value) {
  return clean(value, 200)
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function collectReadableFacts(value, path = [], facts = [], depth = 0) {
  if (facts.length >= MAX_READABLE_FACTS || depth > 4 || value === null || value === undefined) {
    return facts;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    const label = readableLabel(path.join(" ") || "Value");
    facts.push(`${label}: ${clean(value, 240)}`);
    return facts;
  }

  if (Array.isArray(value)) {
    if (value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
      const label = readableLabel(path.join(" ") || "Values");
      facts.push(`${label}: ${value.slice(0, 6).map((item) => clean(item, 80)).join(", ")}`);
      return facts;
    }
    const label = readableLabel(path.join(" ") || "Items");
    facts.push(`${label}: ${value.length} item${value.length === 1 ? "" : "s"}`);
    for (const item of value.slice(0, 2)) {
      collectReadableFacts(item, path, facts, depth + 1);
      if (facts.length >= MAX_READABLE_FACTS) break;
    }
    return facts;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectReadableFacts(item, [...path, key], facts, depth + 1);
      if (facts.length >= MAX_READABLE_FACTS) break;
    }
  }
  return facts;
}

function readableExcerpt(excerpt) {
  const raw = clean(excerpt, MAX_EXCERPT_LENGTH);
  if (!raw) return "";
  if (!/^[\[{]/.test(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    const facts = collectReadableFacts(parsed);
    return facts.length > 0 ? facts.join("; ") : raw;
  } catch {
    return raw;
  }
}

function parseEvidenceJson(excerpt) {
  const raw = clean(excerpt, MAX_EXCERPT_LENGTH);
  if (!raw || !/^[\[{]/.test(raw)) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "GHS 0.00";
  return `GHS ${number.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function evidencePeriodText(data = {}) {
  const period = Array.isArray(data.period) ? data.period : [];
  const start = clean(period[0], 20);
  const end = clean(period[1], 20);
  if (!start || !end) return "";
  return start === end ? ` on ${start}` : ` from ${start} to ${end}`;
}

function miningPeriodText(data = {}) {
  const start = clean(data?.scope?.start_date, 20);
  const end = clean(data?.scope?.end_date, 20);
  if (!start || !end) return "";
  return start === end ? ` on ${start}` : ` from ${start} to ${end}`;
}

function composeSparePartsOperationsAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.sales || !Array.isArray(data?.period)) return null;
  const sales = data.sales;
  const branchName = clean(data.branch_name || data.branch_code || "", 120);
  const location = branchName ? ` at ${branchName}` : "";
  const period = evidencePeriodText(data);
  const transactions = Number(sales.transaction_count || 0);
  const total = formatMoney(sales.total_sales);
  const paid = formatMoney(sales.total_paid);
  const balance = formatMoney(sales.total_balance);
  const collectionRate = Number(sales.collection_rate || 0);
  return [
    `Spare Parts${location} recorded ${transactions.toLocaleString("en-GH")} sale${transactions === 1 ? "" : "s"}${period}, totaling ${total}. [${item.citation}]`,
    `Paid: ${paid}. Outstanding from those sales: ${balance}.${Number.isFinite(collectionRate) ? ` Collection rate: ${collectionRate.toFixed(2)}%.` : ""} [${item.citation}]`,
    "If you want, I can next break down what this means operationally rather than just repeat the figures.",
  ].join("\n\n");
}

function composeSparePartsPerformanceAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.financial_view || !Array.isArray(data?.drivers)) return null;
  const branchName = clean(data.branch_name || data.branch_code || "", 120);
  const location = branchName ? ` for ${branchName}` : "";
  const period = evidencePeriodText(data);
  const financial = data.financial_view;
  const certainty = data.certainty || {};
  const drivers = data.drivers.slice(0, 5);
  const driverLines = drivers.map((driver, index) => {
    const title = clean(driver.key || driver.category || "driver", 120).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 700);
    const effect = clean(driver.effect || "", 120).replace(/_/g, " ");
    return `${index + 1}. ${title}: ${explanation}${effect ? ` Effect: ${effect}.` : ""} [${item.citation}]`;
  });
  return [
    `The live Spare Parts performance diagnosis${location}${period} shows a management net estimate before reliable stock cost of ${formatMoney(financial.estimated_net_before_stock_cost)}, with ${formatMoney(financial.gross_sales)} gross sales, ${formatMoney(financial.discounts)} discounts and ${formatMoney(financial.operating_expenses)} operating expenses. [${item.citation}]`,
    `Cash conversion is separate: ${formatMoney(financial.total_paid)} was paid, ${formatMoney(financial.sales_balance)} remained on those sales, and the collection rate was ${Number(financial.collection_rate || 0).toFixed(2)}%. [${item.citation}]`,
    "Main evidence-backed drivers:",
    ...driverLines,
    `Accounting boundary: ${clean(certainty.warning || "True profit requires reliable COGS; purchases are not certified COGS.", 700)} [${item.citation}]`,
  ].join("\n\n");
}

function composeMiningPerformanceAnswer(item) {
  const data = parseEvidenceJson(item?.excerpt);
  if (!data?.performance_view || !Array.isArray(data?.drivers)) return null;
  const view = data.performance_view;
  const siteName = clean(data?.scope?.site_name || data?.scope?.site_code || "", 120);
  const location = siteName ? ` for ${siteName}` : "";
  const period = miningPeriodText(data);
  const unit = clean(view.production_unit || "units", 50);
  const targetText = view.target_attainment_percent == null
    ? "No configured target-reference percentage is available for this period."
    : `Target-reference attainment is ${Number(view.target_attainment_percent).toFixed(2)}%.`;
  const costText = view.operating_cost_per_recorded_unit == null
    ? "Operating cost per recorded unit is unavailable because there is no recorded production for the period."
    : `Recorded operating expense per production unit is ${formatMoney(view.operating_cost_per_recorded_unit)}.`;
  const driverLines = data.drivers.slice(0, 6).map((driver, index) => {
    const title = clean(driver.key || driver.category || "driver", 120).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 750);
    return `${index + 1}. ${title}: ${explanation} [${item.citation}]`;
  });
  return [
    `The live Mining performance diagnosis${location}${period} shows ${Number(view.production_quantity || 0).toLocaleString("en-GH")} ${unit} of recorded production, ${Number(view.dispatched_quantity || 0).toLocaleString("en-GH")} ${unit} approved for dispatch, and ${Number(view.equipment_utilization_percent || 0).toFixed(2)}% recorded equipment utilization. [${item.citation}]`,
    `${targetText} ${costText} [${item.citation}]`,
    "Main evidence-backed drivers:",
    ...driverLines,
    `Evidence boundary: ${clean(data?.certainty?.warning || "This is operational performance evidence, not a Mining revenue or profit calculation.", 800)} [${item.citation}]`,
  ].join("\n\n");
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
  const fleetAvailability = view.fleet_availability_percent == null
    ? "unavailable"
    : `${Number(view.fleet_availability_percent).toFixed(2)}%`;
  const onHire = view.fleet_on_hire_percent == null
    ? "unavailable"
    : `${Number(view.fleet_on_hire_percent).toFixed(2)}%`;
  const driverLines = data.drivers.slice(0, 7).map((driver, index) => {
    const title = clean(driver.key || driver.category || "driver", 120).replace(/_/g, " ");
    const explanation = clean(driver.explanation || "", 800);
    return `${index + 1}. ${title}: ${explanation} [${item.citation}]`;
  });
  return [
    `The live Equipment Hire performance diagnosis${location} shows ${Number(view.total_assets || 0).toLocaleString("en-GH")} fleet asset(s), ${Number(view.assets_on_hire || 0).toLocaleString("en-GH")} on Hire, ${Number(view.maintenance_or_breakdown_assets || 0).toLocaleString("en-GH")} in maintenance/breakdown, fleet availability of ${fleetAvailability}, and fleet-on-Hire share of ${onHire}. [${item.citation}]`,
    `Commercially, the governed aggregate shows ${formatMoney(view.open_quotation_value)} in open quotation pipeline, ${formatMoney(view.invoiced_amount)} billed on non-void invoices, ${formatMoney(view.paid_amount)} collected, ${formatMoney(view.outstanding_amount)} outstanding and ${formatMoney(view.overdue_amount)} overdue. Collection rate: ${Number(view.collection_rate_percent || 0).toFixed(2)}%. [${item.citation}]`,
    `Billing/closure controls: ${Number(view.approved_uninvoiced_work_logs || 0)} approved uninvoiced work log(s), ${Number(view.returns_due_or_incomplete || 0)} return(s) due/incomplete, and ${Number(view.returned_pending_closure || 0)} returned contract(s) pending closure. [${item.citation}]`,
    "Main evidence-backed drivers:",
    ...driverLines,
    `Evidence boundary: ${clean(data?.certainty?.warning || "This is Equipment Hire commercial and operating evidence, not a certified profit calculation.", 900)} [${item.citation}]`,
  ].join("\n\n");
}

function composeEvidenceAnswer(messages = []) {
  const evidence = evidenceFromMessages(messages);
  if (evidence.length === 0) {
    return "I do not have enough approved live CHALIN evidence to answer that reliably. I will not guess or substitute an unrelated workspace snapshot.";
  }

  const hirePerformance = evidence.find((item) =>
    /equipment hire commercial and fleet performance diagnostics/i.test(item.heading)
  );
  const directHirePerformanceAnswer = composeHirePerformanceAnswer(hirePerformance);
  if (directHirePerformanceAnswer) return directHirePerformanceAnswer;

  const miningPerformance = evidence.find((item) =>
    /mining site performance diagnostics/i.test(item.heading)
  );
  const directMiningPerformanceAnswer = composeMiningPerformanceAnswer(miningPerformance);
  if (directMiningPerformanceAnswer) return directMiningPerformanceAnswer;

  const sparePartsPerformance = evidence.find((item) =>
    /spare parts cross-module performance diagnostics/i.test(item.heading)
  );
  const directPerformanceAnswer = composeSparePartsPerformanceAnswer(sparePartsPerformance);
  if (directPerformanceAnswer) return directPerformanceAnswer;

  const sparePartsOperations = evidence.find((item) =>
    /spare parts operations snapshot/i.test(item.heading)
  );
  const directSparePartsAnswer = composeSparePartsOperationsAnswer(sparePartsOperations);
  if (directSparePartsAnswer) return directSparePartsAnswer;

  const lines = evidence.map((item) => {
    const excerpt = readableExcerpt(item.excerpt);
    return `- ${item.heading}: ${excerpt}${excerpt.endsWith(".") ? "" : "."} [${item.citation}]`;
  });
  return [
    "The approved CHALIN evidence shows:",
    "",
    ...lines,
    "",
    "I used only the supplied governed evidence and did not execute a business change.",
  ].join("\n");
}

function composePublicSafeSocialAnswer(messages = []) {
  const question = latestUserQuestion(messages).toLowerCase();
  if (/\b(?:thanks|thank you)\b/.test(question)) {
    return "You’re welcome. I’m ready whenever you need help with CHALIN or a general question.";
  }
  if (/\b(?:bye|goodbye|see you)\b/.test(question)) {
    return "Goodbye. I’ll be here when you need me.";
  }
  if (/\bwho are you\b/.test(question)) {
    return "I’m CHALIN Copilot, your governed assistant for the CHALIN system. I can explain the product, help think through IT, marketing and business questions, and investigate approved live business information when your permissions allow it.";
  }
  if (/\b(?:what can you do|how can you help|can you help)\b/.test(question)) {
    return "I can explain CHALIN workflows, help with IT and marketing ideas, reason through business problems, and answer approved live business questions using the information and read-only tools your account is allowed to access.";
  }
  return "Hi! I’m ready to help. You can ask about CHALIN, IT, marketing, business decisions or your authorized operational information.";
}

function composePublicSafeSystemAnswer(messages = []) {
  const question = latestUserQuestion(messages).toLowerCase();

  if (/\baudit(?:\s+|-)intelligence\b|\badvanced accounting intelligence\b/.test(question)) {
    return [
      "Audit Intelligence is CHALIN’s management and audit observatory. It helps you understand whether the business records make sense and where management should investigate.",
      "",
      "It combines signals from sales and collections, unpaid balances and debts, expenses and purchases, returns/refunds, stock adjustments and transfers, SMS delivery, sensitive system events, backup/restore and maintenance activity, audit unlocks and sign-off controls. It then turns those signals into an audit status, review checklist, profit-and-loss intelligence, management ledger, debt/aging intelligence and control warnings.",
      "",
      "In simple terms: it should help you see what looks wrong, why it matters and what needs investigation next.",
    ].join("\n");
  }

  if (/\bpayroll\b|\bworker profile\b|\bsalary\b/.test(question)) {
    return "In CHALIN, People & Employment should be the source of worker identity and compensation. A worker’s effective salary/pay-frequency record should flow into Monthly Payroll so the salary is not retyped every month. Payroll then previews the workers and authoritative salaries for the period before approval, payment and payslip generation.";
  }

  if (/\bspare parts\b|\bstock adjustment\b|\bstock transfer\b|\bcustomer debt\b|\btrue profit\b|\bcogs\b/.test(question)) {
    return [
      "CHALIN Spare Parts should be understood as connected commercial flows, not isolated screens: Customer → Sale → Payment/Balance → Debt → Debt Payment; and Product → Purchase/Cost History → Stock → Sale → Revenue.",
      "",
      "For profit questions, sales are not profit and purchases are not automatically COGS. The current CHALIN ONE accounting layer gives a management estimate using net sales and operating expenses, while true profit still requires reliable cost-of-goods-sold evidence. Collections explain cash conversion, not profit by themselves.",
      "",
      "Returns/refunds should be traced back to the original sale and stock/cash reversal, while stock adjustments and transfer mismatches are control signals that can weaken confidence in the numbers. For current branch figures I must use governed live evidence rather than this product knowledge.",
    ].join("\n");
  }

  if (/\b(?:mining|mining site|mine site|stockpile|site closing|mining production|mining fuel)\b/.test(question)) {
    return [
      "CHALIN Mining is a site-scoped operating system. The verified flow is Authorized Site → Shift/Crew → Production → Stockpile → Dispatch, with equipment hours, fuel control, expenses, incidents and site closing providing the operating and control context.",
      "",
      "For performance questions I separate output pressure, recorded operating expense per production unit, equipment working/idle/breakdown time, fuel/stockpile constraints, dispatch flow and pending control/safety issues. Production and dispatch are related but different measures, so a gap is not automatically loss.",
      "",
      "The current governed Mining intelligence does not expose Mining revenue or certified profit. I can explain production and operating efficiency from the available evidence, but I should not invent a profit figure. For current site figures I must use the authorized Mining live tools.",
    ].join("\n");
  }

  if (/\b(?:equipment hire|hire operations|hire contract|hire quotation|hire fleet|hire invoice|hire receivable|rental fleet)\b/.test(question)) {
    return [
      "CHALIN Equipment Hire is a location-scoped commercial and fleet workflow: Customer → Enquiry → Fleet Availability → Quotation → Contract → Asset Assignment/Dispatch → Work Logs → Invoice/Payment → Return → Closure Review.",
      "",
      "For performance questions I separate pipeline from realized business, fleet capacity/reliability from billing, and billed value from cash collection. Open quotation value is pipeline, invoice totals are billed commercial value, payments are collections, and outstanding/overdue balances are receivables. Approved uninvoiced work is a billing-review signal, not automatic lost revenue.",
      "",
      "The current governed Hire snapshot does not provide a complete Hire cost model or certified profit. I can diagnose fleet, billing, collection and closure pressure from authorized live evidence, but I should not invent profit from quotations, invoices, payments or fleet activity.",
    ].join("\n");
  }

  if (/\bmarketing\b|\badvertis|\bbrand|\bcampaign|\bpositioning\b/.test(question)) {
    return "For CHALIN marketing, lead with the operational problem CHALIN solves instead of listing every feature. Segment the message by buyer, demonstrate the before/after workflow, use concrete proof, and measure qualified leads, demos, activation and retained use. I can go deeper on positioning, campaigns, copy or channels if you tell me what you are trying to achieve.";
  }

  if (/\barchitecture\b|\bsoftware\b|\bit\b|\btechnical\b|\bdatabase\b|\bsecurity\b|\bcyber/.test(question)) {
    return "CHALIN should be treated as a multi-workspace business platform with server-enforced permissions, scoped business services, audit evidence and a separate AI tool boundary. The main IT priorities are reliability, explicit data boundaries, least privilege, transactional business operations, observable deployments, recoverability and governed APIs instead of direct AI database access.";
  }

  return "I can explain this from CHALIN’s product model and reason through it with you. Tell me the specific part you want to understand and I’ll answer it directly before adding detail.";
}

function composePublicSafeGeneralAnswer() {
  return "This question does not require private CHALIN records. A configured external reasoning provider should answer it normally. CHALIN Local is only the governed fallback, so I will not pretend it has broad world knowledge that it does not have.";
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function inferredDateInput(messages = [], now = new Date()) {
  const question = recentUserContext(messages).toLowerCase();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/\byesterday\b/.test(question)) {
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const value = isoDate(yesterday);
    return Object.freeze({ start_date: value, end_date: value });
  }
  if (/\bthis\s+week\b/.test(question)) {
    const start = new Date(today);
    const weekday = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - weekday + 1);
    return Object.freeze({ start_date: isoDate(start), end_date: isoDate(today) });
  }
  if (/\bthis\s+month\b/.test(question)) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return Object.freeze({ start_date: isoDate(start), end_date: isoDate(today) });
  }
  if (/\b(today|today's|right now|current|currently|latest|live)\b/.test(question)) {
    const value = isoDate(today);
    return Object.freeze({ start_date: value, end_date: value });
  }
  return Object.freeze({});
}

function localToolCall(tool, messages = []) {
  const key = clean(tool?.key, 150).toLowerCase();
  return Object.freeze({
    id: `local_${key.replace(/[^a-z0-9]+/gi, "_").slice(0, 90)}`,
    tool_key: key,
    input: inferredDateInput(messages),
  });
}

class LocalGovernedProvider {
  constructor() {
    this.key = "local";
  }

  async generate({ messages = [], tools = [], provider_context = {} } = {}) {
    if (provider_context?.public_safe_social_turn === true) {
      const text = composePublicSafeSocialAnswer(messages);
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

    if (provider_context?.public_safe_system_turn === true) {
      const text = composePublicSafeSystemAnswer(messages);
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

    if (provider_context?.public_safe_general_turn === true) {
      const text = composePublicSafeGeneralAnswer(messages);
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

    const selectedTool = chooseLocalReadTool({
      messages,
      tools,
      providerContext: provider_context,
    });

    if (selectedTool) {
      const text = `Checking the approved ${clean(selectedTool.title || selectedTool.key, 180)} evidence before answering.`;
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "local_read_only_tool",
        tool_calls: [localToolCall(selectedTool, messages)],
        provider_store_enabled: false,
      };
    }

    const text = composeEvidenceAnswer(messages);
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

module.exports = {
  CHALIN_PRODUCT_CONTEXT,
  LOCAL_LIVE_TOOL_KEYS,
  LOCAL_MODEL_KEY,
  LocalGovernedProvider,
  TOOL_HINTS,
  WORKSPACE_DEFAULT_TOOLS,
  chooseLocalReadTool,
  collectReadableFacts,
  composeEvidenceAnswer,
  composeHirePerformanceAnswer,
  composeMiningPerformanceAnswer,
  composePublicSafeGeneralAnswer,
  composePublicSafeSocialAnswer,
  composePublicSafeSystemAnswer,
  composeSparePartsOperationsAnswer,
  composeSparePartsPerformanceAnswer,
  evidenceFromMessages,
  formatMoney,
  inferredDateInput,
  latestUserQuestion,
  localToolCall,
  offeredReadOnlyToolMap,
  parseEvidenceJson,
  readableExcerpt,
  recentUserContext,
};
