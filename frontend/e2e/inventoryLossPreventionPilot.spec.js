import { expect, test } from "@playwright/test";

const UNIT_CODE = "POF-A2B3C4D5";
const COUNT_UNIT_CODE = "PSK-Z9Y8X7W6";

const adminUser = {
  id: 1,
  username: "inventory-pilot-admin",
  full_name: "Inventory Pilot Administrator",
  role: "admin",
  workspace_code: "spare_parts",
  active_workspace: { id: 1, code: "spare_parts", name: "Spare Parts" },
  default_branch_id: 1,
  branch_id: 1,
  branch_code: "S1",
  branch_name: "Main Store",
  branch_location: "Dunkwa Main Store",
  can_access_all_branches: 1,
  is_original_system_administrator: true,
  effective_permissions: [
    "inventory.view",
    "inventory.manage",
    "sales.create",
    "returns.manage",
  ],
};

function json(route, body, status = 200, headers = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

function now() {
  return "2026-08-11T07:58:00.000Z";
}

function pilotProduct(state) {
  const active = state.unitStatus === "active" ? 1 : 0;
  const pending = state.batchCreated && !state.batchActivated ? 1 : 0;
  return {
    id: 101,
    branch_id: 1,
    name: "Pilot Oil Filter",
    category: "Filters",
    size: "POF-01",
    barcode: "PILOT-POF-101",
    quantity: state.sourceQuantity,
    selling_price: 100,
    cost_price: 60,
    low_stock_threshold: 0,
    is_active: 1,
    inventory_tracking_mode: "serialized",
    inventory_traceability_state: state.enforced ? "enforced" : "setup",
    inventory_product_code: "POF",
    inventory_risk_tier: "high",
    active_identity_count: active,
    pending_identity_count: pending,
    identity_gap: Math.max(0, Number(state.sourceQuantity) - active),
    ready_for_serialized_enforcement:
      state.batchActivated && active === Number(state.sourceQuantity),
  };
}

function countProduct() {
  return {
    id: 102,
    branch_id: 1,
    name: "Pilot Seal Kit",
    category: "Seals",
    size: "PSK-01",
    barcode: "PILOT-PSK-102",
    quantity: 1,
    selling_price: 75,
    cost_price: 40,
    low_stock_threshold: 0,
    is_active: 1,
    inventory_tracking_mode: "serialized",
    inventory_traceability_state: "enforced",
    inventory_product_code: "PSK",
    inventory_risk_tier: "high",
    active_identity_count: 1,
    pending_identity_count: 0,
    identity_gap: 0,
    ready_for_serialized_enforcement: true,
  };
}

function receivingItem(state) {
  const status = !state.batchCreated
    ? "needs_labels"
    : state.batchActivated
    ? "complete"
    : "batch_in_progress";
  return {
    purchase_item_id: 301,
    purchase_id: 30,
    branch_id: 1,
    product_id: 101,
    product_name: "Pilot Oil Filter",
    supplier_name: "Pilot Supplier Ltd",
    invoice_number: "INV-PILOT-30",
    purchase_date: now(),
    purchased_quantity: 1,
    cost_price: 60,
    inventory_product_code: "POF",
    inventory_risk_tier: "high",
    identity_work_status: status,
    label_batch_id: state.batchCreated ? 11 : null,
    batch_code: state.batchCreated ? "LB-PILOT-1" : null,
    label_batch_status: state.batchActivated
      ? "activated"
      : state.batchPrinted
      ? "printed"
      : state.batchCreated
      ? "generated"
      : null,
    generated_quantity: state.batchCreated ? 1 : 0,
    activated_quantity: state.batchActivated ? 1 : 0,
    voided_quantity: 0,
    print_event_count: state.batchPrinted ? 1 : 0,
  };
}

function batchPayload(state) {
  return {
    status: "success",
    batch: {
      id: 11,
      batch_code: "LB-PILOT-1",
      product_id: 101,
      product_name: "Pilot Oil Filter",
      status: state.batchActivated
        ? "activated"
        : state.batchPrinted
        ? "printed"
        : "generated",
      generated_quantity: 1,
      activated_quantity: state.batchActivated ? 1 : 0,
      voided_quantity: 0,
      print_event_count: state.batchPrinted ? 1 : 0,
    },
    units: [
      {
        id: 201,
        unit_code: UNIT_CODE,
        product_id: 101,
        status: state.batchActivated ? "active" : "label_pending",
      },
    ],
  };
}

function saleRecord() {
  return {
    id: 500,
    branch_id: 1,
    branch_code: "S1",
    branch_name: "Main Store",
    receipt_number: "R-PILOT-500",
    total: 100,
    payment_type: "cash",
    amount_paid: 100,
    balance: 0,
    created_at: now(),
    customer_name: "Walk-in Customer",
    customer_phone: "",
  };
}

function transferSummary(state) {
  return {
    id: 900,
    transfer_number: "TR-PILOT-900",
    status: state.transferStatus,
    from_branch_id: 1,
    from_branch_code: "S1",
    from_branch_name: "Main Store",
    to_branch_id: 2,
    to_branch_code: "S2",
    to_branch_name: "East Store",
    requested_by_name: "Inventory Pilot Administrator",
    requested_at: now(),
    item_count: 1,
    total_requested_quantity: 1,
  };
}

function transferDetail(state) {
  return {
    ...transferSummary(state),
    request_note: "Pilot exact-ID transfer",
    dispatch_note: state.transferStatus !== "approved" ? "Pilot dispatch" : null,
    receive_note: state.transferShortage ? "Box arrived empty" : null,
    items: [
      {
        id: 901,
        transfer_id: 900,
        source_product_id: 101,
        destination_product_id: state.transferStatus === "received" ? 201 : null,
        product_name: "Pilot Oil Filter",
        category: "Filters",
        size: "POF-01",
        barcode: "PILOT-POF-101",
        requested_quantity: 1,
        dispatched_quantity: state.transferStatus === "approved" ? null : 1,
        received_quantity: state.transferStatus === "received" ? 1 : 0,
        source_quantity_before: state.transferStatus === "approved" ? null : 1,
        source_quantity_after: state.transferStatus === "approved" ? null : 0,
        destination_quantity_before: state.transferStatus === "received" ? 0 : null,
        destination_quantity_after: state.transferStatus === "received" ? 1 : null,
      },
    ],
  };
}

function transferPlan(state) {
  const dispatched = state.transferStatus !== "approved";
  const received = state.transferStatus === "received";
  return {
    status: "success",
    serialized_identity_required: true,
    expected_ids_hidden_until_physically_scanned: true,
    partial_receipt_creates_investigations: true,
    transfer: {
      id: 900,
      transfer_number: "TR-PILOT-900",
      status: state.transferStatus,
      from_branch_id: 1,
      from_branch_code: "S1",
      from_branch_name: "Main Store",
      to_branch_id: 2,
      to_branch_code: "S2",
      to_branch_name: "East Store",
    },
    items: [
      {
        id: 901,
        transfer_id: 900,
        source_product_id: 101,
        destination_product_id: received ? 201 : null,
        product_name: "Pilot Oil Filter",
        requested_quantity: 1,
        dispatched_quantity: dispatched ? 1 : null,
        received_quantity: received ? 1 : 0,
        tracking_mode: "serialized",
        traceability_state: "enforced",
        inventory_product_code: "POF",
        inventory_risk_tier: "high",
        serialized_identity_required: true,
        dispatched_identity_count: dispatched ? 1 : 0,
        received_identity_count: received ? 1 : 0,
        missing_identity_count: state.transferShortage && !received ? 1 : 0,
        outstanding_identity_count: dispatched && !received ? 1 : 0,
      },
    ],
  };
}

function countSession(state) {
  return {
    id: 77,
    session_code: "CNT-PILOT-77",
    status: state.countSubmitted ? "submitted" : "open",
    count_type: "blind_cycle",
    selection_method: "manual",
    area_label: "Pilot Shelf B",
    reason: "Release-readiness blind count",
    product_count: 1,
    exception_product_count: state.countSubmitted ? 1 : 0,
    blind_expected_values_hidden: !state.countSubmitted,
    scopes: [
      {
        id: 7701,
        product_id: 102,
        product_name: "Pilot Seal Kit",
        tracking_mode_snapshot: "serialized",
        risk_tier_snapshot: "high",
        review_status: state.countSubmitted ? "variance" : "open",
        expected_system_quantity: state.countSubmitted ? 1 : undefined,
        observed_quantity: state.countSubmitted ? 0 : undefined,
        variance_quantity: state.countSubmitted ? -1 : undefined,
        missing_identity_count: state.countSubmitted ? 1 : 0,
        unexpected_identity_count: 0,
        progress: {
          accepted_observations: 0,
          duplicate_observations: 0,
          exception_observations: 0,
        },
      },
    ],
  };
}

function investigation(state) {
  if (!state.countSubmitted) return [];
  return [
    {
      id: 8801,
      investigation_code: "INV-S1-PILOT-1",
      branch_id: 1,
      product_id: 102,
      product_name: "Pilot Seal Kit",
      unit_id: 202,
      unit_code: COUNT_UNIT_CODE,
      investigation_type: "missing_identity",
      severity: "high",
      status: "open",
      session_code: "CNT-PILOT-77",
      variance_quantity: -1,
      variance_type: "missing_identity",
    },
  ];
}

test("inventory loss-prevention pilot proves the physical lifecycle without production data", async ({ page }) => {
  const state = {
    batchCreated: false,
    batchPrinted: false,
    batchActivated: false,
    enforced: false,
    unitStatus: "label_pending",
    sourceQuantity: 1,
    sold: false,
    returned: false,
    quarantine: false,
    transferStatus: "approved",
    transferShortage: false,
    countCreated: false,
    countSubmitted: false,
  };

  const evidence = {
    saleUnitIds: null,
    returnUnitIds: null,
    dispatchUnitIds: null,
    firstReceiveUnitIds: null,
    lateReceiveUnitIds: null,
    enforcementPayload: null,
  };

  await page.addInitScript((user) => {
    localStorage.setItem("chalin03_token", "inventory-pilot-token");
    localStorage.setItem("chalin03_user", JSON.stringify(user));
    localStorage.setItem("chalin03_selected_branch_id", "1");
  }, adminUser);

  await page.route("http://api.test/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    const body = request.postDataJSON?.() || {};

    if (path === "/auth/me" && method === "GET") {
      return json(route, {
        status: "success",
        user: adminUser,
        workspace: adminUser.active_workspace,
        branch: {
          id: 1,
          branch_code: "S1",
          name: "Main Store",
          location: "Dunkwa Main Store",
        },
      });
    }

    if (path === "/installments/settings" && method === "GET") {
      return json(route, { status: "success", settings: {} });
    }

    if (path === "/inventory-traceability/receiving/purchase-items" && method === "GET") {
      return json(route, { status: "success", items: [receivingItem(state)] });
    }

    if (
      path === "/inventory-traceability/receiving/purchase-items/301/label-batch" &&
      method === "POST"
    ) {
      state.batchCreated = true;
      return json(route, {
        status: "success",
        message: "Exact identities prepared from the recorded supplier purchase line.",
        batch: { id: 11, batch_code: "LB-PILOT-1", generated_quantity: 1 },
      }, 201);
    }

    if (path === "/inventory-traceability/label-batches/11/print" && method === "POST") {
      state.batchPrinted = true;
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="LB-PILOT-1.pdf"',
        },
        body: "%PDF-1.4\n% CHALIN inventory pilot label PDF\n",
      });
    }

    if (path === "/inventory-traceability/overview" && method === "GET") {
      const units = [];
      if (state.batchCreated && !state.batchActivated) {
        units.push({ status: "label_pending", unit_count: 1 });
      }
      if (state.unitStatus === "active") units.push({ status: "active", unit_count: 1 });
      return json(route, { status: "success", units });
    }

    if (path === "/inventory-traceability/products" && method === "GET") {
      return json(route, {
        status: "success",
        products: [pilotProduct(state), countProduct()],
      });
    }

    if (path === "/inventory-traceability/products/101" && method === "GET") {
      return json(route, {
        status: "success",
        product: pilotProduct(state),
        label_batches: state.batchCreated ? [batchPayload(state).batch] : [],
      });
    }

    if (path === "/inventory-traceability/products/101/config" && method === "PUT") {
      evidence.enforcementPayload = body;
      if (body.traceability_state === "enforced") state.enforced = true;
      return json(route, {
        status: "success",
        message: "Traceability configuration saved.",
        product: pilotProduct(state),
      });
    }

    if (path === "/inventory-traceability/label-batches/11" && method === "GET") {
      return json(route, batchPayload(state));
    }

    if (path === "/inventory-traceability/label-batches/11/activate" && method === "POST") {
      expect(body.active_unit_codes).toEqual([UNIT_CODE]);
      expect(body.void_unit_codes).toEqual([]);
      state.batchActivated = true;
      state.unitStatus = "active";
      return json(route, {
        status: "success",
        message: "Physical identities confirmed and activated.",
        activated_quantity: 1,
        voided_quantity: 0,
      });
    }

    if (path === "/inventory-traceability/sale-products" && method === "GET") {
      const product = pilotProduct(state);
      const sellable = state.unitStatus === "active" && state.enforced ? 1 : 0;
      return json(route, {
        status: "success",
        products: [
          {
            ...product,
            quantity: sellable,
            sellable_quantity: sellable,
          },
        ],
      });
    }

    if (path === "/inventory-traceability/sale-scan/verify" && method === "POST") {
      if (String(body.value || "").trim().toUpperCase() !== UNIT_CODE) {
        return json(route, { status: "error", message: "Pilot unit not found." }, 404);
      }
      return json(route, {
        status: "success",
        unit: {
          unit_code: UNIT_CODE,
          product_id: 101,
          product_name: "Pilot Oil Filter",
          same_store: true,
          status: state.unitStatus,
        },
      });
    }

    if (path === "/sales" && method === "POST") {
      evidence.saleUnitIds = body.items?.[0]?.unit_ids || [];
      expect(evidence.saleUnitIds).toEqual([UNIT_CODE]);
      state.sold = true;
      state.unitStatus = "sold";
      state.sourceQuantity = 0;
      return json(route, {
        status: "success",
        receipt: {
          sale_id: 500,
          receipt_number: "R-PILOT-500",
          branch_id: 1,
          branch_code: "S1",
          branch_name: "Main Store",
          branch_location: "Dunkwa Main Store",
          created_at: now(),
          payment_type: "cash",
          subtotal: 100,
          discount_amount: 0,
          tax_amount: 0,
          total: 100,
          amount_tendered: 100,
          amount_paid: 100,
          change_due: 0,
          balance: 0,
          items: [
            {
              product_name: "Pilot Oil Filter",
              quantity: 1,
              unit_price: 100,
              line_total: 100,
            },
          ],
          staff: { full_name: "Inventory Pilot Administrator" },
        },
      }, 201);
    }

    if (path === "/returns/sales" && method === "GET") {
      return json(route, { status: "success", sales: [saleRecord()] });
    }

    if (path === "/returns/sales/500/items" && method === "GET") {
      return json(route, {
        status: "success",
        sale: saleRecord(),
        items: [
          {
            product_id: 101,
            product_name: "Pilot Oil Filter",
            quantity_sold: 1,
            unit_price: 100,
            line_total: 100,
            returned_quantity: state.returned ? 1 : 0,
            pending_return_quantity: 0,
            active_refund_request_count: 0,
            active_refund_request_codes: [],
            physical_remaining_quantity: state.returned ? 0 : 1,
            remaining_quantity: state.returned ? 0 : 1,
            inventory_tracking_mode: "serialized",
            inventory_traceability_state: "enforced",
            inventory_product_code: "POF",
            serialized_return_requires_unit_ids: true,
          },
        ],
      });
    }

    if (path === "/returns" && method === "GET") {
      return json(route, {
        status: "success",
        returns: state.returned
          ? [
              {
                id: 1,
                returned_at: now(),
                receipt_number: "R-PILOT-500",
                customer_name: "Walk-in Customer",
                product_name: "Pilot Oil Filter",
                quantity: 1,
                return_type: "stock_only",
                refund_amount: 0,
                refund_method: "none",
                returned_by_name: "Inventory Pilot Administrator",
                reason: "Pilot exact-ID return",
                branch_code: "S1",
              },
            ]
          : [],
        summary: {
          return_count: state.returned ? 1 : 0,
          total_quantity_returned: state.returned ? 1 : 0,
          total_refunded: 0,
        },
      });
    }

    if (path === "/inventory-traceability/return-scan/verify" && method === "POST") {
      return json(route, {
        status: "success",
        eligible: !state.returned,
        unit: {
          unit_code: UNIT_CODE,
          product_id: 101,
          product_name: "Pilot Oil Filter",
          same_sale: true,
          same_product: true,
          same_store: true,
          already_returned: state.returned,
          status: state.unitStatus,
        },
      });
    }

    if (path === "/returns" && method === "POST") {
      evidence.returnUnitIds = body.unit_ids || [];
      expect(evidence.returnUnitIds).toEqual([UNIT_CODE]);
      state.returned = true;
      state.quarantine = true;
      state.unitStatus = "returned_quarantine";
      state.sourceQuantity = 1;
      return json(route, {
        status: "success",
        message:
          "Return recorded successfully. Physical serialized units are in quarantine and are not sellable until inspection clears them.",
        return_record: {
          sale_id: 500,
          product_id: 101,
          quantity: 1,
          unit_ids: [UNIT_CODE],
          serialized_quarantine: true,
        },
      }, 201);
    }

    if (path === "/inventory-traceability/return-quarantine" && method === "GET") {
      return json(route, {
        status: "success",
        units: state.quarantine
          ? [
              {
                unit_code: UNIT_CODE,
                product_id: 101,
                product_name: "Pilot Oil Filter",
                inventory_product_code: "POF",
                inventory_risk_tier: "high",
                current_branch_name: "Main Store",
                return_id: 1,
                sale_id: 500,
                receipt_number: "R-PILOT-500",
                customer_name: "Walk-in Customer",
                returned_at: now(),
                return_type: "stock_only",
                refund_amount: 0,
                return_reason: "Pilot exact-ID return",
                status: "returned_quarantine",
              },
            ]
          : [],
      });
    }

    if (
      path === `/inventory-traceability/return-quarantine/${UNIT_CODE}/inspect` &&
      method === "POST"
    ) {
      expect(body.outcome).toBe("restock");
      expect(String(body.notes || "").length).toBeGreaterThanOrEqual(8);
      state.quarantine = false;
      state.unitStatus = "active";
      return json(route, {
        status: "success",
        message: `${UNIT_CODE} inspected and returned to active sellable stock.`,
      });
    }

    if (path === "/stock-transfers/branches" && method === "GET") {
      return json(route, {
        status: "success",
        branches: [
          { id: 1, branch_code: "S1", name: "Main Store" },
          { id: 2, branch_code: "S2", name: "East Store" },
        ],
      });
    }

    if (path === "/stock-transfers" && method === "GET") {
      return json(route, { status: "success", transfers: [transferSummary(state)] });
    }

    if (path === "/stock-transfers/products" && method === "GET") {
      return json(route, { status: "success", products: [pilotProduct(state)] });
    }

    if (path === "/stock-transfers/900" && method === "GET") {
      return json(route, { status: "success", transfer: transferDetail(state) });
    }

    if (
      path === "/inventory-traceability/transfer-control/900/plan" &&
      method === "GET"
    ) {
      return json(route, transferPlan(state));
    }

    if (
      path === "/inventory-traceability/transfer-control/900/items/901/scan" &&
      method === "POST"
    ) {
      expect(String(body.value || "").trim().toUpperCase()).toBe(UNIT_CODE);
      expect(["dispatch", "receive"]).toContain(body.phase);
      return json(route, {
        status: "success",
        result: {
          accepted: true,
          transfer_id: 900,
          transfer_item_id: 901,
          unit_code: UNIT_CODE,
          phase: body.phase,
          signed_label: false,
          prior_receipt_status: body.phase === "receive" && state.transferShortage ? "missing" : "pending",
        },
      });
    }

    if (
      path === "/inventory-traceability/transfer-control/900/dispatch" &&
      method === "POST"
    ) {
      evidence.dispatchUnitIds = body.items?.[0]?.unit_ids || [];
      expect(evidence.dispatchUnitIds).toEqual([UNIT_CODE]);
      state.transferStatus = "dispatched";
      state.unitStatus = "in_transit";
      state.sourceQuantity = 0;
      return json(route, {
        ...transferPlan(state),
        status: "success",
        message:
          "Transfer dispatched. Source quantity was reduced and every enforced serialized unit is now recorded in transit.",
        result: {
          transfer_id: 900,
          transfer_number: "TR-PILOT-900",
          status: "dispatched",
          exact_identity_count: 1,
          source_stock_reduced: true,
        },
        secondary_audit_recorded: true,
      });
    }

    if (
      path === "/inventory-traceability/transfer-control/900/receive" &&
      method === "POST"
    ) {
      const ids = body.items?.[0]?.unit_ids || [];
      if (ids.length === 0) {
        evidence.firstReceiveUnitIds = ids;
        state.transferShortage = true;
        return json(route, {
          ...transferPlan(state),
          status: "success",
          message:
            "Partial receipt recorded. Missing dispatched IDs remain in transit and have investigation evidence; destination stock increased only for verified arrivals.",
          result: {
            transfer_id: 900,
            transfer_number: "TR-PILOT-900",
            status: "dispatched",
            transfer_complete: false,
            newly_received_identity_count: 0,
            newly_missing_identity_count: 1,
            shortages_open_investigations: true,
            destination_stock_increased_only_for_observed_units: true,
          },
          secondary_audit_recorded: true,
        });
      }

      evidence.lateReceiveUnitIds = ids;
      expect(ids).toEqual([UNIT_CODE]);
      state.transferShortage = false;
      state.transferStatus = "received";
      state.unitStatus = "active";
      return json(route, {
        ...transferPlan(state),
        status: "success",
        message:
          "Transfer received. Destination stock increased only for the physical IDs actually verified.",
        result: {
          transfer_id: 900,
          transfer_number: "TR-PILOT-900",
          status: "received",
          transfer_complete: true,
          newly_received_identity_count: 1,
          newly_missing_identity_count: 0,
          destination_stock_increased_only_for_observed_units: true,
        },
        secondary_audit_recorded: true,
      });
    }

    if (path === "/inventory-traceability/loss-control/counts" && method === "GET") {
      return json(route, {
        status: "success",
        sessions: state.countCreated
          ? [
              {
                id: 77,
                session_code: "CNT-PILOT-77",
                status: state.countSubmitted ? "submitted" : "open",
                product_count: 1,
                exception_product_count: state.countSubmitted ? 1 : 0,
              },
            ]
          : [],
      });
    }

    if (path === "/inventory-traceability/loss-control/investigations" && method === "GET") {
      return json(route, { status: "success", investigations: investigation(state) });
    }

    if (path === "/inventory-traceability/loss-control/counts" && method === "POST") {
      expect(body.product_ids).toEqual([102]);
      state.countCreated = true;
      return json(route, {
        status: "success",
        message: "Blind count opened. Expected values remain hidden until submission.",
        session: countSession(state),
      }, 201);
    }

    if (path === "/inventory-traceability/loss-control/counts/77" && method === "GET") {
      return json(route, { status: "success", session: countSession(state) });
    }

    if (
      path === "/inventory-traceability/loss-control/counts/77/unit-observations" &&
      method === "POST"
    ) {
      return json(route, {
        status: "success",
        message: "Physical unit recorded.",
        observation: { unit_code: body.value, accepted: true },
      });
    }

    if (
      path === "/inventory-traceability/loss-control/counts/77/submit" &&
      method === "POST"
    ) {
      state.countSubmitted = true;
      return json(route, {
        status: "success",
        message:
          "Blind count submitted. Frozen expected values are now revealed and variance investigations were opened without changing stock.",
        session: countSession(state),
      });
    }

    if (path.startsWith("/sales/customers") && method === "GET") {
      return json(route, { status: "success", customers: [] });
    }

    // Layout/background endpoints are intentionally harmless in this in-memory pilot.
    return json(route, {
      status: "success",
      data: [],
      products: [],
      branches: [],
      notifications: [],
      settings: {},
    });
  });

  // 1) Supplier purchase -> exact identities -> controlled print.
  await page.goto("/inventory-traceability");
  await expect(page.getByRole("heading", { name: "Inventory Control & Traceability" })).toBeVisible();
  await page.getByRole("tab", { name: /Serialized Receiving/ }).click();
  await expect(page.getByRole("heading", { name: "Serialized Receiving" })).toBeVisible();
  await expect(page.getByText("Pilot Oil Filter")).toBeVisible();
  await page.getByRole("button", { name: "Prepare 1 Exact IDs" }).click();
  await expect(page.getByText(/Exact identities prepared/)).toBeVisible();
  await page.getByRole("button", { name: "Print Controlled Labels" }).click();
  await expect(page.getByText(/Controlled inventory labels downloaded/)).toBeVisible();

  // 2) Independent physical attachment -> reconciliation -> explicit admin enforcement.
  await page.getByRole("tab", { name: /Setup & Labels/ }).click();
  await page.getByRole("button", { name: /Pilot Oil Filter/ }).first().click();
  await page.getByRole("button", { name: /LB-PILOT-1/ }).click();
  await expect(page.getByText(UNIT_CODE)).toBeVisible();
  await page.getByLabel(/I physically verified this batch/).check();
  await page.getByRole("button", { name: "Finalize Physical Attachment" }).click();
  await expect(page.getByText(/Physical identities confirmed/)).toBeVisible();
  await page.getByLabel("Rollout state").selectOption("enforced");
  await page.getByRole("button", { name: "Save Tracking Policy" }).click();
  await expect(page.getByText(/Traceability configuration saved/)).toBeVisible();
  expect(evidence.enforcementPayload?.traceability_state).toBe("enforced");
  await expect(
    page.getByText(/Feature-branch Sales enforcement is active for enforced serialized products/)
  ).toBeVisible();

  // 3) Exact-ID sale.
  await page.goto("/new-sale");
  await page.getByPlaceholder("Example: filter, CAT 320, barcode...").fill("Pilot Oil Filter");
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "Add to Sale" }).click();
  await expect(page.getByText("Physical IDs required")).toBeVisible();
  await page.getByLabel("Physical unit ID for Pilot Oil Filter").fill(UNIT_CODE);
  await page.getByRole("button", { name: "Verify ID" }).click();
  await expect(page.getByText(/verified and attached/)).toBeVisible();
  await page.getByRole("button", { name: "Exact" }).click();
  await page.getByRole("button", { name: /Complete Sale/ }).click();
  await expect(page.getByText("Sale recorded successfully.")).toBeVisible();
  expect(evidence.saleUnitIds).toEqual([UNIT_CODE]);

  // 4) Exact sold ID -> return quarantine.
  await page.goto("/returns");
  const saleFinder = page.locator(".section-card").filter({ hasText: "Find Sale" }).first();
  await saleFinder.locator("select").selectOption("500");
  const singleReturn = page.locator("details.returns-single-fallback");
  await singleReturn.locator("summary").click();
  await singleReturn.locator('select[name="product_id"]').selectOption("101");
  await singleReturn.locator('input[name="quantity"]').fill("1");
  await singleReturn.getByPlaceholder("Enter returned unit ID or QR payload").fill(UNIT_CODE);
  await singleReturn.getByRole("button", { name: "Verify Returned ID" }).click();
  await expect(
    singleReturn.locator(".inventory-unit-scanner__message")
  ).toContainText(`${UNIT_CODE} verified against this receipt`);
  await singleReturn.locator('textarea[name="reason"]').fill("Pilot exact-ID return");
  await singleReturn.getByRole("button", { name: "Save Stock-Only Return" }).click();
  await expect(page.getByText(/in quarantine and are not sellable/)).toBeVisible();
  expect(evidence.returnUnitIds).toEqual([UNIT_CODE]);

  // 5) Quarantine inspection -> exact unit becomes active again.
  await page.goto("/inventory-traceability");
  await page.getByRole("tab", { name: /Return Quarantine/ }).click();
  await expect(page.getByText("Quarantine is inventory, not sellable stock.")).toBeVisible();
  await expect(page.getByText(UNIT_CODE)).toBeVisible();
  await page.getByPlaceholder(/Seal intact/).fill("Seal intact and correct item; safe to restock.");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Complete Inspection" }).click();
  await expect(page.getByText(/returned to active sellable stock/)).toBeVisible();

  // 6) Exact-ID transfer dispatch -> zero receipt shortage -> late arrival.
  await page.goto("/stock-transfers");
  await expect(page.getByText("TR-PILOT-900")).toBeVisible();
  await page.getByRole("button", { name: "View / Action" }).click();
  await expect(page.getByText("Exact physical identity control")).toBeVisible();
  await expect(page.getByText("Expected IDs hidden")).toBeVisible();
  await page.getByPlaceholder("Scan source unit ID or QR payload").fill(UNIT_CODE);
  await page.getByRole("button", { name: "Verify Physical ID" }).click();
  await page.getByRole("button", { name: "Dispatch Verified Physical IDs" }).click();
  await expect(page.getByText(/every enforced serialized unit is now recorded in transit/)).toBeVisible();
  expect(evidence.dispatchUnitIds).toEqual([UNIT_CODE]);

  await page.getByPlaceholder(/Optional action note before approve, dispatch, receive/).fill("Box arrived empty");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Record Partial Receipt & Investigate Shortage" }).click();
  await expect(page.getByText(/Missing dispatched IDs remain in transit/)).toBeVisible();
  expect(evidence.firstReceiveUnitIds).toEqual([]);

  await page.getByPlaceholder("Scan physically arrived unit ID or QR payload").fill(UNIT_CODE);
  await page.getByRole("button", { name: "Verify Physical ID" }).click();
  await page.getByRole("button", { name: "Receive Verified Physical IDs" }).click();
  await expect(page.getByText(/Destination stock increased only for the physical IDs actually verified/)).toBeVisible();
  expect(evidence.lateReceiveUnitIds).toEqual([UNIT_CODE]);

  // 7) Blind count reveals a frozen missing identity only after submission.
  await page.goto("/inventory-traceability");
  await page.getByRole("tab", { name: /Blind Counts & Investigations/ }).click();
  await expect(page.getByText("Evidence, not accusation.")).toBeVisible();
  await page.getByText("Pilot Seal Kit", { exact: true }).click();
  await page.getByPlaceholder("Example: Oil Rack A").fill("Pilot Shelf B");
  await page.getByPlaceholder("Routine blind inventory verification").fill("Release-readiness blind count");
  await page.getByRole("button", { name: "Open Blind Count" }).click();
  await expect(page.getByText("Expected IDs hidden")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "CNT-PILOT-77", exact: true })
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Submit Count" }).click();
  await expect(page.getByText(/Frozen expected values are now revealed/)).toBeVisible();
  await expect(page.getByText("INV-S1-PILOT-1")).toBeVisible();
  await expect(page.getByText(COUNT_UNIT_CODE)).toBeVisible();
  await expect(page.getByText(/Stock and worker fault remain separate controlled decisions/)).not.toBeVisible();

  // Evidence captured by the mocked server proves the high-value ID contracts.
  expect(evidence.saleUnitIds).toEqual([UNIT_CODE]);
  expect(evidence.returnUnitIds).toEqual([UNIT_CODE]);
  expect(evidence.dispatchUnitIds).toEqual([UNIT_CODE]);
  expect(evidence.firstReceiveUnitIds).toEqual([]);
  expect(evidence.lateReceiveUnitIds).toEqual([UNIT_CODE]);
});
