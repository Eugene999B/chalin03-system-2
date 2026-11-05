import { useMemo, useState } from "react";
import { Link } from "react-router";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceGuide.css";

const JOURNEY = [
  {
    number: 1,
    title: "Customer & excavator",
    detail: "Select reusable Finance records and confirm the exact machine.",
    path: "/equipment-installment-finance/applications?stage=start",
  },
  {
    number: 2,
    title: "Draft & offer",
    detail: "Set price, deposit, frequency, dates and payment rules.",
    path: "/equipment-installment-finance/applications?stage=start",
  },
  {
    number: 3,
    title: "KYC & affordability",
    detail: "Capture consent, identity, income, expenses and supporting evidence.",
    path: "/equipment-installment-finance/applications",
  },
  {
    number: 4,
    title: "Submit & review",
    detail: "Use the application register and independent approval workflow.",
    path: "/equipment-installment-finance/applications",
  },
  {
    number: 5,
    title: "Agreement",
    detail: "Prepare the authoritative agreement and required documents.",
    path: "/equipment-installment-finance/applications?stage=activation",
  },
  {
    number: 6,
    title: "Opening deposit",
    detail: "Receipt first; reserve the exact excavator only after completion.",
    path: "/equipment-installment-finance/applications?stage=deposit",
  },
  {
    number: 7,
    title: "Account & payments",
    detail: "Monitor the official schedule, balance, receipts and allocations.",
    path: "/equipment-installment-finance/applications?stage=accounts",
  },
  {
    number: 8,
    title: "Arrears & corrections",
    detail: "Use governed follow-up, promises, reversals and return settlement.",
    path: "/equipment-installment-finance/applications?stage=arrears",
  },
  {
    number: 9,
    title: "Delivery",
    detail: "Complete independent authorization, handover and condition evidence.",
    path: "/equipment-installment-finance/applications?stage=case-operations",
  },
  {
    number: 10,
    title: "Settlement & ownership",
    detail: "Confirm full lifecycle evidence before ownership transfer.",
    path: "/equipment-installment-finance/applications?stage=case-operations",
  },
];

const GUIDE_SECTIONS = [
  {
    number: 1,
    title: "Finance workspace and business boundary",
    audience: "Everyone",
    summary:
      "Equipment Installment Finance is a company-wide Finance division. It does not use a Hire-location selector and it must not create Hire enquiries, Hire contracts, dispatch jobs or Hire invoices.",
    points: [
      "Use only your own Finance-authorized account and assigned permissions.",
      "Customers and excavators may be reused company-wide, but Finance records remain separate from Spare Parts installments and Equipment Hire operations.",
      "A visible button does not override permissions, approval status or database safety controls.",
      "Return to the Equipment Divisions gateway before entering Hire work.",
    ],
    warning:
      "Do not create a Hire job as a workaround for a Finance customer, deposit, delivery or payment.",
    path: "/equipment-installment-finance",
    action: "Open Finance Home",
  },
  {
    number: 2,
    title: "Create or select the Finance customer",
    audience: "Finance staff",
    summary:
      "Search the company-wide Finance Customer Centre before creating a new profile. The same customer profile supports applications, agreements, schedules, payments, statements and future installment requests.",
    points: [
      "Search by name, phone, customer code or email to prevent duplicates.",
      "Confirm the legal name, phone number, address and identity details before starting an application.",
      "Keep customer information private and correct errors through the supported edit workflow.",
      "Use Customer Installment Profiles to see the customer's complete Finance history after accounts exist.",
    ],
    path: "/equipment-installment-finance/applications?stage=customers",
    action: "Open Customers",
  },
  {
    number: 3,
    title: "Register and verify the exact excavator",
    audience: "Fleet / Finance staff",
    summary:
      "The machine selected in the application is the machine that can later be reserved and delivered. Its identity, sale permission, status and protected photographs must be trustworthy.",
    points: [
      "Search before registering another machine and verify asset code, serial or chassis number, make, model and selling values.",
      "Add a clear complete machine photograph and retain protected identity evidence.",
      "The excavator must be active, approved for sale and not committed to active Hire work or another Finance agreement.",
      "Protected identity fields may lock after an application, reservation or agreement begins.",
    ],
    warning:
      "Never mark a machine sold or reserved manually just to make it disappear from the available list.",
    path: "/equipment-installment-finance/applications?stage=machines",
    action: "Open Excavators",
  },
  {
    number: 4,
    title: "Start New Installment and create the recoverable draft",
    audience: "Finance staff",
    summary:
      "The guided start flow combines the customer, excavator and commercial plan into one recoverable application draft. The Installment Offer is created automatically in the background.",
    points: [
      "Confirm the customer and exact available excavator before entering money values.",
      "Set selling price, opening deposit, payment frequency, installment count, first due date and the configured non-working-day rule.",
      "Use custom interval days only when the approved plan requires them.",
      "Review the calculated financed amount and schedule preview before continuing.",
    ],
    warning:
      "Do not create several drafts because a page is slow. Refresh and check Applications & Approvals first.",
    path: "/equipment-installment-finance/applications?stage=start",
    action: "Start New Installment",
  },
  {
    number: 5,
    title: "KYC, consent, guarantor and affordability evidence",
    audience: "Preparer & reviewer",
    summary:
      "The application records the customer's identity, consent, address, work or business information, income, costs, household expenses and existing debt. A guarantor is completed when current policy requires one.",
    points: [
      "Record truthful figures supported by available documents and customer declarations.",
      "Capture both customer consent and credit-assessment consent where required.",
      "Treat affordability calculations and risk indicators as decision support, not permission to approve automatically.",
      "The person preparing evidence should not falsely mark their own incomplete evidence as independently verified.",
    ],
    warning:
      "Never increase income or reduce expenses merely to force an eligible result.",
    path: "/equipment-installment-finance/applications",
    action: "Open Applications",
  },
  {
    number: 6,
    title: "Application statuses, autosave and corrections",
    audience: "Finance staff",
    summary:
      "Draft and changes-requested applications remain editable. Submitted and under-review records are controlled. The register preserves the application history instead of replacing it with undocumented changes.",
    points: [
      "Allow autosave to finish before leaving an edited draft.",
      "Use Draft for preparation, Submitted for manager review, Under Review for active assessment and Changes Requested when the preparer must correct evidence.",
      "Approved means the credit decision passed; it does not collect money, reserve the machine, deliver it or transfer ownership.",
      "Declined or withdrawn applications remain in history and should not be deleted from the database.",
    ],
    path: "/equipment-installment-finance/applications",
    action: "Open Application Register",
  },
  {
    number: 7,
    title: "Task & Approval Inbox",
    audience: "Managers & assigned staff",
    summary:
      "The inbox shows work that genuinely needs attention: submission, verification, review, correction, approval or another controlled action. It is the daily place to start before searching every register.",
    points: [
      "Open the assigned case and read the current status, blocker and requested action.",
      "Review the linked customer, excavator, money values and evidence before deciding.",
      "Use clear reasons when requesting changes, rejecting evidence or declining an application.",
      "Do not approve work only to clear the inbox count.",
    ],
    path: "/equipment-installment-finance/applications?stage=inbox",
    action: "Open Task & Approval Inbox",
  },
  {
    number: 8,
    title: "Independent review and approval decision",
    audience: "Finance managers",
    summary:
      "An authorized reviewer starts review, checks the application and evidence, then approves, requests changes or declines. Approval is an accountable decision recorded against the reviewer's own login.",
    points: [
      "Confirm customer identity, commercial terms, affordability evidence, guarantor requirements and machine eligibility.",
      "Separate preparation from review wherever practical.",
      "Record a truthful reason for changes requested, rejection or decline.",
      "After approval, continue to Prepare Agreement; do not collect the opening deposit against an unprepared case.",
    ],
    warning:
      "Never share a manager password or ask another person to approve while signed in as you.",
    path: "/equipment-installment-finance/applications",
    action: "Review Applications",
  },
  {
    number: 9,
    title: "Case Operations and the complete case timeline",
    audience: "Finance team",
    summary:
      "Case Operations brings one selected customer's application, excavator, timeline, documents, tasks, payments and lifecycle evidence into one working view.",
    points: [
      "Select the correct case before recording or reviewing any action.",
      "Use the timeline to understand what has already been submitted, approved, issued, paid or corrected.",
      "Open linked evidence instead of relying only on a verbal explanation.",
      "Use the next-action guidance rather than jumping directly to a later lifecycle stage.",
    ],
    path: "/equipment-installment-finance/applications?stage=case-operations",
    action: "Open Case Operations",
  },
  {
    number: 10,
    title: "Prepare and activate the authoritative agreement",
    audience: "Authorized Finance staff",
    summary:
      "An approved credit application is converted into the authoritative installment agreement. The agreement fixes the customer, exact excavator, price, deposit, financed balance, schedule and legal terms used by later stages.",
    points: [
      "Confirm the approved application still points to the correct customer and excavator.",
      "Review the installment schedule, first due date, frequency and non-working-day treatment.",
      "Issue the required agreement pack and capture the configured seller, buyer, witness and guarantor signatures.",
      "Treat unsigned drafts as drafts; do not present them as completed legal agreements.",
    ],
    path: "/equipment-installment-finance/applications?stage=activation",
    action: "Open Prepare Agreement",
  },
  {
    number: 11,
    title: "Opening Deposit & Machine Reservation",
    audience: "Finance manager / accountant",
    summary:
      "Opening Deposits lists eligible approved or active agreements. A partial opening deposit records a receipt but does not reserve the excavator. Reservation happens only when the required deposit is completed and the exact machine is explicitly confirmed.",
    points: [
      "Check the agreement, customer, excavator and remaining required deposit before entering money.",
      "Select the real payment method and record an external reference when one exists.",
      "Completing the deposit creates one protected Finance sale lock for the exact excavator.",
      "This step does not create a Hire job, delivery, ownership transfer or automatic SMS by itself.",
    ],
    warning:
      "If a receipt may already have been recorded, refresh the account before trying the same payment again.",
    path: "/equipment-installment-finance/applications?stage=deposit",
    action: "Open Opening Deposits",
  },
  {
    number: 12,
    title: "Active Installments and Customer Installment Profiles",
    audience: "Finance team",
    summary:
      "Active Installments is the read-only official account register. Customer Installment Profiles combine applications, agreements, schedules, payments, balances, delivery and ownership evidence for one customer.",
    points: [
      "Use the official current balance, overdue amount, progress and schedule instead of maintaining private calculations.",
      "Open the customer profile before discussing payment history or settlement with the customer.",
      "Confirm that account totals reconcile before issuing statements or legal documents.",
      "Use Corrections & Reversals when committed evidence is wrong; do not edit the read-only account totals.",
    ],
    path: "/equipment-installment-finance/applications?stage=accounts",
    action: "Open Active Installments",
  },
  {
    number: 13,
    title: "Payments & Collections",
    audience: "Finance accountants",
    summary:
      "Normal installment receipts use the protected collection transaction. The system records one committed payment, allocates it to the oldest due installments first and updates the official balance and receipt evidence.",
    points: [
      "Open the correct account and review due, overdue and outstanding values before recording money.",
      "Enter the actual amount, payment method, date and reference; partial and full payments remain visible in history.",
      "Wait for the committed response and receipt before repeating a request.",
      "Use the payment and allocation history to explain how the receipt affected the schedule.",
    ],
    warning:
      "Never delete, overwrite or directly edit a posted payment to make the balance look correct.",
    path: "/equipment-installment-finance/applications?stage=collections",
    action: "Open Payments & Collections",
  },
  {
    number: 14,
    title: "Payments & Arrears follow-up",
    audience: "Collections team",
    summary:
      "The arrears workspace organizes due and overdue accounts, reminders, promises to pay and follow-up. It supports recovery work without changing the original schedule or payment history silently.",
    points: [
      "Prioritize genuinely overdue and high-risk accounts using the official figures.",
      "Record reminder and promise-to-pay evidence truthfully.",
      "Escalate default, reschedule or recovery decisions through the governed workflow.",
      "Protect customer phone numbers, financial details and exported follow-up lists.",
    ],
    path: "/equipment-installment-finance/applications?stage=arrears",
    action: "Open Payments & Arrears",
  },
  {
    number: 15,
    title: "Secure Case Documents and evidence review",
    audience: "Authorized reviewers",
    summary:
      "Secure Case Documents stores private KYC, application, approval and controlled-delivery evidence. Access is permission-based and document approval is separate from the business action it supports.",
    points: [
      "Upload documents to the correct customer and case with a meaningful evidence type.",
      "Review legibility, identity, relevance and completeness before approval.",
      "Do not download or forward private case files outside the authorized business purpose.",
      "A document approval does not automatically approve the credit application, payment, delivery or ownership transfer.",
    ],
    path: "/equipment-installment-finance/applications?stage=case-workspace",
    action: "Open Secure Case Documents",
  },
  {
    number: 16,
    title: "Generated Documents, receipts and immutable history",
    audience: "Finance team",
    summary:
      "The Document Centre issues professional Finance documents from reconciled records and preserves immutable issued-document snapshots with a SHA-256 fingerprint.",
    points: [
      "Issue the correct agreement copy, schedule, receipt, statement, handover, arrears, amendment, settlement or ownership document for the current lifecycle stage.",
      "Legal documents require the configured terms, approvals and supporting evidence.",
      "Receipts must match a committed payment; settlement and ownership documents remain blocked until their conditions are met.",
      "Use the issued history for auditing instead of replacing an old document file.",
    ],
    path: "/equipment-installment-finance/applications?stage=generated-documents",
    action: "Open Generated Documents",
  },
  {
    number: 17,
    title: "Delivery, handover and ownership transfer",
    audience: "Independent authorizers",
    summary:
      "Delivery is controlled separately from ownership. The system checks the configured deposit or payment rule, independent authorization, machine identity, condition evidence and customer acknowledgement before handover.",
    points: [
      "Confirm the exact excavator, meter, condition, accessories and protected photographs at handover.",
      "Do not deliver a machine that is blocked by active Hire work, conflicting sale commitment or incomplete authorization.",
      "Record delivery confirmation and customer acknowledgement after the physical handover.",
      "Complete ownership transfer only after settlement and every required legal and operational condition is satisfied.",
    ],
    warning:
      "Delivery possession is not the same as legal ownership.",
    path: "/equipment-installment-finance/applications?stage=case-operations",
    action: "Open Lifecycle Operations",
  },
  {
    number: 18,
    title: "Corrections, reversals, returns and settlements",
    audience: "Managers & accountants",
    summary:
      "Committed Finance evidence is corrected through governed requests, approvals and ledger entries. The original payment, agreement and account history remains visible.",
    points: [
      "Use a correction or reversal request with a clear reason instead of editing or deleting a committed payment.",
      "Use the approved return-settlement workflow for machine returns, refunds, charges, balance effects and release evidence.",
      "Independent approval and reconciliation must complete before the correction becomes authoritative.",
      "Review the correction ledger and updated official balance after execution.",
    ],
    warning:
      "Do not run direct SQL updates or ask a developer to change a live balance without the governed evidence path.",
    path: "/equipment-installment-finance/applications?stage=corrections",
    action: "Open Corrections & Reversals",
  },
  {
    number: 19,
    title: "Portfolio reports, statements, SMS and accounting exports",
    audience: "Managers & accountants",
    summary:
      "Portfolio, SMS & Reports provides account statements, arrears views, cash-flow reporting, accounting exports, reminders and thermal receipt support from the official Finance data.",
    points: [
      "Confirm the reporting period, customer or account filters before export.",
      "Use official statements and receipts rather than manually retyping balances.",
      "Review reminder recipients and message content before sending customer communication.",
      "Protect exported customer and financial files and keep them only for the authorized purpose.",
    ],
    path: "/equipment-installment-finance/reports",
    action: "Open Portfolio, SMS & Reports",
  },
  {
    number: 20,
    title: "Finance Settings, final operations and production safety",
    audience: "Administrators",
    summary:
      "Finance Settings controls payment, reminder, receipt, delivery and legal rules. Final Operations & Reset verifies readiness and shows a read-only reset-impact report. A separately reviewed, dated owner-authorized restart release may execute only once through protected Railway startup.",
    points: [
      "Change policy settings only with business approval and test the effect on a controlled case.",
      "Use Final Operations to review portfolio readiness, preserved records and the reset-impact fingerprint.",
      "The 05 August 2026 Installment Finance restart release is Finance-only, transaction-protected and self-disabling after its schema_migrations marker; it is not a reusable staff reset button.",
      "The general production reset endpoint and all test-reset controls remain blocked on Railway production. Test resets still require the original System Administrator, a test environment, an approved test database and the exact confirmation phrase.",
    ],
    warning:
      "Never run database/schema.sql, TRUNCATE commands, direct deletion scripts or a test-reset procedure against Railway production. Any future restart requires a new explicit owner-authorized reviewed release.",
    path: "/equipment-installment-finance/applications?stage=finalization",
    action: "Open Final Operations & Reset",
  },
];

const ROLE_GUIDE = [
  {
    title: "Finance preparer / officer",
    detail:
      "Creates or selects customers and excavators, prepares drafts, records KYC and affordability evidence, responds to changes requested and submits complete applications. The preparer must not invent evidence or treat preparation as independent approval.",
  },
  {
    title: "Finance manager / Equipment Business manager",
    detail:
      "Reviews applications, evidence and commercial terms; requests corrections, approves or declines; and performs only the agreement, correction, recovery or lifecycle actions allowed by assigned permissions.",
  },
  {
    title: "Finance accountant / Equipment Business accountant",
    detail:
      "Records controlled deposits and collections, reviews allocations, balances and arrears, issues receipts and statements, prepares accounting exports and uses governed correction or settlement workflows when committed money evidence is wrong.",
  },
  {
    title: "Original System Administrator",
    detail:
      "Manages protected system access, Finance configuration, production health and finalization controls. A dated owner-authorized restart release may run only once and cannot become a reusable administrator tool; normal production reset remains blocked. Administrator access must not replace normal staff accountability or independent business review.",
  },
];

const STATUS_GUIDE = [
  {
    title: "Draft",
    detail: "Preparation is still in progress and the authorized preparer may continue editing.",
  },
  {
    title: "Submitted",
    detail: "The application is waiting for an authorized reviewer and should not be silently changed.",
  },
  {
    title: "Under Review",
    detail: "A reviewer is actively assessing the application and its evidence.",
  },
  {
    title: "Changes Requested",
    detail: "The reviewer returned the case to the preparer with a reason and required corrections.",
  },
  {
    title: "Approved",
    detail: "The credit decision passed. Agreement, deposit, reservation and delivery are still separate stages.",
  },
  {
    title: "Declined / Withdrawn",
    detail: "The application did not continue. Its history remains available for audit and reference.",
  },
  {
    title: "Active account",
    detail: "The agreement and deposit controls are complete enough for scheduled collections and lifecycle work.",
  },
  {
    title: "Due / Overdue / Completed",
    detail: "Use the official schedule and reconciled balance to understand collection priority and final settlement.",
  },
];

const TROUBLESHOOTING = [
  {
    title: "No excavator appears",
    detail:
      "Confirm the machine is active, approved for sale, available, not on active Hire work, not already locked to another agreement, and has the required identity and protected photograph evidence.",
  },
  {
    title: "Cannot edit a machine",
    detail:
      "An active application, reservation or agreement may have protected the record. Correct the case through the supported workflow instead of changing the machine identity underneath it.",
  },
  {
    title: "Cannot submit or approve",
    detail:
      "Check the current application status, missing consent or evidence, requested corrections, user permissions and the exact operator message shown on the page.",
  },
  {
    title: "Agreement is missing from Opening Deposits",
    detail:
      "Confirm the application is approved, the authoritative agreement was prepared, and the agreement remains in an eligible approved or active status with valid customer and machine links.",
  },
  {
    title: "Opening Deposits or another page returns an error",
    detail:
      "Refresh once, then capture the page name, time, HTTP status, response message and request ID from Developer Tools. Do not repeatedly retry a money entry while the result is uncertain.",
  },
  {
    title: "Payment seems duplicated or balance seems wrong",
    detail:
      "Check the receipt, payment history and allocations first. Do not record another payment or edit the database; open Corrections & Reversals with the supporting evidence.",
  },
  {
    title: "Document cannot be issued",
    detail:
      "The case may need reconciliation, approved legal terms, committed payment evidence, signatures, delivery confirmation, settlement or ownership conditions before that document type becomes valid.",
  },
  {
    title: "Mobile text or amount is clipped",
    detail:
      "Reload the current deployment, rotate only if necessary, and report the page name with a screenshot showing the complete browser width. Do not rely on a hidden or clipped amount for a money decision.",
  },
  {
    title: "A sensitive action failed",
    detail:
      "Do not keep pressing the action. Record the message and request ID, confirm whether any receipt or audit entry was committed, then notify the responsible manager or System Administrator.",
  },
];

const QUICK_LINKS = [
  ["Finance Home", "Current portfolio and next-action overview.", "/equipment-installment-finance"],
  ["Start New Installment", "Customer, excavator, offer and recoverable draft.", "/equipment-installment-finance/applications?stage=start"],
  ["Applications & Approvals", "Application register, evidence and decisions.", "/equipment-installment-finance/applications"],
  ["Task & Approval Inbox", "Work that needs action, review or correction.", "/equipment-installment-finance/applications?stage=inbox"],
  ["Case Operations", "One case timeline, evidence, payments and lifecycle.", "/equipment-installment-finance/applications?stage=case-operations"],
  ["Prepare Agreement", "Convert an approved application into the agreement.", "/equipment-installment-finance/applications?stage=activation"],
  ["Opening Deposits", "Record the deposit and reserve the exact machine.", "/equipment-installment-finance/applications?stage=deposit"],
  ["Active Installments", "Official schedules, balances and progress.", "/equipment-installment-finance/applications?stage=accounts"],
  ["Payments & Collections", "Record receipts and review allocations.", "/equipment-installment-finance/applications?stage=collections"],
  ["Customer Profiles", "Complete customer Finance history.", "/equipment-installment-finance/applications?stage=customer-portfolios"],
  ["Payments & Arrears", "Due, overdue, reminders and promises.", "/equipment-installment-finance/applications?stage=arrears"],
  ["Corrections & Reversals", "Governed corrections, returns and settlement.", "/equipment-installment-finance/applications?stage=corrections"],
  ["Customers", "Reusable company-wide Finance customers.", "/equipment-installment-finance/applications?stage=customers"],
  ["Excavators", "Identity, prices, photographs and availability.", "/equipment-installment-finance/applications?stage=machines"],
  ["Secure Case Documents", "Private evidence, review and approvals.", "/equipment-installment-finance/applications?stage=case-workspace"],
  ["Generated Documents", "Agreements, receipts, statements and history.", "/equipment-installment-finance/applications?stage=generated-documents"],
  ["Portfolio, SMS & Reports", "Statements, arrears, cash flow and exports.", "/equipment-installment-finance/reports"],
  ["Finance Settings", "Payment, reminder, receipt, delivery and legal rules.", "/equipment-installment-finance/applications?stage=settings"],
  ["Final Operations & Reset", "Readiness, reset-impact proof and controlled restart status.", "/equipment-installment-finance/applications?stage=finalization"],
];

function searchableText(section) {
  return [
    section.title,
    section.audience,
    section.summary,
    section.warning,
    ...(section.points || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function EquipmentFinanceGuidePage() {
  const [search, setSearch] = useState("");
  const filteredSections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return GUIDE_SECTIONS;
    return GUIDE_SECTIONS.filter((section) => searchableText(section).includes(term));
  }, [search]);

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Current live operating guide</p>
          <h1>Equipment Installment Finance Help &amp; Guide</h1>
          <span>
            Follow the complete controlled process from customer and excavator selection
            through application, approval, agreement, opening deposit, payments, documents,
            delivery, settlement and ownership.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link
            className="finance-simple__button is-primary"
            to="/equipment-installment-finance/applications?stage=start"
          >
            Start New Installment
          </Link>
          <Link
            className="finance-simple__button"
            to="/equipment-installment-finance/applications?stage=inbox"
          >
            Task &amp; Approval Inbox
          </Link>
        </div>
      </header>

      <article className="finance-guide__boundary">
        <span aria-hidden="true">🏦</span>
        <div>
          <strong>Finance is company-wide — no Hire-location selection</strong>
          <p>
            This guide covers Equipment Installment Finance only. It does not authorize Hire
            enquiries, Hire contracts, dispatch jobs or Hire invoices. Every money, machine and
            approval action still depends on the user's assigned role and permissions.
          </p>
        </div>
      </article>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">Complete lifecycle</p>
        <h2>One controlled journey from application to ownership</h2>
        <div className="finance-guide__journey">
          {JOURNEY.map((step) => (
            <Link className="finance-guide__journey-step" to={step.path} key={step.number}>
              <b>{step.number}</b>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </Link>
          ))}
        </div>
        <div className="finance-simple__notice is-info">
          Each stage preserves its own evidence. Approval does not collect money, a deposit does
          not create delivery, delivery does not transfer ownership, and a posted payment is never
          corrected by deleting it.
        </div>
      </section>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">Search the operating manual</p>
        <h2>Detailed page-by-page guide</h2>
        <div className="finance-guide__search">
          <label htmlFor="finance-guide-search">Search by page, task, role or problem</label>
          <div className="finance-guide__search-row">
            <input
              id="finance-guide-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Example: opening deposit, payment, KYC, delivery, correction, reset"
            />
            <button type="button" onClick={() => setSearch("")} disabled={!search}>
              Clear search
            </button>
          </div>
          <p className="finance-guide__result-count" aria-live="polite">
            Showing {filteredSections.length} of {GUIDE_SECTIONS.length} guide sections.
          </p>
        </div>

        {filteredSections.length ? (
          <div className="finance-guide__section-grid">
            {filteredSections.map((section) => (
              <article className="finance-guide__section-card" key={section.number}>
                <div className="finance-guide__section-top">
                  <div className="finance-guide__section-heading">
                    <span className="finance-guide__number">{section.number}</span>
                    <h3>{section.title}</h3>
                  </div>
                  <span className="finance-guide__audience">{section.audience}</span>
                </div>
                <p>{section.summary}</p>
                <ul>
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                {section.warning ? (
                  <div className="finance-guide__warning">
                    <strong>Important:</strong> {section.warning}
                  </div>
                ) : null}
                <Link className="finance-guide__open-link" to={section.path}>
                  {section.action} →
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="finance-guide__empty">
            No guide section matched “{search}”. Try customer, machine, application, deposit,
            payment, document, delivery or correction.
          </div>
        )}
      </section>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">Who does what?</p>
        <h2>Role responsibilities</h2>
        <div className="finance-guide__role-grid">
          {ROLE_GUIDE.map((role) => (
            <article className="finance-guide__role-card" key={role.title}>
              <h3>{role.title}</h3>
              <p>{role.detail}</p>
            </article>
          ))}
        </div>
        <div className="finance-simple__notice is-info">
          The exact buttons available to a person depend on assigned permissions. Use your own
          account; never share passwords or approve while signed in as somebody else.
        </div>
      </section>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">Understand the records</p>
        <h2>Common application and account statuses</h2>
        <div className="finance-guide__status-grid">
          {STATUS_GUIDE.map((status) => (
            <article className="finance-guide__status-card" key={status.title}>
              <h3>{status.title}</h3>
              <p>{status.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">Quick page map</p>
        <h2>Open the correct Finance workspace</h2>
        <nav className="finance-guide__quick-grid" aria-label="Installment Finance page map">
          {QUICK_LINKS.map(([title, detail, path]) => (
            <Link className="finance-guide__quick-link" to={path} key={title}>
              <strong>{title}</strong>
              <span>{detail}</span>
              <small>Open page →</small>
            </Link>
          ))}
        </nav>
      </section>

      <section className="finance-simple__section">
        <p className="finance-simple__eyebrow">Troubleshooting</p>
        <h2>What to check before repeating an action</h2>
        <div className="finance-guide__trouble-grid">
          {TROUBLESHOOTING.map((problem) => (
            <article className="finance-guide__trouble-card" key={problem.title}>
              <h3>{problem.title}</h3>
              <p>{problem.detail}</p>
            </article>
          ))}
        </div>
        <div className="finance-simple__notice is-error">
          For an uncertain money result, stop first. Confirm whether a receipt, payment, audit
          event or reservation was committed before trying again. Send the page name, time,
          response message and request ID to the System Administrator.
        </div>
      </section>

      <footer className="finance-guide__footer">
        <Link to="/equipment-installment-finance">← Return to Finance Home</Link>
        <span>
          Use controlled approvals, corrections and immutable evidence. Never repair production
          Finance records with direct database edits.
        </span>
      </footer>
    </main>
  );
}
