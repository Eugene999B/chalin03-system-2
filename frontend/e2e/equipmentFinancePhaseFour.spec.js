import { expect, test } from "@playwright/test";

const makerUser = {
  id: 11,
  username: "phase4-maker",
  full_name: "Phase 4 Finance Accountant",
  role: "manager",
  workspace_role: "finance_accountant",
  access_role: "finance_accountant",
  workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  is_original_system_administrator: false,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

const approverUser = {
  id: 12,
  username: "phase4-approver",
  full_name: "Independent Finance Manager",
  role: "manager",
  workspace_role: "finance_manager",
  access_role: "finance_manager",
  workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  is_original_system_administrator: false,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function policy() {
  return {
    id: 1,
    policy_version: "FIN-CORR-1",
    return_credit_method: "approved_amount",
    default_return_credit_percent: 70,
    refundable_amount_method: "approved_amount",
    maximum_penalty_percent: 10,
    maximum_damage_charge_percent: 25,
    allow_customer_refund_due: true,
    require_independent_approval: true,
    require_return_evidence: true,
    require_payment_reversal_evidence: true,
    return_terms:
      "Every return requires a signed inspection, independent approval and separate accounting entries. The original agreement and payment receipts remain preserved.",
  };
}

test("independent approver posts a returned excavator settlement and the backend balance becomes GHS 350", async ({ page }) => {
  const state = {
    actor: makerUser,
    outstanding: 800,
    agreementStatus: "active",
    assetSaleStatus: "installment_active",
    request: null,
    ledger: [],
    returns: [],
  };

  const originalPayment = {
    id: 701,
    agreement_id: 601,
    payment_number: "EPAY-PHASE4-001",
    receipt_number: "ERC-PHASE4-001",
    payment_category: "installment",
    payment_stage: "installment_collection",
    amount: 200,
    payment_date: "2026-08-01T12:00:00Z",
    payment_method: "momo",
    reference_number: "MOMO-ORIGINAL-001",
    is_voided: false,
    void_reason: null,
  };

  function accountSummary() {
    return {
      agreement_id: 601,
      agreement_number: "ESA-PHASE4-001",
      agreement_status: state.agreementStatus,
      equipment_commitment_status: state.returns.length ? "released" : "reserved",
      total_amount: 1000,
      amount_paid: 200,
      outstanding_balance: state.outstanding,
      overdue_amount: 0,
      next_due_date: state.returns.length ? null : "2026-09-01",
      customer_name: "Ama Return Test",
      customer_phone: "0240000404",
      asset_id: 301,
      asset_code: "EXC-PHASE4-001",
      asset_name: "Komatsu PC210 Excavator",
      asset_sale_status: state.assetSaleStatus,
      condition_status: state.returns.length ? "fair" : "good",
      pending_correction_count: state.request?.request_status === "pending" ? 1 : 0,
      ledger_entry_count: state.ledger.length,
    };
  }

  function accountFile() {
    return {
      status: "success",
      account: {
        ...accountSummary(),
        customer_id: 21,
        deposit_required: 200,
        deposit_received: 200,
        delivery_id: 801,
        ownership_id: null,
        active_hire_count: 0,
      },
      schedule: [
        {
          id: 901,
          sequence_number: 1,
          due_date: "2026-09-01",
          scheduled_amount: 200,
          amount_paid: 0,
          late_charge_amount: 0,
          waived_charge_amount: 0,
          schedule_status: state.returns.length ? "cancelled" : "upcoming",
        },
      ],
      payments: [originalPayment],
      ledger: state.ledger,
      correction_requests: state.request ? [state.request] : [],
      asset_returns: state.returns,
      policy: policy(),
      settlement_formula:
        "outstanding_balance - approved_return_credit - refundable_amount + penalty_amount + damage_amount",
    };
  }

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase4-maker-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, makerUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    const actor = state.actor;

    if (path === "/auth/me" && method === "GET") {
      return json(route, {
        status: "success",
        user: actor,
        workspace: actor.active_workspace,
      });
    }

    if (path === "/equipment-catalogue/sales/finance-corrections/policy" && method === "GET") {
      return json(route, { status: "success", policy: policy() });
    }

    if (path === "/equipment-catalogue/sales/finance-corrections/accounts" && method === "GET") {
      return json(route, { status: "success", count: 1, accounts: [accountSummary()] });
    }

    if (path === "/equipment-catalogue/sales/finance-corrections/accounts/601" && method === "GET") {
      return json(route, accountFile());
    }

    if (path === "/equipment-catalogue/sales/finance-corrections/settlement-preview" && method === "POST") {
      const payload = request.postDataJSON();
      const outstanding = Number(payload.outstanding_balance);
      const returnCredit = Number(payload.approved_return_credit);
      const refundable = Number(payload.refundable_amount);
      const penalty = Number(payload.penalty_amount);
      const damage = Number(payload.damage_amount);
      const raw = outstanding - returnCredit - refundable + penalty + damage;
      return json(route, {
        status: "success",
        policy_version: "FIN-CORR-1",
        authoritative: false,
        settlement: {
          outstanding_balance: outstanding,
          approved_return_credit: returnCredit,
          refundable_amount: refundable,
          penalty_amount: penalty,
          damage_amount: damage,
          raw_settlement_balance: raw,
          final_settlement_balance: Math.max(raw, 0),
          refund_due: Math.max(-raw, 0),
          formula:
            "outstanding_balance - approved_return_credit - refundable_amount + penalty_amount + damage_amount",
        },
      });
    }

    if (path === "/equipment-catalogue/sales/finance-corrections/accounts/601/requests" && method === "POST") {
      const payload = request.postDataJSON();
      state.request = {
        id: 1001,
        request_number: "EFC-PHASE4-001",
        agreement_id: 601,
        request_type: payload.request_type,
        request_status: "pending",
        reason: payload.reason,
        evidence_reference: payload.evidence_reference,
        policy_version: "FIN-CORR-1",
        requested_by: makerUser.id,
        requested_by_name: makerUser.full_name,
        requested_at: "2026-08-01T20:00:00Z",
        proposed_entries: [
          { entry_type: "approved_return_credit", direction: "credit", amount: 500 },
          { entry_type: "approved_refundable_amount", direction: "credit", amount: 50 },
          { entry_type: "approved_return_penalty", direction: "debit", amount: 25 },
          { entry_type: "approved_damage_charge", direction: "debit", amount: 75 },
          { entry_type: "return_settlement", direction: "memo", amount: 350 },
        ],
      };
      return json(route, {
        status: "success",
        message:
          "Correction request recorded. A different Finance Manager must approve it before any balance, payment, schedule or equipment status changes.",
        request: state.request,
      }, 201);
    }

    if (path === "/equipment-catalogue/sales/finance-corrections/requests/1001/decision" && method === "POST") {
      if (actor.id === makerUser.id) {
        return json(route, {
          status: "error",
          code: "EQUIPMENT_FINANCE_INDEPENDENT_APPROVER_REQUIRED",
          message: "The staff member who prepared the correction cannot approve or reject it.",
        }, 409);
      }
      const payload = request.postDataJSON();
      if (payload.decision !== "approve") {
        return json(route, { status: "error", message: "Expected approval in this journey." }, 400);
      }
      state.request = {
        ...state.request,
        request_status: "approved",
        decided_by: approverUser.id,
        decided_by_name: approverUser.full_name,
        decision_reason: payload.reason,
      };
      state.outstanding = 350;
      state.agreementStatus = "defaulted";
      state.assetSaleStatus = "available";
      state.ledger = [
        { id: 1, entry_number: "EFL-001", entry_type: "approved_return_credit", direction: "credit", amount: 500, balance_before: 800, balance_after: 300, posted_at: "2026-08-01T20:10:00Z" },
        { id: 2, entry_number: "EFL-002", entry_type: "approved_refundable_amount", direction: "credit", amount: 50, balance_before: 300, balance_after: 250, posted_at: "2026-08-01T20:10:01Z" },
        { id: 3, entry_number: "EFL-003", entry_type: "approved_return_penalty", direction: "debit", amount: 25, balance_before: 250, balance_after: 275, posted_at: "2026-08-01T20:10:02Z" },
        { id: 4, entry_number: "EFL-004", entry_type: "approved_damage_charge", direction: "debit", amount: 75, balance_before: 275, balance_after: 350, posted_at: "2026-08-01T20:10:03Z" },
        { id: 5, entry_number: "EFL-005", entry_type: "return_settlement", direction: "memo", amount: 350, balance_before: 350, balance_after: 350, posted_at: "2026-08-01T20:10:04Z" },
      ];
      state.returns = [
        {
          id: 1,
          return_number: "EFR-PHASE4-001",
          return_type: "voluntary_return",
          return_date: "2026-08-01",
          condition_status: "fair",
          approved_return_credit: 500,
          refundable_amount: 50,
          penalty_amount: 25,
          damage_amount: 75,
          settlement_balance: 350,
          refund_due: 0,
          policy_version: "FIN-CORR-1",
          evidence_reference: "RETURN-INSPECTION-001",
        },
      ];
      return json(route, {
        status: "success",
        message: "Correction approved and posted through the protected Finance ledger.",
        request_id: 1001,
        agreement_id: 601,
        execution_reference: "EFX-PHASE4-001",
        account_file: accountFile(),
      });
    }

    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  await page.goto("/equipment-installment-finance/applications?stage=corrections");
  await expect(page.getByTestId("phase4-corrections-page")).toBeVisible();
  await expect(page.getByTestId("phase4-official-balance")).toContainText("GHS 800.00");

  await page.getByLabel("Approved return credit").fill("500");
  await page.getByLabel("Refundable amount").fill("50");
  await page.getByLabel("Penalty").fill("25");
  await page.getByLabel("Damage charge").fill("75");
  await page.getByRole("button", { name: "Preview formula" }).click();
  await expect(page.getByTestId("phase4-settlement-preview")).toContainText("GHS 350.00");

  await page.getByLabel("Inspected condition").selectOption("fair");
  await page.getByLabel("Detailed reason").fill(
    "Customer voluntarily returned the excavator after an independent physical inspection."
  );
  await page.getByLabel("Evidence reference").fill("RETURN-INSPECTION-001");
  await page.getByTestId("phase4-submit-request").click();
  await expect(page.getByRole("status")).toContainText("different Finance Manager");

  state.actor = approverUser;
  await page.evaluate((user) => {
    localStorage.setItem("chalin03_token", "phase4-approver-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, approverUser);
  await page.reload();
  await page.getByRole("button", { name: /Approvals \(1\)/ }).click();
  await expect(page.getByTestId("phase4-pending-request")).toContainText("EFC-PHASE4-001");
  await page.getByPlaceholder("Independent decision reason").fill(
    "Inspection and settlement components verified against policy FIN-CORR-1."
  );
  await expect(page.getByTestId("phase4-decide-request")).toBeEnabled();
  await page.getByTestId("phase4-decide-request").click();

  await expect(page.getByRole("status")).toContainText("posted through the protected Finance ledger");
  await expect(page.getByTestId("phase4-official-balance")).toContainText("GHS 350.00");

  await page.getByRole("button", { name: "Ledger & history" }).click();
  await expect(page.getByTestId("phase4-ledger-entry")).toHaveCount(5);
  await expect(page.getByText("Approved Return Credit")).toBeVisible();
  await expect(page.getByText("Approved Damage Charge")).toBeVisible();
  const originalReceiptRow = page.getByRole("row", { name: /ERC-PHASE4-001/ });
  await expect(originalReceiptRow).toBeVisible();
  await expect(originalReceiptRow.getByText("Posted", { exact: true })).toBeVisible();
  await expect(page.getByText("EFR-PHASE4-001")).toBeVisible();
  await expect(page.getByText("Final balance: GHS 350.00")).toBeVisible();
});
