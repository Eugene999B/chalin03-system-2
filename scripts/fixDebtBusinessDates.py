from pathlib import Path

PAGE_PATH = Path("frontend/src/pages/DebtsPage.jsx")
DATE_UTIL_PATH = Path("frontend/src/utils/businessDate.js")
SALE_ROUTES_PATH = Path("backend/routes/saleRoutes.js")
TEST_PATH = Path("backend/tests/debtBusinessDateContract.test.js")
SERVICE_WORKER_PATH = Path("frontend/public/sw.js")


def replace_once(source: str, old: str, new: str, label: str) -> tuple[str, bool]:
    if new in source:
        return source, False
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"Expected one {label} block, found {count}.")
    return source.replace(old, new, 1), True


def main() -> None:
    page = PAGE_PATH.read_text(encoding="utf-8")
    sale_routes = SALE_ROUTES_PATH.read_text(encoding="utf-8")
    service_worker = SERVICE_WORKER_PATH.read_text(encoding="utf-8")
    changed = False

    date_util = '''export const BUSINESS_TIME_ZONE = "Africa/Accra";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

function parseBusinessDate(value) {
  if (value === undefined || value === null || value === "") return null;

  const text = String(value).trim();
  const dateOnlyMatch = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(text);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  }

  const mysqlTimestampMatch =
    /^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}:\\d{2})(?:\\.\\d+)?$/.exec(text);
  const normalized = mysqlTimestampMatch
    ? `${mysqlTimestampMatch[1]}T${mysqlTimestampMatch[2]}Z`
    : text;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBusinessDate(value) {
  const date = parseBusinessDate(value);
  return date ? dateFormatter.format(date) : "-";
}

export function formatBusinessDateTime(value) {
  const date = parseBusinessDate(value);
  return date ? dateTimeFormatter.format(date) : "-";
}
'''

    if not DATE_UTIL_PATH.exists():
        DATE_UTIL_PATH.parent.mkdir(parents=True, exist_ok=True)
        DATE_UTIL_PATH.write_text(date_util, encoding="utf-8")
        changed = True
    elif DATE_UTIL_PATH.read_text(encoding="utf-8") != date_util:
        raise SystemExit("businessDate.js already exists with unexpected content.")

    import_anchor = 'import CustomerDebtPrintPanel from "../components/CustomerDebtPrintPanel";\n'
    import_line = (
        'import { formatBusinessDate, formatBusinessDateTime } '
        'from "../utils/businessDate";\n'
    )
    if import_line not in page:
        if page.count(import_anchor) != 1:
            raise SystemExit("DebtsPage import anchor was not found safely.")
        page = page.replace(import_anchor, import_anchor + import_line, 1)
        changed = True

    old_formatters = '''  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString();
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleString();
  }
'''
    new_formatters = '''  function formatDate(value) {
    return formatBusinessDate(value);
  }

  function formatDateTime(value) {
    return formatBusinessDateTime(value);
  }
'''
    page, did_change = replace_once(
        page, old_formatters, new_formatters, "DebtsPage date formatter"
    )
    changed = changed or did_change

    old_card_date = '''                        <small>
                          Due: {formatDate(debt.due_date)} • Store:{" "}
                          {getDebtStoreCode(debt)}
                        </small>
'''
    new_card_date = '''                        <small>
                          Debt Date: {formatDate(debt.created_at || debt.sale_date)} • Due:{" "}
                          {formatDate(debt.due_date)} • Store: {getDebtStoreCode(debt)}
                        </small>
'''
    page, did_change = replace_once(
        page, old_card_date, new_card_date, "debt card date"
    )
    changed = changed or did_change

    old_mini_dates = '''                      <MiniStat label="Balance" value={formatMoney(debt.balance)} />
                      <MiniStat label="Due Date" value={formatDate(debt.due_date)} />
'''
    new_mini_dates = '''                      <MiniStat label="Balance" value={formatMoney(debt.balance)} />
                      <MiniStat
                        label="Debt Date"
                        value={formatDate(debt.created_at || debt.sale_date)}
                      />
                      <MiniStat label="Due Date" value={formatDate(debt.due_date)} />
'''
    page, did_change = replace_once(
        page, old_mini_dates, new_mini_dates, "debt mini-stat dates"
    )
    changed = changed or did_change

    old_modal_date = '''                <p>
                  <strong>Sale Date:</strong>{" "}
                  {formatDateTime(selectedDebt.sale_date)}
                </p>
'''
    new_modal_date = '''                <p>
                  <strong>Debt Date:</strong>{" "}
                  {formatDateTime(selectedDebt.created_at || selectedDebt.sale_date)}
                </p>
'''
    page, did_change = replace_once(
        page, old_modal_date, new_modal_date, "debt details date"
    )
    changed = changed or did_change

    if changed:
        PAGE_PATH.write_text(page, encoding="utf-8")

    old_due_date = '''function calculateDueDate(daysToAdd) {
  const date = new Date();
  date.setDate(date.getDate() + Number(daysToAdd || 7));

  return date.toISOString().slice(0, 10);
}
'''
    new_due_date = '''function calculateDueDate(daysToAdd) {
  const date = new Date();
  const parsedDays = Number(daysToAdd);
  const days = Number.isFinite(parsedDays) ? parsedDays : 7;
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}
'''
    sale_routes, did_change = replace_once(
        sale_routes, old_due_date, new_due_date, "UTC debt due-date calculation"
    )
    if did_change:
        SALE_ROUTES_PATH.write_text(sale_routes, encoding="utf-8")
        changed = True

    test_source = '''const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

test("debt dates are labelled separately and use Ghana business time", () => {
  const source = read("frontend", "src", "pages", "DebtsPage.jsx");
  const saleRoutes = read("backend", "routes", "saleRoutes.js");

  assert.match(source, /formatBusinessDate/);
  assert.match(source, /Debt Date:/);
  assert.match(source, /label="Debt Date"/);
  assert.match(source, /label="Due Date"/);
  assert.match(source, /selectedDebt\.created_at \|\| selectedDebt\.sale_date/);
  assert.doesNotMatch(source, /date\.toLocaleDateString\(\)/);
  assert.doesNotMatch(source, /date\.toLocaleString\(\)/);
  assert.match(saleRoutes, /setUTCDate\(date\.getUTCDate\(\) \+ days\)/);
});

test("business date helper preserves Ghana calendar dates", async () => {
  const moduleUrl = pathToFileURL(
    path.join(root, "frontend", "src", "utils", "businessDate.js")
  ).href;
  const { BUSINESS_TIME_ZONE, formatBusinessDate, formatBusinessDateTime } =
    await import(`${moduleUrl}?debt-date-test=1`);

  assert.equal(BUSINESS_TIME_ZONE, "Africa/Accra");
  assert.equal(formatBusinessDate("2026-07-27"), "27 Jul 2026");

  const timestamp = formatBusinessDateTime("2026-07-27T16:30:00Z");
  assert.match(timestamp, /27 Jul 2026/);
  assert.match(timestamp, /04:30/i);
});
'''
    if not TEST_PATH.exists():
        TEST_PATH.write_text(test_source, encoding="utf-8")
        changed = True
    elif TEST_PATH.read_text(encoding="utf-8") != test_source:
        raise SystemExit("Debt business date test already exists with unexpected content.")

    old_cache = 'const CACHE_NAME = "chalin03-returning-customer-ux-v7";'
    new_cache = 'const CACHE_NAME = "chalin03-debt-business-date-v8";'
    if old_cache in service_worker:
        service_worker = service_worker.replace(old_cache, new_cache, 1)
        SERVICE_WORKER_PATH.write_text(service_worker, encoding="utf-8")
        changed = True
    elif new_cache not in service_worker:
        raise SystemExit("Expected service-worker cache version was not found.")

    print("changed=true" if changed else "changed=false")


if __name__ == "__main__":
    main()
