import { expect, test } from "@playwright/test";

const actor = {
  id: 987, username: "qa-onboarding", full_name: "QA Onboarding",
  role: "manager", workspace_role: "finance_manager", access_role: "finance_manager",
  workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};
function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
async function mock(page) {
  const data = { machines: [], customers: [], applications: [] };
  await page.addInitScript(user => {
    localStorage.clear();
    localStorage.setItem("chalin03_token", "fixture-only");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, actor);
  await page.route("http://api.test/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    if (path === "/auth/me") return json(route, { status: "success", user: actor });
    if (path === "/workspace-context/options") return json(route, { status: "success", contexts: [] });
    if (path === "/auth/discount-permission") return json(route, { status: "success", allowed: false });
    if (path === "/equipment-catalogue/sales/phase-one/bootstrap")
      return json(route, { status: "success", customers: data.customers, machines: data.machines, settings: {} });
    if (path === "/equipment-catalogue/sales/professional/machine-register/locations")
      return json(route, { status: "success", locations: [] });
    if (path === "/equipment-catalogue/sales/professional/machine-register" && method === "POST") {
      const payload = request.postDataJSON();
      data.machines.push({ ...payload, id: 701, sale_status: "available",
        active_application_count: 0, readiness: { ready: true, missing: [] },
        editability: { editable: true }, media: [] });
      return json(route, { status: "success", message: "Machine registered.", machine: data.machines[0] }, 201);
    }
    if (path === "/equipment-catalogue/sales/phase-one/customers" && method === "GET")
      return json(route, { status: "success", customers: data.customers });
    if (path === "/equipment-catalogue/sales/phase-one/customers" && method === "POST") {
      data.customers.push({ ...request.postDataJSON(), id: 901, customer_code: "QA-901" });
      return json(route, { status: "success", message: "Customer created.", customer: data.customers[0] }, 201);
    }
    if (path === "/equipment-catalogue/sales/phase-one/schedule-preview" && method === "POST") {
      const offer = request.postDataJSON().offer;
      const amount = Number(offer.selling_price) - Number(offer.deposit);
      return json(route, { status: "success", schedule: {
        first_due_date: offer.first_due_date, final_due_date: offer.first_due_date,
        financed_amount: amount, periodic_amount: amount / Number(offer.installment_count),
        final_payment_amount: amount / Number(offer.installment_count),
        schedule: Array.from({ length: Number(offer.installment_count) }, (_, index) => ({
          sequence_number: index + 1, due_date: offer.first_due_date,
          scheduled_amount: amount / Number(offer.installment_count) }))
      } });
    }
    if (path === "/equipment-catalogue/sales/phase-one/start-installment" && method === "POST") {
      data.applications.push(request.postDataJSON());
      return json(route, { status: "success", application: { id: 990, application_number: "QA-ECAPP-990" },
        next_path: "/equipment-installment-finance/applications" }, 201);
    }
    return json(route, { status: "error", message: "Fixture endpoint missing" }, 404);
  });
  return data;
}
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9e7yyL8AAAAASUVORK5CYII=", "base64");

for (const width of [375, 1440]) {
  test("Finance register and application onboarding at " + width + "px, with fixture cleanup", async ({ page }) => {
    await page.setViewportSize({ width, height: 880 });
    const state = await mock(page);
    await page.goto("/equipment-installment-finance/applications?stage=machines");
    await page.getByRole("button", { name: /Register Excavator/ }).click();
    const machine = page.getByRole("dialog", { name: "Register excavator" });
    await machine.getByLabel("Equipment code").fill("QA-EXC-701");
    await machine.getByLabel("Machine name").fill("QA Temporary Excavator");
    await machine.getByLabel("Make").fill("CAT");
    await machine.getByLabel("Model", { exact: true }).fill("320");
    await machine.getByLabel("Target selling price").fill("850000");
    await machine.getByRole("button", { name: "Save Excavator" }).click();
    await expect(machine.getByRole("alert")).toContainText("serial number or a chassis number");
    expect(state.machines).toHaveLength(0);
    await machine.getByLabel("Serial number").fill("QA-SERIAL-701");
    await machine.locator('input[type="file"]').setInputFiles({ name: "qa-main.png", mimeType: "image/png", buffer: image });
    await expect(machine.locator(".finance-simple__photo-preview img")).toHaveCount(1);
    await machine.getByRole("button", { name: "Save Excavator" }).click();
    await expect.poll(() => state.machines.length).toBe(1);

    await page.goto("/equipment-installment-finance/applications?stage=customers");
    await page.getByRole("button", { name: /Add Customer/ }).click();
    const customer = page.getByRole("dialog", { name: "Add Finance customer" });
    await customer.getByLabel("Full name").fill("QA Temporary Customer");
    await customer.getByLabel("Phone", { exact: true }).fill("0240000999");
    await customer.getByRole("button", { name: "Save Customer" }).click();
    await expect.poll(() => state.customers.length).toBe(1);

    await page.goto("/equipment-installment-finance/applications?stage=start");
    await page.getByRole("button", { name: /QA Temporary Customer/ }).click();
    await page.getByRole("button", { name: /Continue to Excavator/ }).click();
    await page.getByRole("button", { name: /Select excavator/ }).click();
    await page.getByRole("button", { name: /Continue to Terms/ }).click();
    const date = page.locator('input[type="date"]').first();
    await date.fill("2025-10-24");
    await page.getByRole("button", { name: /Continue to Assessment/ }).click();
    await expect(page.getByRole("alert")).toContainText("first installment date is in the past");
    expect(state.applications).toHaveLength(0);
    const future = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    await date.fill(future);
    await expect(page.getByText("Live payment schedule").first()).toBeVisible();
    await page.getByRole("button", { name: /Continue to Assessment/ }).click();
    await page.getByRole("button", { name: /Continue to Review/ }).click();
    await page.getByRole("button", { name: /Create installment application/ }).click();
    await expect.poll(() => state.applications.length).toBe(1);
    expect(state.applications[0].offer.first_due_date).toBe(future);
    expect(state.applications[0].offer.selling_price).toBe("850000");

    state.applications.length = 0;
    state.customers.length = 0;
    state.machines.length = 0;
    expect(state.applications).toHaveLength(0);
    expect(state.customers).toHaveLength(0);
    expect(state.machines).toHaveLength(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
}
