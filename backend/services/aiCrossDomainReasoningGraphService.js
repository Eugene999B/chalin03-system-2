"use strict";

const MAX_GRAPH_DOMAINS = 8;
const MAX_GRAPH_OBJECTIVES = 8;
const MAX_GRAPH_RELATIONSHIPS = 12;
const MAX_GRAPH_EVIDENCE_FAMILIES = 16;
const MAX_GRAPH_TEXT = 12000;

const KNOWN_DOMAINS = new Set([
  "payroll",
  "spare_parts",
  "mining",
  "equipment_hire",
  "equipment_finance",
  "customer_accounting",
  "audit_controls_security",
  "chalin_product",
]);

const KNOWN_EVIDENCE_FAMILIES = new Set([
  "sales",
  "profit",
  "inventory",
  "customer",
  "debt",
  "worker",
  "payroll",
  "mining",
  "equipment_hire",
  "equipment_finance",
  "audit",
  "document",
  "conversation_context",
]);

const CORE_OPERATING_DOMAINS = Object.freeze([
  "spare_parts",
  "mining",
  "equipment_hire",
  "equipment_finance",
]);

const ENTERPRISE_HEALTH_DOMAINS = Object.freeze([
  ...CORE_OPERATING_DOMAINS,
  "customer_accounting",
  "payroll",
]);

const ENTERPRISE_EVIDENCE = Object.freeze([
  "sales",
  "profit",
  "inventory",
  "mining",
  "equipment_hire",
  "equipment_finance",
]);

const ENTERPRISE_HEALTH_EVIDENCE = Object.freeze([
  ...ENTERPRISE_EVIDENCE,
  "customer",
  "debt",
  "payroll",
  "worker",
]);

const PROFIT_PATTERN = /\b(?:profit|profits|margin|margins|gross profit|net profit)\b/i;
const RECEIVABLE_PATTERN = /\b(?:customer debt|debt|debts|owe|owes|owing|receivable|receivables|arrears|collection|collections)\b/i;
const WORKFORCE_COST_PATTERN = /\b(?:payroll|salary|salaries|wage|wages|compensation)\b/i;
const WORKFORCE_DRIVER_PATTERN = /\b(?:worker|workers|employee|employees|staff|headcount|overtime|allowance|allowances|deduction|deductions)\b/i;
const CONTROL_PATTERN = /\b(?:audit|approval|approvals|approved|governance|control|controls|security|who changed|who approved|activity log|suspicious|risk[- ]?5)\b/i;
const FINANCE_PATTERN = /\b(?:equipment finance|installment finance|instalment finance|finance account|repayment|arrears|portfolio|down payment|opening deposit)\b/i;
const HIRE_PATTERN = /\b(?:equipment hire|hire contract|rental|fleet utilisation|fleet utilization|dispatch|dispatcher)\b/i;
const MINING_PATTERN = /\b(?:mining|mine site|mining site|site production|production shift|ore|fuel usage|mining fuel)\b/i;
const ENTERPRISE_COMPARISON_PATTERN = /(?:\b(?:which|what)\s+(?:one|business|division)\b[\s\S]{0,100}\b(?:most|highest|best)\b[\s\S]{0,60}\b(?:money|profit|revenue|sales|performance)\b)|(?:\b(?:most profitable|highest revenue|highest profit|best performing)\b[\s\S]{0,60}\b(?:business|division)\b)/i;
const ENTERPRISE_HEALTH_PATTERN = /\b(?:things|business|company|group|operations|system)\b[\s\S]{0,70}\b(?:wrong|bad|down|problem|problems|not look good|not looking good|don't look good|doesn't look good)\b/i;
const LIVE_SIGNAL_PATTERN = /\b(?:today|yesterday|now|current|currently|latest|live|outstanding|overdue|this week|this month|last week|last month|right now)\b/i;

function clean(value, maximum = MAX_GRAPH_TEXT) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function unique(values = [], maximum = Number.MAX_SAFE_INTEGER) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = clean(value, 160);
    if (!text) continue;
    if (output.some((item) => item.toLowerCase() === text.toLowerCase())) continue;
    output.push(text);
    if (output.length >= maximum) break;
  }
  return output;
}

function safeDomains(values = []) {
  return unique(values, MAX_GRAPH_DOMAINS).filter((item) => KNOWN_DOMAINS.has(item));
}

function safeEvidenceFamilies(values = []) {
  return unique(values, MAX_GRAPH_EVIDENCE_FAMILIES).filter((item) => KNOWN_EVIDENCE_FAMILIES.has(item));
}

function relationship(key, domains = [], evidenceFamilies = [], { live = false } = {}) {
  return Object.freeze({
    key,
    domains: Object.freeze(safeDomains(domains)),
    evidence_families: Object.freeze(safeEvidenceFamilies(evidenceFamilies)),
    live_data_required: live === true,
  });
}

function relationshipsForText(text, baseDomains = []) {
  const value = clean(text, MAX_GRAPH_TEXT);
  const domains = safeDomains(baseDomains);
  const relationships = [];
  const add = (entry) => {
    if (!entry?.key || relationships.some((item) => item.key === entry.key)) return;
    relationships.push(entry);
  };

  if (ENTERPRISE_COMPARISON_PATTERN.test(value)) {
    add(relationship(
      "enterprise_business_performance_comparison",
      CORE_OPERATING_DOMAINS,
      ENTERPRISE_EVIDENCE,
      { live: true }
    ));
  }

  if (ENTERPRISE_HEALTH_PATTERN.test(value) && LIVE_SIGNAL_PATTERN.test(value)) {
    add(relationship(
      "enterprise_operating_health_diagnosis",
      ENTERPRISE_HEALTH_DOMAINS,
      ENTERPRISE_HEALTH_EVIDENCE,
      { live: true }
    ));
  }

  if (PROFIT_PATTERN.test(value)) {
    add(relationship(
      "profit_driver_bridge",
      [],
      ["profit", "sales", "inventory"],
      { live: LIVE_SIGNAL_PATTERN.test(value) }
    ));
  }

  if (
    RECEIVABLE_PATTERN.test(value) &&
    !domains.includes("equipment_finance") &&
    !domains.includes("equipment_hire") &&
    !domains.includes("mining")
  ) {
    add(relationship(
      "receivables_cash_conversion_bridge",
      ["customer_accounting"],
      ["customer", "debt"],
      { live: true }
    ));
  }

  if (WORKFORCE_COST_PATTERN.test(value)) {
    add(relationship(
      "workforce_cost_bridge",
      ["payroll"],
      WORKFORCE_DRIVER_PATTERN.test(value) ? ["payroll", "worker"] : ["payroll", "worker"],
      { live: LIVE_SIGNAL_PATTERN.test(value) }
    ));
  }

  if (CONTROL_PATTERN.test(value)) {
    add(relationship(
      "control_governance_overlay",
      ["audit_controls_security"],
      ["audit"],
      { live: /\b(?:today|current|currently|latest|who changed|who approved|activity log|suspicious)\b/i.test(value) }
    ));
  }

  if (FINANCE_PATTERN.test(value) && domains.includes("equipment_finance")) {
    add(relationship(
      "equipment_finance_portfolio_bridge",
      ["equipment_finance"],
      ["equipment_finance"],
      { live: LIVE_SIGNAL_PATTERN.test(value) || /\b(?:arrears|repayment|portfolio|opening deposit)\b/i.test(value) }
    ));
  }

  if (HIRE_PATTERN.test(value) && domains.includes("equipment_hire")) {
    add(relationship(
      "equipment_hire_commercial_bridge",
      ["equipment_hire"],
      ["equipment_hire"],
      { live: LIVE_SIGNAL_PATTERN.test(value) }
    ));
  }

  if (MINING_PATTERN.test(value) && domains.includes("mining")) {
    add(relationship(
      "mining_performance_bridge",
      ["mining"],
      ["mining"],
      { live: LIVE_SIGNAL_PATTERN.test(value) }
    ));
  }

  return Object.freeze(relationships.slice(0, MAX_GRAPH_RELATIONSHIPS));
}

function graphForObjective(question, baseDomains = [], baseEvidenceFamilies = [], inheritedLive = false) {
  const text = clean(question, 1200);
  const relationships = relationshipsForText(text, baseDomains);
  const domains = safeDomains([
    ...baseDomains,
    ...relationships.flatMap((item) => item.domains),
  ]);
  const evidenceFamilies = safeEvidenceFamilies([
    ...baseEvidenceFamilies,
    ...relationships.flatMap((item) => item.evidence_families),
  ]);
  return Object.freeze({
    question: text,
    domains: Object.freeze(domains),
    evidence_families: Object.freeze(evidenceFamilies),
    relationship_keys: Object.freeze(relationships.map((item) => item.key)),
    live_data_required:
      inheritedLive === true || relationships.some((item) => item.live_data_required === true),
  });
}

function buildCrossDomainReasoningGraph({ taskUnderstanding = null } = {}) {
  const task = taskUnderstanding && typeof taskUnderstanding === "object" ? taskUnderstanding : {};
  const currentPrompt = clean(task.current_prompt, MAX_GRAPH_TEXT);
  const primaryDomains = safeDomains(task.domains);
  const baseEvidence = safeEvidenceFamilies(task.evidence_families);
  const objectiveTexts = Array.isArray(task.objectives) && task.objectives.length
    ? task.objectives.slice(0, MAX_GRAPH_OBJECTIVES)
    : currentPrompt
      ? [currentPrompt]
      : [];

  const overallRelationships = relationshipsForText(
    [currentPrompt, ...objectiveTexts].filter(Boolean).join("\n"),
    primaryDomains
  );
  const relatedDomains = safeDomains(
    overallRelationships
      .flatMap((item) => item.domains)
      .filter((domain) => !primaryDomains.includes(domain))
  );
  const domains = safeDomains([...primaryDomains, ...relatedDomains]);
  const evidenceFamilies = safeEvidenceFamilies([
    ...baseEvidence,
    ...overallRelationships.flatMap((item) => item.evidence_families),
  ]);
  const objectives = objectiveTexts.map((question, index) => {
    const graph = graphForObjective(
      question,
      primaryDomains,
      baseEvidence,
      task.live_data_required === true
    );
    return Object.freeze({
      id: `graph_objective_${index + 1}`,
      ...graph,
    });
  });
  const liveDataRequired =
    task.live_data_required === true ||
    overallRelationships.some((item) => item.live_data_required === true) ||
    objectives.some((item) => item.live_data_required === true);

  return Object.freeze({
    version: 1,
    source_of_truth: false,
    permission_authority: false,
    execution_authority: false,
    primary_domains: Object.freeze(primaryDomains),
    related_domains: Object.freeze(relatedDomains),
    domains: Object.freeze(domains),
    cross_domain: domains.length > 1,
    evidence_families: Object.freeze(evidenceFamilies),
    relationship_keys: Object.freeze(overallRelationships.map((item) => item.key)),
    relationships: Object.freeze(overallRelationships),
    objective_count: objectives.length,
    objectives: Object.freeze(objectives),
    live_data_required: liveDataRequired,
  });
}

module.exports = {
  CORE_OPERATING_DOMAINS,
  ENTERPRISE_HEALTH_DOMAINS,
  ENTERPRISE_HEALTH_EVIDENCE,
  ENTERPRISE_EVIDENCE,
  KNOWN_DOMAINS,
  KNOWN_EVIDENCE_FAMILIES,
  MAX_GRAPH_DOMAINS,
  MAX_GRAPH_EVIDENCE_FAMILIES,
  MAX_GRAPH_OBJECTIVES,
  MAX_GRAPH_RELATIONSHIPS,
  buildCrossDomainReasoningGraph,
  graphForObjective,
  relationshipsForText,
  safeDomains,
  safeEvidenceFamilies,
};
