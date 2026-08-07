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

test("Phase 6 operational inbox paginates and loads one selected case on demand", async ({ page }) => {
  const bootstrapRequests = [];
  const caseRequests = [];

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase6-performance-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, manager);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");

    if (path === "/auth/me") {
      return json(route, { status: "success", user: manager, workspace });
    }

    if (path === "/equipment-catalogue/sales/operational-polish/bootstrap") {
      const casePage = Number(url.searchParams.get("page") || 1);
      const inboxPage = Number(url.searchParams.get("inbox_page") || 1);
      const search = url.searchParams.get("search") || "";
      bootstrapRequests.push({ casePage, inboxPage, search });
      const applicationId = search ? 42 : casePage === 2 ? 26 : 1;
      const applicationNumber = search
        ? "ECA-PERF-SPECIAL"
        : `ECA-PERF-${String(applicationId).padStart(3, "0")}`;
      return json(route, {
        status: "success",
        cases: [{
          application_id: applicationId,
          agreement_id: null,
          case_type: "application",
          case_id: applicationId,
          case_number: applicationNumber,
          application_number: applicationNumber,
          customer_name: search ? "Special Performance Customer" : `Performance Customer ${applicationId}`,
          customer_phone: "0240000606",
          asset_label: `EXC-PERF-${applicationId} — Excavator`,
          status: "submitted",
        }],
        pagination: {
          page: casePage,
          page_size: 25,
          total: search ? 1 : 50,
          total_pages: search ? 1 : 2,
          has_previous_page: casePage > 1,
          has_next_page: !search && casePage < 2,
        },
        inbox: {
          items: [{
            id: `task:${inboxPage}`,
            stored_task_id: inboxPage,
            source: "task",
            priority: "high",
            title: `Bounded inbox page ${inboxPage}`,
            description: "Server-paginated Finance work item.",
            application_id: applicationId,
            action_tab: "case",
          }],
          summary: {
            total: 50,
            critical: 0,
            approvals: 0,
            data_quality: 0,
            total_is_lower_bound: false,
          },
          pagination: {
            page: inboxPage,
            page_size: 25,
            has_previous_page: inboxPage > 1,
            has_next_page: inboxPage < 2,
          },
        },
        alerts: [],
        policy: {
          paginated_case_register: true,
          paginated_operational_inbox: true,
          list_contains_image_bytes: false,
          selected_case_loaded_separately: true,
        },
      });
    }

    const caseMatch = path.match(
      /^\/equipment-catalogue\/sales\/operational-polish\/cases\/application\/(\d+)$/
    );
    if (caseMatch) {
      const applicationId = Number(caseMatch[1]);
      caseRequests.push(applicationId);
      return json(route, {
        status: "success",
        case: {
          application_id: applicationId,
          case_type: "application",
          case_id: applicationId,
          case_number: applicationId === 42 ? "ECA-PERF-SPECIAL" : `ECA-PERF-${applicationId}`,
          customer_name: "Special Performance Customer",
          customer_phone: "0240000606",
          asset_code: "EXC-PERF-042",
          asset_name: "Performance Excavator",
          outstanding_balance: 0,
        },
        events: [],
        documents: [],
        amendments: [],
        simulations: [],
        alerts: [],
        payments: [],
        issued_documents: [],
        summary: { total_events: 0 },
      });
    }

    return json(route, { status: "error", message: `Unhandled ${request.method()} ${path}` }, 404);
  });

  await page.goto("/equipment-installment-finance/applications?stage=operations&tab=inbox");
  await expect(page.getByRole("heading", { name: "Finance Operations Centre" })).toBeVisible();
  await expect(page.getByText("Bounded inbox page 1")).toBeVisible();
  await expect.poll(() => caseRequests.length).toBe(0);
  expect(bootstrapRequests[0]).toEqual({ casePage: 1, inboxPage: 1, search: "" });

  await page
    .getByLabel("Finance inbox pages")
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.getByText("Bounded inbox page 2")).toBeVisible();
  expect(bootstrapRequests.at(-1).inboxPage).toBe(2);

  await page
    .getByLabel("Finance case pages")
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.getByLabel("Selected case")).toContainText("ECA-PERF-026");
  expect(bootstrapRequests.at(-1).casePage).toBe(2);

  await page.getByLabel("Search Finance case").fill("special");
  await expect(page.getByLabel("Selected case")).toContainText("ECA-PERF-SPECIAL");
  expect(bootstrapRequests.at(-1)).toEqual({ casePage: 1, inboxPage: 2, search: "special" });
  await expect.poll(() => caseRequests.length).toBe(0);

  await page.getByRole("button", { name: "Case Timeline" }).click();
  await expect(page.getByRole("heading", { name: "ECA-PERF-SPECIAL" })).toBeVisible();
  await expect.poll(() => caseRequests).toEqual([42]);
});
