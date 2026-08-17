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

function json(route, body, status = 200) { return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }

test("final Finance completion requires password re-authentication and exact confirmation", async ({ page }) => {
  let dryRunRequests = 0;
  let executeRequests = 0;
  const features = [
    ["Arrears dashboard", "Due, overdue, broken-promise and high-risk queues are available."],
    ["Reminders and promises to pay", "Follow-up, promise dates, amounts, outcomes and corrections are append-only."],
    ["Default and recovery governance", "Reschedule, default and recovery decisions remain permission controlled and audited."],
    ["Completion and ownership transfer", "Settlement, controlled handover and zero-balance ownership transfer are enforced."],
    ["Finance policies and document settings", "Payment, reminder, receipt, delivery and legal settings remain Finance scoped."],
    ["Finance role permissions", "Finance staff remain isolated from Equipment Hire jobs and location operations."],
    ["Professional document pack", "Immutable agreements, receipts, statements, notices and completion documents are available."],
  ].map(([title, evidence], index) => ({ code: String(index), title, evidence, complete: true }));

  const readiness = {
    ready: true,
    workspace: "equipment_installment_finance",
    database: "railway",
    features,
    portfolio_counts: { applications: 1, agreements: 1, payments: 1, schedule_rows: 12, deliveries: 1, ownership_transfers: 0 },
    reset: { enabled: true, production_permanently_blocked: false, requires_password_reauthentication: true, requires_exact_confirmation: true, code: "LIVE_FINANCE_RESET_REQUIRES_REAUTH", message: "Reset requires the original System Administrator password and the exact confirmation phrase." },
  };
  const dryRun = { mode: "dry_run", read_only: true, database: "railway", readiness: true, confirmation_phrase: "RESET INSTALLMENT FINANCE", fingerprint: "phase4-live-reset-fingerprint", production_reset_executed: false, table_impact: [], preserves: ["Spare Parts records", "Mining records", "Equipment Hire jobs and contracts", "shared customer identities", "shared excavator identity and photographs", "users, permissions, settings, backups and audit history"] };

  await page.addInitScript((user) => { localStorage.setItem("chalin03_token", "phase4-completion-token"); localStorage.setItem("chalin03_user", JSON.stringify(user)); }, adminUser);
  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path === "/auth/me" && method === "GET") return json(route, { status: "success", user: adminUser, workspace: adminUser.active_workspace });
    if (path === "/equipment-catalogue/sales/completion-phase-four/readiness" && method === "GET") return json(route, { status: "success", readiness });
    if (path === "/equipment-catalogue/sales/completion-phase-four/reset/dry-run" && method === "POST") { dryRunRequests += 1; return json(route, { status: "success", dry_run: dryRun }); }
    if (path === "/equipment-catalogue/sales/completion-phase-four/reset/execute" && method === "POST") {
      executeRequests += 1;
      const body = request.postDataJSON();
      if (body?.password === "correct-password" && body?.confirmation === "RESET INSTALLMENT FINANCE") return json(route, { status: "success", mode: "installment_live_reset", message: "Installment Finance data was reset successfully." });
      return json(route, { status: "error", code: "FINANCE_RESET_REAUTH_FAILED", message: "Incorrect System Administrator password." }, 401);
    }
    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  await page.goto("/equipment-installment-finance/applications?stage=finalization");
  await expect(page.getByRole("heading", { name: "Final Operations & Reset Centre" })).toBeVisible();
  await expect(page.getByText("Installment-only reset boundary")).toBeVisible();
  await expect(page.getByText("7 / 7")).toBeVisible();
  await expect(page.getByText("READY", { exact: true })).toBeVisible();
  for (const feature of features) await expect(page.getByRole("heading", { name: feature.title })).toBeVisible();

  await page.getByRole("button", { name: "Prepare Dry Run" }).click();
  await expect(page.getByText("Read-only Installment Finance reset impact prepared")).toBeVisible();
  await expect(page.getByText(dryRun.fingerprint)).toBeVisible();
  expect(dryRunRequests).toBe(1);

  const password = page.getByPlaceholder("Enter current password");
  const confirmation = page.getByPlaceholder("RESET INSTALLMENT FINANCE");
  const resetButton = page.getByRole("button", { name: "Reset Installment Finance Data" });
  await expect(password).toBeVisible();
  await expect(confirmation).toBeVisible();
  await expect(resetButton).toBeDisabled();

  await password.fill("wrong-password");
  await confirmation.fill("RESET INSTALLMENT FINANCE");
  await resetButton.click();
  await expect(page.getByText("Incorrect System Administrator password.")).toBeVisible();
  expect(executeRequests).toBe(1);

  await password.fill("correct-password");
  await confirmation.fill("RESET INSTALLMENT FINANCE");
  await resetButton.click();
  await expect(page.getByText("Installment Finance data was reset successfully.")).toBeVisible();
  expect(executeRequests).toBe(2);
});
