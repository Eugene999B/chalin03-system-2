import { expect, test } from "@playwright/test";

const adminUser = {
  id: 1,
  username: "phase3-doc-admin",
  full_name: "Phase 3 Document Administrator",
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

const definitions = [
  ["installment_agreement", "Machine Sale & Installment Agreement", "Original Agreement", "agreement", ["pdf", "word", "print"]],
  ["customer_agreement_copy", "Machine Sale & Installment Agreement", "Customer Copy", "agreement", ["pdf", "word", "print"]],
  ["company_agreement_copy", "Machine Sale & Installment Agreement", "Company Copy", "agreement", ["pdf", "word", "print"]],
  ["boss_approval_pack", "Installment Approval & Risk Pack", "Boss Approval Pack", "approval", ["pdf", "word", "print"]],
  ["payment_schedule", "Official Installment Payment Schedule", "Payment Schedule", "schedule", ["pdf", "word", "print"]],
  ["machine_annexure", "Machine Identity & Photo Annexure", "Machine Annexure", "machine", ["pdf", "word", "print"]],
  ["guarantor_undertaking", "Guarantor Undertaking", "Guarantor Form", "guarantor", ["pdf", "word", "print"]],
  ["payment_receipt", "Official Installment Payment Receipt", "Payment Receipt", "receipt", ["pdf", "thermal", "print"]],
  ["customer_statement", "Customer Installment Statement", "Customer Statement", "statement", ["pdf", "word", "print"]],
  ["delivery_handover_note", "Excavator Delivery & Handover Note", "Delivery Note", "delivery", ["pdf", "word", "print"]],
  ["arrears_notice", "Installment Arrears Notice", "Arrears Notice", "arrears", ["pdf", "word", "print"]],
  ["amendment_agreement", "Installment Agreement Amendment", "Amendment Agreement", "amendment", ["pdf", "word", "print"]],
  ["settlement_confirmation", "Full Settlement Confirmation", "Settlement Confirmation", "completion", ["pdf", "word", "print"]],
  ["ownership_transfer", "Equipment Ownership Transfer Certificate", "Ownership Transfer", "completion", ["pdf", "word", "print"]],
].map(([code, title, short_title, category, formats]) => ({ code, title, short_title, category, formats }));

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("staff sees obvious document categories and can issue the exact approved amendment", async ({ page }) => {
  const issued = [];
  const issuePayloads = [];

  const account = {
    agreement_id: 601,
    agreement_number: "ESA-DOCUMENT-001",
    agreement_status: "active",
    application_id: 501,
    customer_id: 21,
    customer_name: "Ama Document Customer",
    customer_phone: "0240000021",
    asset_id: 301,
    asset_code: "EXC-301",
    asset_name: "LiuGong 922E",
    total_amount: 2500000,
    amount_paid: 1150000,
    outstanding_balance: 1350000,
  };

  const snapshot = {
    generated_at: "2026-08-05T00:00:00.000Z",
    template_version: "v1-approved",
    company: {
      name: "CHALIN 03 COMPANY LIMITED",
      phone: "0249469080",
      email: "agyapongcharles3@gmail.com",
      postal_address: "P. O. Box 187, Dunkwa-on-Offin",
    },
    policy: {
      legal_review_status: "approved",
      agreement_terms: "Ownership remains with Chalin 03 Company Limited until full settlement.",
    },
    agreement: {
      id: 601,
      agreement_number: "ESA-DOCUMENT-001",
      kyc_customer_name: "Ama Document Customer",
      kyc_customer_phone: "0240000021",
      asset_code: "EXC-301",
      asset_name: "LiuGong 922E",
      total_amount: 2500000,
      amount_paid: 1150000,
      outstanding_balance: 1350000,
      guarantor_name: "Kojo Guarantor",
      main_image_url: "/equipment-catalogue/sales/protected-images/applications/501",
    },
    schedule: [
      { id: 801, sequence_number: 1, due_date: "2026-06-23", scheduled_amount: 150000, amount_paid: 150000, balance: 0, schedule_status: "paid" },
      { id: 802, sequence_number: 2, due_date: "2026-07-07", scheduled_amount: 150000, amount_paid: 0, balance: 150000, schedule_status: "overdue" },
    ],
    payments: [
      {
        id: 701,
        payment_number: "ESP-DOCUMENT-001",
        receipt_number: "ESR-DOCUMENT-001",
        payment_date: "2026-06-23T10:30:00.000Z",
        amount: 150000,
        payment_method: "cash",
      },
    ],
    media: [
      {
        id: 11,
        evidence_type: "main",
        is_primary: true,
        file_url: "/equipment-catalogue/sales/protected-images/applications/501",
      },
    ],
    signatures: [],
    reconciliation: { consistent: true, mismatches: [] },
  };

  const amendments = [
    {
      id: 880,
      amendment_number: "EFA-DOCUMENT-001",
      amendment_status: "approved",
      amendment_type: "customer_address",
      risk_level: "medium",
      reason: "Approved correction to the customer's address.",
      effective_date: "2026-08-05",
      integrity_valid: true,
    },
  ];

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase3-doc-token");
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
    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts" && method === "GET") {
      return json(route, { status: "success", accounts: [account] });
    }
    if (path === "/equipment-catalogue/sales/professional/completion-documents/options" && method === "GET") {
      return json(route, {
        status: "success",
        documents: definitions,
        policy: { immutable_snapshot: true, exact_payment_required_for_receipts: true, thermal_receipt_available: true },
      });
    }
    if (path === "/equipment-catalogue/sales/professional/agreements/601/preview" && method === "GET") {
      return json(route, { status: "success", snapshot });
    }
    if (path === "/equipment-catalogue/sales/professional/documents" && method === "GET") {
      return json(route, { status: "success", documents: issued });
    }
    if (path === "/equipment-catalogue/sales/operational-polish/cases/agreement/601/amendments" && method === "GET") {
      return json(route, { status: "success", count: amendments.length, amendments });
    }
    if (path === "/equipment-catalogue/sales/professional/completion-documents/issue" && method === "POST") {
      const payload = request.postDataJSON();
      issuePayloads.push(payload);
      const id = 900 + issued.length + 1;
      const definition = definitions.find((item) => item.code === payload.document_type);
      const document = {
        id,
        agreement_id: 601,
        document_number:
          payload.document_type === "payment_receipt"
            ? "EFR-DOCUMENT-001"
            : payload.document_type === "amendment_agreement"
              ? "EFAM-DOCUMENT-001"
              : "EFAC-DOCUMENT-001",
        document_type: payload.document_type,
        document_format: payload.format === "word" ? "word" : "pdf",
        template_version: "v1-approved",
        snapshot_checksum: String(id).padStart(64, "a"),
        issued_at: "2026-08-05T00:00:00.000Z",
        customer_name_snapshot: "Ama Document Customer",
        asset_name_snapshot: "LiuGong 922E",
        definition,
      };
      issued.unshift(document);
      return json(route, {
        status: "success",
        message: `${definition.short_title} issued from an immutable, reconciled Finance snapshot.`,
        document: {
          ...document,
          download_path: `/equipment-catalogue/sales/professional/completion-documents/${id}/download`,
        },
      }, 201);
    }

    const downloadMatch = path.match(/^\/equipment-catalogue\/sales\/professional\/completion-documents\/(\d+)\/download$/);
    if (downloadMatch && method === "GET") {
      const format = url.searchParams.get("format") || "pdf";
      const extension = format === "word" ? "doc" : "pdf";
      const contentType = format === "word" ? "application/msword" : "application/pdf";
      const body = format === "word"
        ? Buffer.from("<html><body>CHALIN 03 DOCUMENT</body></html>")
        : Buffer.from("%PDF-1.4\nCHALIN 03 DOCUMENT\n%%EOF");
      return route.fulfill({
        status: 200,
        contentType,
        headers: { "Content-Disposition": `attachment; filename="finance-document.${extension}"` },
        body,
      });
    }

    if (path === "/equipment-catalogue/sales/protected-images/applications/501" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "image/png", body: onePixelPng });
    }
    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  await page.goto("/equipment-installment-finance/applications?stage=generated-documents");
  await expect(page.getByRole("heading", { name: "Finance Document Centre" })).toBeVisible();
  await expect(page.getByText("No agreement selected")).toBeVisible();
  await expect(page.getByLabel("Search Finance document accounts")).toBeVisible();
  await page.getByLabel("Select installment account").selectOption("601");

  await expect(page.getByRole("heading", { name: "Choose a document category" })).toBeVisible();
  const categoryButtons = page.locator(".finance-docs__category-button");
  await expect(categoryButtons).toHaveCount(4);
  await expect(categoryButtons.filter({ hasText: "Payments & Customer Account" })).toContainText("4 documents inside");
  await expect(categoryButtons.filter({ hasText: "Machine, Guarantor & Handover" })).toContainText("3 documents inside");
  await expect(page.getByText("GHS 1,350,000.00")).toBeVisible();

  const machine = page.locator('img[alt="LiuGong 922E"]');
  await expect(machine).toBeVisible();
  await expect.poll(() => machine.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);

  const customerCopy = page.locator(".finance-docs__document-card").filter({ hasText: "Customer Copy" });
  await customerCopy.getByRole("button", { name: "Issue PDF" }).click();
  await expect(page.getByText(/Customer Copy issued from an immutable/)).toBeVisible();
  expect(issuePayloads[0]).toMatchObject({
    agreement_id: 601,
    document_type: "customer_agreement_copy",
    format: "pdf",
    payment_id: null,
    amendment_id: null,
  });

  await categoryButtons.filter({ hasText: "Payments & Customer Account" }).click();
  await expect(page.locator("#finance-document-group-payments")).toHaveAttribute("open", "");
  await page.locator(".finance-docs__receipt-selector select").selectOption("701");
  const paymentReceipt = page.locator(".finance-docs__document-card").filter({ hasText: "Payment Receipt" });
  await paymentReceipt.getByRole("button", { name: "Thermal Receipt" }).click();
  await expect(page.getByText(/Payment Receipt issued from an immutable/)).toBeVisible();
  expect(issuePayloads[1]).toMatchObject({
    agreement_id: 601,
    document_type: "payment_receipt",
    format: "thermal",
    payment_id: 701,
    amendment_id: null,
  });

  await categoryButtons.filter({ hasText: "Changes, Settlement & Ownership" }).click();
  const amendmentCard = page.locator(".finance-docs__document-card").filter({ hasText: "Amendment Agreement" });
  await expect(amendmentCard).toContainText("Ready to issue EFA-DOCUMENT-001");
  await amendmentCard.getByRole("button", { name: "Issue PDF" }).click();
  await expect(page.getByText(/Amendment Agreement issued from an immutable/)).toBeVisible();
  expect(issuePayloads[2]).toMatchObject({
    agreement_id: 601,
    document_type: "amendment_agreement",
    format: "pdf",
    amendment_id: 880,
  });

  await page.getByText("Immutable document history", { exact: true }).click();
  await expect(page.getByText("EFAM-DOCUMENT-001")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print" }).first()).toBeVisible();
});
