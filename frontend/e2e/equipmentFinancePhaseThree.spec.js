import { expect, test } from "@playwright/test";

const adminUser = {
  id: 1,
  username: "phase3-admin",
  full_name: "Phase 3 Administrator",
  role: "admin",
  workspace_role: "finance_manager",
  access_role: "finance_manager",
  workspace_code: "equipment_hire",
  business_unit_id: 2,
  business_unit_name: "Equipment Business",
  active_workspace: {
    id: 2,
    code: "equipment_hire",
    name: "Equipment Business",
  },
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

function scheduleRows() {
  return [
    { id: 1, sequence_number: 1, due_date: "2026-09-01", scheduled_amount: 200, amount_paid: 0, schedule_status: "pending" },
    { id: 2, sequence_number: 2, due_date: "2026-10-01", scheduled_amount: 200, amount_paid: 0, schedule_status: "pending" },
    { id: 3, sequence_number: 3, due_date: "2026-11-01", scheduled_amount: 200, amount_paid: 0, schedule_status: "pending" },
    { id: 4, sequence_number: 4, due_date: "2026-12-01", scheduled_amount: 200, amount_paid: 0, schedule_status: "pending" },
  ];
}

test("administrator completes the minimal installment workflow and sees the backend balance", async ({ page }) => {
  const state = {
    machines: [],
    applicationCreated: false,
    activated: false,
    depositRecorded: false,
    outstanding: 1000,
    amountPaid: 0,
    payments: [],
  };

  const customer = {
    id: 21,
    customer_code: "FCUS-00021",
    customer_name: "Ama Phase Three",
    phone: "0240000021",
    email: "ama@example.com",
    address: "Dunkwa-on-Offin",
    finance_application_count: 0,
    finance_agreement_count: 0,
    outstanding_balance: 0,
  };

  function machine() {
    return state.machines[0];
  }

  function activationCandidate() {
    if (!state.applicationCreated) return [];
    return [
      {
        id: 501,
        application_number: "ECAPP-PHASE3-001",
        application_status: "approved",
        kyc_status: "verified",
        affordability_status: "eligible",
        risk_band: "low",
        customer_id: customer.id,
        customer_name: customer.customer_name,
        customer_phone: customer.phone,
        quotation_id: 401,
        quotation_number: "EIO-PHASE3-001",
        quotation_status: "approved",
        asset_id: machine().id,
        asset_code: machine().asset_code,
        asset_name: machine().asset_name,
        quoted_total: 1000,
        approved_deposit: 200,
        financed_amount: 800,
        payment_frequency: "monthly",
        payment_interval_days: null,
        non_working_day_rule: "exact",
        installment_count: 4,
        proposed_first_due_date: "2026-09-01",
        periodic_amount: 200,
        final_payment_amount: 200,
        final_due_date: "2026-12-01",
        agreement_id: state.activated ? 601 : null,
        activation_ready: !state.activated,
        activation_blockers: [],
      },
    ];
  }

  function account() {
    if (!state.activated || !state.depositRecorded) return null;
    return {
      agreement_id: 601,
      agreement_number: "ESA-PHASE3-001",
      agreement_status: "active",
      application_id: 501,
      application_number: "ECAPP-PHASE3-001",
      customer_id: customer.id,
      customer_name: customer.customer_name,
      customer_phone: customer.phone,
      customer_address: customer.address,
      asset_id: machine().id,
      asset_code: machine().asset_code,
      asset_name: machine().asset_name,
      serial_number: machine().serial_number,
      total_amount: 1000,
      deposit_required: 200,
      deposit_received: 200,
      financed_amount: 800,
      amount_paid: state.amountPaid,
      outstanding_balance: state.outstanding,
      overdue_amount: 0,
      payment_frequency: "monthly",
      installment_count: 4,
      first_due_date: "2026-09-01",
      next_due_date: "2026-09-01",
      final_due_date: "2026-12-01",
      last_payment_date: state.payments.at(-1)?.payment_date || null,
      equipment_commitment_status: "reserved",
      reserved: true,
      active_hire_count: 0,
      delivery_eligible: true,
      fully_paid: false,
      ownership_id: null,
      main_image_url: machine().main_image_url,
    };
  }

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase3-admin-token");
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

    if (path === "/equipment-catalogue/sales/phase-one/bootstrap" && method === "GET") {
      return json(route, {
        status: "success",
        customers: [customer],
        machines: state.machines,
        settings: {
          default_payment_frequency: "monthly",
          default_first_due_days: 30,
        },
        policy: {
          scope: "company_wide",
          hire_location_selection_required: false,
        },
      });
    }

    if (path === "/equipment-catalogue/sales/professional/machine-register/locations" && method === "GET") {
      return json(route, {
        status: "success",
        locations: [{ id: 31, name: "Dunkwa Equipment Yard" }],
      });
    }

    if (path === "/equipment-catalogue/sales/professional/machine-register" && method === "POST") {
      const payload = request.postDataJSON();
      state.machines = [
        {
          id: 301,
          ...payload,
          asset_code: payload.asset_code,
          asset_name: payload.asset_name,
          serial_number: payload.serial_number,
          target_selling_price: Number(payload.target_selling_price),
          minimum_selling_price: Number(payload.minimum_selling_price || 0),
          operational_purpose: payload.operational_purpose || "sale_only",
          sale_status: "available",
          current_status: "available",
          active_application_count: 0,
          active_sale_lock_count: 0,
          main_image_url: payload.photos?.[0]?.data_url || null,
          media: (payload.photos || []).map((photo, index) => ({
            id: index + 1,
            file_url: photo.data_url,
            evidence_type: photo.evidence_type,
            is_primary: photo.is_primary,
          })),
          readiness: { ready: true, missing: [] },
          editability: { editable: true, reason: "No installment has started." },
        },
      ];
      return json(route, {
        status: "success",
        message: "Excavator registered.",
        machine: state.machines[0],
      }, 201);
    }

    if (path === "/equipment-catalogue/sales/phase-one/schedule-preview" && method === "POST") {
      const schedule = scheduleRows();
      return json(route, {
        status: "success",
        schedule: {
          selling_price: 1000,
          deposit: 200,
          financed_amount: 800,
          installment_count: 4,
          payment_frequency: "monthly",
          custom_interval_days: null,
          first_due_date: "2026-09-01",
          final_due_date: "2026-12-01",
          periodic_amount: 200,
          final_payment_amount: 200,
          non_working_day_rule: "exact",
          schedule,
        },
      });
    }

    if (path === "/equipment-catalogue/sales/phase-one/start-installment" && method === "POST") {
      state.applicationCreated = true;
      return json(route, {
        status: "success",
        message: "Installment Offer and draft created.",
        application: {
          id: 501,
          application_number: "ECAPP-PHASE3-001",
          application_status: "draft",
        },
        installment_offer: {
          id: 401,
          number: "EIO-PHASE3-001",
          exact_schedule: scheduleRows(),
        },
        next_path: "/equipment-installment-finance/applications?stage=activation",
      }, 201);
    }

    if (path === "/equipment-catalogue/sales/agreement-activations/readiness" && method === "GET") {
      return json(route, { status: "success", readiness: { ready: true } });
    }

    if (path === "/equipment-catalogue/sales/agreement-activations/candidates" && method === "GET") {
      return json(route, { status: "success", candidates: activationCandidate() });
    }

    if (path === "/equipment-catalogue/sales/agreement-activations/501" && method === "POST") {
      state.activated = true;
      state.outstanding = 1000;
      return json(route, {
        status: "success",
        message: "Finance agreement and exact installment schedule created.",
        agreement: { id: 601, agreement_number: "ESA-PHASE3-001" },
        next_action: {
          code: "collect_deposit",
          label: "Record the required deposit to reserve the exact machine.",
        },
      }, 201);
    }

    if (path === "/equipment-catalogue/sales/deposit-reservations/readiness" && method === "GET") {
      return json(route, { status: "success", readiness: { ready: true } });
    }

    if (path === "/equipment-catalogue/sales/deposit-reservations/candidates" && method === "GET") {
      const candidates = state.activated
        ? [
            {
              agreement_id: 601,
              agreement_number: "ESA-PHASE3-001",
              application_id: 501,
              application_number: "ECAPP-PHASE3-001",
              customer_id: customer.id,
              customer_name: customer.customer_name,
              customer_phone: customer.phone,
              asset_id: machine().id,
              asset_code: machine().asset_code,
              asset_name: machine().asset_name,
              main_image_url: machine().main_image_url,
              asset_sale_status: "available",
              total_amount: 1000,
              deposit_required: 200,
              deposit_received: state.depositRecorded ? 200 : 0,
              deposit_remaining: state.depositRecorded ? 0 : 200,
              financed_amount: 800,
              outstanding_balance: state.outstanding,
              reserved: state.depositRecorded,
              equipment_commitment_status: state.depositRecorded ? "reserved" : "unreserved",
            },
          ]
        : [];
      return json(route, { status: "success", candidates });
    }

    if (path === "/equipment-catalogue/sales/deposit-reservations/601/deposit" && method === "POST") {
      state.depositRecorded = true;
      state.amountPaid = 200;
      state.outstanding = 800;
      state.payments = [
        {
          id: 701,
          receipt_number: "DEP-RECEIPT-001",
          payment_number: "DEP-PAY-001",
          payment_date: "2026-08-01T12:00:00Z",
          payment_method: "cash",
          amount: 200,
          payment_category: "deposit",
        },
      ];
      return json(route, {
        status: "success",
        message: "Opening deposit recorded and the excavator was reserved.",
        payment: { id: 701, receipt_number: "DEP-RECEIPT-001" },
      }, 201);
    }

    if (path === "/equipment-catalogue/sales/finance-lifecycle/readiness" && method === "GET") {
      return json(route, { status: "success", readiness: { ready: true } });
    }

    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts" && method === "GET") {
      return json(route, {
        status: "success",
        accounts: account() ? [account()] : [],
      });
    }

    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts/601" && method === "GET") {
      return json(route, {
        status: "success",
        account: account(),
        schedule: scheduleRows(),
        payments: state.payments,
        payment_allocations: [],
      });
    }

    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts/601/collections" && method === "POST") {
      const payload = request.postDataJSON();
      const amount = Number(payload.amount);
      state.amountPaid = Number((state.amountPaid + amount).toFixed(2));
      state.outstanding = Number((state.outstanding - amount).toFixed(2));
      state.payments = [
        ...state.payments,
        {
          id: 702,
          receipt_number: "COL-RECEIPT-001",
          payment_number: "COL-PAY-001",
          payment_date: "2026-08-01T13:00:00Z",
          payment_method: payload.payment_method,
          amount,
          payment_category: "installment",
        },
      ];
      return json(route, {
        status: "success",
        message: "Installment payment recorded and allocated.",
        payment_id: 702,
        receipt_number: "COL-RECEIPT-001",
        account: account(),
        boss_payment_alert: { ok: false, status: "skipped" },
      }, 201);
    }

    if (path === "/equipment-catalogue/sales/operational-polish/drafts/start-installment") {
      if (method === "GET") {
        return json(route, { status: "success", draft: null });
      }
      if (method === "PUT") {
        const payload = request.postDataJSON();
        return json(route, {
          status: "success",
          draft: {
            payload: payload.payload,
            version: 1,
            progress: null,
            last_saved_at: "2026-08-01T12:00:00Z",
          },
        });
      }
      if (method === "DELETE") {
        return json(route, { status: "success" });
      }
    }

    if (method === "GET") {
      return json(route, {
        status: "success",
        readiness: { ready: true },
        locations: [],
        notifications: [],
        items: [],
        data: [],
      });
    }

    return json(route, { status: "success", message: "Test request accepted." });
  });

  await page.goto("/equipment-installment-finance");
  await expect(page.getByTestId("finance-minimal-workflow")).toBeVisible();
  await expect(page.locator('[data-testid^="finance-step-"]')).toHaveCount(9);

  await page.getByTestId("finance-step-2").getByRole("link", { name: /add equipment/i }).click();
  await expect(page.getByRole("heading", { name: "Excavators" })).toBeVisible();
  await page.getByRole("button", { name: /register excavator/i }).click();

  const dialog = page.getByRole("dialog", { name: "Register excavator" });
  await dialog.getByLabel("Equipment code").fill("EXC-PH3-001");
  await dialog.getByLabel("Machine name").fill("Phase 3 Excavator");
  await dialog.getByLabel("Make").fill("Caterpillar");
  await dialog.getByLabel("Model", { exact: true }).fill("320 GC");
  await dialog.getByLabel("Serial number").fill("PHASE3-SERIAL-001");
  await dialog.getByLabel("Target selling price").fill("1000");
  await dialog.getByLabel("Minimum approved price").fill("900");
  await dialog.getByLabel("Full machine photos").setInputFiles({
    name: "phase3-excavator.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=",
      "base64"
    ),
  });
  await expect(dialog.locator("img")).toBeVisible();
  await dialog.getByRole("button", { name: "Save Excavator" }).click();

  await expect(page.getByText("EXC-PH3-001")).toBeVisible();
  await page.getByRole("link", { name: "Start Installment" }).click();

  await expect(page.getByRole("heading", { name: "Start New Installment" })).toBeVisible();
  await page.getByRole("button", { name: /Ama Phase Three/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Select the exact excavator" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Set the exact payment interval" })).toBeVisible();
  await page.getByLabel("Opening deposit").fill("200");
  await page.getByLabel("Number of payments").fill("4");
  await page.getByLabel("First payment date").fill("2026-09-01");
  await expect(page.getByText("4 payment date(s)")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Customer assessment" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review and create the draft" })).toBeVisible();
  await page.getByRole("button", { name: "Create Draft Installment" }).click();

  await expect(page).toHaveURL(/stage=activation/);
  await expect(page.getByText("ECAPP-PHASE3-001")).toBeVisible();
  await page.getByRole("button", { name: "Create Agreement" }).first().click();
  const activationDialog = page.getByRole("dialog", { name: "Activate Finance agreement" });
  await activationDialog.getByLabel(/Approved terms confirmed/).check();
  await activationDialog.getByRole("button", { name: "Create Agreement" }).click();
  await expect(page.getByText(/Finance agreement and exact installment schedule created/)).toBeVisible();
  await expect(page.getByText(/Record the required deposit to reserve the exact machine/)).toBeVisible();

  await page.goto("/equipment-installment-finance/applications?stage=deposit");
  await expect(page.getByText("ESA-PHASE3-001")).toBeVisible();
  await page.getByRole("button", { name: "Record Deposit" }).click();
  const depositDialog = page.getByRole("dialog", { name: "Record opening deposit" });
  await depositDialog.getByLabel(/Reserve this exact excavator/).check();
  await depositDialog.getByRole("button", { name: "Record Deposit" }).click();
  await expect(page.getByText(/DEP-RECEIPT-001/)).toBeVisible();

  await page.goto("/equipment-installment-finance/applications?stage=collections&agreement=601");
  await expect(page.getByTestId("finance-collections-minimal")).toBeVisible();
  await expect(page.getByTestId("account-detail-official-balance")).toHaveText("GHS 800.00");
  await expect(page.getByTestId("payment-history")).toContainText("DEP-RECEIPT-001");

  await page.getByLabel("Amount received").fill("100");
  await page.getByRole("button", { name: "Record Payment" }).click();
  await expect(page.getByRole("status")).toContainText("COL-RECEIPT-001");
  await expect(page.getByTestId("account-detail-official-balance")).toHaveText("GHS 700.00");
  await expect(page.getByTestId("payment-history-row")).toHaveCount(2);
  await expect(page.getByTestId("payment-history")).toContainText("DEP-RECEIPT-001");
  await expect(page.getByTestId("payment-history")).toContainText("COL-RECEIPT-001");

  await page.goto("/equipment-installment-finance");
  await expect(page.getByTestId("official-outstanding-balance")).toHaveText("GHS 700.00");
});