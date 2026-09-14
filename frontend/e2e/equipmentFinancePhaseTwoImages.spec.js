import { expect, test } from "@playwright/test";

const adminUser = {
  id: 1,
  username: "phase2-image-admin",
  full_name: "Phase 2 Image Administrator",
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

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=",
  "base64"
);

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("Finance excavator photos require authenticated Axios blobs and decode to real pixels", async ({ page }) => {
  let imageHeaders = null;
  const imagePath =
    "/equipment-catalogue/sales/protected-images/assets/301/901";
  const customer = {
    id: 21,
    customer_code: "FCUS-00021",
    customer_name: "Ama Protected Picture",
    phone: "0240000021",
    outstanding_balance: 0,
  };
  const machines = [
    {
      id: 301,
      asset_code: "EXC-PH2-001",
      asset_name: "Protected Picture Excavator",
      make: "Caterpillar",
      model: "320 GC",
      model_year: 2024,
      serial_number: "PHASE2-SERIAL-001",
      target_selling_price: 100000,
      sale_status: "available",
      current_status: "available",
      active_application_count: 0,
      active_sale_lock_count: 0,
      has_image: true,
      has_legacy_image: false,
      photo_count: 1,
      main_image_url: imagePath,
      main_image_path: imagePath,
      media: [
        {
          id: 901,
          is_primary: true,
          evidence_type: "main",
          file_url: imagePath,
          image_path: imagePath,
        },
      ],
      readiness: { ready: true, missing: [], photo_count: 1 },
      editability: { editable: true },
    },
    {
      id: 302,
      asset_code: "EXC-PH2-002",
      asset_name: "No Photo Excavator",
      make: "Komatsu",
      model: "PC200",
      serial_number: "PHASE2-SERIAL-002",
      target_selling_price: 90000,
      sale_status: "available",
      current_status: "available",
      active_application_count: 0,
      active_sale_lock_count: 0,
      has_image: false,
      has_legacy_image: false,
      photo_count: 0,
      main_image_url: null,
      main_image_path: null,
      media: [],
      readiness: { ready: true, missing: [], photo_count: 0 },
      editability: { editable: true },
    },
  ];

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "phase2-admin-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
  }, adminUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (path === imagePath && method === "GET") {
      imageHeaders = request.headers();
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(pngBytes.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
        body: pngBytes,
      });
    }

    if (path === "/auth/me" && method === "GET") {
      return json(route, {
        status: "success",
        user: adminUser,
        workspace: adminUser.active_workspace,
      });
    }

    if (path === "/equipment-catalogue/sales/phase-one/bootstrap" && method === "GET") {
      return json(route, {
        status: "success",
        customers: [customer],
        machines,
        settings: {
          default_payment_frequency: "monthly",
          default_first_due_days: 30,
        },
        policy: {
          scope: "company_wide",
          hire_location_selection_required: false,
          list_contains_image_bytes: false,
          authenticated_blob_images: true,
        },
      });
    }

    if (
      path ===
      "/equipment-catalogue/sales/operational-polish/drafts/start-installment"
    ) {
      if (method === "GET") return json(route, { status: "success", draft: null });
      if (method === "PUT") {
        return json(route, {
          status: "success",
          draft: {
            payload: request.postDataJSON()?.payload || null,
            version: 1,
            last_saved_at: "2026-08-04T16:00:00Z",
          },
        });
      }
      if (method === "DELETE") return json(route, { status: "success" });
    }

    if (method === "GET") {
      return json(route, {
        status: "success",
        readiness: { ready: true },
        items: [],
        data: [],
      });
    }
    return json(route, { status: "success" });
  });

  await page.goto(
    "/equipment-installment-finance/applications?stage=start"
  );
  await expect(
    page.getByRole("heading", { name: "Start New Installment" })
  ).toBeVisible();
  await page.getByRole("button", { name: /Ama Protected Picture/ }).click();

  const protectedResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api${imagePath}`) &&
      response.request().method() === "GET"
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Select the exact excavator" })
  ).toBeVisible();

  const protectedResponse = await protectedResponsePromise;
  expect(protectedResponse.status()).toBe(200);
  expect(protectedResponse.headers()["content-type"]).toMatch(/^image\//);
  expect((await protectedResponse.body()).length).toBeGreaterThan(0);
  expect(imageHeaders?.authorization).toBe("Bearer phase2-admin-token");
  expect(imageHeaders?.["x-chalin03-division"]).toBe("installment_finance");
  expect(imageHeaders?.["x-chalin03-workspace"]).toBe("equipment_hire");

  const protectedImage = page.locator(
    'img[alt="Protected Picture Excavator"]'
  );
  await expect(protectedImage).toBeVisible();
  await expect(protectedImage).toHaveAttribute("data-image-state", "ready");
  const decoded = await protectedImage.evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    source: image.src,
  }));
  expect(decoded.naturalWidth).toBeGreaterThan(0);
  expect(decoded.naturalHeight).toBeGreaterThan(0);
  expect(decoded.source.startsWith("blob:")).toBe(true);

  const noPhotoCard = page
    .locator(".finance-simple__card")
    .filter({ hasText: "No Photo Excavator" });
  await expect(noPhotoCard).toContainText("🚜");
  await expect(noPhotoCard.locator("img")).toHaveCount(0);
});