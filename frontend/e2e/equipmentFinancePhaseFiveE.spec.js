import { expect, test } from "@playwright/test";

const workspace = { id: 2, code: "equipment_hire", name: "Equipment Business" };

function user(id, name, workspaceRole, role = "manager") {
  return {
    id,
    username: `phase5e-${workspaceRole}`,
    full_name: name,
    role,
    workspace_role: workspaceRole,
    access_role: workspaceRole,
    workspace_code: "equipment_hire",
    active_workspace: workspace,
    is_original_system_administrator: false,
    effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
  };
}

const accountant = user(31, "Finance Case Accountant", "finance_accountant");
const auditor = user(32, "Independent Finance Auditor", "finance_auditor", "auditor");
const manager = user(33, "Independent Finance Manager", "finance_manager");
const deliveryOfficer = user(34, "Delivery Confirmation Officer", "collections_officer");
const requiredCategories = ["kyc_identity", "guarantor_identity", "agreement_attachment"];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function documentCapabilities(actor) {
  const role = actor.workspace_role;
  return {
    role,
    private_documents_view: true,
    private_documents_upload: ["finance_accountant", "finance_manager"].includes(role),
    private_documents_download: true,
    private_document_activity_view: true,
    private_documents_are_encrypted: true,
  };
}

function reviewCapabilities(actor) {
  const role = actor.workspace_role;
  return {
    role,
    independent_document_review: ["finance_auditor", "finance_manager"].includes(role),
    document_approval: role === "finance_manager",
    document_archive: role === "finance_manager",
    uploader_cannot_review: true,
    uploader_or_reviewer_cannot_approve: true,
  };
}

function authorizationCapabilities(actor) {
  const role = actor.workspace_role;
  return {
    role,
    delivery_authorization_view: true,
    delivery_authorization_request: ["finance_accountant", "finance_manager"].includes(role),
    delivery_authorization_decision: role === "finance_manager",
    delivery_authorization_revoke: role === "finance_manager",
    requester_cannot_authorize: true,
    creates_delivery: false,
    confirms_handover: false,
  };
}

function activity(id, type, actor, description) {
  return {
    id,
    action_type: type,
    actor_id: actor.id,
    actor_name: actor.full_name,
    actor_role: actor.workspace_role,
    description,
    created_at: `2026-08-02T01:${String(id).padStart(2, "0")}:00Z`,
  };
}

test("four independent staff roles complete encrypted documents and controlled delivery", async ({ page }) => {
  const state = {
    actor: accountant,
    documents: [],
    authorizations: [],
    activity: [],
    delivered: false,
  };

  const baseCase = {
    agreement_id: 751,
    agreement_number: "ESA-PHASE5E-001",
    agreement_status: "active",
    application_id: 651,
    application_number: "ECA-PHASE5E-001",
    customer_id: 51,
    customer_name: "Akosua Controlled Delivery",
    customer_phone: "0240000505",
    asset_id: 451,
    asset_code: "EXC-PHASE5E-001",
    asset_name: "Caterpillar 320 Excavator",
    total_amount: 1000,
    amount_paid: 300,
    outstanding_balance: 700,
    deposit_required: 200,
    deposit_received: 200,
    delivery_policy: "after_deposit",
    delivery_threshold_percent: 0,
    equipment_commitment_status: "reserved",
    active_hire_count: 0,
  };

  function readiness() {
    const approved = new Set(
      state.documents
        .filter((item) => item.document_status === "active" && item.review_status === "verified" && item.approval_status === "approved")
        .map((item) => item.document_category)
    );
    const required = requiredCategories.map((category) => ({ category, complete: approved.has(category) }));
    return { required, complete: required.every((item) => item.complete), missing: required.filter((item) => !item.complete).map((item) => item.category) };
  }

  function financeCase() {
    return { ...baseCase, delivery_count: state.delivered ? 1 : 0, document_count: state.documents.length };
  }

  function authorizationRows() {
    return state.authorizations.map((item) => ({
      ...item,
      effective_status: item.authorization_status,
      can_be_used_for_delivery: item.authorization_status === "authorized",
    }));
  }

  function addActivity(type, actor, description) {
    state.activity.push(activity(state.activity.length + 1, type, actor, description));
  }

  await page.addInitScript((initialUser) => {
    localStorage.setItem("chalin03_token", "phase5e-accountant-token");
    localStorage.setItem("chalin03_user", JSON.stringify(initialUser));
  }, accountant);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (path === "/auth/me" && method === "GET") {
      return json(route, { status: "success", user: state.actor, workspace });
    }

    if (path === "/equipment-catalogue/sales/private-documents/capabilities" && method === "GET") {
      return json(route, { status: "success", capabilities: documentCapabilities(state.actor) });
    }
    if (path === "/equipment-catalogue/sales/private-documents/review-capabilities" && method === "GET") {
      return json(route, { status: "success", capabilities: reviewCapabilities(state.actor), policy: {} });
    }
    if (path === "/equipment-catalogue/sales/delivery-authorizations/capabilities" && method === "GET") {
      return json(route, { status: "success", capabilities: authorizationCapabilities(state.actor) });
    }
    if (path === "/equipment-catalogue/sales/private-documents/cases" && method === "GET") {
      return json(route, { status: "success", count: 1, cases: [financeCase()] });
    }
    if (path === "/equipment-catalogue/sales/private-documents/review-cases/751" && method === "GET") {
      return json(route, {
        status: "success",
        case: financeCase(),
        review_policy: { required_document_categories: requiredCategories },
        review_documents: state.documents,
        document_readiness: readiness(),
        activity: [...state.activity].reverse(),
      });
    }
    if (path === "/equipment-catalogue/sales/delivery-authorizations/cases/751" && method === "GET") {
      return json(route, {
        status: "success",
        case: financeCase(),
        authorization_policy: { policy_version: "FIN-DELIVERY-AUTH-1", delivery_authorization_valid_hours: 48 },
        document_readiness: readiness(),
        delivery_threshold: { satisfied: true, explanation: "Deposit received." },
        authorizations: authorizationRows(),
      });
    }

    if (path === "/equipment-catalogue/sales/private-documents/cases/751/documents" && method === "POST") {
      const payload = request.postDataJSON();
      const id = state.documents.length + 1;
      const row = {
        id,
        document_number: `EFD-PHASE5E-00${id}`,
        agreement_id: 751,
        application_id: 651,
        customer_id: 51,
        document_category: payload.document_category,
        document_type: payload.document_type,
        original_file_name: payload.file_name,
        mime_type: payload.mime_type,
        file_size_bytes: 40,
        content_checksum: String(id).repeat(64).slice(0, 64),
        document_status: "active",
        review_status: "pending",
        reviewed_by: null,
        approval_status: "pending",
        approved_by: null,
        uploaded_by: accountant.id,
        uploaded_by_name: accountant.full_name,
        uploaded_at: "2026-08-02T01:01:00Z",
      };
      state.documents.push(row);
      addActivity("document_uploaded", accountant, `Uploaded ${row.document_number}.`);
      return json(route, { status: "success", message: "Private document encrypted and stored.", document: row }, 201);
    }

    const reviewMatch = path.match(/^\/equipment-catalogue\/sales\/private-documents\/documents\/(\d+)\/review$/);
    if (reviewMatch && method === "POST") {
      const row = state.documents.find((item) => item.id === Number(reviewMatch[1]));
      row.review_status = "verified";
      row.reviewed_by = auditor.id;
      row.reviewed_by_name = auditor.full_name;
      row.reviewed_at = "2026-08-02T01:10:00Z";
      addActivity("document_verified", auditor, `Verified ${row.document_number}.`);
      return json(route, { status: "success", message: "Document independently verified and sent for separate approval." });
    }

    const approvalMatch = path.match(/^\/equipment-catalogue\/sales\/private-documents\/documents\/(\d+)\/approval$/);
    if (approvalMatch && method === "POST") {
      const row = state.documents.find((item) => item.id === Number(approvalMatch[1]));
      row.approval_status = "approved";
      row.approved_by = manager.id;
      row.approved_by_name = manager.full_name;
      row.approved_at = "2026-08-02T01:20:00Z";
      addActivity("document_approved", manager, `Approved ${row.document_number}.`);
      return json(route, { status: "success", message: "Document approved for the Finance case file." });
    }

    if (path === "/equipment-catalogue/sales/delivery-authorizations/cases/751/requests" && method === "POST") {
      const payload = request.postDataJSON();
      state.authorizations = [{
        id: 81,
        authorization_number: "FDA-PHASE5E-001",
        agreement_id: 751,
        application_id: 651,
        asset_id: 451,
        customer_id: 51,
        authorization_status: "pending",
        request_reason: payload.reason,
        requested_by: accountant.id,
        requested_by_name: accountant.full_name,
        requested_at: "2026-08-02T01:30:00Z",
      }];
      addActivity("delivery_authorization_requested", accountant, "Requested FDA-PHASE5E-001.");
      return json(route, { status: "success", message: "Delivery authorization requested. A different Finance Manager must decide it." }, 201);
    }

    if (path === "/equipment-catalogue/sales/delivery-authorizations/authorizations/81/decision" && method === "POST") {
      const payload = request.postDataJSON();
      state.authorizations[0] = {
        ...state.authorizations[0],
        authorization_status: "authorized",
        decided_by: manager.id,
        decided_by_name: manager.full_name,
        decided_at: "2026-08-02T01:40:00Z",
        decision_reason: payload.reason,
        expires_at: "2026-08-04T01:40:00Z",
      };
      addActivity("delivery_authorized", manager, "Authorized FDA-PHASE5E-001.");
      return json(route, { status: "success", message: "Delivery authorized for the recorded validity window." });
    }

    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts/751/delivery" && method === "POST") {
      const payload = request.postDataJSON();
      if (payload.authorization_number !== "FDA-PHASE5E-001") {
        return json(route, { status: "error", message: "Authorization reference mismatch." }, 409);
      }
      state.delivered = true;
      state.authorizations[0] = {
        ...state.authorizations[0],
        authorization_status: "consumed",
        consumed_by: deliveryOfficer.id,
        consumed_at: "2026-08-02T01:50:00Z",
      };
      addActivity("delivery_confirmed", deliveryOfficer, "Confirmed authorized physical delivery FDC-PHASE5E-001.");
      return json(route, {
        status: "success",
        message: "Authorized Finance delivery and independent physical handover confirmation recorded.",
        delivery_number: "ESD-PHASE5E-001",
        confirmation_number: "FDC-PHASE5E-001",
      }, 201);
    }

    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  async function switchActor(actor, token) {
    state.actor = actor;
    await page.evaluate(({ nextUser, nextToken }) => {
      localStorage.setItem("chalin03_token", nextToken);
      localStorage.setItem("chalin03_user", JSON.stringify(nextUser));
    }, { nextUser: actor, nextToken: token });
    await page.reload();
    await expect(page.getByTestId("phase5e-permissions")).toContainText(actor.workspace_role.replaceAll("_", " "));
  }

  async function upload(category, type, name) {
    await page.getByLabel("Category").selectOption(category);
    await page.getByLabel("Document type").fill(type);
    await page.getByLabel("Private file").setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 Phase 5E encrypted evidence"),
    });
    await page.getByTestId("phase5e-upload-document").click();
    await expect(page.getByRole("status")).toContainText("encrypted and stored");
  }

  await page.goto("/equipment-installment-finance/applications?stage=case-workspace");
  await expect(page.getByTestId("phase5e-case-workspace")).toBeVisible();
  await upload("kyc_identity", "Ghana Card", "customer-card.pdf");
  await upload("guarantor_identity", "Guarantor Ghana Card", "guarantor-card.pdf");
  await upload("agreement_attachment", "Signed agreement", "agreement.pdf");
  await expect(page.getByTestId("phase5e-document-row")).toHaveCount(3);

  await switchActor(auditor, "phase5e-auditor-token");
  for (let index = 0; index < 3; index += 1) {
    const row = page.getByTestId("phase5e-document-row").nth(index);
    await row.getByPlaceholder("Independent review or approval notes").fill("Identity and original evidence independently verified.");
    await row.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("status")).toContainText("independently verified");
  }

  await switchActor(manager, "phase5e-manager-token");
  for (let index = 0; index < 3; index += 1) {
    const row = page.getByTestId("phase5e-document-row").nth(index);
    await row.getByPlaceholder("Independent review or approval notes").fill("Independent review accepted for controlled delivery.");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("approved for the Finance case file");
  }
  await expect(page.getByTestId("phase5e-required-documents")).toContainText("Complete");

  await switchActor(accountant, "phase5e-accountant-token-2");
  await page.getByPlaceholder("Why the approved customer and exact machine are ready for delivery").fill("All required evidence is approved and the deposit threshold is satisfied.");
  await page.getByTestId("phase5e-request-delivery").click();
  await expect(page.getByRole("status")).toContainText("different Finance Manager");

  await switchActor(manager, "phase5e-manager-token-2");
  await expect(page.getByTestId("phase5e-pending-authorization")).toContainText("FDA-PHASE5E-001");
  await page.getByPlaceholder("Independent authorization reason").fill("Exact machine, payment threshold and approved documents independently confirmed.");
  await page.getByTestId("phase5e-authorize-delivery").click();
  await expect(page.getByRole("status")).toContainText("authorized for the recorded validity window");

  await switchActor(deliveryOfficer, "phase5e-delivery-token");
  await expect(page.getByTestId("phase5e-delivery-confirmation-panel")).toBeVisible();
  await page.getByLabel("Receiving person").fill("Akosua Controlled Delivery");
  await page.getByLabel("Receiving phone").fill("0240000505");
  await page.getByLabel("Destination").fill("Dunkwa equipment yard");
  await page.getByLabel("Condition").selectOption("good");
  await page.getByLabel("Meter reading").fill("1250.50");
  await page.getByLabel("Fuel level %").fill("75");
  await page.getByLabel("Attachments and tools").fill("Two buckets, manual and spare key.");
  await page.getByLabel("Confirmation notes").fill("Customer inspected and accepted the exact excavator.");
  await page.getByTestId("phase5e-confirm-delivery").click();

  await expect(page.getByRole("status")).toContainText("independent physical handover confirmation recorded");
  await expect(page.getByTestId("phase5e-case-summary")).toContainText("Delivered");
  await expect(page.getByTestId("phase5e-authorization-panel")).toContainText("consumed");
  await expect(page.getByTestId("phase5e-activity-row")).toHaveCount(12);
  await expect(page.getByTestId("phase5e-activity-log")).toContainText("delivery confirmed");
});
