import { expect, test } from "@playwright/test";

const makerUser = {
  id: 21,
  username: "phase5-maker",
  full_name: "Finance Case Accountant",
  role: "manager",
  workspace_role: "finance_accountant",
  access_role: "finance_accountant",
  workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  is_original_system_administrator: false,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

const reviewerUser = {
  id: 22,
  username: "phase5-reviewer",
  full_name: "Independent Finance Auditor",
  role: "auditor",
  workspace_role: "finance_auditor",
  access_role: "finance_auditor",
  workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  is_original_system_administrator: false,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

const approverUser = {
  id: 23,
  username: "phase5-approver",
  full_name: "Independent Finance Manager",
  role: "manager",
  workspace_role: "finance_manager",
  access_role: "finance_manager",
  workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  is_original_system_administrator: false,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

const confirmerUser = {
  id: 24,
  username: "phase5-confirmer",
  full_name: "Delivery Confirmation Officer",
  role: "manager",
  workspace_role: "collections_officer",
  access_role: "collections_officer",
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

function actorCapabilities(actor) {
  const role = actor.workspace_role;
  const manager = role === "finance_manager";
  const auditor = role === "finance_auditor";
  const accountant = role === "finance_accountant";
  const confirmer = role === "collections_officer";
  return {
    role,
    protected_system_administrator: false,
    private_documents_view: true,
    private_documents_upload: accountant || manager,
    independent_document_review: auditor || manager,
    document_approval: manager,
    delivery_authorization_request: accountant || manager,
    delivery_authorization_decision: manager,
    delivery_confirmation: accountant || manager || confirmer,
    policy_manage: manager,
    activity_log_view: true,
    independent_controls: {
      uploader_cannot_review: true,
      uploader_or_reviewer_cannot_approve: true,
      requester_cannot_authorize_delivery: true,
      authorizer_cannot_confirm_delivery: true,
    },
  };
}

function policy() {
  return {
    id: 1,
    policy_version: "FIN-DOC-DELIVERY-1",
    required_document_categories: [
      "kyc_identity",
      "guarantor_identity",
      "agreement_attachment",
    ],
    allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
    maximum_file_size_bytes: 5242880,
    independent_document_review_required: true,
    separate_document_approval_required: true,
    independent_delivery_authorization_required: true,
    independent_delivery_confirmation_required: true,
    delivery_authorization_valid_hours: 48,
  };
}

function activity(id, action, actor, description) {
  return {
    id,
    activity_number: `EFA-PHASE5-${String(id).padStart(3, "0")}`,
    agreement_id: 751,
    action_type: action,
    actor_id: actor.id,
    actor_name: actor.full_name,
    actor_role: actor.workspace_role,
    description,
    created_at: `2026-08-01T22:${String(id).padStart(2, "0")}:00Z`,
  };
}

test("four independent staff roles complete private documents, delivery authorization and confirmation", async ({ page }) => {
  const state = {
    actor: makerUser,
    documents: [],
    authorization: null,
    confirmations: [],
    activity: [],
    delivered: false,
  };

  const financeCase = {
    agreement_id: 751,
    agreement_number: "ESA-PHASE5-001",
    agreement_status: "active",
    application_id: 651,
    application_number: "ECA-PHASE5-001",
    customer_id: 51,
    customer_name: "Akosua Document Test",
    customer_phone: "0240000505",
    asset_id: 451,
    asset_code: "EXC-PHASE5-001",
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
    delivery_count: 0,
  };

  function readiness() {
    const approved = new Set(
      state.documents
        .filter((document) => document.review_status === "verified" && document.approval_status === "approved")
        .map((document) => document.document_category)
    );
    const required = policy().required_document_categories.map((category) => ({
      category,
      complete: approved.has(category),
    }));
    return {
      required,
      complete: required.every((item) => item.complete),
      missing: required.filter((item) => !item.complete).map((item) => item.category),
    };
  }

  function caseFile() {
    return {
      status: "success",
      case: { ...financeCase, delivery_count: state.delivered ? 1 : 0 },
      policy: policy(),
      documents: state.documents,
      document_readiness: readiness(),
      delivery_authorizations: state.authorization ? [state.authorization] : [],
      delivery_confirmations: state.confirmations,
      activity: [...state.activity].reverse(),
    };
  }

  function caseSummary() {
    return {
      ...financeCase,
      delivery_count: state.delivered ? 1 : 0,
      document_count: state.documents.length,
      required_documents_complete: readiness().complete,
      missing_document_categories: readiness().missing,
      latest_authorization: state.authorization,
    };
  }

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase5-maker-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, makerUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (path === "/auth/me" && method === "GET") {
      return json(route, {
        status: "success",
        user: state.actor,
        workspace: state.actor.active_workspace,
      });
    }

    if (path === "/equipment-catalogue/sales/documents-delivery/capabilities" && method === "GET") {
      return json(route, {
        status: "success",
        capabilities: actorCapabilities(state.actor),
        document_categories: [
          "kyc_identity",
          "kyc_address",
          "kyc_income",
          "guarantor_identity",
          "guarantor_undertaking",
          "agreement_attachment",
          "delivery_evidence",
          "other",
        ],
      });
    }

    if (path === "/equipment-catalogue/sales/documents-delivery/cases" && method === "GET") {
      return json(route, { status: "success", count: 1, cases: [caseSummary()], policy: policy() });
    }

    if (path === "/equipment-catalogue/sales/documents-delivery/cases/751" && method === "GET") {
      return json(route, caseFile());
    }

    if (path === "/equipment-catalogue/sales/documents-delivery/cases/751/documents" && method === "POST") {
      const payload = request.postDataJSON();
      const id = state.documents.length + 1;
      const document = {
        id,
        document_number: `EFD-PHASE5-00${id}`,
        application_id: 651,
        agreement_id: 751,
        customer_id: 51,
        document_category: payload.document_category,
        document_type: payload.document_type,
        original_file_name: payload.file_name,
        mime_type: payload.mime_type,
        file_size_bytes: 16,
        content_checksum: `${String(id).repeat(64)}`.slice(0, 64),
        encryption_version: "aes-256-gcm-v1",
        private_access_only: true,
        review_status: "pending",
        reviewed_by: null,
        approval_status: "pending",
        approved_by: null,
        uploaded_by: makerUser.id,
        uploaded_by_name: makerUser.full_name,
        uploaded_at: "2026-08-01T22:01:00Z",
        archived_at: null,
      };
      state.documents.push(document);
      state.activity.push(activity(state.activity.length + 1, "document_uploaded", makerUser, `Uploaded ${document.document_number}.`));
      return json(route, {
        status: "success",
        message: "Private document encrypted and stored. It is pending independent review.",
        document,
      }, 201);
    }

    const reviewMatch = path.match(/^\/equipment-catalogue\/sales\/documents-delivery\/documents\/(\d+)\/review$/);
    if (reviewMatch && method === "POST") {
      const document = state.documents.find((item) => item.id === Number(reviewMatch[1]));
      const payload = request.postDataJSON();
      document.review_status = payload.decision === "verify" ? "verified" : "rejected";
      document.reviewed_by = reviewerUser.id;
      document.reviewed_by_name = reviewerUser.full_name;
      document.reviewed_at = "2026-08-01T22:10:00Z";
      document.review_notes = payload.notes;
      state.activity.push(activity(state.activity.length + 1, "document_verified", reviewerUser, `Verified ${document.document_number}.`));
      return json(route, {
        ...caseFile(),
        message: "Document independently verified and sent for approval.",
      });
    }

    const approvalMatch = path.match(/^\/equipment-catalogue\/sales\/documents-delivery\/documents\/(\d+)\/approval$/);
    if (approvalMatch && method === "POST") {
      const document = state.documents.find((item) => item.id === Number(approvalMatch[1]));
      const payload = request.postDataJSON();
      document.approval_status = payload.decision === "approve" ? "approved" : "rejected";
      document.approved_by = approverUser.id;
      document.approved_by_name = approverUser.full_name;
      document.approved_at = "2026-08-01T22:20:00Z";
      document.approval_notes = payload.notes;
      state.activity.push(activity(state.activity.length + 1, "document_approved", approverUser, `Approved ${document.document_number}.`));
      return json(route, {
        ...caseFile(),
        message: "Document approved for the Finance case file.",
      });
    }

    if (path === "/equipment-catalogue/sales/documents-delivery/cases/751/delivery-authorizations" && method === "POST") {
      const payload = request.postDataJSON();
      state.authorization = {
        id: 81,
        authorization_number: "FDA-PHASE5-001",
        agreement_id: 751,
        application_id: 651,
        asset_id: 451,
        customer_id: 51,
        authorization_status: "pending",
        policy_version: "FIN-DOC-DELIVERY-1",
        request_reason: payload.reason,
        requested_by: makerUser.id,
        requested_by_name: makerUser.full_name,
        requested_at: "2026-08-01T22:30:00Z",
        authorized_by: null,
        expires_at: null,
      };
      state.activity.push(activity(state.activity.length + 1, "delivery_authorization_requested", makerUser, "Requested FDA-PHASE5-001."));
      return json(route, {
        ...caseFile(),
        message: "Delivery authorization requested. A different Finance Manager must decide it.",
      }, 201);
    }

    if (path === "/equipment-catalogue/sales/documents-delivery/delivery-authorizations/81/decision" && method === "POST") {
      const payload = request.postDataJSON();
      state.authorization = {
        ...state.authorization,
        authorization_status: payload.decision === "authorize" ? "authorized" : "rejected",
        authorized_by: approverUser.id,
        authorized_by_name: approverUser.full_name,
        authorized_at: "2026-08-01T22:40:00Z",
        authorization_reason: payload.reason,
        expires_at: "2026-08-03T22:40:00Z",
      };
      state.activity.push(activity(state.activity.length + 1, "delivery_authorized", approverUser, "Authorized FDA-PHASE5-001."));
      return json(route, {
        ...caseFile(),
        message: "Delivery authorized for the recorded validity window. A different staff member must confirm handover.",
      });
    }

    if (path === "/equipment-catalogue/sales/finance-lifecycle/accounts/751/delivery" && method === "POST") {
      const payload = request.postDataJSON();
      if (payload.authorization_number !== "FDA-PHASE5-001") {
        return json(route, { status: "error", message: "Authorization required." }, 409);
      }
      state.delivered = true;
      state.authorization = {
        ...state.authorization,
        authorization_status: "consumed",
        consumed_by: confirmerUser.id,
        consumed_by_name: confirmerUser.full_name,
        consumed_at: "2026-08-01T22:50:00Z",
        delivery_id: 91,
      };
      state.confirmations.push({
        id: 101,
        confirmation_number: "FDC-PHASE5-001",
        authorization_id: 81,
        delivery_id: 91,
        agreement_id: 751,
        receiving_person: payload.receiving_person,
        condition_status: payload.condition_status,
        meter_reading: Number(payload.meter_reading),
        fuel_level_percent: Number(payload.fuel_level_percent),
        confirmed_by: confirmerUser.id,
        confirmed_by_name: confirmerUser.full_name,
        confirmed_at: "2026-08-01T22:50:00Z",
      });
      state.activity.push(activity(state.activity.length + 1, "delivery_confirmed", confirmerUser, "Confirmed authorized physical delivery FDC-PHASE5-001."));
      return json(route, {
        status: "success",
        message: "Authorized Finance delivery and independent handover confirmation recorded.",
        delivery_id: 91,
        delivery_number: "ESD-PHASE5-001",
        authorization_number: "FDA-PHASE5-001",
        confirmation_id: 101,
        confirmation_number: "FDC-PHASE5-001",
      }, 201);
    }

    return json(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });

  async function switchActor(actor, token) {
    state.actor = actor;
    await page.evaluate(({ user, nextToken }) => {
      localStorage.setItem("chalin03_token", nextToken);
      localStorage.setItem("chalin03_user", JSON.stringify(user));
    }, { user: actor, nextToken: token });
    await page.reload();
    await expect(page.getByTestId("phase5-role-card")).toContainText(actor.workspace_role.replaceAll("_", " "));
  }

  async function upload(category, type, name) {
    await page.getByLabel("Category").selectOption(category);
    await page.getByLabel("Document type").fill(type);
    await page.getByLabel("Private file").setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 Phase 5 private test evidence"),
    });
    await page.getByTestId("phase5-upload-document").click();
    await expect(page.getByRole("status")).toContainText("encrypted and stored");
  }

  await page.goto("/equipment-installment-finance/applications?stage=documents-delivery");
  await expect(page.getByTestId("phase5-documents-delivery-page")).toBeVisible();
  await expect(page.getByTestId("phase5-required-documents")).toContainText("Still required");

  await upload("kyc_identity", "Ghana Card", "customer-ghana-card.pdf");
  await upload("guarantor_identity", "Guarantor Ghana Card", "guarantor-card.pdf");
  await upload("agreement_attachment", "Signed installment agreement", "signed-agreement.pdf");
  await expect(page.getByTestId("phase5-document-row")).toHaveCount(3);
  await expect(page.getByTestId("phase5-required-documents")).toContainText("Still required");

  await switchActor(reviewerUser, "phase5-reviewer-token");
  const reviewRows = page.getByTestId("phase5-document-row");
  for (let index = 0; index < 3; index += 1) {
    const row = reviewRows.nth(index);
    await row.getByPlaceholder("Independent review or approval notes").fill("Original document and customer identity verified against the Finance application.");
    await row.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("status")).toContainText("independently verified");
  }

  await switchActor(approverUser, "phase5-approver-token");
  const approvalRows = page.getByTestId("phase5-document-row");
  for (let index = 0; index < 3; index += 1) {
    const row = approvalRows.nth(index);
    await row.getByPlaceholder("Independent review or approval notes").fill("Independent review evidence accepted for controlled Finance delivery.");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("approved for the Finance case file");
  }
  await expect(page.getByTestId("phase5-required-documents")).toContainText("Complete");

  await switchActor(makerUser, "phase5-maker-token-2");
  await page.getByPlaceholder("Why the approved customer and exact machine are ready for delivery").fill(
    "All required private documents are approved and the deposit delivery threshold is satisfied."
  );
  await page.getByTestId("phase5-request-delivery").click();
  await expect(page.getByRole("status")).toContainText("different Finance Manager");

  await switchActor(approverUser, "phase5-approver-token-2");
  await expect(page.getByTestId("phase5-pending-authorization")).toContainText("FDA-PHASE5-001");
  await page.getByPlaceholder("Independent authorization reason").fill(
    "Approved document checks, exact asset reservation and payment threshold independently confirmed."
  );
  await page.getByTestId("phase5-authorize-delivery").click();
  await expect(page.getByRole("status")).toContainText("different staff member must confirm handover");

  await switchActor(confirmerUser, "phase5-confirmer-token");
  await expect(page.getByTestId("phase5-delivery-confirmation-panel")).toBeVisible();
  await page.getByLabel("Receiving person").fill("Akosua Document Test");
  await page.getByLabel("Receiving phone").fill("0240000505");
  await page.getByLabel("Destination").fill("Dunkwa equipment delivery yard");
  await page.getByLabel("Condition").selectOption("good");
  await page.getByLabel("Meter reading").fill("1250.50");
  await page.getByLabel("Fuel level %").fill("75");
  await page.getByLabel("Attachments and tools").fill("Two buckets, operator manual and spare key.");
  await page.getByLabel("Confirmation notes").fill("Customer inspected and accepted the exact excavator.");
  await page.getByTestId("phase5-confirm-delivery").click();

  await expect(page.getByRole("status")).toContainText("independent handover confirmation recorded");
  await expect(page.getByTestId("phase5-authorization-panel")).toContainText("Controlled delivery has been completed");
  await expect(page.getByTestId("phase5-activity-row")).toHaveCount(11);
  await expect(page.getByTestId("phase5-activity-log")).toContainText("delivery confirmed");
  await expect(page.getByTestId("phase5-permissions")).toContainText("Confirm handover");
});
