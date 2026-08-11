"use strict";

const {
  getKnowledgeHealthSnapshot,
} = require("./aiKnowledgeHealthService");

const MAX_CURRICULUM_ITEMS = 40;

const EXPERT_PACKS = Object.freeze([
  Object.freeze({
    key: "people_employment_payroll",
    title: "People, Employment & Payroll",
    workspaces: Object.freeze(["spare_parts", "mining", "equipment_hire"]),
    pattern: /\b(worker|employee|employment|hr|payroll|salary|wage|payslip|allowance|deduction|compensation|leave|termination|offboard)\b/i,
    expected_topics: Object.freeze([
      "worker profile source of truth",
      "effective-dated compensation and pay frequency",
      "payroll period preview and calculation",
      "allowances, deductions and adjustments",
      "payroll review, approval and payment",
      "payslip generation and payroll audit trail",
      "employment changes, termination and offboarding",
    ]),
  }),
  Object.freeze({
    key: "spare_parts",
    title: "Spare Parts Operations",
    workspaces: Object.freeze(["spare_parts"]),
    pattern: /\b(spare parts|product|inventory|stock|supplier|purchase|sale|sales|store|branch|return|refund|transfer|daily closing|reorder|margin)\b/i,
    expected_topics: Object.freeze([
      "products, suppliers and purchasing",
      "inventory quantity and valuation",
      "sales, pricing and margin",
      "customers, debts and collections",
      "returns and refunds",
      "stock adjustments and transfers",
      "daily closing and reconciliation",
      "profit and stock-loss investigation",
    ]),
  }),
  Object.freeze({
    key: "mining",
    title: "Mining Operations",
    workspaces: Object.freeze(["mining"]),
    pattern: /\b(mining|mine|site|shift|production|stockpile|ore|fuel|diesel|crew|incident|mining cost)\b/i,
    expected_topics: Object.freeze([
      "site setup and operating scope",
      "shift and daily operating logs",
      "production and stockpiles",
      "fuel control and consumption",
      "equipment activity and utilization",
      "workforce and contractors",
      "site expenses and production cost",
      "safety, incidents and operational review",
    ]),
  }),
  Object.freeze({
    key: "equipment_hire",
    title: "Equipment Hire",
    workspaces: Object.freeze(["equipment_hire"]),
    pattern: /\b(equipment hire|hire|rental|quotation|availability|dispatch|job card|work log|fleet|return|maintenance|hire invoice|hire receivable)\b/i,
    expected_topics: Object.freeze([
      "enquiries and quotations",
      "fleet availability and reservation",
      "hire contracts and authorization",
      "dispatch and delivery",
      "job cards and work logs",
      "invoicing, payments and receivables",
      "returns, utilization and maintenance",
    ]),
  }),
  Object.freeze({
    key: "equipment_installment_finance",
    title: "Equipment Installment Finance",
    workspaces: Object.freeze(["equipment_hire"]),
    pattern: /\b(installment|instalment|equipment finance|credit application|kyc|affordability|down payment|repayment|arrears|ownership transfer)\b/i,
    expected_topics: Object.freeze([
      "credit application and KYC",
      "affordability and approval",
      "financed equipment and agreement creation",
      "opening deposit and repayment schedule",
      "collections and payment allocation",
      "arrears and portfolio health",
      "delivery authorization and ownership transfer",
    ]),
  }),
  Object.freeze({
    key: "customers_accounting",
    title: "Customers, Accounting & Collections",
    workspaces: Object.freeze(["spare_parts", "equipment_hire"]),
    pattern: /\b(customer|buyer|client|debt|debtor|collection|payment|receipt|statement|account|cash|revenue|profit|ledger|aging|ageing)\b/i,
    expected_topics: Object.freeze([
      "customer identity and duplicate prevention",
      "customer purchase history and lifetime value",
      "credit sales, debts and collections",
      "customer statements and payment history",
      "cash position and reconciliation",
      "profit, margin and management accounting",
      "debt aging and collection prioritization",
    ]),
  }),
  Object.freeze({
    key: "audit_security",
    title: "Audit, Controls & Security",
    workspaces: Object.freeze(["spare_parts", "mining", "equipment_hire"]),
    pattern: /\b(audit|control|security|permission|role|user|login|trace|who changed|anomaly|suspicious|backup|restore|reconciliation)\b/i,
    expected_topics: Object.freeze([
      "audit trail and transaction trace",
      "roles, permissions and sensitive access",
      "high-risk changes and review controls",
      "backup, restore and maintenance events",
      "reconciliation and anomaly investigation",
      "AI action audit and Risk-5 governance",
    ]),
  }),
  Object.freeze({
    key: "chalin_intelligence",
    title: "CHALIN Intelligence & System Knowledge",
    workspaces: Object.freeze(["spare_parts", "mining", "equipment_hire"]),
    pattern: /\b(chalin|copilot|intelligence|knowledge|ai|document|pdf|excel|word|tool|provider|gemini|groq|openrouter|web search|conversation|memory)\b/i,
    expected_topics: Object.freeze([
      "CHALIN product and workspace architecture",
      "login-aware AI capability and scope",
      "governed knowledge sources and approvals",
      "conversation, task and evidence memory",
      "document generation and provenance",
      "provider routing and public-web privacy",
      "governed operational actions and risk levels",
    ]),
  }),
]);

function clean(value, maximum = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function publicExpertPack(pack) {
  return Object.freeze({
    key: pack.key,
    title: pack.title,
    workspaces: Object.freeze([...pack.workspaces]),
    expected_topics: Object.freeze([...pack.expected_topics]),
  });
}

function packsForWorkspace(workspaceCode = null) {
  const workspace = clean(workspaceCode, 50).toLowerCase();
  const source = workspace
    ? EXPERT_PACKS.filter((pack) => pack.workspaces.includes(workspace))
    : EXPERT_PACKS;
  return Object.freeze(source);
}

function classifyExpertPack(text, workspaceCode = null) {
  const candidates = packsForWorkspace(workspaceCode);
  const value = clean(text, 4000);
  for (const pack of candidates) {
    if (pack.pattern.test(value)) return pack;
  }
  return candidates.find((pack) => pack.key === "chalin_intelligence") || candidates[0] || null;
}

function suggestedSourceType(text) {
  const value = clean(text, 2000).toLowerCase();
  if (/\b(policy|rule|approval|permission|control)\b/.test(value)) return "policy";
  if (/\b(procedure|process|steps|workflow|how do|how to|termination|closing)\b/.test(value)) return "procedure";
  if (/\b(manual|guide|training|operate|operation)\b/.test(value)) return "manual";
  return "faq";
}

function sourceMatchesPack(source = {}, pack) {
  if (!pack) return false;
  const text = [
    source.source_key,
    source.title,
    source.source_type,
    source.owner_workspace_code,
  ]
    .filter(Boolean)
    .join(" ");
  return pack.pattern.test(text);
}

function expertPackCoverage(pack, sourceHealth = []) {
  const matching = (Array.isArray(sourceHealth) ? sourceHealth : []).filter((source) =>
    sourceMatchesPack(source, pack)
  );
  const current = matching.filter((source) => source.health_state === "current");
  const expired = matching.filter((source) => source.health_state === "expired");
  const unpublished = matching.filter((source) =>
    ["unpublished", "draft", "future"].includes(source.health_state)
  );

  return Object.freeze({
    ...publicExpertPack(pack),
    status: current.length > 0 ? "foundation_present" : "foundation_missing",
    current_source_count: current.length,
    expired_source_count: expired.length,
    unpublished_or_future_source_count: unpublished.length,
    matching_source_keys: Object.freeze(
      matching.map((source) => source.source_key).filter(Boolean).slice(0, 20)
    ),
    coverage_note:
      current.length > 0
        ? "At least one current governed source appears related to this expert pack. Topic-level completeness still requires review of source contents."
        : "No current governed source title/key appears to establish this expert-pack foundation.",
  });
}

function priorityRank(priority) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority] ?? 4;
}

function curriculumIdentity(item = {}) {
  return [item.kind, item.expert_pack, item.query, item.source_key, item.feedback_key]
    .map((value) => clean(value, 240).toLowerCase())
    .join("|");
}

function addCurriculumItem(target, item) {
  if (!item || target.length >= MAX_CURRICULUM_ITEMS) return;
  const identity = curriculumIdentity(item);
  if (target.some((existing) => curriculumIdentity(existing) === identity)) return;
  target.push(Object.freeze(item));
}

function buildKnowledgeCurriculum(health = {}) {
  const workspaceCode = health?.scope?.workspace_code || null;
  const packs = packsForWorkspace(workspaceCode);
  const packCoverage = packs.map((pack) =>
    expertPackCoverage(pack, health.source_health || [])
  );
  const curriculum = [];

  for (const gap of health.gap_candidates || []) {
    const pack = classifyExpertPack(gap.query, workspaceCode);
    addCurriculumItem(curriculum, {
      kind: "knowledge_gap",
      priority: Number(gap.miss_count || 0) >= 2 ? "high" : "medium",
      expert_pack: pack?.key || null,
      title: `Teach CHALIN: ${clean(gap.query, 180)}`,
      query: clean(gap.query, 240),
      reason: `${Number(gap.miss_count || 0)} governed knowledge search${Number(gap.miss_count || 0) === 1 ? "" : "es"} returned no approved evidence in the selected lookback window.`,
      recommended_action: "create_or_expand_governed_source",
      suggested_source_type: suggestedSourceType(gap.query),
      workspace_code: gap.workspace_code || workspaceCode,
      last_seen_at: gap.last_seen_at || null,
      auto_publish: false,
    });
  }

  for (const feedback of health.correction_review_queue || []) {
    const pack = packsForWorkspace(feedback.workspace_code || workspaceCode)[0] || null;
    addCurriculumItem(curriculum, {
      kind: "correction_review",
      priority: feedback.has_correction ? "high" : "medium",
      expert_pack: pack?.key || null,
      title: "Review an unresolved CHALIN answer correction",
      feedback_key: feedback.feedback_key,
      reason: feedback.has_correction
        ? "A user supplied a correction to an answer; it must be reviewed before any lesson is promoted to organizational knowledge."
        : "An answer was marked incorrect/not helpful and still requires review.",
      recommended_action: "review_feedback_before_teaching",
      workspace_code: feedback.workspace_code || workspaceCode,
      created_at: feedback.created_at || null,
      correction_text_included: false,
      auto_publish: false,
    });
  }

  for (const source of health.source_health || []) {
    if (source.health_state === "expired") {
      const pack = classifyExpertPack(
        `${source.source_key || ""} ${source.title || ""}`,
        workspaceCode
      );
      addCurriculumItem(curriculum, {
        kind: "expired_source",
        priority: "high",
        expert_pack: pack?.key || null,
        title: `Replace or archive expired knowledge: ${source.title || source.source_key}`,
        source_key: source.source_key,
        reason: "The source has published knowledge but no currently effective published version.",
        recommended_action: "publish_replacement_or_archive_source",
        workspace_code: source.owner_workspace_code || workspaceCode,
        auto_publish: false,
      });
    } else if (source.health_state === "unpublished") {
      const pack = classifyExpertPack(
        `${source.source_key || ""} ${source.title || ""}`,
        workspaceCode
      );
      addCurriculumItem(curriculum, {
        kind: "unpublished_source",
        priority: "medium",
        expert_pack: pack?.key || null,
        title: `Complete governed publication: ${source.title || source.source_key}`,
        source_key: source.source_key,
        reason: "The active source does not yet have a currently effective published version.",
        recommended_action: "complete_review_and_publication",
        workspace_code: source.owner_workspace_code || workspaceCode,
        auto_publish: false,
      });
    }
  }

  for (const coverage of packCoverage) {
    if (coverage.status !== "foundation_missing") continue;
    addCurriculumItem(curriculum, {
      kind: "expert_pack_foundation",
      priority: "medium",
      expert_pack: coverage.key,
      title: `Establish ${coverage.title} expert-pack foundation`,
      reason: "No current governed knowledge source appears to establish this domain foundation yet.",
      recommended_action: "author_review_and_publish_expert_pack_sources",
      expected_topics: coverage.expected_topics,
      workspace_code: workspaceCode,
      auto_publish: false,
    });
  }

  curriculum.sort((left, right) =>
    priorityRank(left.priority) - priorityRank(right.priority) ||
    String(left.title || "").localeCompare(String(right.title || ""))
  );

  const priorityCounts = curriculum.reduce(
    (counts, item) => {
      counts[item.priority] = (counts[item.priority] || 0) + 1;
      return counts;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );

  return Object.freeze({
    generated_at: new Date().toISOString(),
    scope: health.scope || Object.freeze({ workspace_code: null, mode: "enterprise" }),
    health_status: health.status || "unknown",
    curriculum_item_count: curriculum.length,
    priority_counts: Object.freeze(priorityCounts),
    expert_packs: Object.freeze(packCoverage),
    curriculum: Object.freeze(curriculum.slice(0, MAX_CURRICULUM_ITEMS)),
    governance: Object.freeze({
      gap_detection_can_create_drafts: false,
      gap_detection_can_publish: false,
      correction_requires_review: true,
      organizational_truth_requires_governed_publication: true,
      expert_pack_topics_are_curriculum_targets_not_claimed_facts: true,
    }),
  });
}

async function getKnowledgeCurriculum({
  workspaceCode = null,
  windowDays = 30,
  connection,
} = {}) {
  const health = await getKnowledgeHealthSnapshot({
    workspaceCode,
    windowDays,
    ...(connection ? { connection } : {}),
  });
  return buildKnowledgeCurriculum(health);
}

module.exports = {
  EXPERT_PACKS,
  MAX_CURRICULUM_ITEMS,
  addCurriculumItem,
  buildKnowledgeCurriculum,
  classifyExpertPack,
  curriculumIdentity,
  expertPackCoverage,
  getKnowledgeCurriculum,
  packsForWorkspace,
  priorityRank,
  publicExpertPack,
  sourceMatchesPack,
  suggestedSourceType,
};
