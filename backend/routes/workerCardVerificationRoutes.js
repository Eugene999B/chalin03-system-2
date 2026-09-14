const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const { pool } = require("../config/db");
const {
  verifyWorkerCardSignature,
} = require("../services/workerCardVerificationService");
const payrollPayslipVerificationRoutes = require("./payrollPayslipVerificationRoutes");

const router = express.Router();

const LOGO_PATH = path.resolve(
  __dirname,
  "..",
  "assets",
  "chalin03-logo.png"
);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function html(value) {
  return cleanText(value, 1000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, fallback = "Not recorded") {
  if (!value) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return cleanText(value, 30) || fallback;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function titleCase(value) {
  return cleanText(value, 100)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function logoDataUri() {
  try {
    return `data:image/png;base64,${fs
      .readFileSync(LOGO_PATH)
      .toString("base64")}`;
  } catch {
    return "";
  }
}

function cardState(profile, signatureValid) {
  if (!signatureValid) {
    return {
      code: "invalid",
      label: "INVALID CREDENTIAL",
      message:
        "The verification signature is missing or does not match this card.",
    };
  }

  const employmentStatus = cleanText(
    profile.employment_status,
    40
  ).toLowerCase();

  if (employmentStatus !== "active") {
    return {
      code: "inactive",
      label: "INACTIVE CREDENTIAL",
      message:
        "This worker record is not currently active in the Chalin 03 system.",
    };
  }

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const issued = profile.id_card_issue_date
    ? new Date(profile.id_card_issue_date).getTime()
    : null;
  const expires = profile.id_card_expiry_date
    ? new Date(profile.id_card_expiry_date).getTime()
    : null;

  if (issued && issued > todayUtc) {
    return {
      code: "pending",
      label: "NOT YET VALID",
      message: "This card's issue date has not yet been reached.",
    };
  }

  if (!expires || expires < todayUtc) {
    return {
      code: "expired",
      label: "EXPIRED CREDENTIAL",
      message:
        "This card has expired or does not have a valid expiry date.",
    };
  }

  return {
    code: "valid",
    label: "VALID CHALIN 03 CREDENTIAL",
    message:
      "The signed card details match an active Chalin 03 worker record.",
  };
}

function workspaceLabel(assignment) {
  if (!assignment) return "Group Operations";

  const workspace = titleCase(
    assignment.workspace_code || "operations"
  );
  const context = cleanText(assignment.context_label, 100);

  return context ? `${workspace} · ${context}` : workspace;
}

function renderPage({
  companyName,
  companyAddress,
  companyPhone,
  profile,
  assignment,
  state,
}) {
  const logo = logoDataUri();
  const verifiedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  });
  const showDetails =
    state.code !== "invalid" && Boolean(profile.id);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chalin 03 Staff Card Verification</title>
  <style>
    :root {
      color-scheme: light;
      --navy: #07182c;
      --gold: #d9ad24;
      --text: #102033;
      --muted: #5c6b7c;
      --line: #d8e0e9;
      --paper: #f5f7fa;
      --valid: #17823b;
      --danger: #a61b1b;
      --warning: #9a6700;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 22px;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 10%, rgba(217, 173, 36, .14), transparent 34%),
        linear-gradient(145deg, #eef2f7, #ffffff 55%, #e9eef5);
    }

    .card {
      width: min(100%, 720px);
      overflow: hidden;
      border: 1px solid rgba(7, 24, 44, .16);
      border-radius: 22px;
      background: white;
      box-shadow: 0 28px 70px rgba(7, 24, 44, .18);
    }

    header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 22px 26px;
      color: white;
      background: var(--navy);
      border-bottom: 4px solid var(--gold);
    }

    header img,
    .logo-fallback {
      width: 62px;
      height: 62px;
      object-fit: contain;
      border: 1px solid var(--gold);
      border-radius: 13px;
      background: #07182c;
    }

    .logo-fallback {
      display: grid;
      place-items: center;
      color: var(--gold);
      font-weight: 900;
    }

    header h1 {
      margin: 0;
      font-size: clamp(20px, 4vw, 30px);
      letter-spacing: .02em;
    }

    header p {
      margin: 6px 0 0;
      color: var(--gold);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    main { padding: 28px; }

    .status {
      padding: 17px 20px;
      border-radius: 15px;
      background: var(--paper);
      border-left: 6px solid var(--muted);
    }

    .status.valid { border-left-color: var(--valid); }
    .status.invalid,
    .status.inactive,
    .status.expired { border-left-color: var(--danger); }
    .status.pending { border-left-color: var(--warning); }

    .status strong {
      display: block;
      font-size: 20px;
      color: var(--navy);
    }

    .status span {
      display: block;
      margin-top: 7px;
      color: var(--muted);
      line-height: 1.55;
    }

    dl {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 13px;
      margin: 24px 0 0;
    }

    dl div {
      min-width: 0;
      padding: 14px 15px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: linear-gradient(145deg, #ffffff, #f7f9fb);
    }

    dt {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    dd {
      margin: 7px 0 0;
      overflow-wrap: anywhere;
      color: var(--navy);
      font-size: 16px;
      font-weight: 800;
    }

    .notice {
      margin: 24px 0 0;
      padding-top: 18px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }

    footer {
      padding: 15px 26px;
      color: white;
      background: var(--navy);
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 620px) {
      body { padding: 12px; }
      header, main { padding: 20px; }
      dl { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <article class="card">
    <header>
      ${
        logo
          ? `<img src="${logo}" alt="Chalin 03 logo" />`
          : '<div class="logo-fallback">C03</div>'
      }
      <div>
        <h1>${html(companyName)}</h1>
        <p>Official staff card verification</p>
      </div>
    </header>

    <main>
      <section class="status ${html(state.code)}">
        <strong>${html(state.label)}</strong>
        <span>${html(state.message)}</span>
      </section>

      ${
        showDetails
          ? `<dl>
        <div>
          <dt>Employee name</dt>
          <dd>${html(profile.full_name || "Not available")}</dd>
        </div>
        <div>
          <dt>Employee number</dt>
          <dd>${html(profile.employee_number || "Not available")}</dd>
        </div>
        <div>
          <dt>Role / title</dt>
          <dd>${html(profile.job_title || "Staff member")}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>${html(profile.department || "Group Operations")}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>${html(workspaceLabel(assignment))}</dd>
        </div>
        <div>
          <dt>Card serial</dt>
          <dd>${html(
            profile.id_card_serial ||
              profile.employee_number ||
              "Not available"
          )}</dd>
        </div>
        <div>
          <dt>Issue date</dt>
          <dd>${html(formatDate(profile.id_card_issue_date))}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>${html(formatDate(profile.id_card_expiry_date))}</dd>
        </div>
      </dl>`
          : `<p class="notice">No worker details are displayed unless the QR signature is valid.</p>`
      }

      <p class="notice">
        This page confirms a signed Chalin 03 corporate credential only. It is not a Ghana Card, ECOWAS identity card, passport, travel document or government identity record. Verification performed ${html(
          verifiedAt
        )}.
      </p>
    </main>

    <footer>
      ${html(companyAddress)} · ${html(companyPhone)} · chalin03.com
    </footer>
  </article>
</body>
</html>`;
}

router.get(
  "/worker-card-verification/:serial",
  async (req, res, next) => {
    try {
      const serial = cleanText(req.params.serial, 80);
      const signature = cleanText(req.query.sig, 100);

      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      );

      const [profileRows] = await pool.query(
        `SELECT
           id,
           full_name,
           employee_number,
           id_card_serial,
           job_title,
           department,
           employment_status,
           id_card_issue_date,
           id_card_expiry_date
         FROM worker_profiles
         WHERE id_card_serial = ?
            OR employee_number = ?
         LIMIT 1`,
        [serial, serial]
      );

      const profile = profileRows[0] || {};
      const signatureValid =
        profile.id &&
        verifyWorkerCardSignature(profile, signature);

      const [[assignmentRows], [settingsRows]] = profile.id
        ? await Promise.all([
            pool.query(
              `SELECT workspace_code, context_label
               FROM worker_assignments
               WHERE worker_id = ?
                 AND is_active = TRUE
               ORDER BY id DESC
               LIMIT 1`,
              [profile.id]
            ),
            pool.query(
              `SELECT
                 business_name,
                 business_address,
                 business_phone,
                 owner_phone
               FROM settings
               ORDER BY
                 CASE WHEN branch_id = 1 THEN 0 ELSE 1 END,
                 id ASC
               LIMIT 1`
            ),
          ])
        : [[[]], [[]]];

      const settings = settingsRows[0] || {};
      const state = cardState(profile, Boolean(signatureValid));
      const statusCode = signatureValid ? 200 : 404;

      return res
        .status(statusCode)
        .type("html")
        .send(
          renderPage({
            companyName:
              settings.business_name ||
              "Chalin 03 Company Limited",
            companyAddress:
              settings.business_address ||
              "Dunkwa Police Barrier, Ghana",
            companyPhone:
              settings.business_phone ||
              settings.owner_phone ||
              "0249469080",
            profile,
            assignment: assignmentRows[0] || null,
            state,
          })
        );
    } catch (error) {
      return next(error);
    }
  }
);

router.use("/verification", payrollPayslipVerificationRoutes);

module.exports = router;