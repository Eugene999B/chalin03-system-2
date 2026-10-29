import { expect, test } from "@playwright/test";

const financeUser = {
  id: 84, username: "finance-ux-test",
  full_name: "Finance UX Test",
  role: "manager", workspace_role: "finance_manager",
  access_role: "finance_manager", workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

const candidate = {
  id: 28,
  application_number: "ECAPP-FIXTURE-28",
  customer_name: "Fixture Customer",
  asset_code: "EXC-022", asset_name: "Fixture Excavator",
  financed_amount: 50000, quoted_total: 1800000,
  approved_deposit: 1750000, quotation_number: "EIO-FIXTURE-28",
  installment_count: 1, payment_frequency: "weekly",
  periodic_amount: 50000, proposed_first_due_date: "2026-10-24",
  final_due_date: "2026-10-24",
  kyc_status: "complete", affordability_status: "not_assessed",
  activation_ready: true, agreement_id: null,
  activation_blockers: [],
  activation_advisories: [
    "The approved first installment due date predates the application.",
    "Affordability has not been assessed or credit risk is critical.",
  ],
};

const reserved = (id) => ({
  agreement_id: id, agreement_number: `ESA-FIXTURE-${id}`,
  customer_name: "Fixture Customer",
  asset_code: "EXC-021", asset_name: "Existing excavator",
  total_amount: 850000, deposit_required: 800000,
  deposit_received: 800000, deposit_remaining: 0,
  ready_for_deposit: false, reserved: true, blockers: [],
});

function fulfill(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function fixture(page, { activation = [candidate], deposits = [reserved(21), reserved(22), reserved(23), reserved(24), reserved(25)] } = {}) {
  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "mock-finance-ui-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, financeUser);

  await page.route("http://api.test/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/auth/me") return fulfill(route, { status: "success", user: financeUser, workspace: financeUser.active_workspace });
    if (path === "/workspace-context/options") return fulfill(route, { status: "success", contexts: [], automatic_access: true });
    if (path === "/auth/discount-permission") return fulfill(route, { status: "success", allowed: false });
    if (path === "/equipment-catalogue/sales/phase-one/bootstrap")
      return fulfill(route, { status: "success", machines: [], customers: [] });
    if (path === "/equipment-catalogue/sales/professional/machine-register/locations")
      return fulfill(route, { status: "success", locations: [] });
    if (path === "/equipment-catalogue/sales/phase-one/bootstrap")
      return fulfill(route, { status: "success", machines: [], customers: [] });
    if (path === "/equipment-catalogue/sales/professional/machine-register/locations")
      return fulfill(route, { status: "success", locations: [] });
    if (path === "/equipment-catalogue/sales/agreement-activations/readiness")
      return fulfill(route, { status: "success", readiness: { ready: true } });
    if (path === "/equipment-catalogue/sales/agreement-activations/candidates")
      return fulfill(route, { status: "success", candidates: activation });
    if (path === "/equipment-catalogue/sales/agreement-activations/28" && method === "POST")
      return fulfill(route, {
        status: "success", message: "Finance agreement and exact installment schedule created.",
        agreement: { id: 91 }, next_action: { label: "Record the required deposit." },
      }, 201);
    if (path === "/equipment-catalogue/sales/deposit-reservations/readiness")
      return fulfill(route, { status: "success", readiness: { ready: true } });
    if (path === "/equipment-catalogue/sales/deposit-reservations/candidates")
      return fulfill(route, { status: "success", candidates: deposits });
    return fulfill(route, { status: "error", message: `Unhandled ${method} ${path}` }, 404);
  });
}

async function noHorizontalOverflow(page, locator) {
  const dimensions = await locator.evaluate((node) => ({
    client: node.clientWidth,
    scroll: node.scrollWidth,
    rect: node.getBoundingClientRect().width,
  }));
  expect(dimensions.rect).toBeGreaterThan(190);
  expect(dimensions.scroll - dimensions.client).toBeLessThanOrEqual(2);
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(documentOverflow).toBeLessThanOrEqual(2);
}

for (const width of [375, 1440]) {
  test(`Prepare Agreement warning disclosure fits ${width}px and leads to opening deposit`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await fixture(page);
    await page.goto("/equipment-installment-finance/applications?stage=activation");
    await expect(page.getByRole("heading", { name: "Prepare Agreement" })).toBeVisible();
    const record = page.locator(".finance-lifecycle__record, .finance-simplified__compact-record").first();
    await expect(record).toBeVisible();
    const disclosure = record.locator(".finance-lifecycle__warnings");
    await expect(disclosure).toHaveCount(1);
    await expect(disclosure.locator("summary")).toContainText("2 financial review warnings");
    expect(await disclosure.evaluate((n) => n.open)).toBe(false);
    await noHorizontalOverflow(page, record);
    await disclosure.locator("summary").click();
    await expect(disclosure.locator("li")).toHaveCount(2);
    const recordBox = await record.boundingBox();
    const noticeBox = await disclosure.boundingBox();
    expect(noticeBox.width).toBeGreaterThan(recordBox.width * 0.78);
    await noHorizontalOverflow(page, record);

    await page.getByRole("button", { name: "Review & Create" }).click();
    await expect(page.getByRole("dialog", { name: "Activate Finance agreement" })).toBeVisible();
    await page.getByRole("checkbox", { name: /Approved terms confirmed/ }).check();
    await page.getByRole("button", { name: "Create Agreement" }).click();
    await expect(page.getByRole("heading", { name: "Agreement prepared" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to Opening Deposit" })).toHaveAttribute(
      "href", /stage=deposit&agreement=91/
    );
    await page.screenshot({ path: testInfo.outputPath(`agreement-${width}.png`), fullPage: true });
  });

  test(`Opening deposits empty queue accurately explains reserved machines at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await fixture(page);
    await page.goto("/equipment-installment-finance/applications?stage=deposit");
    await expect(page.getByRole("heading", { name: "Opening Deposits" })).toBeVisible();
    const metrics = page.locator(".finance-simple__metrics");
    await expect(page.locator(".finance-simple__metric")).toHaveCount(4);
    await noHorizontalOverflow(page, metrics);
    const metricStyle = await metrics.evaluate((node) => ({
      flow: getComputedStyle(node).gridAutoFlow,
      scroll: node.scrollWidth - node.clientWidth,
    }));
    expect(metricStyle.flow).toBe("row");
    expect(metricStyle.scroll).toBeLessThanOrEqual(2);
    await expect(page.getByText("No opening deposits currently due.")).toBeVisible();
    await page.getByRole("button", { name: "Show all agreements" }).click();
    await expect(page.locator(".finance-simplified__compact-record")).toHaveCount(5);
    await noHorizontalOverflow(page, page.locator(".finance-lifecycle").first());
    await page.screenshot({ path: testInfo.outputPath(`deposits-${width}.png`), fullPage: true });
  });
}

test("Past approved due dates cannot be opened for agreement creation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await fixture(page, { activation: [{
    ...candidate,
    activation_ready: false,
    correction_required: true,
    proposed_first_due_date: "2025-10-24",
    activation_blockers: [
      "Approved first installment date 2025-10-24 has passed. An authorised manager must return it for correction, then review and reapprove the current schedule."
    ],
  }] });
  await page.goto("/equipment-installment-finance/applications?stage=activation");
  await expect(page.getByRole("heading", { name: "Prepare Agreement" })).toBeVisible();
  const blocked = page.locator(".finance-simplified__compact-record").first();
  await expect(blocked.getByText("Requires attention")).toBeVisible();
  await expect(blocked.getByText(/Approved first installment date 2025-10-24/)).toBeVisible();
  await expect(blocked.getByRole("button", { name: /Create Agreement|Review & Create/ })).toHaveCount(0);
  await expect(blocked.getByRole("link", { name: "Return for schedule correction" }))
    .toHaveAttribute("href", /stage=applications-core&application=28/);
  await noHorizontalOverflow(page, blocked);
});

for (const width of [375, 1440]) {
  test(`Excavator registration validates identity and image inside dialog at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    let creationRequests = 0;
    await fixture(page);
    await page.route("http://api.test/api/equipment-catalogue/sales/professional/machine-register", async (route) => {
      if (route.request().method() === "POST") creationRequests += 1;
      return fulfill(route, { status: "error", message: "Unexpected unverified create" }, 400);
    });
    await page.goto("/equipment-installment-finance/applications?stage=machines");
    await expect(page.getByRole("heading", { name: "Excavators" })).toBeVisible();
    await page.getByRole("button", { name: /Register Excavator/ }).click();
    const dialog = page.getByRole("dialog", { name: "Register excavator" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Required to register:/)).toBeVisible();
    await dialog.getByLabel("Equipment code").fill(`TEST-${width}`);
    await dialog.getByLabel("Machine name").fill("Acceptance test excavator");
    await dialog.getByLabel("Make").fill("Test make");
    await dialog.getByLabel("Model", { exact: true }).fill("Test model");
    await dialog.getByLabel("Target selling price (required)").fill("100000");
    await dialog.getByLabel("Model year (required)").fill("2024");
    await dialog.locator(".finance-simple__field").filter({ hasText: /^Condition \(required\)/ }).locator("select").selectOption("good");
    await dialog.locator(".finance-simple__field").filter({ hasText: /^Ownership \(required\)/ }).locator("select").selectOption("company_owned");
    await dialog.locator(".finance-simple__field").filter({ hasText: /^Sale purpose \(required\)/ }).locator("select").selectOption("sale_only");
    await dialog.locator(".finance-simple__field").filter({ hasText: /^Meter type \(required\)/ }).locator("select").selectOption("hour_meter");
    await dialog.getByLabel("Current meter (required)").fill("0");
    await dialog.locator(".finance-simple__field").filter({ hasText: /^Fuel type \(required\)/ }).locator("select").selectOption("Diesel");
    await dialog.getByRole("button", { name: "Save Excavator" }).click();
    await expect(dialog.getByRole("alert")).toContainText("serial number or chassis number");
    await dialog.getByLabel(/Serial number \(or chassis number required\)/).fill(`SERIAL-TEST-${width}`);
    await dialog.getByRole("button", { name: "Save Excavator" }).click();
    await expect(dialog.getByRole("alert")).toContainText("main excavator photo");
    expect(creationRequests).toBe(0);
    await noHorizontalOverflow(page, dialog);
  });
}


for (const width of [375, 1440]) {
  test(`Excavator registration requires explicit verified fields at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 860 });
    await fixture(page);
    await page.goto("/equipment-installment-finance/applications?stage=machines");
    await page.getByRole("button", { name: /Register Excavator/ }).click();
    const dialog = page.getByRole("dialog", { name: "Register excavator" });
    await expect(dialog).toBeVisible();
    for (const name of [
      "Model year (required)",
      "Condition (required)",
      "Ownership (required)",
      "Sale purpose (required)",
      "Meter type (required)",
      "Current meter (required)",
      "Fuel type (required)",
    ]) {
      const field = dialog.locator(".finance-simple__field").filter({ hasText: name });
      const control = field.locator("input, select");
      await expect(control).toHaveCount(1);
      await expect(control).toHaveAttribute("required");
    }
    const getField = (name) => dialog.locator(".finance-simple__field").filter({ hasText: name }).locator("input, select");
    await expect(getField("Condition (required)")).toHaveValue("");
    await expect(getField("Fuel type (required)")).toHaveValue("");
    await expect(getField("Current meter (required)")).toHaveValue("");
    const overflow = await dialog.evaluate(node => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await page.screenshot({ path: testInfo.outputPath(`excavator-required-${width}.png`) });
  });
}
