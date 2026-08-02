import { expect, test } from "@playwright/test";

const workspace = { id: 2, code: "equipment_hire", name: "Equipment Business" };
const manager = {
  id: 61,
  username: "phase6-manager",
  full_name: "Phase 6 Finance Manager",
  role: "manager",
  workspace_role: "finance_manager",
  access_role: "finance_manager",
  workspace_code: "equipment_hire",
  active_workspace: workspace,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("Phase 6 unifies portfolio, arrears, cash flow, statements and SMS evidence", async ({ page }) => {
  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase6-manager-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, manager);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();

    if (path === "/auth/me") return json(route, { status: "success", user: manager, workspace });
    if (path === "/equipment-catalogue/sales/phase6/portfolio") {
      return json(route, {
        status: "success",
        summary: {
          agreement_count: 1,
          active_count: 1,
          overdue_count: 1,
          portfolio_value: 500000,
          lifetime_collections: 150000,
          period_collections: 50000,
          outstanding_balance: 350000,
          overdue_balance: 25000,
          average_paid_percent: 30,
        },
        statuses: [{ agreement_status: "overdue", agreements: 1, outstanding_amount: 350000 }],
        aging: [{ aging_bucket: "1_30", agreements: 1, overdue_amount: 25000 }],
        upcoming: [{ due_date: "2026-08-10", agreements: 1, expected_amount: 25000 }],
        accounts: [{
          id: 901,
          agreement_number: "ESA-PHASE6-001",
          customer_name: "Kwame Phase Six",
          customer_phone: "0240000606",
          asset_code: "EXC-PHASE6-001",
          asset_name: "Caterpillar 320 Excavator",
          amount_paid: 150000,
          outstanding_balance: 350000,
          overdue_amount: 25000,
        }],
      });
    }
    if (path === "/equipment-catalogue/sales/phase6/arrears") {
      return json(route, {
        status: "success",
        as_of: "2026-08-02",
        summary: { accounts: 1, arrears: 25000, outstanding: 350000 },
        arrears: [{
          agreement_id: 901,
          agreement_number: "ESA-PHASE6-001",
          customer_name: "Kwame Phase Six",
          customer_phone: "0240000606",
          asset_code: "EXC-PHASE6-001",
          asset_name: "Caterpillar 320 Excavator",
          oldest_due_date: "2026-07-20",
          days_overdue: 13,
          calculated_arrears: 25000,
          outstanding_balance: 350000,
          successful_reminders: 1,
          last_reminder_at: "2026-08-02T09:00:00Z",
        }],
      });
    }
    if (path === "/equipment-catalogue/sales/phase6/cash-flow") {
      return json(route, {
        status: "success",
        actual: [{ month_key: "2026-08", month_label: "Aug 2026", payments: 1, collected_amount: 50000 }],
        expected: [{ month_key: "2026-08", month_label: "Aug 2026", schedule_lines: 2, expected_amount: 50000 }],
        payment_methods: [{ payment_method: "bank", payments: 1, collected_amount: 50000 }],
      });
    }
    if (path === "/equipment-catalogue/sales/phase6/messages") {
      return json(route, {
        status: "success",
        history: {
          customer_payment_receipts: [{
            id: 1,
            message_type: "customer_payment_receipt",
            recipient_type: "customer",
            recipient_phone: "0240000606",
            delivery_status: "accepted",
            created_at: "2026-08-02T09:01:00Z",
            agreement_number: "ESA-PHASE6-001",
            customer_name: "Kwame Phase Six",
            receipt_number: "EFR-PHASE6-001",
            message_preview: "Payment receipt accepted.",
          }],
          boss_payment_alerts: [],
          reminders: [],
        },
      });
    }
    if (path === "/equipment-catalogue/sales/phase6/accounts/901/statement") {
      return json(route, {
        status: "success",
        statement: {
          agreement: { agreement_number: "ESA-PHASE6-001" },
          schedule: [],
          payments: [{
            id: 801,
            receipt_number: "EFR-PHASE6-001",
            payment_date: "2026-08-02T08:30:00Z",
            payment_method: "bank",
            amount: 50000,
            customer_sms_status: "accepted",
            boss_sms_status: "accepted",
          }],
          allocations: [],
        },
      });
    }
    if (path === "/equipment-catalogue/sales/phase6/messages/sync" && method === "POST") {
      return json(route, {
        status: "success",
        message: "Payment SMS sync completed: 1 sent, 0 failed and 0 skipped.",
        receipts: { sent: 1, failed: 0, skipped: 0 },
      });
    }
    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  await page.goto("/equipment-installment-finance/reports");
  await expect(page.getByTestId("phase6-finance-reports")).toBeVisible();
  await expect(page.getByTestId("phase6-portfolio-summary")).toContainText("GHS 500,000.00");
  await expect(page.getByTestId("phase6-arrears-report")).toContainText("ESA-PHASE6-001");
  await expect(page.getByTestId("phase6-cash-flow-report")).toContainText("Aug 2026");
  await expect(page.getByTestId("phase6-message-history")).toContainText("Customer Payment Receipt");

  await page.getByLabel("Finance agreement").selectOption("901");
  await expect(page.getByTestId("phase6-customer-statement")).toContainText("EFR-PHASE6-001");
  await expect(page.getByTestId("phase6-customer-statement")).toContainText("Thermal Receipt");

  await page.getByRole("button", { name: "Sync Payment SMS" }).click();
  await expect(page.getByRole("status")).toContainText("1 sent");
});
