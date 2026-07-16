const assert = require("node:assert/strict");
const {
  readFileSync,
} = require("node:fs");
const {
  join,
} = require("node:path");
const test = require("node:test");

const backendRoot = join(__dirname, "..");
const projectRoot = join(backendRoot, "..");

function readBackend(relativePath) {
  return readFileSync(
    join(backendRoot, relativePath),
    "utf8"
  );
}

function readProject(relativePath) {
  return readFileSync(
    join(projectRoot, relativePath),
    "utf8"
  );
}

test(
  "Release 2F migration is additive and records print evidence",
  () => {
    const source = readProject(
      "database/migrations/20260716_release2f_worker_print_pack.sql"
    );

    for (const marker of [
      "id_card_issue_date",
      "id_card_expiry_date",
      "id_card_serial",
      "worker_print_history",
      "release2f_worker_print_pack",
    ]) {
      assert.match(
        source,
        new RegExp(marker)
      );
    }

    assert.doesNotMatch(
      source,
      /\bTRUNCATE\b/i
    );

    assert.doesNotMatch(
      source,
      /\bDELETE\s+FROM\s+(sales|products|customers|debts|expenses|purchases)\b/i
    );
  }
);

test(
  "worker print routes support full profile and both ID-card choices",
  () => {
    const source = readBackend(
      "routes/workerPrintRoutes.js"
    );

    for (const marker of [
      "PDFDocument",
      "CARD_WIDTH",
      "CARD_HEIGHT",
      "85.6",
      "53.98",
      "profile-pdf",
      "id-card-pdf",
      "buildExactCardPdf",
      "buildA4CardSheetPdf",
      "drawIdCardFront",
      "drawIdCardBack",
      "worker_print_history",
      "workers.sensitive.view",
      "workers.documents.view",
      "chalin03-logo.png",
      "WORKER_ID_CARD_PDF_GENERATED",
    ]) {
      assert.match(
        source,
        new RegExp(marker)
      );
    }

    assert.match(
      source,
      /\["card", "a4"\]/
    );

    assert.match(
      source,
      /Cache-Control/
    );

    assert.match(
      source,
      /private, no-store/
    );
  }
);

test(
  "worker print routes are mounted and frontend offers both layouts",
  () => {
    const server = readBackend("server.js");

    const frontend = readProject(
      "frontend/src/pages/ExpandedWorkerProfilePage.jsx"
    );

    assert.match(
      server,
      /workerPrintRoutes/
    );

    assert.match(
      frontend,
      /Print Full Profile/
    );

    assert.match(
      frontend,
      /Exact Card Size/
    );

    assert.match(
      frontend,
      /A4 Print Sheet/
    );

    assert.match(
      frontend,
      /id-card-pdf\?layout=card/
    );

    assert.match(
      frontend,
      /id-card-pdf\?layout=a4/
    );
  }
);