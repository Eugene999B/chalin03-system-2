"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertIsolatedSmokeTarget,
} = require("../scripts/runChalinOneAdminAuthenticatedSmoke");

test("authenticated Admin smoke accepts only the local operational acceptance database", () => {
  assert.deepEqual(
    assertIsolatedSmokeTarget({
      NODE_ENV: "test",
      DB_HOST: "127.0.0.1",
      DB_NAME: "chalin_one_operational_acceptance",
    }),
    {
      host: "127.0.0.1",
      database: "chalin_one_operational_acceptance",
    }
  );
});

test("authenticated Admin smoke refuses staging, production and non-local databases", () => {
  assert.throws(
    () =>
      assertIsolatedSmokeTarget({
        NODE_ENV: "staging",
        DB_HOST: "127.0.0.1",
        DB_NAME: "chalin_one_operational_acceptance",
      }),
    /NODE_ENV=test/
  );

  assert.throws(
    () =>
      assertIsolatedSmokeTarget({
        NODE_ENV: "test",
        DB_HOST: "mysql.railway.internal",
        DB_NAME: "chalin_one_operational_acceptance",
      }),
    /refuses non-local database host/
  );

  assert.throws(
    () =>
      assertIsolatedSmokeTarget({
        NODE_ENV: "test",
        DB_HOST: "127.0.0.1",
        DB_NAME: "railway_production",
      }),
    /isolated operational acceptance database/
  );
});
