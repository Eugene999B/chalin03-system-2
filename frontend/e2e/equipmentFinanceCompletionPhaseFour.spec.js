import { expect, test } from "@playwright/test";

const adminUser = {
  id: 1,
  username: "phase4-completion-admin",
  full_name: "Phase 4 Completion Administrator",
  role: "admin",
  workspace_role: "finance_manager",
  access_role: "finance_manager",
  workspace_code: "equipment_hire",
  business_unit_id: 2,
  business_unit_name: "Equipment Business",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  is_original_system_administrator: true,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("final Finance completion proves operations, dry run and permanent production lock", async ({ page }) => {
  let dryRunRequests = 0;
  let executeRequests = 0;

  const features = [
    ["arrears", "Arrears dashboard", "Due, overdue, broken-promise and high-risk queues are available."],
    ["promises", "Reminders and promises to pay", "Follow-up, promise dates, amounts, outcomes and corrections are append-only."],
    ["recovery", "Default and recovery governance", "Reschedule, default and recovery decisions remain permission controlled and audited."],
    ["completion", "Completion and ownership transfer", "Settlement, controlled handover and zero-balance ownership transfer are enforced."],
    ["settings", "Finance policies and document settings", "Payment, reminder, receipt, delivery and legal settings remain Finance scoped."],
    ["permissions", "Finance role permissions", "Finance staff remain isolated from Equipment Hire jobs and location operations."],
    ["documents", "Professional document pack", "Immutable agreements, receipts, statements, notices and completion documents are available."],
  ].map(([code, title, evidence]) => ({ code, title, evidence, complete: true }));

  const readiness = {
    generated_at: "2026-08-05T07:20:00.000Z",
    workspace: "equipment_installment_finance",
    ready: true,
    database: "railway",
    features,
    database_readiness: {
      ready: true,
      required_tables: [],
      missing_tables: [],
      discovered_finance_tables: [
        "equipment_credit_applications",
        "equipment_sale_agreements",
        "equipment_sale_payments",
        "equipment_installment_schedule",
      ],
    },
    portfolio_counts: {
      applications: 1,
      agreements: 1,
      payments: 1,
      schedule_rows: 12,
      deliveries: 1,
      ownership_transfers: 0,
    },
    reset: {
      enabled: false,
      production_permanently_blocked: true,
      environment: "production",
      database: "railway",
      code: "PRODUCTION_FINANCE_RESET_PERMANENTLY_BLOCKED",
      message:
        "Finance data deletion is permanently blocked in production. Use the dry run and approved backup evidence only.",
    },
    production_reset_executed: false,
    fresh_installment_proof_required: true,
  };

  const dryRun = {
    generated_at: "2026-08-05T07:21:00.000Z",
    workspace: "equipment_installment_finance",
    mode: "dry_run",
    read_only: true,
    database: "railway",
    readiness: true,
    portfolio_counts: readiness.portfolio_counts,
    table_impact: [
      {
        table: "equipment_credit_applications",
        total_rows: 1,
        reset_scope: "dedicated_finance_table",
      },
      {
        table: "equipment_sale_agreements",
        total_rows: 1,
        reset_scope: "linked_finance_rows_only",
      },
      {
        table: "equipment_sale_payments",
        total_rows: 1,
        reset_scope: "linked_finance_rows_only",
      },
    ],
    reset: readiness.reset,
    confirmation_phrase: "RESET FINANCE TEST DATA",
    production_reset_executed: false,
    preserves: [
      "Spare Parts records",
      "Mining records",
      "Equipment Hire jobs and contracts",
      "shared customer identities",
      "shared excavator identity and photographs",
      "users, permissions, settings, backups and audit history",
    ],
    fingerprint: "8d8a3ed650fa47305b99cd60fbda4ed346b2e62bdbe659ca7b4bb80935f04751",
  };

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase4-completion-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, adminUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (path === "/auth/me" && method === "GET") {
      return json(route, {
        status: "success",
        user: adminUser,
        workspace: adminUser.active_workspace,
      });
    }

    if (
      path === "/equipment-catalogue/sales/completion-phase-four/readiness" &&
      method === "GET"
    ) {
      return json(route, { status: "success", readiness });
    }

    if (
      path === "/equipment-catalogue/sales/completion-phase-four/reset/dry-run" &&
      method === "POST"
    ) {
      dryRunRequests += 1;
      return json(route, { status: "success", dry_run: dryRun });
    }

    if (
      path === "/equipment-catalogue/sales/completion-phase-four/reset/execute" &&
      method === "POST"
    ) {
      executeRequests += 1;
      return json(
        route,
        {
          status: "error",
          code: "PRODUCTION_FINANCE_RESET_PERMANENTLY_BLOCKED",
          message: "Finance data deletion is permanently blocked in production.",
        },
        403
      );
    }

    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  await page.goto(
    "/equipment-installment-finance/applications?stage=finalization"
  );

  await expect(
    page.getByRole("heading", { name: "Final Operations & Reset Centre" })
  ).toBeVisible();
  await expect(page.getByText("Production reset is permanently blocked")).toBeVisible();
  await expect(page.getByText("7 / 7")).toBeVisible();
  await expect(page.getByText("READY", { exact: true })).toBeVisible();

  for (const feature of features) {
    await expect(page.getByRole("heading", { name: feature.title })).toBeVisible();
  }

  await page.getByRole("button", { name: "Prepare Dry Run" }).click();
  await expect(page.getByText("Read-only Finance reset impact prepared")).toBeVisible();
  await expect(page.getByText("Dry-run fingerprint")).toBeVisible();
  await expect(page.getByText(dryRun.fingerprint)).toBeVisible();
  await expect(page.getByText("Spare Parts records")).toBeVisible();
  await expect(page.getByText("Equipment Hire jobs and contracts")).toBeVisible();
  expect(dryRunRequests).toBe(1);

  await expect(page.getByText("LOCKED", { exact: true })).toBeVisible();
  const confirmation = page.getByPlaceholder("RESET FINANCE TEST DATA");
  await expect(confirmation).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset Test Finance Data" })).toBeDisabled();
  expect(executeRequests).toBe(0);

  await expect(page.getByRole("heading", { name: "Fresh installment journey" })).toBeVisible();
  await expect(
    page.getByText(/Customer → excavator → application → approval → agreement/)
  ).toBeVisible();
  await expect(page.getByText("PRODUCTION-SHAPED BROWSER PROOF REQUIRED")).toBeVisible();
});
