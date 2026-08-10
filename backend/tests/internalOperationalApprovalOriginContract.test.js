const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cloudflareOriginSecretMiddleware,
  isInternalOperationalApprovalExecution,
  trustedHostMiddleware,
} = require("../middleware/securityMiddleware");

function makeRequest({
  host = "127.0.0.1:5000",
  method = "POST",
  path = "/api/returns",
  requestId = "2",
  token = "a".repeat(64),
} = {}) {
  const headers = {
    host,
    "x-chalin-approval-request-id": requestId,
    "x-chalin-approval-execution": token,
  };

  return {
    method,
    path,
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function withProductionEnvironment(run) {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    run();
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

test("internal return approval execution may cross the production host/origin boundary", () => {
  withProductionEnvironment(() => {
    const req = makeRequest();
    assert.equal(isInternalOperationalApprovalExecution(req), true);

    let hostNext = 0;
    const hostRes = makeResponse();
    trustedHostMiddleware(req, hostRes, () => {
      hostNext += 1;
    });
    assert.equal(hostNext, 1);
    assert.equal(hostRes.statusCode, 200);

    let originNext = 0;
    const originRes = makeResponse();
    cloudflareOriginSecretMiddleware(req, originRes, () => {
      originNext += 1;
    });
    assert.equal(originNext, 1);
    assert.equal(originRes.statusCode, 200);
  });
});

test("internal approval exception is restricted to one-time protected execution routes", () => {
  withProductionEnvironment(() => {
    assert.equal(
      isInternalOperationalApprovalExecution(makeRequest({ path: "/api/products" })),
      false
    );
    assert.equal(
      isInternalOperationalApprovalExecution(makeRequest({ token: "not-a-token" })),
      false
    );
    assert.equal(
      isInternalOperationalApprovalExecution(
        makeRequest({ method: "GET", path: "/api/returns" })
      ),
      false
    );

    const req = makeRequest({ path: "/api/products" });
    const res = makeResponse();
    let nextCalls = 0;
    trustedHostMiddleware(req, res, () => {
      nextCalls += 1;
    });
    assert.equal(nextCalls, 0);
    assert.equal(res.statusCode, 421);
    assert.equal(res.body?.code, "UNTRUSTED_API_HOST");
  });
});

test("sale edit and sale void protected execution routes remain supported", () => {
  assert.equal(
    isInternalOperationalApprovalExecution(
      makeRequest({ method: "PUT", path: "/api/sales/123" })
    ),
    true
  );
  assert.equal(
    isInternalOperationalApprovalExecution(
      makeRequest({ method: "PATCH", path: "/api/sales/123/void" })
    ),
    true
  );
});
