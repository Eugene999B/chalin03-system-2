import { expect, test } from "@playwright/test";

const adminUser = {
  id: 1,
  username: "phase2-admin",
  full_name: "Phase 2 Administrator",
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

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64"
);

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("staff can search, select and move through account, customer and payment details", async ({ page }) => {
  const state = {
    paid: 200,
    outstanding: 800,
    payments: [
      {
        id: 701,
        agreement_id: 601,
        payment_number: "ESP-0001",
        receipt_number: "ESR-0001",
        payment_date: "2026-08-01",
        amount: 200,
        payment_method: "cash",
        received_by_name: "Phase 2 Administrator",
      },
    ],
  };

  const schedule = [
    { id: 801, agreement_id: 601, sequence_number: 1, due_date: "2026-08-15", scheduled_amount: 250, amount_paid: 200, schedule_status: "partial" },
    { id: 802, agreement_id: 601, sequence_number: 2, due_date: "2026-09-15", scheduled_amount: 250, amount_paid: 0, schedule_status: "pending" },
    { id: 803, agreement_id: 601, sequence_number: 3, due_date: "2026-10-15", scheduled_amount: 250, amount_paid: 0, schedule_status: "pending" },
    { id: 804, agreement_id: 601, sequence_number: 4, due_date: "2026-11-15", scheduled_amount: 250, amount_paid: 0, schedule_status: "pending" },
  ];

  function account() {
    return {
      agreement_id: 601,
      agreement_number: "ESA-PHASE2-001",
      agreement_status: "active",
      application_id: 501,
      application_number: "ECAPP-PHASE2-001",
      customer_id: 21,
      customer_name: "Ama Account Customer",
      customer_phone: "0240000021",
      customer_address: "Dunkwa-on-Offin",
      asset_id: 301,
      asset_code: "EXC-301",
      asset_name: "LiuGong 922E",
      serial_number: "LG922E-PHASE2",
      total_amount: 1000,
      deposit_required: 200,
      deposit_received: 200,
      financed_amount: 800,
      amount_paid: state.paid,
      outstanding_balance: state.outstanding,
      overdue_amount: 50,
      payment_frequency: "monthly",
      installment_count: 4,
      next_due_date: "2026-08-15",
      final_due_date: "2026-11-15",
      last_payment_at: "2026-08-01",
      equipment_commitment_status: "reserved",
      reserved: true,
      active_hire_count: 0,
      delivery_status: "not_delivered",
      ownership_status: "retained_by_seller",
      ownership_id: null,
      reconciliation_consistent: true,
      reconciliation_mismatches: [],
      main_image_url: "/equipment-catalogue/sales/protected-images/applications/501",
    };
  }

  function customerSummary() {
    return {
      customer_id: 21,
      customer_name: "Ama Account Customer",
      phone: "0240000021",
      email: "ama@example.com",
      address: "Dunkwa-on-Offin",
      latest_kyc: {
        id_type: "Ghana Card",
        id_number: "GHA-123456789-0",
        occupation: "Contractor",
        employer_business_name: "Ama Mining Services",
        guarantor_name: "Kojo Guarantor",
      },
      latest_application: {
        application_id: 501,
        application_number: "ECAPP-PHASE2-001",
      },
      application_count: 1,
      approved_application_count: 1,
      agreement_count: 1,
      active_agreement_count: 1,
      completed_agreement_count: 0,
      overdue_agreement_count: 1,
      defaulted_agreement_count: 0,
      total_sales_value: 1000,
      financed_amount: 800,
      amount_paid: state.paid,
      outstanding_balance: state.outstanding,
      overdue_amount: 50,
      next_due_date: "2026-08-15",
      highest_risk_band: "medium",
      aging_bucket: "1_7_days",
      portfolio_status: "overdue",
    };
  }

  function customerProfile() {
    const customer = customerSummary();
    return {
      status: "success",
      generated_at: "2026-08-05T00:00:00.000Z",
      customer: {
        ...customer,
        applications: [
          {
            application_id: 501,
            application_number: "ECAPP-PHASE2-001",
            application_status: "approved",
            quoted_total: 1000,
          },
        ],
        agreements: [
          {
            id: 601,
            agreement_id: 601,
            agreement_number: "ESA-PHASE2-001",
            agreement_status: "overdue",
            asset_code_snapshot: "EXC-301",
            asset_name_snapshot: "LiuGong 922E",
            total_amount: 1000,
            amount_paid: state.paid,
            outstanding_balance: state.outstanding,
            overdue_amount: 50,
            next_due_date: "2026-08-15",
            risk_band: "medium",
          },
        ],
      },
      schedule,
      payments: state.payments,
      deliveries: [],
      ownership_transfers: [],
      decisions: [],
      reconciliations: [{ agreement_id: 601, agreement_number: "ESA-PHASE2-001", consistent: true, mismatches: [] }],
    };
  }

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase2-admin-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, adminUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (path === "/auth/me" && method === "GET") {
      return json(route, { status: "success", user: adminUser, workspace: adminUser.active_workspace });
    }
    if (path === "/equipment-catalogue/sales/finance-lifecycle/readiness" && method === "GET") {
      return json(route, { status: "success", readiness: { ready: true } });
    }
    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts" && method === "GET") {
      return json(route, { status: "success", count: 1, accounts: [account()] });
    }
    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts/601" && method === "GET") {
      return json(route, {
        status: "success",
        account: account(),
        reconciliation: { consistent: true, mismatches: [] },
        schedule,
        payments: state.payments,
        payment_allocations: state.payments.map((payment, index) => ({
          id: index + 1,
          payment_id: payment.id,
          schedule_id: 801,
          sequence_number: 1,
          due_date: "2026-08-15",
          receipt_number: payment.receipt_number,
          allocated_amount: payment.amount,
        })),
        deliveries: [],
        ownership_transfers: [],
      });
    }
    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts/601/collections" && method === "POST") {
      const payload = request.postDataJSON();
      const amount = Number(payload.amount);
      state.paid += amount;
      state.outstanding -= amount;
      const payment = {
        id: 702,
        agreement_id: 601,
        payment_number: "ESP-0002",
        receipt_number: "ESR-0002",
        payment_date: "2026-08-05",
        amount,
        payment_method: payload.payment_method,
        received_by_name: "Phase 2 Administrator",
      };
      state.payments = [payment, ...state.payments];
      return json(route, {
        status: "success",
        message: "Installment collection recorded and allocated across the oldest due schedule lines.",
        payment_id: payment.id,
        receipt_number: payment.receipt_number,
        allocations: [{ schedule_id: 801, sequence_number: 1, allocated_amount: amount }],
        account: account(),
      }, 201);
    }
    if (path === "/equipment-catalogue/sales/finance-customers" && method === "GET") {
      return json(route, {
        status: "success",
        summary: {
          customers: 1,
          active_customers: 1,
          overdue_customers: 1,
          amount_paid: state.paid,
          outstanding_balance: state.outstanding,
          overdue_amount: 50,
        },
        customers: [customerSummary()],
      });
    }
    if (path === "/equipment-catalogue/sales/finance-customers/21" && method === "GET") {
      return json(route, customerProfile());
    }
    if (
      [
        "/equipment-catalogue/sales/credit-applications/501/image",
        "/equipment-catalogue/sales/protected-images/applications/501",
      ].includes(path) &&
      method === "GET"
    ) {
      return route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng });
    }
    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  await page.goto("/equipment-installment-finance/applications?stage=accounts");
  await expect(page.getByRole("heading", { name: "Active Installments" })).toBeVisible();
  await expect(page.getByLabel("Search active installment accounts")).toBeVisible();
  await expect(page.getByText("Ama Account Customer").first()).toBeVisible();
  await expect(page.getByText("GHS 800.00").first()).toBeVisible();

  await page.getByRole("link", { name: "Record Payment" }).first().click();
  await expect(page.getByRole("heading", { name: "Payments & Collections Centre" })).toBeVisible();
  await expect(page.getByTestId("finance-account-detail")).toBeVisible();
  await page.getByLabel("Amount received").fill("200");
  await page.getByRole("button", { name: "Record Payment", exact: true }).click();
  await expect(page.getByText(/Receipt: ESR-0002/)).toBeVisible();
  await expect(page.getByTestId("account-detail-official-balance")).toContainText("GHS 600.00");

  await page.goto("/equipment-installment-finance/applications?stage=customer-portfolios&customer=21");
  await expect(page.getByRole("heading", { name: "Customer Installment Profiles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ama Account Customer" })).toBeVisible();
  await page.getByText("Show identity, KYC and assessment details", { exact: true }).click();
  await expect(page.getByText("GHA-123456789-0")).toBeVisible();
  const image = page.locator('img[alt="Excavator for Ama Account Customer"]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  await page.getByText("Show schedule and payment details", { exact: true }).click();
  await expect(page.getByText("ESR-0002")).toBeVisible();
  await expect(page.getByRole("link", { name: "Record Payment" }).first()).toBeVisible();

  await page.goto("/equipment-installment-finance/applications?stage=customer-portfolios");
  await expect(page.getByText("No customer selected")).toBeVisible();
  await expect(page.getByLabel("Search Finance customers")).toBeVisible();

  await page.goto("/equipment-installment-finance/applications?stage=collections");
  await expect(page.getByRole("heading", { name: "Payments & Collections Centre" })).toBeVisible();
  await expect(page.getByLabel("Search payment-ready Finance accounts")).toBeVisible();
  await expect(page.getByRole("link", { name: "Corrections & Reversals" }).first()).toBeVisible();
});
