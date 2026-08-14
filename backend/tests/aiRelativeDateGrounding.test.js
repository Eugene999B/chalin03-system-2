"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  groundRelativeDateInput,
} = require("../services/aiToolRegistry");

const fixedNow = new Date("2026-08-14T12:46:00.000Z");

function readTool(overrides = {}) {
  return {
    key: "spare_parts.operations_snapshot",
    risk_level: 1,
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" },
      },
    },
    ...overrides,
  };
}

function req(message) {
  return { body: { message } };
}

test("owner yesterday request deterministically grounds a missing read-tool date to August 13", () => {
  const grounded = groundRelativeDateInput({
    tool: readTool(),
    input: {},
    req: req("generate pdf format of yesterday sales"),
    now: fixedNow,
  });

  assert.deepEqual(grounded, {
    start_date: "2026-08-13",
    end_date: "2026-08-13",
  });
});

test("owner yesterday request overrides a provider's mistaken today date", () => {
  const grounded = groundRelativeDateInput({
    tool: readTool(),
    input: {
      start_date: "2026-08-14",
      end_date: "2026-08-14",
    },
    req: req("generate pdf format of yesterday sales"),
    now: fixedNow,
  });

  assert.equal(grounded.start_date, "2026-08-13");
  assert.equal(grounded.end_date, "2026-08-13");
});

test("owner today request deterministically grounds a safe read tool to August 14", () => {
  const grounded = groundRelativeDateInput({
    tool: readTool(),
    input: {},
    req: req("show today's sales"),
    now: fixedNow,
  });

  assert.equal(grounded.start_date, "2026-08-14");
  assert.equal(grounded.end_date, "2026-08-14");
});

test("comparison and range requests are not collapsed into a single day", () => {
  const original = {
    start_date: "2026-08-13",
    end_date: "2026-08-14",
  };
  const grounded = groundRelativeDateInput({
    tool: readTool(),
    input: original,
    req: req("compare yesterday sales with today"),
    now: fixedNow,
  });

  assert.deepEqual(grounded, original);
});

test("relative-date grounding never rewrites write-capable tools", () => {
  const original = {
    start_date: "2026-08-14",
    end_date: "2026-08-14",
  };
  const grounded = groundRelativeDateInput({
    tool: readTool({ risk_level: 2 }),
    input: original,
    req: req("yesterday"),
    now: fixedNow,
  });

  assert.deepEqual(grounded, original);
});

test("relative-date grounding ignores tools without an explicit date-window schema", () => {
  const original = { query: "yesterday sales" };
  const grounded = groundRelativeDateInput({
    tool: readTool({ input_schema: { type: "object", properties: { query: { type: "string" } } } }),
    input: original,
    req: req("yesterday sales"),
    now: fixedNow,
  });

  assert.deepEqual(grounded, original);
});
