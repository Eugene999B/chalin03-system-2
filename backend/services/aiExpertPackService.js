"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  HIRE_EXPERT_PACK,
  getHireExpertPack,
  isHireExpertPrompt,
} = require("./aiHireExpertPackService");
const {
  MINING_EXPERT_PACK,
  getMiningExpertPack,
  isMiningExpertPrompt,
} = require("./aiMiningExpertPackService");
const {
  SPARE_PARTS_EXPERT_PACK,
  getSparePartsExpertPack,
  isSparePartsExpertPrompt,
} = require("./aiSparePartsExpertPackService");

const PAYROLL_RELEASE_COMMIT = "8e4ca14e4020b809ab4a2245e3e5eeb67d7fc369";

const PAYROLL_RUNTIME_FILES = Object.freeze([
  "services/payrollFoundationService.js",
  "services/payrollWorkerProfileService.js",
  "services/payrollProcessingService.js",
  "services/payrollPayslipService.js",
  "routes/payrollFoundationRoutes.js",
  "routes/payrollProcessingRoutes.js",
  "routes/payrollPayslipRoutes.js",
]);

const PAYROLL_EXPERT_PACK = Object.freeze({
  key: "people_employment_payroll",
  title: "People, Employment & Payroll",
  version: "2026-08-10-source-derived-v1",
  authority: "verified_product_source_contract",
  reviewed_source_lineage: "main/production payroll simplification release",
  verified_release_commit: PAYROLL_RELEASE_COMMIT,
  source_paths: Object.freeze([
    "backend/routes/workerProfileExpansionRoutes.js",
    "backend/services/payrollFoundationService.js",
    "backend/services/payrollWorkerProfileService.js",
    "backend/services/payrollProcessingService.js",
    "backend/services/payrollPayslipService.js",
    "backend/tests/payrollWorkerOnboardingSimplification20260810.test.js",
    "backend/tests/payrollProcessingPhaseFour20260810.test.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "worker_salary_onboarding",
      statement:
        "Creating a worker requires a positive starting basic salary and a supported pay frequency. The employment start date is used as the initial salary effective date unless an explicit salary effective date is supplied.",
      source_basis: Object.freeze([
        "workerProfileExpansionRoutes.initialSalaryPayload",
        "payrollWorkerOnboardingSimplification20260810: worker onboarding requires payroll authority and starting salary",
      ]),
    }),
    Object.freeze({
      key: "salary_source_of_truth",
      statement:
        "Basic salary is not stored as a salary column on worker_profiles. The authoritative salary source is the effective-dated payroll_compensation_profiles history linked to the worker.",
      source_basis: Object.freeze([
        "payrollWorkerProfileService.policy.salary_source",
        "payrollFoundationService.compensationHistory",
        "payrollWorkerOnboardingSimplification20260810: no salary on worker_profiles",
      ]),
    }),
    Object.freeze({
      key: "atomic_initial_activation",
      statement:
        "Worker creation and the initial approved compensation profile are written in one database transaction. The initial salary is auto-activated as part of onboarding; it is not presented as an independently reviewed later salary change.",
      source_basis: Object.freeze([
        "workerProfileExpansionRoutes worker create transaction",
        "payrollWorkerOnboardingSimplification20260810: atomic worker and salary write",
      ]),
    }),
    Object.freeze({
      key: "later_salary_changes",
      statement:
        "Later salary changes preserve effective-dated history. They begin as compensation drafts, are submitted for approval, and the preparer or submitter cannot approve their own salary change. Approving a new effective salary closes the superseded approved period without overwriting history.",
      source_basis: Object.freeze([
        "payrollFoundationService.createCompensationDraft",
        "payrollFoundationService.submitCompensationProfile",
        "payrollFoundationService.approveCompensationProfile",
      ]),
    }),
    Object.freeze({
      key: "recurring_components",
      statement:
        "Compensation supports recurring earning, deduction and employer-contribution components, including fixed amounts and percentage-of-basic calculations. The salary-change UI is designed to carry existing recurring allowances and deductions forward when changing salary.",
      source_basis: Object.freeze([
        "payrollFoundationService.normalizeComponent",
        "payrollWorkerOnboardingSimplification20260810: recurring components carry-forward contract",
      ]),
    }),
    Object.freeze({
      key: "monthly_payroll_salary_resolution",
      statement:
        "Payroll preview resolves the worker's applicable approved compensation profile for the payroll period and exposes the authoritative basic salary and pay frequency used for calculation rather than asking the operator to retype salary for each month.",
      source_basis: Object.freeze([
        "payrollProcessingService preview contract",
        "payrollWorkerOnboardingSimplification20260810: payroll preview exposes salary source",
      ]),
    }),
    Object.freeze({
      key: "versioned_statutory_rules",
      statement:
        "Payroll calculations consume versioned statutory-rule configuration instead of embedding statutory percentages directly in the payroll calculation code. Rules can calculate deductions or employer contributions from configured bases and can support progressive bands.",
      source_basis: Object.freeze([
        "payrollProcessingPhaseFour20260810: versioned rule calculation",
        "payrollProcessingPhaseFour20260810: progressive statutory bands",
      ]),
    }),
    Object.freeze({
      key: "maker_checker_processing",
      statement:
        "The payroll processing lifecycle separates validation, preparation, approval, locking, payment, reversal requests, adjustments and reconciliation. Payroll preparation, approval, payment, adjustment and audit permissions are distinct, and self-approval protections are enforced for payroll periods and adjustments.",
      source_basis: Object.freeze([
        "payrollProcessingRoutes",
        "payrollProcessingPhaseFour20260810: maker-checker permissions and reversals",
      ]),
    }),
    Object.freeze({
      key: "payment_integrity",
      statement:
        "Salary payments are designed to be idempotent and reference-safe, cannot exceed the remaining payroll balance, and are protected by preserved calculation evidence/checksums. Reversals are represented as preserved reversal evidence rather than silently deleting the original payment.",
      source_basis: Object.freeze([
        "payrollProcessingService payment controls",
        "payrollProcessingPhaseFour20260810: payment integrity contract",
      ]),
    }),
    Object.freeze({
      key: "worker_payroll_360",
      statement:
        "A worker payroll profile can summarize current approved salary/pay frequency, payroll timeline, salary payments, loans, outstanding salary, year-to-date earnings/deductions/net pay and issued payslips while keeping the worker/workspace category relationship enforced.",
      source_basis: Object.freeze([
        "payrollWorkerProfileService.workerPayrollProfile",
      ]),
    }),
  ]),
  workflow: Object.freeze([
    "Create worker profile with starting Basic Salary and Pay Frequency.",
    "Activate the initial effective-dated compensation profile atomically with worker creation.",
    "For later changes, create a compensation draft and submit it for independent approval.",
    "Open/run a payroll period; resolve each worker's approved compensation effective for the period.",
    "Preview basic salary, recurring components, configured statutory rules, gross earnings, deductions, contributions and net salary.",
    "Validate and prepare the payroll period.",
    "A separately authorized approver reviews/approves the payroll period; self-approval controls remain enforced.",
    "Lock/finalize the approved payroll according to the processing workflow.",
    "Record salary payments with idempotency, reference and balance controls.",
    "Issue/reissue payslips from preserved payroll/payment evidence and retain history for audit/reconciliation.",
  ]),
  diagnostic_questions: Object.freeze([
    "Does the worker have a currently effective approved compensation profile for the payroll period?",
    "Does the compensation effective date overlap or conflict with an existing approved period?",
    "Are recurring allowances/deductions attached to the intended compensation profile?",
    "Which versioned statutory rules are effective for the payroll period?",
    "Has the payroll period been validated, prepared and independently approved?",
    "Does the payment amount exceed the remaining salary balance or reuse a payment reference?",
    "Are there pending adjustments or reversal requests affecting the payroll entry?",
    "Does the stored calculation checksum still match the preserved payroll calculation evidence?",
  ]),
  boundaries: Object.freeze({
    salary_is_not_worker_profile_column: true,
    initial_salary_auto_activation_is_onboarding_specific: true,
    later_salary_changes_require_independent_approval: true,
    payroll_records_are_sensitive: true,
    payroll_write_actions_require_business_permissions: true,
    expert_pack_is_product_knowledge_not_live_worker_data: true,
  }),
});

const EXPERT_PACKS = Object.freeze({
  [PAYROLL_EXPERT_PACK.key]: PAYROLL_EXPERT_PACK,
  [SPARE_PARTS_EXPERT_PACK.key]: SPARE_PARTS_EXPERT_PACK,
  [MINING_EXPERT_PACK.key]: MINING_EXPERT_PACK,
  [HIRE_EXPERT_PACK.key]: HIRE_EXPERT_PACK,
});

function clean(value, maximum = 200) {
  return String(value ?? "").trim().slice(0, maximum);
}

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function payrollRuntimeAvailability() {
  const files = PAYROLL_RUNTIME_FILES.map((relative) => {
    const present = fs.existsSync(runtimePath(relative));
    return Object.freeze({
      path: `backend/${relative}`,
      present,
    });
  });
  const presentCount = files.filter((item) => item.present).length;
  const total = files.length;
  return Object.freeze({
    status:
      presentCount === total
        ? "available_in_current_source_tree"
        : presentCount === 0
          ? "not_present_in_current_source_tree"
          : "partially_present_in_current_source_tree",
    present_file_count: presentCount,
    expected_file_count: total,
    files: Object.freeze(files),
    warning:
      presentCount === total
        ? null
        : "The verified Payroll product contract comes from the reviewed main/production payroll lineage, but this deployed source tree does not contain the complete Payroll runtime package. Explain the design accurately, but do not claim the missing runtime is executable here.",
  });
}

function getExpertPack(packKey, { includeAvailability = true } = {}) {
  const key = clean(packKey, 80).toLowerCase();
  if (key === SPARE_PARTS_EXPERT_PACK.key) {
    return getSparePartsExpertPack({ includeAvailability });
  }
  if (key === MINING_EXPERT_PACK.key) {
    return getMiningExpertPack({ includeAvailability });
  }
  if (key === HIRE_EXPERT_PACK.key) {
    return getHireExpertPack({ includeAvailability });
  }
  const pack = EXPERT_PACKS[key];
  if (!pack) return null;
  return Object.freeze({
    ...pack,
    deployment_availability:
      includeAvailability && key === PAYROLL_EXPERT_PACK.key
        ? payrollRuntimeAvailability()
        : null,
  });
}

function listExpertPacks({ includeAvailability = true } = {}) {
  return Object.freeze(
    Object.keys(EXPERT_PACKS).map((key) => getExpertPack(key, { includeAvailability }))
  );
}

function isPayrollExpertPrompt(value) {
  const text = clean(value, 16000);
  return /\b(?:payroll|salary|salaries|payslip|wage|compensation|pay frequency|basic salary|worker payroll|salary deduction|salary allowance)\b/i.test(text);
}

function expertPacksForPrompt(value) {
  const matches = [];
  if (isPayrollExpertPrompt(value)) matches.push(getExpertPack(PAYROLL_EXPERT_PACK.key));
  if (isSparePartsExpertPrompt(value)) matches.push(getExpertPack(SPARE_PARTS_EXPERT_PACK.key));
  if (isMiningExpertPrompt(value)) matches.push(getExpertPack(MINING_EXPERT_PACK.key));
  if (isHireExpertPrompt(value)) matches.push(getExpertPack(HIRE_EXPERT_PACK.key));
  return Object.freeze(matches.filter(Boolean));
}

function expertPackForPrompt(value) {
  return expertPacksForPrompt(value)[0] || null;
}

function workflowLines(pack) {
  if (Array.isArray(pack.workflow)) return pack.workflow;
  if (Array.isArray(pack.workflows)) {
    return pack.workflows.map((item) => `${item.path}. ${item.interpretation}`);
  }
  return [];
}

function renderExpertPack(pack) {
  if (!pack) return "";
  const facts = (pack.facts || [])
    .map((fact, index) => `${index + 1}. ${fact.statement}`)
    .join("\n");
  const workflow = workflowLines(pack)
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");
  const diagnostics = (pack.diagnostic_questions || [])
    .map((item) => `- ${item}`)
    .join("\n");
  const rules = (pack.reasoning_rules || [])
    .map((item) => `- ${item}`)
    .join("\n");
  const availability = pack.deployment_availability || {};
  let liveBoundary =
    "Use this as product/workflow knowledge only. Current business facts require authorized governed live evidence.";
  if (pack.key === PAYROLL_EXPERT_PACK.key) {
    liveBoundary =
      "Use this as product/workflow knowledge only. Never infer a live worker salary, payroll result or employee fact from this pack; live payroll records require an authorized governed read path.";
  } else if (pack.key === SPARE_PARTS_EXPERT_PACK.key) {
    liveBoundary =
      "Use this as product/workflow knowledge only. Never infer live branch sales, stock, debt, customer or profit figures from this pack; current Spare Parts facts require authorized governed live evidence.";
  } else if (pack.key === MINING_EXPERT_PACK.key) {
    liveBoundary =
      "Use this as product/workflow knowledge only. Never infer live site production, cost, fuel, stockpile, equipment or incident figures from this pack; current Mining facts require authorized governed live evidence. Do not invent Mining revenue or profit when the governed Mining evidence does not provide it.";
  } else if (pack.key === HIRE_EXPERT_PACK.key) {
    liveBoundary =
      "Use this as product/workflow knowledge only. Never infer live Hire enquiries, quotations, fleet state, work logs, invoices, collections, returns or balances from this pack; current Equipment Hire facts require authorized governed live evidence. Do not invent Hire profit or time-based utilization when the governed Hire evidence does not provide the required cost/capacity evidence.";
  }
  return [
    `CHALIN source-derived expert pack: ${pack.title}`,
    `Pack version: ${pack.version}.`,
    `Verified release/source commit: ${pack.verified_release_commit}.`,
    `Current deployment availability: ${availability.status || "unknown"}.`,
    availability.warning ? `Deployment warning: ${availability.warning}` : "",
    "Verified product behavior:",
    facts,
    workflow ? "Verified operating relationships/workflow:" : "",
    workflow,
    diagnostics ? "Diagnostic questions:" : "",
    diagnostics,
    rules ? "Reasoning rules:" : "",
    rules,
    liveBoundary,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderExpertPacks(packs = []) {
  return (Array.isArray(packs) ? packs : [])
    .map(renderExpertPack)
    .filter(Boolean)
    .join("\n\n");
}

module.exports = {
  EXPERT_PACKS,
  HIRE_EXPERT_PACK,
  MINING_EXPERT_PACK,
  PAYROLL_EXPERT_PACK,
  PAYROLL_RELEASE_COMMIT,
  PAYROLL_RUNTIME_FILES,
  SPARE_PARTS_EXPERT_PACK,
  expertPackForPrompt,
  expertPacksForPrompt,
  getExpertPack,
  isHireExpertPrompt,
  isMiningExpertPrompt,
  isPayrollExpertPrompt,
  isSparePartsExpertPrompt,
  listExpertPacks,
  payrollRuntimeAvailability,
  renderExpertPack,
  renderExpertPacks,
  runtimePath,
};
