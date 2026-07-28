const BUSINESS_TIME_ZONE = "Africa/Accra";

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Number(numberValue(value).toFixed(2));
}

export function formatStatementMoney(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatStatementDate(value) {
  const date = validDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatStatementDateTime(value) {
  const date = validDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function dateInputValue(value) {
  const date = validDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function safeFilename(value) {
  return String(value || "statement")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "statement";
}

function statusLabel(value) {
  const status = String(value || "unpaid").toLowerCase();
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partially Paid";
  return "Unpaid";
}

function paymentMethodLabel(value) {
  const method = String(value || "-").toLowerCase();
  const labels = {
    cash: "Cash",
    momo: "Mobile Money",
    bank: "Bank",
    credit: "Credit",
    mixed: "Mixed",
  };
  return labels[method] || String(value || "-").toUpperCase();
}

function isOverdue(debt) {
  if (numberValue(debt?.balance) <= 0 || !debt?.due_date) return false;
  const dueDate = validDate(`${String(debt.due_date).slice(0, 10)}T23:59:59Z`);
  return Boolean(dueDate && dueDate < new Date());
}

function debtMatchesFilters(debt, filters = {}) {
  const businessDate = dateInputValue(debt.sale_date || debt.created_at);
  if (filters.from && businessDate && businessDate < filters.from) return false;
  if (filters.to && businessDate && businessDate > filters.to) return false;

  const selectedStatus = String(filters.debt_status || "").toLowerCase();
  if (!selectedStatus) return true;
  if (selectedStatus === "overdue") return isOverdue(debt);
  return String(debt.status || "unpaid").toLowerCase() === selectedStatus;
}

function periodLabel(filters = {}) {
  if (filters.from && filters.to) {
    return `${formatStatementDate(`${filters.from}T12:00:00Z`)} to ${formatStatementDate(`${filters.to}T12:00:00Z`)}`;
  }
  if (filters.from) return `From ${formatStatementDate(`${filters.from}T12:00:00Z`)}`;
  if (filters.to) return `Up to ${formatStatementDate(`${filters.to}T12:00:00Z`)}`;
  return "Complete account history";
}

function statementCode(storeCode, customerId) {
  const timestamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(/[^0-9]/g, "");
  return `CDS-${String(storeCode || "STORE").toUpperCase()}-${customerId || "CUSTOMER"}-${timestamp}`;
}

export function buildCustomerDebtStatement(detail, context = {}) {
  const debts = (detail?.debts || [])
    .filter((debt) => debtMatchesFilters(debt, context.filters))
    .sort(
      (left, right) =>
        new Date(left.sale_date || left.created_at) -
        new Date(right.sale_date || right.created_at)
    );

  const summary = debts.reduce(
    (result, debt) => {
      result.debt_count += 1;
      result.total_owed += numberValue(debt.amount_owed);
      result.total_paid += numberValue(debt.amount_paid);
      result.outstanding_balance += numberValue(debt.balance);
      result.item_lines += (debt.items || []).length;
      result.item_quantity += (debt.items || []).reduce(
        (sum, item) => sum + numberValue(item.quantity),
        0
      );
      result.payment_count += (debt.payments || []).length;
      if (isOverdue(debt)) result.overdue_count += 1;
      return result;
    },
    {
      debt_count: 0,
      total_owed: 0,
      total_paid: 0,
      outstanding_balance: 0,
      item_lines: 0,
      item_quantity: 0,
      payment_count: 0,
      overdue_count: 0,
    }
  );

  Object.keys(summary).forEach((key) => {
    if (["total_owed", "total_paid", "outstanding_balance"].includes(key)) {
      summary[key] = roundMoney(summary[key]);
    }
  });

  return {
    company_name: "Chalin 03 Company Limited",
    store_code: String(context.storeCode || "STORE").toUpperCase(),
    store_name: context.storeName || "Selected Store",
    statement_number: statementCode(context.storeCode, detail?.customer?.id),
    generated_at: new Date().toISOString(),
    period: periodLabel(context.filters),
    customer: {
      id: detail?.customer?.id || "-",
      name: detail?.customer?.name || "Customer",
      phone: detail?.customer?.phone || "-",
      location: detail?.customer?.location || "-",
    },
    summary,
    debts,
  };
}

function itemRows(debt) {
  if (!(debt.items || []).length) {
    return `<tr><td colspan="5" class="empty">No item breakdown is available for this older receipt.</td></tr>`;
  }

  return debt.items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(formatStatementDateTime(debt.sale_date || debt.created_at))}</td>
        <td>${escapeHtml(item.product_name || "Item")}</td>
        <td class="number">${escapeHtml(numberValue(item.quantity))}</td>
        <td class="money">${escapeHtml(formatStatementMoney(item.unit_price))}</td>
        <td class="money">${escapeHtml(formatStatementMoney(item.line_total))}</td>
      </tr>`
    )
    .join("");
}

function paymentRows(debt) {
  if (!(debt.payments || []).length) {
    return `<tr><td colspan="5" class="empty">No separate debt payment has been recorded for this receipt.</td></tr>`;
  }

  return debt.payments
    .map(
      (payment) => `<tr>
        <td>${escapeHtml(formatStatementDateTime(payment.paid_at))}</td>
        <td class="money">${escapeHtml(formatStatementMoney(payment.amount))}</td>
        <td>${escapeHtml(paymentMethodLabel(payment.payment_method))}</td>
        <td>${escapeHtml(payment.received_by_name || "-")}</td>
        <td>${escapeHtml(payment.notes || "-")}</td>
      </tr>`
    )
    .join("");
}

function debtSection(debt, index) {
  const purchaseDate = debt.sale_date || debt.created_at;
  return `<section class="receipt-block">
    <div class="receipt-heading">
      <div>
        <span class="eyebrow">Purchase ${index + 1}</span>
        <h2>Receipt ${escapeHtml(debt.receipt_number || "-")}</h2>
        <p>Debt ID: ${escapeHtml(debt.id || "-")} • Sale ID: ${escapeHtml(debt.sale_id || "-")}</p>
      </div>
      <span class="status ${escapeHtml(String(debt.status || "unpaid").toLowerCase())}">${escapeHtml(statusLabel(debt.status))}</span>
    </div>

    <div class="detail-grid">
      <div><span>Purchase Date & Time</span><strong>${escapeHtml(formatStatementDateTime(purchaseDate))}</strong></div>
      <div><span>Debt Recorded</span><strong>${escapeHtml(formatStatementDateTime(debt.created_at))}</strong></div>
      <div><span>Payment Due Date</span><strong>${escapeHtml(formatStatementDate(debt.due_date))}</strong></div>
      <div><span>Sold By</span><strong>${escapeHtml(debt.staff_name || "-")}</strong></div>
      <div><span>Original Payment Type</span><strong>${escapeHtml(paymentMethodLabel(debt.payment_type || "credit"))}</strong></div>
      <div><span>Overdue</span><strong>${isOverdue(debt) ? "Yes" : "No"}</strong></div>
    </div>

    <h3>Items / Materials Purchased</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Purchased At</th><th>Item / Material</th><th>Quantity</th><th>Unit Price</th><th>Line Total</th></tr></thead>
      <tbody>${itemRows(debt)}</tbody>
    </table></div>

    <div class="financial-grid">
      <div><span>Sale Total</span><strong>${escapeHtml(formatStatementMoney(debt.sale_total || debt.amount_owed))}</strong></div>
      <div><span>Debt Created</span><strong>${escapeHtml(formatStatementMoney(debt.amount_owed))}</strong></div>
      <div><span>Total Paid</span><strong>${escapeHtml(formatStatementMoney(debt.amount_paid))}</strong></div>
      <div class="balance"><span>Outstanding</span><strong>${escapeHtml(formatStatementMoney(debt.balance))}</strong></div>
    </div>

    <h3>Payments Applied to This Receipt</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Payment Date & Time</th><th>Amount</th><th>Method</th><th>Received By</th><th>Notes</th></tr></thead>
      <tbody>${paymentRows(debt)}</tbody>
    </table></div>
  </section>`;
}

export function customerDebtStatementHtml(statement, options = {}) {
  const autoPrint = Boolean(options.autoPrint);
  const purpose = options.purpose === "pdf" ? "Save as PDF" : "Print Statement";
  const debtSections = statement.debts.length
    ? statement.debts.map(debtSection).join("")
    : `<div class="no-records">No debt records matched the selected date or status filters.</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(statement.statement_number)} - Customer Debt Statement</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45}.statement{max-width:1050px;margin:18px auto;background:#fff;box-shadow:0 15px 45px rgba(15,23,42,.16)}.brand{padding:22px 26px;background:#07182c;color:#fff;border-bottom:5px solid #d4af37}.brand-row{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.brand h1{margin:0;color:#f5d84a;font-size:22px;letter-spacing:.03em}.brand h2{margin:5px 0 0;font-size:19px}.brand p{margin:5px 0 0;color:#dbeafe}.statement-code{text-align:right;font-size:11px}.content{padding:22px 26px}.identity-grid,.summary-grid,.detail-grid,.financial-grid{display:grid;gap:10px}.identity-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px}.summary-grid{grid-template-columns:repeat(4,minmax(0,1fr));margin:16px 0 22px}.detail-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin:12px 0}.financial-grid{grid-template-columns:repeat(4,minmax(0,1fr));margin:14px 0}.identity-grid>div,.summary-grid>div,.detail-grid>div,.financial-grid>div{padding:10px;border:1px solid #dbe3ec;border-radius:9px;background:#f8fafc}.summary-grid>div{background:#fff}.identity-grid span,.summary-grid span,.detail-grid span,.financial-grid span{display:block;color:#64748b;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:.03em}.identity-grid strong,.summary-grid strong,.detail-grid strong,.financial-grid strong{display:block;margin-top:4px;overflow-wrap:anywhere}.summary-grid strong{font-size:15px;color:#173b68}.financial-grid .balance{background:#07182c;color:#fff}.financial-grid .balance span{color:#bfdbfe}.receipt-block{margin:0 0 20px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;break-inside:avoid-page}.receipt-heading{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding-bottom:10px;border-bottom:2px solid #e2e8f0}.receipt-heading h2{margin:2px 0;font-size:17px}.receipt-heading p{margin:0;color:#64748b}.eyebrow{color:#9a6700;font-size:10px;font-weight:800;text-transform:uppercase}.status{padding:6px 10px;border-radius:999px;font-weight:800}.status.unpaid{background:#fee2e2;color:#991b1b}.status.partial{background:#fef3c7;color:#92400e}.status.paid{background:#dcfce7;color:#166534}.receipt-block h3{margin:15px 0 7px;color:#173b68;font-size:13px}.table-wrap{width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:700px}th{padding:7px;background:#173b68;color:#fff;text-align:left;font-size:10px}td{padding:7px;border:1px solid #dbe3ec;vertical-align:top}tr:nth-child(even) td{background:#f8fafc}.money,.number{text-align:right;white-space:nowrap}.empty{text-align:center;color:#64748b;font-style:italic}.final-summary{margin-top:24px;padding:16px;background:#f8fafc;border:2px solid #173b68;border-radius:12px}.final-summary h2{margin:0 0 10px;color:#173b68}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}.signature{padding-top:28px;border-top:1px solid #334155;text-align:center}.notice{margin-top:24px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;color:#854d0e}.footer{margin-top:22px;padding-top:12px;border-top:1px solid #dbe3ec;text-align:center;color:#64748b;font-size:10px}.screen-note{max-width:1050px;margin:12px auto;padding:10px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;color:#9a3412;font-weight:700}
@media(max-width:720px){body{background:#fff}.statement{margin:0;box-shadow:none}.brand,.content{padding:15px}.brand-row,.receipt-heading{flex-direction:column}.statement-code{text-align:left}.identity-grid,.summary-grid,.detail-grid,.financial-grid{grid-template-columns:1fr}.signatures{grid-template-columns:1fr;gap:34px}.table-wrap{border:1px solid #dbe3ec}.screen-note{margin:8px}}
@media print{body{background:#fff}.screen-note{display:none}.statement{margin:0;max-width:none;box-shadow:none}.content{padding:14px 0}.brand{padding:16px 18px}.receipt-block{break-inside:avoid}.table-wrap{overflow:visible}table{min-width:0}.signatures{break-inside:avoid}}
</style></head><body>
<div class="screen-note">${escapeHtml(purpose)}: review the complete statement, then use the browser print window.${options.purpose === "pdf" ? " Choose Save as PDF as the printer destination." : ""}</div>
<main class="statement">
<header class="brand"><div class="brand-row"><div><h1>${escapeHtml(statement.company_name.toUpperCase())}</h1><h2>Customer Debt Statement</h2><p>${escapeHtml(statement.store_code)} — ${escapeHtml(statement.store_name)}</p></div><div class="statement-code"><strong>${escapeHtml(statement.statement_number)}</strong><br>Generated: ${escapeHtml(formatStatementDateTime(statement.generated_at))}<br>Period: ${escapeHtml(statement.period)}</div></div></header>
<div class="content">
<section class="identity-grid"><div><span>Customer ID</span><strong>${escapeHtml(statement.customer.id)}</strong></div><div><span>Customer Name</span><strong>${escapeHtml(statement.customer.name)}</strong></div><div><span>Phone Number</span><strong>${escapeHtml(statement.customer.phone)}</strong></div><div><span>Location / Address</span><strong>${escapeHtml(statement.customer.location)}</strong></div><div><span>Store</span><strong>${escapeHtml(statement.store_code)} — ${escapeHtml(statement.store_name)}</strong></div><div><span>Statement Period</span><strong>${escapeHtml(statement.period)}</strong></div></section>
<section class="summary-grid"><div><span>Debt Records</span><strong>${escapeHtml(statement.summary.debt_count)}</strong></div><div><span>Total Owed</span><strong>${escapeHtml(formatStatementMoney(statement.summary.total_owed))}</strong></div><div><span>Total Paid</span><strong>${escapeHtml(formatStatementMoney(statement.summary.total_paid))}</strong></div><div><span>Outstanding Balance</span><strong>${escapeHtml(formatStatementMoney(statement.summary.outstanding_balance))}</strong></div><div><span>Item Lines</span><strong>${escapeHtml(statement.summary.item_lines)}</strong></div><div><span>Total Quantity</span><strong>${escapeHtml(statement.summary.item_quantity)}</strong></div><div><span>Debt Payments</span><strong>${escapeHtml(statement.summary.payment_count)}</strong></div><div><span>Overdue Records</span><strong>${escapeHtml(statement.summary.overdue_count)}</strong></div></section>
${debtSections}
<section class="final-summary"><h2>Final Account Position</h2><div class="financial-grid"><div><span>Total Debt Created</span><strong>${escapeHtml(formatStatementMoney(statement.summary.total_owed))}</strong></div><div><span>Total Payments Received</span><strong>${escapeHtml(formatStatementMoney(statement.summary.total_paid))}</strong></div><div><span>Outstanding Balance</span><strong>${escapeHtml(formatStatementMoney(statement.summary.outstanding_balance))}</strong></div><div><span>Account Status</span><strong>${statement.summary.outstanding_balance > 0 ? "PAYMENT OUTSTANDING" : "ACCOUNT CLEARED"}</strong></div></div></section>
<div class="notice"><strong>Important:</strong> This statement summarises the customer’s recorded credit purchases and payments. Each receipt remains a separate accounting record. A payment receipt is the official proof of an individual payment.</div>
<div class="signatures"><div class="signature">Prepared / Verified By</div><div class="signature">Customer Acknowledgement</div></div>
<footer class="footer">Chalin 03 Company Limited • ${escapeHtml(statement.statement_number)} • Generated in Ghana business time</footer>
</div></main>
${autoPrint ? `<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),350));</script>` : ""}
</body></html>`;
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}

export function openCustomerDebtStatement(statement, purpose = "print", existingWindow = null) {
  const printWindow = existingWindow || window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(
    customerDebtStatementHtml(statement, { autoPrint: true, purpose })
  );
  printWindow.document.close();
  return true;
}

export function downloadCustomerDebtWord(statement) {
  const filename = `${safeFilename(statement.statement_number)}-customer-debt-statement.doc`;
  downloadText(
    `\ufeff${customerDebtStatementHtml(statement, { autoPrint: false, purpose: "word" })}`,
    filename,
    "application/msword;charset=utf-8"
  );
}

function xmlCell(value, type = "String", style = "") {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

function xmlRow(cells) {
  return `<Row>${cells.join("")}</Row>`;
}

export function downloadCustomerDebtExcel(statement) {
  const summaryRows = [
    ["Statement Number", statement.statement_number],
    ["Generated", formatStatementDateTime(statement.generated_at)],
    ["Store", `${statement.store_code} — ${statement.store_name}`],
    ["Customer ID", statement.customer.id],
    ["Customer", statement.customer.name],
    ["Phone", statement.customer.phone],
    ["Location", statement.customer.location],
    ["Period", statement.period],
    ["Debt Records", statement.summary.debt_count],
    ["Total Owed", statement.summary.total_owed],
    ["Total Paid", statement.summary.total_paid],
    ["Outstanding", statement.summary.outstanding_balance],
  ];

  const itemRowsXml = [];
  const paymentRowsXml = [];
  statement.debts.forEach((debt) => {
    const items = (debt.items || []).length ? debt.items : [{}];
    items.forEach((item) => {
      itemRowsXml.push(
        xmlRow([
          xmlCell(debt.receipt_number || "-"),
          xmlCell(debt.id || "-", "String"),
          xmlCell(formatStatementDateTime(debt.sale_date || debt.created_at)),
          xmlCell(formatStatementDateTime(debt.created_at)),
          xmlCell(formatStatementDate(debt.due_date)),
          xmlCell(item.product_name || "No item detail"),
          xmlCell(numberValue(item.quantity), "Number"),
          xmlCell(numberValue(item.unit_price), "Number", "Money"),
          xmlCell(numberValue(item.line_total), "Number", "Money"),
          xmlCell(numberValue(debt.amount_owed), "Number", "Money"),
          xmlCell(numberValue(debt.amount_paid), "Number", "Money"),
          xmlCell(numberValue(debt.balance), "Number", "Money"),
          xmlCell(statusLabel(debt.status)),
          xmlCell(debt.staff_name || "-"),
        ])
      );
    });

    (debt.payments || []).forEach((payment) => {
      paymentRowsXml.push(
        xmlRow([
          xmlCell(debt.receipt_number || "-"),
          xmlCell(debt.id || "-", "String"),
          xmlCell(formatStatementDateTime(payment.paid_at)),
          xmlCell(numberValue(payment.amount), "Number", "Money"),
          xmlCell(paymentMethodLabel(payment.payment_method)),
          xmlCell(payment.received_by_name || "-"),
          xmlCell(payment.notes || "-"),
        ])
      );
    });
  });

  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#173B68" ss:Pattern="Solid"/></Style><Style ss:ID="Money"><NumberFormat ss:Format="&quot;GHS&quot; #,##0.00"/></Style></Styles>
<Worksheet ss:Name="Account Summary"><Table>${xmlRow([xmlCell("Field", "String", "Header"), xmlCell("Value", "String", "Header")])}${summaryRows
    .map(([field, value], index) =>
      xmlRow([
        xmlCell(field),
        xmlCell(
          value,
          [9, 10, 11].includes(index) ? "Number" : "String",
          [9, 10, 11].includes(index) ? "Money" : ""
        ),
      ])
    )
    .join("")}</Table></Worksheet>
<Worksheet ss:Name="Purchases and Items"><Table>${xmlRow([
    "Receipt",
    "Debt ID",
    "Purchase Date and Time",
    "Debt Recorded",
    "Due Date",
    "Item or Material",
    "Quantity",
    "Unit Price",
    "Line Total",
    "Debt Created",
    "Total Paid",
    "Outstanding",
    "Status",
    "Sold By",
  ].map((value) => xmlCell(value, "String", "Header")))}${itemRowsXml.join("")}</Table></Worksheet>
<Worksheet ss:Name="Debt Payments"><Table>${xmlRow([
    "Receipt",
    "Debt ID",
    "Payment Date and Time",
    "Amount",
    "Method",
    "Received By",
    "Notes",
  ].map((value) => xmlCell(value, "String", "Header")))}${paymentRowsXml.join("")}</Table></Worksheet>
</Workbook>`;

  downloadText(
    xml,
    `${safeFilename(statement.statement_number)}-customer-debt-statement.xls`,
    "application/vnd.ms-excel;charset=utf-8"
  );
}
