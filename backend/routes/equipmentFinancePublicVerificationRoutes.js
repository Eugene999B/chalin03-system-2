const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("node:fs");
const path = require("node:path");

const {
  FinanceVerificationError,
  verifyFinanceDocument,
} = require("../services/equipmentFinanceVerificationService");

const router = express.Router();

const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many verification requests. Please wait briefly and scan again.",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function logoDataUrl() {
  const candidates = [
    path.resolve(__dirname, "..", "assets", "chalin03-logo.png"),
    path.resolve(__dirname, "..", "..", "frontend", "public", "chalin03-logo.png"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return `data:image/png;base64,${fs.readFileSync(candidate).toString("base64")}`;
      }
    } catch {
      // Continue to the text-only brand treatment below.
    }
  }
  return "";
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "Not published";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function statusTheme(code) {
  if (code === "verified") {
    return {
      className: "verified",
      icon: "✓",
      eyebrow: "AUTHENTIC CHALIN 03 RECORD",
      title: "Document Verified",
      message:
        "This QR matches a current document in the Chalin 03 Equipment Installment Finance issue register and is bound to the issuance fingerprint recorded with that document.",
    };
  }
  if (code === "superseded") {
    return {
      className: "warning",
      icon: "↻",
      eyebrow: "VALID HISTORICAL RECORD",
      title: "Document Superseded",
      message:
        "This was issued by Chalin 03, but a newer active version exists. Use the latest issued document for current decisions.",
    };
  }
  if (code === "revoked") {
    return {
      className: "danger",
      icon: "!",
      eyebrow: "WITHDRAWN RECORD",
      title: "Document Revoked",
      message:
        "This document exists in the Chalin 03 issue history but is no longer an active record.",
    };
  }
  return {
    className: "danger",
    icon: "×",
    eyebrow: "VERIFICATION WARNING",
    title: "Verification Failed",
    message: "This reference could not be confirmed as a current Chalin 03 issued record.",
  };
}

function factValue(fact) {
  if (fact.amount !== undefined) return money(fact.amount);
  if (fact.kind === "date") return dateLabel(fact.value);
  return String(fact.value ?? "Not published");
}

function financialFactsHtml(facts = []) {
  if (!facts.length) return "";
  return `
    <section class="panel">
      <div class="section-kicker">SAFE FINANCIAL FACTS</div>
      <div class="fact-grid">
        ${facts
          .map(
            (fact) => `
              <div class="fact">
                <span>${escapeHtml(fact.label)}</span>
                <strong>${escapeHtml(factValue(fact))}</strong>
              </div>`
          )
          .join("")}
      </div>
    </section>`;
}

function renderVerifiedPage(result) {
  const theme = statusTheme(result.status.code);
  const logo = logoDataUrl();
  const replacement = result.status.replacement_document_number
    ? `<p class="replacement">Latest active record: <strong>${escapeHtml(
        result.status.replacement_document_number
      )}</strong></p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <title>Chalin 03 Document Verification</title>
  <style>
    :root{color-scheme:light;--green:#063d2c;--deep:#032a20;--gold:#d2a83a;--ink:#14231c;--muted:#68756f;--line:#d8e0dc;--paper:#fffdf8;--bg:#eef3f0;--danger:#8f2f2f;--warning:#8a6718}
    *{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at top right,#f5e9bf 0,transparent 28%),linear-gradient(180deg,#eef5f1,#e6ece8);color:var(--ink);min-height:100vh}
    .shell{width:min(920px,calc(100% - 28px));margin:0 auto;padding:28px 0 48px}.brand{display:flex;align-items:center;gap:14px;margin-bottom:20px}.brand img{width:58px;height:58px;border-radius:16px;box-shadow:0 8px 24px rgba(3,42,32,.16)}.brand h1{font-size:15px;letter-spacing:.12em;margin:0;color:var(--deep)}.brand p{margin:4px 0 0;color:var(--muted);font-weight:700;font-size:12px}
    .hero{position:relative;overflow:hidden;border-radius:28px;padding:30px;background:linear-gradient(135deg,var(--deep),#0b543d);color:white;box-shadow:0 22px 55px rgba(3,42,32,.2)}.hero:after{content:"";position:absolute;width:260px;height:260px;border:1px solid rgba(210,168,58,.28);border-radius:50%;right:-75px;top:-90px;box-shadow:0 0 0 34px rgba(210,168,58,.06),0 0 0 68px rgba(210,168,58,.04)}.status{position:relative;z-index:1;display:grid;grid-template-columns:68px 1fr;gap:18px;align-items:center}.status-icon{width:68px;height:68px;border-radius:20px;display:grid;place-items:center;font-size:32px;font-weight:900;background:#fff;color:var(--green);box-shadow:inset 0 0 0 2px rgba(210,168,58,.45)}.hero.warning .status-icon{color:var(--warning)}.hero.danger .status-icon{color:var(--danger)}.eyebrow{font-size:11px;font-weight:900;letter-spacing:.16em;color:#efd98e}.hero h2{font-size:clamp(28px,5vw,46px);line-height:1;margin:6px 0 10px}.hero p{max-width:690px;margin:0;color:#d7e6df;line-height:1.6}.replacement{margin-top:12px!important;color:#ffe9a9!important}
    .doc-number{position:relative;z-index:1;margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,.16);display:flex;gap:14px;flex-wrap:wrap;justify-content:space-between;align-items:end}.doc-number span{display:block;color:#afc9bd;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em}.doc-number strong{display:block;margin-top:5px;font-size:18px;color:white}
    .panel{background:rgba(255,253,248,.96);border:1px solid rgba(216,224,220,.94);border-radius:22px;padding:22px;margin-top:18px;box-shadow:0 12px 35px rgba(19,44,32,.06)}.section-kicker{font-size:10px;color:#237558;font-weight:900;letter-spacing:.15em;margin-bottom:14px}.fact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fact{padding:15px;border:1px solid var(--line);border-radius:15px;background:white}.fact span{display:block;font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.07em}.fact strong{display:block;margin-top:7px;font-size:15px;overflow-wrap:anywhere}.privacy{margin-top:18px;padding:16px 18px;border-radius:16px;background:#e8f2ed;color:#214b3a;font-size:12px;line-height:1.6}.fingerprint{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.footer{text-align:center;color:#718078;font-size:11px;line-height:1.7;margin-top:24px;padding:0 12px}
    @media(max-width:640px){.shell{width:min(100% - 18px,920px);padding-top:12px}.brand{padding:4px 4px 0}.brand img{width:48px;height:48px;border-radius:13px}.hero{padding:22px;border-radius:22px}.status{grid-template-columns:54px 1fr;gap:13px}.status-icon{width:54px;height:54px;border-radius:16px;font-size:25px}.hero h2{font-size:30px}.doc-number{display:grid;gap:13px}.panel{padding:16px;border-radius:18px}.fact-grid{grid-template-columns:1fr}.fact{padding:13px}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="brand">
      ${logo ? `<img src="${logo}" alt="Chalin 03 Company Limited" />` : ""}
      <div><h1>CHALIN 03 COMPANY LIMITED</h1><p>Secure Document Verification Centre</p></div>
    </header>

    <section class="hero ${theme.className}">
      <div class="status">
        <div class="status-icon">${theme.icon}</div>
        <div>
          <div class="eyebrow">${theme.eyebrow}</div>
          <h2>${theme.title}</h2>
          <p>${theme.message}</p>
          ${replacement}
        </div>
      </div>
      <div class="doc-number">
        <div><span>Document number</span><strong>${escapeHtml(result.document.document_number)}</strong></div>
        <div><span>Document type</span><strong>${escapeHtml(result.document.document_title)}</strong></div>
      </div>
    </section>

    <section class="panel">
      <div class="section-kicker">ISSUED RECORD</div>
      <div class="fact-grid">
        <div class="fact"><span>Issue date</span><strong>${escapeHtml(dateLabel(result.document.issued_at))}</strong></div>
        <div class="fact"><span>Agreement</span><strong>${escapeHtml(result.agreement.agreement_number)}</strong></div>
        <div class="fact"><span>Customer</span><strong>${escapeHtml(result.agreement.customer_name)}</strong></div>
        <div class="fact"><span>Customer phone</span><strong>${escapeHtml(result.agreement.customer_phone)}</strong></div>
        <div class="fact"><span>Machine</span><strong>${escapeHtml(`${result.agreement.machine_code} — ${result.agreement.machine_name}`)}</strong></div>
        <div class="fact"><span>Machine serial</span><strong>${escapeHtml(result.agreement.serial_number)}</strong></div>
        <div class="fact"><span>Template</span><strong>${escapeHtml(result.document.template_version)}</strong></div>
        <div class="fact"><span>Issuance fingerprint</span><strong class="fingerprint">${escapeHtml(result.document.checksum_fingerprint)}</strong></div>
      </div>
    </section>

    ${financialFactsHtml(result.financial_facts)}

    <div class="privacy">
      <strong>Privacy protection:</strong> this public page intentionally masks sensitive identity and contact information. Ghana Card numbers, addresses, uploaded KYC evidence, signatures and confidential source documents are never exposed here.
    </div>

    <footer class="footer">
      Verification matches this QR reference to the Chalin 03 issued-document register and the SHA-256 fingerprint recorded at issuance.<br />
      This page confirms the system record and its current/revoked/superseded status; it does not replace legal review of the underlying transaction.
    </footer>
  </main>
</body>
</html>`;
}

function renderFailurePage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Chalin 03 Verification</title><style>body{margin:0;background:#edf2ef;color:#17231d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center}.card{width:min(620px,calc(100% - 28px));background:#fffdf8;border:1px solid #d8e0dc;border-radius:24px;padding:30px;box-shadow:0 20px 50px rgba(3,42,32,.12)}.mark{width:60px;height:60px;border-radius:18px;background:#8f2f2f;color:white;display:grid;place-items:center;font-size:30px;font-weight:900}.eyebrow{margin-top:20px;color:#8f2f2f;font-weight:900;font-size:11px;letter-spacing:.14em}.card h1{font-size:32px;margin:7px 0 10px}.card p{color:#68756f;line-height:1.6}.brand{margin-top:24px;padding-top:18px;border-top:1px solid #e1e7e3;font-size:12px;font-weight:900;color:#063d2c;letter-spacing:.08em}</style></head><body><main class="card"><div class="mark">×</div><div class="eyebrow">CHALIN 03 DOCUMENT VERIFICATION</div><h1>Verification could not be completed</h1><p>${escapeHtml(message)}</p><div class="brand">CHALIN 03 COMPANY LIMITED</div></main></body></html>`;
}

router.get("/:documentId/:token", verificationLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  try {
    const result = await verifyFinanceDocument({
      documentId: req.params.documentId,
      token: req.params.token,
    });
    const statusCode = result.status.code === "verified" ? 200 : 410;
    return res.status(statusCode).type("html").send(renderVerifiedPage(result));
  } catch (error) {
    const statusCode =
      error instanceof FinanceVerificationError
        ? Number(error.statusCode || 404)
        : 500;
    if (!(error instanceof FinanceVerificationError)) {
      console.error("Finance document verification error:", error);
    }
    return res
      .status(statusCode)
      .type("html")
      .send(
        renderFailurePage(
          error instanceof FinanceVerificationError
            ? error.message
            : "The verification service is temporarily unavailable. Please scan again shortly."
        )
      );
  }
});

module.exports = router;
