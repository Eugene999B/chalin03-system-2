const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCsvFormula(value) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = String(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const safe = escapeCsvFormula(value).replaceAll('"', '""');
  return `"${safe}"`;
}

function rowsToCsv(headers, rows) {
  const headerLine = headers.map((header) => csvCell(header.label)).join(",");
  const bodyLines = rows.map((row) =>
    headers.map((header) => csvCell(row[header.key])).join(",")
  );

  return [headerLine, ...bodyLines].join("\r\n");
}

module.exports = {
  escapeCsvFormula,
  csvCell,
  rowsToCsv,
};
