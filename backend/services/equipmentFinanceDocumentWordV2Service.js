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
    .map(([name, value]) => `<div class="fact"><span class="dot"></span><div><small>${escapeHtml(name)}</small><strong>${escapeHtml(clean(value))}</strong></div></div>`)
    .join("")}</div>`;
}

function schedule(rows = []) {
  return `<table><thead><tr><th>No.</th><th>Due date</th><th>Scheduled</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows
    .map((row) => `<tr><td>${escapeHtml(row.sequence_number)}</td><td>${escapeHtml(dateLabel(row.due_date))}</td><td>${escapeHtml(money(row.scheduled_amount))}</td><td>${escapeHtml(money(row.amount_paid))}</td><td>${escapeHtml(money(row.balance))}</td><td>${escapeHtml(label(row.schedule_status))}</td></tr>`)
    .join("")}</tbody></table>`;
}

function section(title, content, accent) {
  return `<section><div class="section-title" style="background:${accent}"><span></span>${escapeHtml(title)}</div><div class="section-rule"></div>${content}</section>`;
}

function summaryCards(entries, accent) {
  return `<div class="summary">${entries.map(([name, value]) => `<div class="summary-card"><div class="summary-head" style="background:${accent}">${escapeHtml(name)}</div><div class="summary-value">${escapeHtml(clean(value))}</div></div>`).join("")}</div>`;
}

function body(document) {
  const template = templateFor(document);
  const agreement = agreementOf(document);
  const context = document.snapshot?.document_context || {};
  const summary = summaryCards([
    ["Purchase price", money(agreement.total_amount)],
    ["Total paid", money(agreement.amount_paid)],
    ["Official balance", money(agreement.outstanding_balance)],
    ["Payment plan", `${agreement.installment_count || 0} ${label(agreement.payment_frequency)}`],
  ], template.accent);

  if (template.family === "receipt") {
    return `<div class="receipt-grid"><div class="amount-panel"><small>AMOUNT PAID</small><div>${escapeHtml(money(context.payment?.amount))}</div><b>PAYMENT RECEIVED</b></div><div class="receipt-facts">${facts([
      ["Receipt", context.payment?.receipt_number || context.payment?.payment_number],
      ["Date", dateTimeLabel(context.payment?.payment_date)],
      ["Method", label(context.payment?.payment_method)],
      ["Reference", context.payment?.reference_number],
      ["Customer", customerName(document)],
      ["Equipment", machineName(document)],
    ])}</div></div>${section("Oldest-due-first allocation", `<table><thead><tr><th>Installment</th><th>Due date</th><th>Allocated</th></tr></thead><tbody>${(context.payment_allocations || []).map((row) => `<tr><td>${escapeHtml(row.sequence_number)}</td><td>${escapeHtml(dateLabel(row.due_date))}</td><td>${escapeHtml(money(row.allocated_amount))}</td></tr>`).join("")}</tbody></table>`, template.accent)}`;
  }

  if (template.family === "certificate") {
    return `<div class="certificate"><div class="cert-kicker">CHALIN 03 COMPANY LIMITED HEREBY CERTIFIES</div><h2>${escapeHtml(template.title)}</h2><div class="cert-word">${escapeHtml(template.watermark)}</div>${facts([
      [document.document_type === "settlement_confirmation" ? "Customer" : "New owner", customerName(document)],
      ["Agreement", agreement.agreement_number],
      ["Equipment", machineName(document)],
      ["Serial / chassis", agreement.serial_number || agreement.chassis_number],
      [document.document_type === "settlement_confirmation" ? "Official balance" : "Transfer record", document.document_type === "settlement_confirmation" ? money(agreement.outstanding_balance) : context.ownership_transfer?.transfer_number],
    ])}<p>${document.document_type === "settlement_confirmation" ? "The reconciled installment obligation has been fully settled and the official account balance is zero." : "The controlled ownership-transfer record authorises transfer of the identified equipment."}</p><div class="seal">OFFICIAL<br>VERIFIED</div></div>`;
  }

  if (template.family === "statement") {
    return `${summary}${facts([
      ["Customer", customerName(document)],
      ["Agreement", agreement.agreement_number],
      ["Equipment", machineName(document)],
      ["Statement date", dateLabel(document.snapshot?.generated_at)],
    ])}${section("Payment history", `<table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead><tbody>${(document.snapshot?.payments || []).map((row) => `<tr><td>${escapeHtml(row.receipt_number || row.payment_number)}</td><td>${escapeHtml(dateLabel(row.payment_date))}</td><td>${escapeHtml(label(row.payment_method))}</td><td>${escapeHtml(money(row.amount))}</td></tr>`).join("")}</tbody></table>`, template.accent)}${section("Remaining schedule", schedule((document.snapshot?.schedule || []).filter((row) => Number(row.balance || 0) > 0.005)), template.accent)}`;
  }

  return `${summary}${facts([
    ["Customer", customerName(document)],
    ["Agreement", agreement.agreement_number],
    ["Equipment", machineName(document)],
    ["Classification", template.classification],
    ["First due date", dateLabel(agreement.first_due_date)],
    ["Final due date", dateLabel(agreement.final_due_date)],
  ])}${["legal", "schedule"].includes(template.family) ? section("Official installment schedule", schedule(document.snapshot?.schedule || []), template.accent) : ""}${template.family === "legal" ? section("Approved terms and conditions", `<div class="legal-copy">${escapeHtml(document.snapshot?.policy?.agreement_terms || "")}</div>`, template.accent) : ""}`;
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
  @page{size:A4;margin:10mm 12mm 14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:${COLORS.ink};font-size:9pt;line-height:1.42;margin:0;background:${COLORS.ivory}}.watermark-logo{position:fixed;top:31%;left:29%;width:42%;opacity:.045;z-index:-2}.watermark-text{position:fixed;top:55%;left:4%;width:92%;font-family:Georgia,serif;font-size:38pt;font-weight:800;text-align:center;color:${template.accent};transform:rotate(-20deg);opacity:.055;z-index:-1}.mast{position:relative;background:${COLORS.forestDeep};color:#fff;padding:14px 18px 22px;border-bottom:5px solid ${COLORS.gold};overflow:hidden}.mast:after{content:"";position:absolute;left:-5%;right:-5%;bottom:-20px;height:35px;background:${COLORS.ivory};border-radius:50% 50% 0 0}.brand{display:flex;align-items:center;gap:15px}.brand img{width:76px;height:76px;object-fit:contain}.brand-copy{flex:1}.brand-copy h1{font-family:Georgia,serif;margin:0;font-size:20pt;letter-spacing:.4px}.brand-copy p{margin:5px 0 0;color:${COLORS.goldBright};font-weight:700;letter-spacing:1.4px;font-size:7pt}.meta{width:165px;border:1px solid ${COLORS.gold};border-radius:9px;padding:8px;text-align:right;background:#073429}.meta small{display:block;color:${COLORS.goldBright};font-weight:800;font-size:6pt}.meta b{display:block;margin:2px 0 6px;font-size:7pt}.title{text-align:center;padding:20px 0 12px}.title h2{font-family:Georgia,serif;margin:0;color:${template.accent};font-size:19pt}.title p{margin:6px 0 0;color:${COLORS.goldDark};font-size:7pt;font-weight:800;letter-spacing:1px}.badge{display:inline-block;margin-top:8px;padding:5px 18px;background:${template.accent};color:#fff;border-radius:15px;font-size:6pt;font-weight:800}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.summary-card{border:1px solid ${COLORS.line};border-radius:8px;background:#fff;overflow:hidden;text-align:center}.summary-head{padding:6px;color:${COLORS.goldBright};font-size:6pt;font-weight:800;text-transform:uppercase}.summary-value{padding:12px 7px;color:${template.accent};font-size:10pt;font-weight:900}.facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:11px 0}.fact{display:flex;gap:8px;align-items:center;padding:10px;border:1px solid ${COLORS.line};border-top:3px solid ${template.accent};border-radius:7px;background:#fff}.dot{width:12px;height:12px;border-radius:50%;background:${COLORS.gold};flex:0 0 12px}.fact small{display:block;color:${COLORS.muted};font-weight:800;text-transform:uppercase;font-size:6pt}.fact strong{display:block;margin-top:3px}.section-title{display:inline-block;margin:0;padding:7px 14px;border-radius:6px;color:#fff;font-size:8pt;font-weight:800;text-transform:uppercase}.section-title span{display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS.goldBright};margin-right:8px}.section-rule{height:1px;background:${COLORS.gold};margin:-13px 0 13px 170px}section{margin:16px 0}table{width:100%;border-collapse:collapse;font-size:7pt;background:#fff}th{padding:7px;background:${template.accent};color:#fff;text-align:left}td{padding:6px;border-bottom:1px solid ${COLORS.line}}tr:nth-child(even) td{background:${COLORS.ash}}.receipt-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:12px;margin:12px 0}.amount-panel{background:${COLORS.forestDeep};border-top:5px solid ${COLORS.gold};border-radius:12px;color:#fff;padding:25px 18px;text-align:center}.amount-panel small{color:${COLORS.goldBright};font-weight:800}.amount-panel div{font-family:Georgia,serif;font-size:28pt;margin:18px 0}.amount-panel b{display:block;background:${COLORS.gold};color:${COLORS.forestDeep};border-radius:18px;padding:7px}.receipt-facts .facts{grid-template-columns:1fr}.certificate{position:relative;border:5px double ${template.accent};padding:46px 34px;text-align:center;background:rgba(255,255,255,.75)}.certificate h2{font-family:Georgia,serif;font-size:28pt;color:${template.accent};margin:18px 0}.cert-kicker{color:${COLORS.goldDark};font-weight:800;letter-spacing:1px}.cert-word{font-family:Georgia,serif;font-size:45pt;color:${template.accent};opacity:.08;margin:20px}.seal{display:inline-flex;width:92px;height:92px;border-radius:50%;background:${COLORS.gold};border:8px double ${COLORS.goldBright};align-items:center;justify-content:center;color:${COLORS.forestDeep};font-weight:900;margin-top:15px}.legal-copy{white-space:pre-wrap;border-left:5px solid ${template.accent};padding:14px;background:#fff;border-radius:7px}.verify{margin-top:18px;padding:12px;background:${COLORS.forestDeep};color:#fff;border-left:7px solid ${COLORS.gold};border-radius:10px;display:flex;gap:14px;align-items:center;page-break-inside:avoid}.verify img{width:84px;background:#fff;padding:3px;border-radius:4px}.verify strong{color:${COLORS.goldBright}}.verify code{font-size:5.7pt;word-break:break-all;color:#dbe8e1}.footer{margin-top:15px;padding:10px;background:${COLORS.forestDeep};border-top:3px solid ${COLORS.gold};color:${COLORS.goldBright};text-align:center;font-size:6pt;font-weight:800}
  </style></head><body>${logo ? `<img class="watermark-logo" src="${logo}" alt="">` : ""}<div class="watermark-text">${escapeHtml(template.watermark)}</div><div class="mast"><div class="brand">${logo ? `<img src="${logo}" alt="Official Chalin 03 logo">` : ""}<div class="brand-copy"><h1>${escapeHtml(clean(company.name, "CHALIN 03 COMPANY LIMITED"))}</h1><p>EQUIPMENT • FINANCE • TRUST</p></div><div class="meta"><small>DOCUMENT NUMBER</small><b>${escapeHtml(document.document_number)}</b><small>AGREEMENT</small><b>${escapeHtml(clean(agreementOf(document).agreement_number))}</b></div></div></div><div class="title"><h2>${escapeHtml(template.title)}</h2><p>${escapeHtml(template.subtitle.toUpperCase())}</p><span class="badge">${escapeHtml(template.classification)}</span></div>${body(document)}<div class="verify"><img src="${qr}" alt="Verification QR"><div><strong>VERIFY THIS OFFICIAL CHALIN 03 DOCUMENT</strong><br><code>${escapeHtml(verificationPayload(document))}</code></div></div><div class="footer">SECURE • VERIFIED • SYSTEM-GENERATED • SHA ${escapeHtml(clean(document.snapshot_checksum, "").slice(0, 28))}</div></body></html>`, "utf8");
}

module.exports = { renderCompletionWord };