const QRCode = require("qrcode");
const {
  COLORS,
  agreementOf,
  clean,
  customerName,
  dateLabel,
  dateTimeLabel,
  escapeHtml,
  label,
  machineName,
  money,
  officialLogoDataUrl,
  templateFor,
  verificationPayload,
} = require("./equipmentFinanceDocumentDesignV2Service");

function facts(entries) {
  return `<div class="facts">${entries
    .filter((entry) => entry?.[1] !== undefined && entry?.[1] !== null)
    .map(([name, value]) => `<div class="fact"><small>${escapeHtml(name)}</small><strong>${escapeHtml(clean(value))}</strong></div>`)
    .join("")}</div>`;
}

function schedule(rows = []) {
  return `<table><thead><tr><th>No.</th><th>Due date</th><th>Scheduled</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows
    .map((row) => `<tr><td>${escapeHtml(row.sequence_number)}</td><td>${escapeHtml(dateLabel(row.due_date))}</td><td>${escapeHtml(money(row.scheduled_amount))}</td><td>${escapeHtml(money(row.amount_paid))}</td><td>${escapeHtml(money(row.balance))}</td><td>${escapeHtml(label(row.schedule_status))}</td></tr>`)
    .join("")}</tbody></table>`;
}

function section(title, content, accent) {
  return `<section><h3 style="background:${accent}">${escapeHtml(title)}</h3>${content}</section>`;
}

function body(document) {
  const template = templateFor(document);
  const agreement = agreementOf(document);
  const context = document.snapshot?.document_context || {};
  const summary = facts([
    ["Customer", customerName(document)],
    ["Agreement", agreement.agreement_number],
    ["Equipment", machineName(document)],
    ["Purchase price", money(agreement.total_amount)],
    ["Total paid", money(agreement.amount_paid)],
    ["Official balance", money(agreement.outstanding_balance)],
  ]);

  if (template.family === "receipt") {
    return `${section("Payment received", `<div class="amount">${escapeHtml(money(context.payment?.amount))}</div>${facts([
      ["Receipt", context.payment?.receipt_number || context.payment?.payment_number],
      ["Date", dateTimeLabel(context.payment?.payment_date)],
      ["Method", label(context.payment?.payment_method)],
      ["Reference", context.payment?.reference_number],
    ])}`, template.accent)}${summary}`;
  }
  if (template.family === "certificate") {
    return `<div class="certificate"><p>CHALIN 03 COMPANY LIMITED HEREBY CERTIFIES</p><h2>${escapeHtml(template.title)}</h2>${summary}<p>${document.document_type === "settlement_confirmation" ? "The reconciled installment obligation has been fully settled." : "The controlled ownership-transfer record authorises transfer of the identified equipment."}</p></div>`;
  }
  if (template.family === "statement") {
    return `${summary}${section("Payment history", `<table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead><tbody>${(document.snapshot?.payments || []).map((row) => `<tr><td>${escapeHtml(row.receipt_number || row.payment_number)}</td><td>${escapeHtml(dateLabel(row.payment_date))}</td><td>${escapeHtml(label(row.payment_method))}</td><td>${escapeHtml(money(row.amount))}</td></tr>`).join("")}</tbody></table>`, template.accent)}${section("Remaining schedule", schedule((document.snapshot?.schedule || []).filter((row) => Number(row.balance || 0) > 0.005)), template.accent)}`;
  }
  return `${summary}${section("Document-specific record", facts([
    ["Classification", template.classification],
    ["Payment plan", `${agreement.installment_count || 0} ${label(agreement.payment_frequency)}`],
    ["First due date", dateLabel(agreement.first_due_date)],
    ["Final due date", dateLabel(agreement.final_due_date)],
  ]), template.accent)}${["legal", "schedule"].includes(template.family) ? section("Official installment schedule", schedule(document.snapshot?.schedule || []), template.accent) : ""}${template.family === "legal" ? section("Terms and conditions", `<p>${escapeHtml(document.snapshot?.policy?.agreement_terms || "")}</p>`, template.accent) : ""}`;
}

async function renderCompletionWord(document) {
  const template = templateFor(document);
  const company = document.snapshot?.company || {};
  const logo = officialLogoDataUrl();
  const qr = await QRCode.toDataURL(verificationPayload(document), {
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  return Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.document_number)}</title><style>
  @page{size:A4;margin:14mm 15mm 16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:${COLORS.ink};font-size:9.5pt;line-height:1.45;margin:0}.watermark{position:fixed;top:42%;left:5%;width:90%;transform:rotate(-31deg);font-size:42pt;font-weight:900;text-align:center;color:${template.accent};opacity:.13;z-index:-1}.rule{height:12px;background:${COLORS.navy};border-bottom:4px solid ${COLORS.gold}}.head{display:flex;align-items:center;gap:16px;padding:14px 0 9px;border-bottom:2px solid ${COLORS.gold}}.head img{width:82px;height:82px;object-fit:contain}.company{flex:1;text-align:center}.company h1{margin:0;color:${COLORS.navy};font-size:20pt}.company p{margin:5px 0;color:${COLORS.muted};font-size:8pt}.badge{padding:7px 11px;background:${template.accent};color:#fff;border-radius:5px;font-weight:800;font-size:7pt}.title{text-align:center;padding:16px 0}.title h2{margin:0;color:${template.accent};font-size:18pt}.facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.fact{padding:10px;border:1px solid ${COLORS.line};border-left:5px solid ${template.accent};border-radius:6px;background:${template.accentSoft}}.fact small{display:block;color:${COLORS.muted};font-weight:800;text-transform:uppercase;font-size:6.7pt}.fact strong{display:block;margin-top:4px}section{margin:14px 0}section h3{margin:0 0 8px;padding:7px 10px;border-radius:5px;color:#fff;font-size:9pt;text-transform:uppercase}table{width:100%;border-collapse:collapse;font-size:7.4pt}th{padding:7px;background:${template.accent};color:#fff;text-align:left}td{padding:6px;border-bottom:1px solid ${COLORS.line}}tr:nth-child(even) td{background:${COLORS.ash}}.amount{font-size:30pt;text-align:center;color:${COLORS.emerald};font-weight:900;padding:18px}.certificate{border:5px double ${template.accent};padding:45px 34px;text-align:center}.certificate h2{font-family:Georgia,serif;font-size:28pt;color:${template.accent}}.verify{margin-top:18px;padding:12px;border:1px solid ${COLORS.line};background:${COLORS.ash};display:flex;gap:12px;align-items:center;page-break-inside:avoid}.verify img{width:82px}.verify code{font-size:6pt;word-break:break-all}.footer{margin-top:18px;padding-top:8px;border-top:1px solid ${COLORS.gold};text-align:center;color:${COLORS.muted};font-size:6.5pt;font-weight:700}
  </style></head><body><div class="watermark">${escapeHtml(template.watermark)}</div><div class="rule"></div><div class="head">${logo ? `<img src="${logo}" alt="Official Chalin 03 logo">` : ""}<div class="company"><h1>${escapeHtml(clean(company.name, "CHALIN 03 COMPANY LIMITED"))}</h1><p>${escapeHtml([company.phone, company.email, company.postal_address || company.address].filter(Boolean).join(" • "))}</p></div><div class="badge">${escapeHtml(template.classification)}</div></div><div class="title"><h2>${escapeHtml(template.title)}</h2><p>${escapeHtml(template.subtitle)} • ${escapeHtml(document.document_number)} • Agreement ${escapeHtml(clean(agreementOf(document).agreement_number))}</p></div>${body(document)}<div class="verify"><img src="${qr}" alt="Verification QR"><div><strong>DOCUMENT AUTHENTICITY & TAMPER-EVIDENT VERIFICATION</strong><br><code>${escapeHtml(verificationPayload(document))}</code></div></div><div class="footer">CHALIN 03 COMPANY LIMITED • SYSTEM-GENERATED • TAMPER-EVIDENT • SHA ${escapeHtml(clean(document.snapshot_checksum, "").slice(0, 24))}</div></body></html>`, "utf8");
}

module.exports = { renderCompletionWord };
