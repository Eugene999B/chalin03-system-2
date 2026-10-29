import { expect, test } from "@playwright/test";

const manager = {
  id: 84, username: "finance-qa", full_name: "Finance QA",
  role: "manager", workspace_role: "finance_manager",
  access_role: "finance_manager", workspace_code: "equipment_hire",
  active_workspace: { id: 2, code: "equipment_hire", name: "Equipment Business" },
  effective_permissions: ["fleet.assets.view", "fleet.assets.manage"],
};
const machines = [
  { id: 41, asset_code: "QA-EXC-A", asset_name: "QA Excavator A", make: "CAT", model: "320", target_selling_price: 120000, sale_status: "available", readiness: { ready: true, missing: [] } },
  { id: 42, asset_code: "QA-EXC-B", asset_name: "QA Excavator B", make: "SANY", model: "SY", target_selling_price: 240000, sale_status: "available", readiness: { ready: true, missing: [] } },
];
const customers = [
  { id: 301, customer_name: "QA Buyer A", phone: "0240000301", customer_code: "QA-CUS-A" },
  { id: 302, customer_name: "QA Buyer B", phone: "0240000302", customer_code: "QA-CUS-B" },
];
function json(route, body, status=200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
async function fixture(page) {
  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "qa-registration-test");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
    localStorage.removeItem("chalin03.finance.start-installment.v2");
  }, manager);
  let registrations=0;
  await page.route("http://api.test/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (pathname === "/auth/me") return json(route, { status: "success", user: manager, workspace: manager.active_workspace });
    if (pathname === "/workspace-context/options") return json(route, { status: "success", contexts: [], automatic_access: true });
    if (pathname === "/equipment-catalogue/sales/phase-one/bootstrap") return json(route, { status: "success", customers, machines });
    if (pathname === "/equipment-catalogue/sales/professional/machine-register" && method === "GET")
      return json(route, { status: "success", machines });
    if (pathname === "/equipment-catalogue/sales/professional/machine-register/locations")
      return json(route, { status: "success", locations: [{id:9,name:"QA Equipment Yard"}] });
    if (pathname === "/equipment-catalogue/sales/professional/machine-register" && method === "POST") {
      registrations+=1; return json(route, { status:"error",message:"Test must not create a machine" }, 409);
    }
    return json(route, { status:"error", message:`Unmocked ${method} ${pathname}` },404);
  });
  return () => registrations;
}
async function fitsViewport(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
}

for (const width of [375,1440]) {
  test(`protected excavator registration requires real identity at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    const posted = await fixture(page);
    await page.goto("/equipment-installment-finance/applications?stage=machines");
    await page.getByRole("button",{name:/Register Excavator/i}).click();
    const dialog = page.getByRole("dialog",{name:"Register excavator"});
    await expect(dialog).toBeVisible();
    for (const field of ["Model year (required)","Engine number (required)","Colour (required)","Physical yard / storage (required)"]) {
      await expect(dialog.getByLabel(field)).toHaveAttribute("required","");
    }
    await dialog.getByLabel("Equipment code").fill("QA-EXC-NEW");
    await dialog.getByLabel("Machine name").fill("QA Incomplete Excavator");
    await dialog.getByLabel("Make").fill("CAT");
    await dialog.getByLabel("Model", {exact:true}).fill("320");
    await dialog.getByLabel("Serial number (or chassis number required)").fill("QA-SERIAL-NEW");
    await dialog.getByLabel("Target selling price").fill("120000");
    await dialog.getByRole("button",{name:"Save Excavator"}).click();
    expect(posted()).toBe(0);
    await fitsViewport(page);
  });

  test(`switching excavators always updates the offered selling price at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await fixture(page);
    await page.goto("/equipment-installment-finance/applications?stage=start");
    await expect(page.locator(".c03-start2-brand strong")).toBeVisible();
    await page.getByRole("button",{name:/QA Buyer A/}).click();
    await page.getByRole("button",{name:"Continue to Excavator"}).click();
    await page.locator(".c03-start2-machine-grid article").nth(0).getByRole("button",{name:"Select excavator"}).click();
    await page.getByRole("button",{name:"Continue to Terms"}).click();
    await expect(page.getByLabel("Selling price")).toHaveValue("120000");
    await page.getByLabel("Selling price").fill("119000");
    await page.getByRole("button",{name:"Back"}).click();
    await page.locator(".c03-start2-machine-grid article").nth(1).getByRole("button",{name:"Select excavator"}).click();
    await page.getByRole("button",{name:"Continue to Terms"}).click();
    await expect(page.getByLabel("Selling price")).toHaveValue("240000");
    await expect(page.locator(".c03-start2-deal")).toContainText("QA-EXC-B");
    await fitsViewport(page);
  });
}

for (const width of [375, 1440]) {
  for (const choice of ["reuse", "separate"]) {
    test(`new buyer duplicate is reviewed, not silently copied (${choice}, ${width}px)`, async ({page}) => {
      await page.setViewportSize({width,height:900});
      await fixture(page);
      const submissions = [];
      await page.route("http://api.test/api/equipment-catalogue/sales/phase-one/schedule-preview", route => {
        const due = route.request().postDataJSON()?.offer?.first_due_date || "2026-12-01";
        return json(route, {status:"success",schedule:{
          first_due_date:due,final_due_date:due,installment_count:12,periodic_amount:7500,
          schedule:[{sequence_number:1,due_date:due,scheduled_amount:7500}],
        }});
      });
      await page.route("http://api.test/api/equipment-catalogue/sales/phase-one/start-installment", route => {
        const payload = route.request().postDataJSON();
        submissions.push(payload);
        if (!payload.confirm_duplicate_customer && !payload.customer_id) {
          return json(route, {status:"error",code:"POSSIBLE_DUPLICATE_FINANCE_CUSTOMER",
            message:"A customer with this phone number or name already exists.",
            duplicates:[{...customers[0],is_active:1}]},409);
        }
        return json(route,{status:"success",application:{application_number:"ECAPP-QA-DUPLICATE"},
          next_path:"/equipment-installment-finance/applications"},201);
      });
      await page.goto("/equipment-installment-finance/applications?stage=start");
      await page.getByRole("button",{name:"Create new customer"}).click();
      await page.getByLabel("Legal / registered name").fill("QA Distinct Buyer");
      await page.getByLabel("Primary phone").fill("0241111111");
      await page.getByRole("button",{name:"Continue to Excavator"}).click();
      await page.locator(".c03-start2-machine-grid article").first()
        .getByRole("button",{name:"Select excavator"}).click();
      await page.getByRole("button",{name:"Continue to Terms"}).click();
      await page.getByLabel("Opening deposit").fill("10000");
      await expect(page.locator(".c03-start2-schedule-rows")).toBeVisible();
      await page.getByRole("button",{name:"Continue to Assessment"}).click();
      await page.getByLabel("ID number").fill("QA-OTHER-PERSON-ID");
      await page.getByRole("button",{name:"Continue to Review"}).click();
      await page.getByRole("button",{name:"Create installment application"}).click();
      const review = page.getByRole("region",{name:"Possible existing customer matches"});
      await expect(review).toBeVisible();
      await expect(review.getByRole("checkbox")).not.toBeChecked();
      expect(submissions).toHaveLength(1);
      expect(submissions[0].confirm_duplicate_customer).toBeFalsy();
      if (choice === "reuse") {
        await review.getByRole("button",{name:/QA Buyer A/}).click();
        await expect(page.locator(".c03-start2-customer-grid button.is-selected"))
          .toContainText("QA Buyer A");
      } else {
        await review.getByRole("checkbox").check();
      }
      await page.getByRole("button",{name:"Continue to Excavator"}).click();
      await page.getByRole("button",{name:"Continue to Terms"}).click();
      await expect(page.locator(".c03-start2-schedule-rows")).toBeVisible();
      await page.getByRole("button",{name:"Continue to Assessment"}).click();
      if (choice === "reuse") await expect(page.getByLabel("ID number")).toHaveValue("");
      await page.getByRole("button",{name:"Continue to Review"}).click();
      await page.getByRole("button",{name:"Create installment application"}).click();
      await expect.poll(() => submissions.length).toBe(2);
      if (choice === "reuse") {
        expect(String(submissions[1].customer_id)).toBe("301");
        expect(submissions[1].confirm_duplicate_customer).toBeFalsy();
        expect(submissions[1].kyc.id_number).toBe("");
      } else {
        expect(submissions[1].customer_id).toBe(null);
        expect(submissions[1].confirm_duplicate_customer).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    });
  }
}
