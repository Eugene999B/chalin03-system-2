import { expect, test } from "@playwright/test";

const workspace = { id: 2, code: "equipment_hire", name: "Equipment Business" };
const manager = {
  id: 84,
  username: "three-page-manager",
  full_name: "Three Page Finance Manager",
  role: "manager",
  workspace_role: "finance_manager",
  access_role: "finance_manager",
  workspace_code: "equipment_hire",
  active_workspace: workspace,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

const image =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='420' viewBox='0 0 640 420'%3E%3Crect width='640' height='420' fill='%23133b2a'/%3E%3Cpath d='M118 290h365l-45-92H265l-35 34H132z' fill='%23d8b85e'/%3E%3Ccircle cx='205' cy='308' r='52' fill='%23071811'/%3E%3Ccircle cx='423' cy='308' r='52' fill='%23071811'/%3E%3C/svg%3E";

const customers = [
  {
    id: 301,
    customer_code: "EFC-0301",
    customer_name: "Adwoa Signature Construction",
    customer_type: "company",
    phone: "0240000301",
    email: "accounts@example.test",
    outstanding_balance: 365000,
  },
  {
    id: 302,
    customer_code: "EFC-0302",
    customer_name: "Kojo Earthworks Limited",
    customer_type: "company",
    phone: "0240000302",
    email: "kojo@example.test",
    outstanding_balance: 210000,
  },
];

const machines = [
  {
    id: 401,
    asset_code: "EXC-0401",
    asset_name: "LiuGong 922E Excavator",
    asset_type: "Excavator",
    make: "LiuGong",
    model: "922E",
    model_year: 2025,
    serial_number: "LG922E-SIGNATURE",
    chassis_number: "LG922E-CHASSIS",
    target_selling_price: 1250000,
    minimum_selling_price: 1175000,
    sale_status: "available",
    active_application_count: 0,
    location_name: "Central Equipment Yard",
    readiness: { ready: true, missing: [] },
    editability: { editable: true, reason: "" },
    main_image_url: image,
    media: [{ id: 1, is_primary: true, evidence_type: "main", file_url: image }],
  },
  {
    id: 402,
    asset_code: "EXC-0402",
    asset_name: "SANY SY215C Excavator",
    asset_type: "Excavator",
    make: "SANY",
    model: "SY215C",
    model_year: 2024,
    serial_number: "SANY-SIGNATURE",
    chassis_number: "SANY-CHASSIS",
    target_selling_price: 1380000,
    minimum_selling_price: 1290000,
    sale_status: "available",
    active_application_count: 0,
    location_name: "Central Equipment Yard",
    readiness: { ready: true, missing: [] },
    editability: { editable: true, reason: "" },
    main_image_url: image,
    media: [{ id: 2, is_primary: true, evidence_type: "main", file_url: image }],
  },
];

const applications = [
  {
    id: 501,
    application_number: "ECAPP-0501",
    customer_name: "Adwoa Signature Construction",
    asset_code: "EXC-0401",
    asset_name: "LiuGong 922E Excavator",
    application_status: "submitted",
    quotation_number: "EFI-0501",
    quoted_total: 1250000,
    proposed_deposit: 250000,
    financed_amount: 1000000,
    kyc_status: "verified",
    affordability_status: "eligible",
    risk_band: "low",
    equipment_origin_name: "Central Equipment Yard",
    has_image: false,
  },
  {
    id: 502,
    application_number: "ECAPP-0502",
    customer_name: "Kojo Earthworks Limited",
    asset_code: "EXC-0402",
    asset_name: "SANY SY215C Excavator",
    application_status: "draft",
    quotation_number: "EFI-0502",
    quoted_total: 1380000,
    proposed_deposit: 300000,
    financed_amount: 1080000,
    kyc_status: "incomplete",
    affordability_status: "manual_review",
    risk_band: "medium",
    equipment_origin_name: "Central Equipment Yard",
    has_image: false,
  },
];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function prepareFinance(page) {
  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "three-page-finance-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
    localStorage.removeItem("chalin03.finance.start-installment.v2");
  }, manager);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");

    if (path === "/auth/me") {
      return json(route, { status: "success", user: manager, workspace });
    }
    if (path === "/workspace-context/options") {
      return json(route, {
        status: "success",
        managed_workspace: false,
        automatic_access: true,
        contexts: [],
      });
    }
    if (path === "/equipment-catalogue/sales/phase-one/bootstrap") {
      return json(route, { status: "success", customers, machines });
    }
    if (path === "/equipment-catalogue/sales/professional/machine-register/locations") {
      return json(route, {
        status: "success",
        locations: [{ id: 9, code: "CENTRAL", name: "Central Equipment Yard" }],
      });
    }
    if (path === "/equipment-catalogue/sales/credit-applications/readiness") {
      return json(route, {
        status: "success",
        readiness: {
          ready: true,
          missing_tables: [],
          missing_columns: [],
          invalid_nullability: [],
          invalid_enums: [],
          capabilities: {
            window_functions_supported: true,
            register_query_compiles: true,
          },
        },
      });
    }
    if (path === "/equipment-catalogue/sales/credit-applications") {
      return json(route, {
        status: "success",
        applications,
        pagination: { page: 1, page_size: 25, total: 2, total_pages: 1 },
        summary: {
          drafts: 1,
          awaiting_review: 1,
          approved: 0,
          proposed_exposure: 2080000,
        },
      });
    }
    return json(route, { status: "error", message: `Unhandled ${request.method()} ${path}` }, 404);
  });
}

async function expectNoDocumentOverflow(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function computed(locator, property) {
  return locator.evaluate((node, key) => getComputedStyle(node)[key], property);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`three redesigned Finance pages render safely on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await prepareFinance(page);

    await page.goto("/equipment-installment-finance/applications?stage=start");
    await expect(page.getByRole("heading", { name: "Start New Installment" })).toBeVisible();
    await expect(page.locator(".finance-simple__steps")).toBeVisible();
    expect(await computed(page.locator(".finance-simple__hero"), "backgroundImage")).toContain("linear-gradient");
    expect(parseFloat(await computed(page.locator(".finance-simple__hero"), "borderRadius"))).toBeGreaterThan(18);
    if (viewport.name === "phone") {
      expect(await computed(page.locator(".finance-simple__steps"), "scrollSnapType")).toContain("x");
    }
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`start-installment-${viewport.name}.png`), fullPage: true });

    await page.goto("/equipment-installment-finance/applications");
    await expect(page.getByRole("heading", { name: "Credit Applications" })).toBeVisible();
    await expect(page.locator(".finance-simple__metric")).toHaveCount(4);
    await expect(page.locator(".finance-simple__card")).toHaveCount(2);
    const applicationColumns = await computed(page.locator(".finance-simple__cards"), "gridTemplateColumns");
    expect(applicationColumns.trim().split(/\s+/)).toHaveLength(1);
    const firstApplication = await page.locator(".finance-simple__card").first().boundingBox();
    expect(firstApplication).not.toBeNull();
    expect(firstApplication.width).toBeGreaterThan(viewport.name === "desktop" ? 700 : 320);
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`applications-approvals-${viewport.name}.png`), fullPage: true });

    await page.goto("/equipment-installment-finance/applications?stage=machines");
    await expect(page.getByRole("heading", { name: "Excavators" })).toBeVisible();
    await expect(page.locator(".finance-simple__machine")).toHaveCount(2);
    const machineColumns = await computed(page.locator(".finance-simple__machine-grid"), "gridTemplateColumns");
    const machineColumnCount = machineColumns.trim().split(/\s+/).length;
    expect(machineColumnCount).toBe(viewport.name === "desktop" ? 2 : 1);
    const firstMachineImage = await page.locator(".finance-simple__machine > .finance-simple__machine-image").first().boundingBox();
    expect(firstMachineImage).not.toBeNull();
    expect(firstMachineImage.height).toBeGreaterThan(viewport.name === "desktop" ? 300 : 180);
    await expectNoDocumentOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`excavator-showroom-${viewport.name}.png`), fullPage: true });
  });
}
