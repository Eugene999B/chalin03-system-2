const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("node:fs");
const path = require("node:path");

const { publicPayslipVerification } = require("../services/payrollPayslipService");

const router = express.Router();
const LOGO_PATH = path.resolve(__dirname, "..", "assets", "chalin03-logo.png");

const verificationLimiter = rateLimit({
  windowMs: Math.max(1, Number(process.env.VERIFICATION_RATE_LIMIT_WINDOW_MINUTES) || 15) * 60 * 1000,
  max: Math.max(20, Number(process.env.VERIFICATION_RATE_LIMIT_MAX) || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "VERIFICATION_RATE_LIMITED",
    message: "Too many verification requests. Please wait briefly and try again.",
  },
});

router.use(verificationLimiter);

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function html(value) {
  return cleanText(value, 1500)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, currency = "GHS") {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${currency} ${safe.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value, fallback = "Not recorded") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 50) || fallback;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Accra",
  });
}

function logoDataUri() {
  try {
    return `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString("base64")}`;
  } catch {
    return "";
  }
}

function statePresentation(result) {
  if (result.state === "current" && result.valid) {
    return { className: "current", label: "VERIFIED CHALIN 03 PAYSLIP", accent: "#16803c" };
  }
  if (result.state === "revoked") {
    return { className: "revoked", label: "REVOKED CHALIN 03 PAYSLIP", accent: "#a61b1b" };
  }
  if (result.state === "superseded") {
    return { className: "superseded", label: "SUPERSEDED CHALIN 03 PAYSLIP", accent: "#9a6700" };
  }
  return { className: "invalid", label: "PAYSLIP NOT VERIFIED", accent: "#a61b1b" };
}

function renderPage(result) {
  const presentation = statePresentation(result);
  const logo = logoDataUri();
  const showDetails = result.found && result.state !== "invalid" && !result.integrity_error;
  const verifiedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <title>Chalin 03 Payslip Verification</title>
  <style>
    :root { color-scheme: light; --navy:#07182c; --gold:#d6ad24; --text:#142033; --muted:#607083; --line:#d8e0e9; --paper:#f5f7fa; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:22px; font-family:Arial,Helvetica,sans-serif; color:var(--text); background:radial-gradient(circle at 12% 8%,rgba(214,173,36,.15),transparent 33%),linear-gradient(145deg,#eef2f7,#fff 58%,#e8edf4); }
    .card { width:min(100%,760px); overflow:hidden; border:1px solid rgba(7,24,44,.16); border-radius:22px; background:#fff; box-shadow:0 28px 70px rgba(7,24,44,.18); }
    header { display:flex; align-items:center; gap:16px; padding:22px 26px; color:#fff; background:var(--navy); border-bottom:4px solid var(--gold); }
    header img,.logo { width:62px; height:62px; object-fit:contain; border:1px solid var(--gold); border-radius:13px; background:var(--navy); }
    .logo { display:grid; place-items:center; color:var(--gold); font-weight:900; }
    header h1 { margin:0; font-size:clamp(20px,4vw,30px); letter-spacing:.02em; }
    header p { margin:6px 0 0; color:var(--gold); font-size:12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    main { padding:28px; }
    .status { padding:18px 20px; border-radius:15px; background:var(--paper); border-left:6px solid ${presentation.accent}; }
    .status strong { display:block; color:var(--navy); font-size:20px; }
    .status p { margin:8px 0 0; color:var(--muted); line-height:1.55; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:20px; }
    .item { padding:14px 16px; border:1px solid var(--line); border-radius:12px; background:#fff; }
    .item span { display:block; margin-bottom:6px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .item strong { display:block; color:var(--navy); font-size:16px; overflow-wrap:anywhere; }
    .privacy { margin-top:20px; padding:14px 16px; border-radius:12px; color:var(--muted); background:#f8fafc; font-size:12px; line-height:1.55; }
    footer { padding:17px 26px 22px; color:var(--muted); font-size:11px; text-align:center; border-top:1px solid var(--line); }
    @media (max-width:620px) { body{padding:10px}.grid{grid-template-columns:1fr}main{padding:20px}header{padding:18px} }
  </style>
</head>
<body>
  <article class="card">
    <header>
      ${logo ? `<img src="${logo}" alt="Chalin 03" />` : '<div class="logo">C03</div>'}
      <div><h1>Chalin 03 Verification Centre</h1><p>Payroll document authenticity</p></div>
    </header>
    <main>
      <section class="status ${presentation.className}">
        <strong>${html(presentation.label)}</strong>
        <p>${html(result.message || "The supplied verification reference does not match a valid Chalin 03 payslip record.")}</p>
      </section>
      ${showDetails ? `<section class="grid">
        <div class="item"><span>Employee</span><strong>${html(result.employee)}</strong></div>
        <div class="item"><span>Employee number</span><strong>${html(result.employee_number)}</strong></div>
        <div class="item"><span>Payroll period</span><strong>${html(result.period)}</strong></div>
        <div class="item"><span>Net pay</span><strong>${html(money(result.net_pay,result.currency))}</strong></div>
        <div class="item"><span>Payslip ID</span><strong>${html(`${result.payslip_number} · v${result.issue_version}`)}</strong></div>
        <div class="item"><span>Issue date</span><strong>${html(formatDate(result.issued_at))}</strong></div>
      </section>` : ""}
      <div class="privacy">For privacy, this public page intentionally shows only the limited identity and payroll fields required to verify the document. Bank or mobile-money destinations, deductions and detailed payroll lines are not exposed here.</div>
    </main>
    <footer>Verification checked ${html(verifiedAt)} · Chalin 03 Company Limited</footer>
  </article>
</body>
</html>`;
}

router.get("/payroll-payslip/:reference", async (req, res, next) => {
  try {
    const result = await publicPayslipVerification(req.params.reference);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    return res.status(result.found ? 200 : 404).send(renderPage(result));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;