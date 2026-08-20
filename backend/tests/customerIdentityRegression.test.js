const test = require("node:test");
const assert = require("node:assert/strict");

function canonicalCustomerKey(record) {
  const customerId = Number(record?.customer_id);
  if (Number.isInteger(customerId) && customerId > 0) {
    return `id:${customerId}`;
  }

  const phone = String(record?.customer_phone || "").trim().toLowerCase();
  if (phone) return `phone:${phone}`;

  return `name:${String(record?.customer_name || "Customer")
    .trim()
    .toLowerCase()}`;
}

function buildCanonicalCustomerFilter(alias, selection) {
  const params = [];
  if (selection.customerId) {
    params.push(selection.customerId);
    return {
      sql: ` AND ${alias}.customer_id = ?`,
      params,
    };
  }

  const clauses = [];
  if (selection.phone) {
    clauses.push(`${alias}.customer_phone = ?`);
    params.push(selection.phone);
  }
  if (clauses.length === 0 && selection.name) {
    clauses.push(`${alias}.customer_name = ?`);
    params.push(selection.name);
  }

  return {
    sql: clauses.length > 0 ? ` AND (${clauses.join(" OR ")})` : "",
    params,
  };
}

test("customer identity is keyed by customer ID before phone", () => {
  const ansah = {
    customer_id: 101,
    customer_name: "Emmanuel Ansah",
    customer_phone: "0240000000",
  };
  const awuah = {
    customer_id: 202,
    customer_name: "Emmanuel Awuah",
    customer_phone: "0240000000",
  };

  assert.notEqual(canonicalCustomerKey(ansah), canonicalCustomerKey(awuah));
  assert.equal(canonicalCustomerKey(ansah), "id:101");
  assert.equal(canonicalCustomerKey(awuah), "id:202");
});

test("missing customer ID may fall back to phone", () => {
  assert.equal(
    canonicalCustomerKey({ customer_phone: "0241111111" }),
    "phone:0241111111"
  );
});

test("selected customer ID is exclusive and never broadened by phone", () => {
  const result = buildCanonicalCustomerFilter("d", {
    customerId: 101,
    phone: "0240000000",
    name: "Emmanuel Ansah",
  });

  assert.equal(result.sql, " AND d.customer_id = ?");
  assert.deepEqual(result.params, [101]);
});
