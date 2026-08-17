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
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("Installment reset requires review, password and exact confirmation", async ({ page }) => {
  let dryRunRequests = 0;
  let executeRequests = 0;
  const readiness = {
    status: "success",
    readiness: {
      portfolio_counts: { applications: 2, agreements: 1, payments: 3, schedule_rows: 8, deliveries: 1, ownership_transfers: 0 },
      features: [],
      ready: true,
      database: "railway",
    },
  };
  const dryRun = {
    status: "success",
    dry_run: {
      fingerprint: "installment-reset-fingerprint",
      impact: [
        { table: "equipment_credit_applications", rows: 2 },
        { table: "equipment_sale_agreements", rows: 1 },
        { table: "equipment_sale_payments", rows: 3 },
      ],
      preserves: ["shared customer identities", "excavator master records and photographs", "Spare Parts records", "Mining records", "Equipment Hire jobs and contracts", "users and permissions", "audit history"],
    },
  };

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase4-completion-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, adminUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return json(route, { status: "success", user: adminUser, workspace: adminUser.active_workspace });
    if (path === "/equipment-catalogue/sales/completion-phase-four/readiness") return json(route, readiness);
    if (path === "/equipment-catalogue/sales/completion-phase-four/reset/dry-run") {
      dryRunRequests += 1;
      return json(route, dryRun);
    }
    if (path === "/equipment-catalogue/sales/completion-phase-four/reset/execute") {
      executeRequests += 1;
      return json(route, { status: "success", message: "Installment Finance data was reset successfully." });
    }
    return json(route, { status: "error", message: "Unhandled request" }, 404);
  });

  await page.goto("/equipment-installment-finance/applications?stage=finalization");

  await expect(page.getByRole("heading", { name: "Reset Centre" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare Reset Review" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare Reset Review" }).click();
  await expect(page.getByText("Reset fingerprint")).toBeVisible();
  expect(dryRunRequests).toBe(1);

  const password = page.getByLabel("Current password");
  const confirmation = page.getByPlaceholder("RESET INSTALLMENT FINANCE");
  const resetButton = page.getByRole("button", { name: "Reset Installment Finance Data" });

  await expect(password).toBeVisible();
  await expect(confirmation).toBeVisible();
  await expect(resetButton).toBeDisabled();

  await password.fill("correct-password");
  await confirmation.fill("RESET INSTALLMENT FINANCE");
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await expect(page.getByText("Installment Finance data was reset successfully.")).toBeVisible();
  expect(executeRequests).toBe(1);
});
