import { expect, test } from "@playwright/test";

const workspace = { id: 2, code: "equipment_hire", name: "Equipment Business" };
const manager = {
  id: 84,
  username: "signature-ui-manager",
  full_name: "Signature UI Finance Manager",
  role: "manager",
  workspace_role: "finance_manager",
  access_role: "finance_manager",
  workspace_code: "equipment_hire",
  active_workspace: workspace,
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};

const customers = [
  {
    id: 301,
    customer_code: "EFC-0301",
    customer_name: "Adwoa Signature Construction",
    customer_type: "company",
    phone: "0240000301",
    whatsapp_phone: "0240000301",
    email: "accounts@example.test",
    address: "Accra",
    contact_person: "Adwoa Mensah",
    risk_notes: "",
    is_active: 1,
    finance_application_count: 2,
    finance_agreement_count: 1,
    outstanding_balance: 365000,
  },
  {
    id: 302,
    customer_code: "EFC-0302",
    customer_name: "Kojo Earthworks Limited",
    customer_type: "company",
    phone: "0240000302",
    whatsapp_phone: "",
    email: "",
    address: "Kumasi",
    contact_person: "Kojo Asare",
    risk_notes: "",
    is_active: 1,
    finance_application_count: 1,
    finance_agreement_count: 1,
    outstanding_balance: 210000,
  },
];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function prepareFinance(page) {
  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "signature-ui-manager-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, manager);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") {
      return json(route, { status: "success", user: manager, workspace });
    }
    if (path === "/equipment-catalogue/sales/phase-one/customers") {
      return json(route, { status: "success", customers });
    }
    if (path === "/workspace-context/options") {
      return json(route, {
        status: "success",
        managed_workspace: false,
        automatic_access: true,
        contexts: [],
      });
    }
    return json(route, { status: "error", message: `Unhandled ${request.method()} ${path}` }, 404);
  });
}

async function expectNoDocumentOverflow(page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
    )
    .toMatchObject({ width: expect.any(Number), scrollWidth: expect.any(Number) });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectTouchHeight(locator, minimum = 44) {
  const box = await locator.boundingBox();
  expect(box, "Expected the control to have a layout box").not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(minimum);
}

test("Installment Finance signature UI renders as an isolated desktop cockpit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepareFinance(page);
  await page.goto("/equipment-installment-finance/applications?stage=customers");

  await expect(page.locator(".bwl-shell.bwl-theme-finance-signature")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finance Customer Centre" })).toBeVisible();
  await expect(page.locator(".finance-simplified")).toBeVisible();
  await expect(page.locator(".bwl-sidebar")).toBeVisible();
  await expect(page.locator(".finance-simple__metric")).toHaveCount(4);
  await expect(page.getByText("Adwoa Signature Construction")).toBeVisible();
  await expect(page.getByText("Kojo Earthworks Limited")).toBeVisible();

  const heroBackground = await page.locator(".finance-simple__hero").evaluate(
    (node) => getComputedStyle(node).backgroundImage
  );
  expect(heroBackground).toContain("linear-gradient");

  const sidebarBackground = await page.locator(".bwl-sidebar").evaluate(
    (node) => getComputedStyle(node).backgroundImage
  );
  expect(sidebarBackground).toContain("linear-gradient");

  const customerGridColumns = await page.locator(".finance-simple__customer-grid").evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns
  );
  expect(customerGridColumns.trim().split(/\s+/)).toHaveLength(1);

  const firstSummaryBox = await page.locator(".finance-simplified__customer-summary").first().boundingBox();
  expect(firstSummaryBox).not.toBeNull();
  expect(firstSummaryBox.width).toBeGreaterThan(300);

  const firstCustomerHeading = await page.locator(".finance-simplified__customer-summary h3").first().boundingBox();
  expect(firstCustomerHeading).not.toBeNull();
  expect(firstCustomerHeading.width).toBeGreaterThan(250);
  expect(firstCustomerHeading.height).toBeLessThan(60);

  await expectNoDocumentOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("installment-signature-desktop.png"), fullPage: true });
});

test("Installment Finance signature UI is purpose-built for a phone viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareFinance(page);
  await page.goto("/equipment-installment-finance/applications?stage=customers");

  const mobileToggle = page.getByRole("button", { name: "Open workspace menu" });
  await expect(mobileToggle).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finance Customer Centre" })).toBeVisible();
  await expect(page.locator(".finance-simple__metric")).toHaveCount(4);

  await expectTouchHeight(mobileToggle);
  await expectTouchHeight(page.getByLabel("Search Finance customer register"));
  await expectTouchHeight(page.getByRole("button", { name: "View Details" }).first());

  const metrics = page.locator(".finance-simple__metrics");
  const metricOverflow = await metrics.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    snap: getComputedStyle(node).scrollSnapType,
  }));
  expect(metricOverflow.scrollWidth).toBeGreaterThan(metricOverflow.clientWidth);
  expect(metricOverflow.snap).toContain("x");

  await expectNoDocumentOverflow(page);

  await mobileToggle.click();
  const openSidebar = page.locator(".bwl-sidebar.is-open");
  await expect(openSidebar).toBeVisible();
  await expect.poll(async () => (await openSidebar.boundingBox())?.x ?? -999).toBeGreaterThanOrEqual(-1);
  const sidebarBox = await openSidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarBox.width).toBeLessThanOrEqual(390 * 0.91);
  await expect(page.getByRole("link", { name: /Customers/ })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("installment-signature-mobile-menu.png"), fullPage: true });

  await page.locator(".bwl-overlay").click({ position: { x: 380, y: 820 } });
  await expect(page.locator(".bwl-sidebar")).not.toHaveClass(/is-open/);
  await expect.poll(async () => (await page.locator(".bwl-sidebar").boundingBox())?.x ?? 0).toBeLessThan(-100);
  await page.screenshot({ path: testInfo.outputPath("installment-signature-mobile.png"), fullPage: true });
});
