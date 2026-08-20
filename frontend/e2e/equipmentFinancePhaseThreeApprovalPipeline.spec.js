import { expect, test } from "@playwright/test";

const managerUser = {
  id: 1,
  username: "phase3-manager",
  full_name: "Phase 3 Finance Manager",
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

function json(route, body, status = 200, headers = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

function scheduleRows() {
  return [
    { sequence_number: 1, due_date: "2026-09-01", scheduled_amount: 200 },
    { sequence_number: 2, due_date: "2026-10-01", scheduled_amount: 200 },
    { sequence_number: 3, due_date: "2026-11-01", scheduled_amount: 200 },
    { sequence_number: 4, due_date: "2026-12-01", scheduled_amount: 200 },
  ];
}

function nextAction(status) {
  const actions = {
    draft: {
      code: "complete_and_submit",
      label: "Complete the draft or submit it for manager review.",
      allowed_actions: ["edit", "submit"],
    },
    changes_requested: {
      code: "apply_requested_changes",
      label: "Apply the manager's requested changes and resubmit.",
      allowed_actions: ["edit", "submit"],
    },
    submitted: {
      code: "manager_review",
      label: "An authorised Finance manager should start or complete review.",
      allowed_actions: ["start_review", "request_changes", "approve", "decline"],
    },
    under_review: {
      code: "manager_decision",
      label: "Record approval, decline, or the exact changes required.",
      allowed_actions: ["request_changes", "approve", "decline"],
    },
    approved: {
      code: "activate_agreement",
      label: "Create the installment agreement from this approved application.",
      allowed_actions: ["activate_agreement"],
    },
  };
  return actions[status] || { code: "inspect", label: "Inspect application.", allowed_actions: [] };
}

test("one fresh installment is created, listed, opened, corrected and approved", async ({ page }) => {
  const customer = {
    id: 21,
    customer_code: "FCUS-PH3-021",
    customer_name: "Ama Phase Three Approval",
    customer_type: "individual",
    phone: "0240000021",
    email: "ama.phase3@example.com",
    address: "Dunkwa-on-Offin",
    finance_application_count: 0,
    finance_agreement_count: 0,
    outstanding_balance: 0,
  };
  const machine = {
    id: 301,
    asset_code: "EXC-PH3-301",
    asset_name: "Phase 3 Approval Excavator",
    asset_type: "Excavator",
    make: "Caterpillar",
    model: "320 GC",
    model_year: 2025,
    serial_number: "PH3-APPROVAL-301",
    chassis_number: "PH3-CHASSIS-301",
    target_selling_price: 1000,
    minimum_selling_price: 900,
    operational_purpose: "sale_only",
    sale_status: "available",
    is_active: true,
    active_application_count: 0,
    active_sale_lock_count: 0,
    active_hire_count: 0,
    has_image: false,
    main_image_url: null,
    media: [],
    readiness: { ready: true, missing: [] },
    editability: { editable: true, reason: "No installment has started." },
  };
  const state = {
    created: false,
    status: "draft",
    version: 1,
    creationPayload: null,
    actionBodies: [],
    protectedHeaders: [],
    decisions: [
      {
        id: 1,
        application_id: 501,
        decision_version: 1,
        action_type: "created",
        from_status: null,
        to_status: "draft",
        notes: "Application, quotation, quotation item and KYC record created.",
        decided_by: 1,
        decided_at: "2026-08-04T17:00:00Z",
      },
    ],
  };

  function application() {
    return {
      id: 501,
      application_number: "ECAPP-PH3-501",
      customer_id: customer.id,
      quotation_id: 401,
      asset_id: machine.id,
      application_date: "2026-08-04",
      application_status: state.status,
      kyc_status: "complete",
      affordability_status: "eligible",
      risk_band: "low",
      risk_score: 18,
      quoted_total: 1000,
      proposed_deposit: 200,
      financed_amount: 800,
      proposed_frequency: "monthly",
      proposed_interval_days: 30,
      proposed_non_working_day_rule: "exact",
      proposed_installment_count: 4,
      proposed_installment_amount: 200,
      proposed_periodic_amount: 200,
      proposed_first_due_date: "2026-09-01",
      monthly_salary_income: 3000,
      monthly_business_income: 0,
      monthly_other_income: 0,
      monthly_business_costs: 0,
      monthly_household_expenses: 600,
      existing_monthly_debt: 0,
      decision_version: state.version,
      submitted_at: ["submitted", "under_review", "changes_requested", "approved"].includes(state.status)
        ? "2026-08-04T17:02:00Z"
        : null,
      reviewed_at: ["under_review", "changes_requested", "approved"].includes(state.status)
        ? "2026-08-04T17:03:00Z"
        : null,
      customer_code: customer.customer_code,
      customer_name: customer.customer_name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      customer_address: customer.address,
      quotation_number: "EIO-PH3-401",
      quotation_status: "approved",
      quotation_total: 1000,
      quotation_deposit: 200,
      asset_code: machine.asset_code,
      asset_name: machine.asset_name,
      asset_type: machine.asset_type,
      make: machine.make,
      model: machine.model,
      model_year: machine.model_year,
      serial_number: machine.serial_number,
      chassis_number: machine.chassis_number,
      has_image: false,
      main_image_url: null,
      image_path: null,
      equipment_origin_name: null,
    };
  }

  function kyc() {
    return {
      id: 601,
      application_id: 501,
      customer_name_snapshot: customer.customer_name,
      customer_phone_snapshot: customer.phone,
      customer_email_snapshot: customer.email,
      customer_address_snapshot: customer.address,
      id_type: "Ghana Card",
      id_number: "GHA-123456789-0",
      employment_type: "salaried",
      occupation: "Site Supervisor",
      residential_address: customer.address,
      guarantor_name: "Kofi Guarantor",
      guarantor_phone: "0240000099",
      customer_consent_confirmed: true,
      credit_assessment_consent_confirmed: true,
    };
  }

  function listPayload() {
    if (!state.created) {
      return {
        status: "success",
        request_id: "phase3-list-empty",
        applications: [],
        pagination: { page: 1, page_size: 25, total: 0, total_pages: 1 },
        summary: { drafts: 0, awaiting_review: 0, approved: 0, proposed_exposure: 0 },
      };
    }
    const item = application();
    return {
      status: "success",
      request_id: `phase3-list-${state.version}`,
      applications: [item],
      pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 },
      summary: {
        drafts: ["draft", "changes_requested"].includes(state.status) ? 1 : 0,
        awaiting_review: ["submitted", "under_review"].includes(state.status) ? 1 : 0,
        approved: state.status === "approved" ? 1 : 0,
        proposed_exposure: ["draft", "submitted", "under_review", "changes_requested", "approved"].includes(state.status)
          ? 800
          : 0,
      },
      policy: {
        scope: "company_wide",
        hire_location_selection_required: false,
        list_contains_image_bytes: false,
        window_functions_required: false,
        orphaned_join_records_remain_visible: true,
        query_plan: ["count", "summary", "page"],
      },
    };
  }

  function detailPayload() {
    return {
      status: "success",
      request_id: `phase3-detail-${state.version}`,
      application: application(),
      kyc: kyc(),
      decisions: [...state.decisions].reverse(),
      active_asset_locks: [],
      editable: ["draft", "changes_requested"].includes(state.status),
      withdrawable: ["draft", "changes_requested", "submitted"].includes(state.status),
      next_action: nextAction(state.status),
      policy: {
        scope: "company_wide",
        hire_location_selection_required: false,
        detail_contains_image_bytes: false,
      },
    };
  }

  function recordAction(action, toStatus, body, note) {
    expect(Number(body.known_version)).toBe(state.version);
    const fromStatus = state.status;
    state.version += 1;
    state.status = toStatus;
    state.actionBodies.push({ action, fromStatus, toStatus, body });
    state.decisions.push({
      id: state.decisions.length + 1,
      application_id: 501,
      decision_version: state.version,
      action_type: action,
      from_status: fromStatus,
      to_status: toStatus,
      notes: note,
      decided_by: 1,
      decided_at: `2026-08-04T17:0${state.decisions.length}:00Z`,
    });
  }

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase3-manager-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
    localStorage.removeItem("chalin03_active_context_equipment_hire");
    localStorage.removeItem("chalin03.finance.start-installment.v2");
  }, managerUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    const headers = request.headers();

    if (path.startsWith("/equipment-catalogue/sales/")) {
      state.protectedHeaders.push({ path, method, headers });
    }

    if (path === "/auth/me" && method === "GET") {
      return json(route, {
        status: "success",
        user: managerUser,
        workspace: managerUser.active_workspace,
      });
    }

    if (
      path === "/equipment-catalogue/sales/operational-polish/drafts/start-installment"
    ) {
      if (method === "GET") {
        return json(route, { status: "success", draft: null });
      }
      if (method === "PUT") {
        const payload = request.postDataJSON();
        return json(route, {
          status: "success",
          server_saved: true,
          draft: {
            payload: payload.payload,
            version: 1,
            progress: null,
            last_saved_at: "2026-08-04T17:00:00Z",
          },
        });
      }
      if (method === "DELETE") {
        return json(route, { status: "success", server_draft_available: true });
      }
    }

    if (
      path === "/equipment-catalogue/sales/phase-one/bootstrap" &&
      method === "GET"
    ) {
      return json(route, {
        status: "success",
        customers: [customer],
        machines: [machine],
        settings: {
          default_payment_frequency: "monthly",
          default_first_due_days: 30,
        },
        policy: {
          scope: "company_wide",
          hire_location_selection_required: false,
          list_contains_image_bytes: false,
        },
      });
    }

    if (
      path === "/equipment-catalogue/sales/phase-one/schedule-preview" &&
      method === "POST"
    ) {
      return json(route, {
        status: "success",
        schedule: {
          selling_price: 1000,
          deposit: 200,
          financed_amount: 800,
          installment_count: 4,
          payment_frequency: "monthly",
          custom_interval_days: 30,
          first_due_date: "2026-09-01",
          final_due_date: "2026-12-01",
          periodic_amount: 200,
          final_payment_amount: 200,
          non_working_day_rule: "exact",
          schedule: scheduleRows(),
        },
      });
    }

    if (
      path === "/equipment-catalogue/sales/phase-one/start-installment" &&
      method === "POST"
    ) {
      state.creationPayload = request.postDataJSON();
      state.created = true;
      return json(
        route,
        {
          status: "success",
          message: "Installment Offer and draft credit application created.",
          customer: {
            id: customer.id,
            customer_code: customer.customer_code,
            customer_name: customer.customer_name,
          },
          machine: {
            id: machine.id,
            asset_code: machine.asset_code,
            asset_name: machine.asset_name,
          },
          installment_offer: {
            id: 401,
            number: "EIO-PH3-401",
            status: "approved",
            created_automatically: true,
            exact_schedule: scheduleRows(),
          },
          application: {
            id: 501,
            application_number: "ECAPP-PH3-501",
            application_status: "draft",
            kyc_status: "complete",
            affordability_status: "eligible",
            risk_band: "low",
            risk_score: 18,
          },
          next_path: "/equipment-installment-finance/applications?application=501",
          safeguards: {
            machine_photo_bytes_loaded: false,
            machine_photo_snapshot_stored: false,
          },
        },
        201
      );
    }

    if (
      path === "/equipment-catalogue/sales/credit-applications/readiness" &&
      method === "GET"
    ) {
      return json(route, {
        status: "success",
        request_id: "phase3-readiness",
        readiness: {
          ready: true,
          scope: "company_wide",
          hire_location_selection_required: false,
          missing_tables: [],
          missing_columns: [],
          invalid_nullability: [],
          invalid_enums: [],
          capabilities: {
            window_functions_required: false,
            register_query_compiles: true,
            separate_count_summary_page_queries: true,
          },
        },
      });
    }

    if (
      path === "/equipment-catalogue/sales/credit-applications" &&
      method === "GET"
    ) {
      return json(route, listPayload());
    }

    if (
      path === "/equipment-catalogue/sales/credit-applications/501" &&
      method === "GET"
    ) {
      return json(route, detailPayload());
    }

    if (
      path === "/equipment-catalogue/sales/credit-applications/501/submit" &&
      method === "POST"
    ) {
      const body = request.postDataJSON();
      recordAction(
        "submitted",
        "submitted",
        body,
        state.status === "changes_requested"
          ? "Requested changes completed and application resubmitted."
          : "Application submitted for manager review."
      );
      return json(route, {
        status: "success",
        message: "Installment application submitted for manager review.",
        request_id: `phase3-submit-${state.version}`,
        application: application(),
        next_action: nextAction(state.status),
        idempotent_replay: false,
      });
    }

    if (
      path === "/equipment-catalogue/sales/credit-applications/501/review" &&
      method === "POST"
    ) {
      const body = request.postDataJSON();
      if (body.action === "start_review") {
        recordAction("review_started", "under_review", body, "Manager review started.");
      } else if (body.action === "request_changes") {
        expect(body.reason).toContain("serial plate");
        recordAction("changes_requested", "changes_requested", body, body.reason);
      } else if (body.action === "approve") {
        recordAction("approved", "approved", body, "Approved by authorised Finance manager.");
      } else {
        return json(route, {
          status: "error",
          code: "INVALID_FINANCE_REVIEW_ACTION",
          message: "Unexpected review action in Phase 3 browser proof.",
        }, 400);
      }
      return json(route, {
        status: "success",
        message:
          state.status === "approved"
            ? "Installment application approved by the authorised manager."
            : `Installment application recorded as ${state.status.replaceAll("_", " ")}.`,
        request_id: `phase3-review-${state.version}`,
        application: application(),
        next_action: nextAction(state.status),
        idempotent_replay: false,
      });
    }

    if (method === "GET") {
      return json(route, {
        status: "success",
        readiness: { ready: true },
        items: [],
        data: [],
        notifications: [],
        locations: [],
      });
    }

    return json(route, { status: "success", message: "Test request accepted." });
  });

  await page.goto(
    "/equipment-installment-finance/applications?stage=start&asset=301"
  );
  await expect(page.getByRole("heading", { name: "Start New Installment" })).toBeVisible();

  await page.getByRole("button", { name: /Ama Phase Three Approval/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Select the exact excavator" })).toBeVisible();
  await expect(page.getByText("EXC-PH3-301")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Set the exact payment interval" })).toBeVisible();
  await page.getByLabel("Opening deposit").fill("200");
  await page.getByLabel("Number of payments").fill("4");
  await page.getByLabel("First payment date").fill("2026-09-01");
  await expect(page.getByText("4 payment date(s)")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Customer assessment" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "ID number Optional", exact: true })
    .fill("GHA-123456789-0");
  await page.getByLabel("Employment or business type").selectOption("salaried");
  await page.getByLabel("Occupation").fill("Site Supervisor");
  await page.getByLabel("Residential address").fill(customer.address);
  await page.getByLabel("Salary income").fill("3000");
  await page.getByLabel("Household expenses").fill("600");
  await page.getByLabel("Customer consent confirmed").check();
  await page.getByLabel("Credit assessment consent confirmed").check();
  await page.getByLabel("Guarantor name").fill("Kofi Guarantor");
  await page.getByLabel("Guarantor phone").fill("0240000099");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review and create the draft" })).toBeVisible();
  await page.getByRole("button", { name: "Create Draft Installment" }).click();

  await expect(page).toHaveURL(/application=501/);
  await expect(page.getByText("ECAPP-PH3-501").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 record(s)" })).toBeVisible();
  const fileDialog = page.getByRole("dialog", { name: "Credit application file" });
  await expect(fileDialog).toBeVisible();
  await expect(fileDialog.getByText("Draft", { exact: true })).toBeVisible();

  await fileDialog.getByRole("button", { name: "Submit for Review" }).click();
  let actionDialog = page.getByRole("dialog", { name: "Submit for manager review" });
  await actionDialog.getByLabel("Reason / note").fill("Ready for independent review.");
  await actionDialog.getByRole("button", { name: "Confirm Action" }).click();
  await expect(fileDialog.getByText("Submitted", { exact: true })).toBeVisible();

  await fileDialog.getByRole("button", { name: "Start Review" }).click();
  actionDialog = page.getByRole("dialog", { name: "Start manager review" });
  await actionDialog.getByRole("button", { name: "Confirm Action" }).click();
  await expect(fileDialog.getByText("Under Review", { exact: true })).toBeVisible();

  await fileDialog.getByRole("button", { name: "Request Changes" }).click();
  actionDialog = page.getByRole("dialog", { name: "Request changes" });
  await actionDialog
    .getByLabel("Reason / note")
    .fill("Attach a clearer serial plate reference before approval.");
  await actionDialog.getByRole("button", { name: "Confirm Action" }).click();
  await expect(fileDialog.getByText("Changes Requested", { exact: true })).toBeVisible();

  await fileDialog.getByRole("button", { name: "Submit for Review" }).click();
  actionDialog = page.getByRole("dialog", { name: "Submit for manager review" });
  await actionDialog
    .getByLabel("Reason / note")
    .fill("Requested serial plate reference has been checked.");
  await actionDialog.getByRole("button", { name: "Confirm Action" }).click();
  await expect(fileDialog.getByText("Submitted", { exact: true })).toBeVisible();

  await fileDialog.getByRole("button", { name: "Start Review" }).click();
  actionDialog = page.getByRole("dialog", { name: "Start manager review" });
  await actionDialog.getByRole("button", { name: "Confirm Action" }).click();
  await expect(fileDialog.getByText("Under Review", { exact: true })).toBeVisible();

  await fileDialog.getByRole("button", { name: "Approve" }).click();
  actionDialog = page.getByRole("dialog", { name: "Approve credit application" });
  await actionDialog
    .getByLabel("Reason / note")
    .fill("Commercial terms, customer information and machine reference approved.");
  await actionDialog.getByRole("button", { name: "Confirm Action" }).click();

  await expect(fileDialog.getByText("Approved", { exact: true })).toBeVisible();
  await expect(fileDialog.getByText("Approved → Approved")).toBeVisible();
  await fileDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("GHS 800.00").first()).toBeVisible();

  expect(state.creationPayload).toBeTruthy();
  expect(state.creationPayload.asset_id).toBe("301");
  expect(state.creationPayload.customer_id).toBe("21");
  expect(JSON.stringify(state.creationPayload)).not.toContain("data:image/");
  expect(state.actionBodies.map((item) => item.action)).toEqual([
    "submitted",
    "review_started",
    "changes_requested",
    "submitted",
    "review_started",
    "approved",
  ]);
  expect(state.version).toBe(7);
  expect(state.status).toBe("approved");
  expect(state.decisions).toHaveLength(7);

  for (const request of state.protectedHeaders) {
    expect(request.headers.authorization).toBe("Bearer phase3-manager-token");
    expect(request.headers["x-chalin03-division"]).toBe("installment_finance");
    expect(request.headers["x-chalin03-context-id"]).toBeUndefined();
  }
});
