from pathlib import Path
import json

ROOT = Path('.')


def replace_once(path, old, new):
    file_path = ROOT / path
    source = file_path.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'Expected one match in {path}, found {count}: {old[:100]!r}')
    file_path.write_text(source.replace(old, new), encoding='utf-8')


# Backend automatic notification refresh.
server_path = 'backend/server.js'
replace_once(
    server_path,
    '''const {
  startSmsDeliveryStatusSync,
} = require("./services/smsDeliveryStatusService");
''',
    '''const {
  startSmsDeliveryStatusSync,
} = require("./services/smsDeliveryStatusService");
const {
  startNotificationSyncScheduler,
} = require("./services/notificationSchedulerService");
'''
)
replace_once(
    server_path,
    '''      startSmsDeliveryStatusSync();
      startInstallmentReminderScheduler();
''',
    '''      startSmsDeliveryStatusSync();
      startInstallmentReminderScheduler();
      startNotificationSyncScheduler();
'''
)

scheduler_path = ROOT / 'backend/services/notificationSchedulerService.js'
scheduler_path.write_text(r'''const { runNotificationSync } = require("./notificationService");

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_INITIAL_DELAY_MS = 20_000;

let initialTimer = null;
let intervalTimer = null;
let syncRunning = false;

function booleanSetting(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function notificationSchedulerConfig(env = process.env) {
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const enabled = booleanSetting(env.NOTIFICATION_SYNC_ENABLED, production);
  const intervalMinutes = boundedNumber(
    env.NOTIFICATION_SYNC_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES
  );
  const initialDelayMs = boundedNumber(
    env.NOTIFICATION_SYNC_INITIAL_DELAY_MS,
    DEFAULT_INITIAL_DELAY_MS,
    1_000,
    5 * 60_000
  );

  return {
    enabled,
    intervalMinutes,
    intervalMs: Math.round(intervalMinutes * 60_000),
    initialDelayMs: Math.round(initialDelayMs),
  };
}

async function runScheduledNotificationSync({
  sync = runNotificationSync,
  logger = console,
} = {}) {
  if (syncRunning) {
    return { skipped: true, reason: "local_sync_already_running" };
  }

  syncRunning = true;
  try {
    const result = await sync({ workspace: "group", userId: null });
    logger.log(
      `Notification sync completed: generated ${Number(
        result?.generated_count || 0
      )}, resolved ${Number(result?.resolved_count || 0)}.`
    );
    return { skipped: false, result };
  } catch (error) {
    if (Number(error?.statusCode || 0) === 409) {
      logger.warn("Notification sync skipped because another server instance holds the database lock.");
      return { skipped: true, reason: "database_sync_already_running" };
    }

    logger.error("Automatic notification sync failed:", error.message);
    return { skipped: false, failed: true, error };
  } finally {
    syncRunning = false;
  }
}

function startNotificationSyncScheduler({
  env = process.env,
  sync = runNotificationSync,
  logger = console,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
} = {}) {
  const config = notificationSchedulerConfig(env);

  if (!config.enabled) {
    logger.log("Automatic notification sync is disabled.");
    return { started: false, ...config };
  }

  if (initialTimer || intervalTimer) {
    return { started: false, alreadyStarted: true, ...config };
  }

  const execute = () => runScheduledNotificationSync({ sync, logger });

  initialTimer = setTimeoutFn(() => {
    initialTimer = null;
    void execute();
  }, config.initialDelayMs);
  initialTimer?.unref?.();

  intervalTimer = setIntervalFn(() => {
    void execute();
  }, config.intervalMs);
  intervalTimer?.unref?.();

  logger.log(
    `Automatic notification sync scheduled every ${config.intervalMinutes} minute(s).`
  );

  return { started: true, ...config };
}

function resetNotificationSchedulerForTests() {
  initialTimer = null;
  intervalTimer = null;
  syncRunning = false;
}

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  notificationSchedulerConfig,
  runScheduledNotificationSync,
  startNotificationSyncScheduler,
  resetNotificationSchedulerForTests,
};
''', encoding='utf-8')

scheduler_test_path = ROOT / 'backend/tests/notificationSchedulerService.test.js'
scheduler_test_path.write_text(r'''const test = require("node:test");
const assert = require("node:assert/strict");

const {
  notificationSchedulerConfig,
  resetNotificationSchedulerForTests,
  runScheduledNotificationSync,
  startNotificationSyncScheduler,
} = require("../services/notificationSchedulerService");

test("notification scheduler defaults on only in production", () => {
  assert.equal(notificationSchedulerConfig({ NODE_ENV: "production" }).enabled, true);
  assert.equal(notificationSchedulerConfig({ NODE_ENV: "development" }).enabled, false);
  assert.equal(
    notificationSchedulerConfig({
      NODE_ENV: "production",
      NOTIFICATION_SYNC_ENABLED: "false",
    }).enabled,
    false
  );
});

test("notification scheduler enforces a safe minimum interval", () => {
  const config = notificationSchedulerConfig({
    NODE_ENV: "production",
    NOTIFICATION_SYNC_INTERVAL_MINUTES: "1",
  });
  assert.equal(config.intervalMinutes, 5);
  assert.equal(config.intervalMs, 5 * 60_000);
});

test("notification scheduler registers one initial run and one recurring run", () => {
  resetNotificationSchedulerForTests();
  const delays = [];
  const handles = [];
  const fakeHandle = () => ({ unref() { handles.push("unref"); } });

  const result = startNotificationSyncScheduler({
    env: { NODE_ENV: "production" },
    sync: async () => ({ generated_count: 0, resolved_count: 0 }),
    logger: { log() {}, warn() {}, error() {} },
    setTimeoutFn(callback, delay) {
      delays.push(["timeout", delay, typeof callback]);
      return fakeHandle();
    },
    setIntervalFn(callback, delay) {
      delays.push(["interval", delay, typeof callback]);
      return fakeHandle();
    },
  });

  assert.equal(result.started, true);
  assert.equal(delays.length, 2);
  assert.equal(delays[0][0], "timeout");
  assert.equal(delays[1][0], "interval");
  assert.equal(delays[1][1], 15 * 60_000);
  assert.equal(handles.length, 2);
  resetNotificationSchedulerForTests();
});

test("notification scheduler prevents overlapping local executions", async () => {
  resetNotificationSchedulerForTests();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const sync = async () => {
    calls += 1;
    await pending;
    return { generated_count: 1, resolved_count: 0 };
  };
  const logger = { log() {}, warn() {}, error() {} };

  const first = runScheduledNotificationSync({ sync, logger });
  await Promise.resolve();
  const second = await runScheduledNotificationSync({ sync, logger });

  assert.equal(second.skipped, true);
  assert.equal(calls, 1);
  release();
  await first;
  resetNotificationSchedulerForTests();
});
''', encoding='utf-8')

# Frontend route-level lazy loading while preserving all existing wrappers.
app_path = 'frontend/src/App.jsx'
replace_once(
    app_path,
    'import { BrowserRouter, Navigate, Route, Routes } from "react-router";\n',
    'import { lazy, Suspense } from "react";\nimport { BrowserRouter, Navigate, Route, Routes } from "react-router";\n'
)

lazy_imports = [
    'import MiningOperationsPage from "./pages/MiningOperationsPage";\n',
    'import MiningControlCentrePage from "./pages/MiningControlCentrePage";\n',
    'import EquipmentHireOperationsPage from "./pages/EquipmentHireOperationsPage";\n',
    'import HireCommercialControlPage from "./pages/HireCommercialControlPage";\n',
    'import NotificationCentrePage from "./pages/NotificationCentrePage";\n',
    'import SharedReportsDocumentsPage from "./pages/SharedReportsDocumentsPage";\n',
    'import FleetAssetsPage from "./pages/FleetAssetsPage";\n',
    'import OperationsDocumentsAccountingPage from "./pages/OperationsDocumentsAccountingPage";\n',
    'import GroupExecutiveControlPage from "./pages/GroupExecutiveControlPage";\n',
    'import GroupConfigurationPage from "./pages/GroupConfigurationPage";\n',
    'import Release2FinalControlPage from "./pages/Release2FinalControlPage";\n',
    'import WorkspaceAdministrationPage from "./pages/WorkspaceAdministrationPage";\n',
    'import EmploymentDocumentsPage from "./pages/EmploymentDocumentsPage";\n',
    'import DocumentSignatureSettingsPage from "./pages/DocumentSignatureSettingsPage";\n',
]
for import_line in lazy_imports:
    replace_once(app_path, import_line, '')

lazy_block = '''const MiningOperationsPage = lazy(() => import("./pages/MiningOperationsPage"));
const MiningControlCentrePage = lazy(() => import("./pages/MiningControlCentrePage"));
const EquipmentHireOperationsPage = lazy(() =>
  import("./pages/EquipmentHireOperationsPage")
);
const HireCommercialControlPage = lazy(() =>
  import("./pages/HireCommercialControlPage")
);
const NotificationCentrePage = lazy(() => import("./pages/NotificationCentrePage"));
const SharedReportsDocumentsPage = lazy(() =>
  import("./pages/SharedReportsDocumentsPage")
);
const FleetAssetsPage = lazy(() => import("./pages/FleetAssetsPage"));
const OperationsDocumentsAccountingPage = lazy(() =>
  import("./pages/OperationsDocumentsAccountingPage")
);
const GroupExecutiveControlPage = lazy(() =>
  import("./pages/GroupExecutiveControlPage")
);
const GroupConfigurationPage = lazy(() => import("./pages/GroupConfigurationPage"));
const Release2FinalControlPage = lazy(() => import("./pages/Release2FinalControlPage"));
const WorkspaceAdministrationPage = lazy(() =>
  import("./pages/WorkspaceAdministrationPage")
);
const EmploymentDocumentsPage = lazy(() => import("./pages/EmploymentDocumentsPage"));
const DocumentSignatureSettingsPage = lazy(() =>
  import("./pages/DocumentSignatureSettingsPage")
);

'''
replace_once(app_path, 'const businessWorkRoles = ["admin", "manager", "cashier"];\n', lazy_block + 'const businessWorkRoles = ["admin", "manager", "cashier"];\n')

replace_once(
    app_path,
    '''function SafePage({ children }) {
  return <PageErrorBoundary>{children}</PageErrorBoundary>;
}
''',
    '''function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: "12rem",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontWeight: 700,
      }}
    >
      Loading workspace…
    </div>
  );
}

function SafePage({ children }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}
'''
)

frontend_test_path = ROOT / 'frontend/scripts/workspaceFinalCompletionTests.mjs'
frontend_test_path.write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [app, packageJson, help] = await Promise.all([
  read("src/App.jsx"),
  read("package.json"),
  read("src/pages/WorkspaceHelpPage.jsx"),
]);

assert.match(app, /import \{ lazy, Suspense \} from "react"/);
assert.match(app, /<Suspense fallback=\{<RouteLoadingFallback \/>\}>/);
assert.match(app, /role="status"/);

for (const page of [
  "MiningOperationsPage",
  "MiningControlCentrePage",
  "EquipmentHireOperationsPage",
  "HireCommercialControlPage",
  "FleetAssetsPage",
  "WorkspaceAdministrationPage",
]) {
  assert.match(app, new RegExp(`const ${page} = lazy`));
  assert.doesNotMatch(app, new RegExp(`import ${page} from`));
}

assert.match(app, /WorkspaceShell allowedWorkspaces=\{MINING_WORKSPACE\}/);
assert.match(app, /WorkspaceShell allowedWorkspaces=\{EQUIPMENT_HIRE_WORKSPACE\}/);
assert.match(app, /MINING_SECTION_PERMISSIONS\.control/);
assert.match(app, /HIRE_SECTION_PERMISSIONS\.commercial/);
assert.match(packageJson, /workspaceFinalCompletionTests\.mjs/);
assert.match(help, /automatic rule refresh/i);
assert.match(help, /controlled cancellation, adjustment, void or amendment/i);

console.log("Mining and Equipment Hire final frontend checks passed.");
''', encoding='utf-8')

frontend_package_path = ROOT / 'frontend/package.json'
frontend_package = json.loads(frontend_package_path.read_text(encoding='utf-8'))
if 'workspaceFinalCompletionTests.mjs' not in frontend_package['scripts']['test']:
    frontend_package['scripts']['test'] += ' && node scripts/workspaceFinalCompletionTests.mjs'
frontend_package_path.write_text(json.dumps(frontend_package, indent=2) + '\n', encoding='utf-8')

# In-app guidance for automatic notifications and controlled corrections.
help_path = 'frontend/src/pages/WorkspaceHelpPage.jsx'
replace_once(
    help_path,
    'Use Mining reports, shared documents, notifications and audit evidence for the selected site and period. Confirm filters before exporting and keep operational, staff and contractor information private.',
    'Use Mining reports, shared documents, notifications and audit evidence for the selected site and period. Automatic rule refresh raises low-stockpile, low-fuel, approval, variance, incident and closing alerts; administrators may still run a manual sync during investigation. Confirm filters before exporting and keep operational, staff and contractor information private.'
)
replace_once(
    help_path,
    'Use password-only sign-in, least-privilege permissions and controlled corrections. Review Activity Log evidence and notify the System Administrator before repeating a failed sensitive action.',
    'Use password-only sign-in, least-privilege permissions and controlled corrections. Wrong operational entries must use controlled cancellation, adjustment, status correction or a documented replacement record; do not delete database rows directly. Review Activity Log evidence and notify the System Administrator before repeating a failed sensitive action.'
)
replace_once(
    help_path,
    'Use the Maintenance Register for inspections, service history, meters and defects. Use Sales Documents & Reports, Hire Reports, shared controls and notifications for the correct location and period. Protect customer, finance and machine records.',
    'Use the Maintenance Register for inspections, service history, meters and defects. Use Sales Documents & Reports, Hire Reports, shared controls and notifications for the correct location and period. Automatic rule refresh raises overdue invoice, ending-contract, pending-approval, draft-work-log and open-damage alerts. Protect customer, finance and machine records.'
)
replace_once(
    help_path,
    'Use password-only sign-in, least privilege and Activity Log evidence, and report unexpected failures before retrying a sensitive action.',
    'Use password-only sign-in, least privilege and Activity Log evidence. Wrong commercial or operational entries must use controlled cancellation, adjustment, void or amendment with truthful reasons; do not delete database rows directly. Report unexpected failures before retrying a sensitive action.'
)

# Permanent backend source acceptance contract.
acceptance_test_path = ROOT / 'backend/tests/miningHireFinalAcceptance.test.js'
acceptance_test_path.write_text(r'''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const mining = read("backend", "routes", "miningRoutes.js");
const miningControl = read("backend", "routes", "miningControlRoutes.js");
const hire = read("backend", "routes", "equipmentHireRoutes.js");
const hireCommercial = read("backend", "routes", "hireCommercialRoutes.js");
const equipmentSales = read("backend", "routes", "equipmentSalesRoutes.js");
const equipmentSalesFinal = read(
  "backend",
  "routes",
  "equipmentSalesFinalizationRoutes.js"
);
const notifications = read("backend", "services", "notificationService.js");
const scheduler = read(
  "backend",
  "services",
  "notificationSchedulerService.js"
);
const server = read("backend", "server.js");

function expectRoute(source, method, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(source, new RegExp(`router\\.${method}\\(\\s*[\"']${escaped}[\"']`));
}

test("Mining core workflow remains reachable", () => {
  for (const [method, route] of [
    ["post", "/sites"],
    ["post", "/daily-logs"],
    ["post", "/production"],
    ["post", "/equipment-logs"],
    ["post", "/fuel-logs"],
    ["post", "/expenses"],
    ["post", "/incidents"],
  ]) expectRoute(mining, method, route);

  for (const [method, route] of [
    ["post", "/stockpiles"],
    ["post", "/stockpile-movements"],
    ["post", "/dispatches"],
    ["patch", "/dispatches/:id/approve"],
    ["post", "/fuel-tanks"],
    ["post", "/fuel-transactions"],
    ["post", "/fuel-reconciliations"],
    ["post", "/crews"],
    ["post", "/closings"],
  ]) expectRoute(miningControl, method, route);
});

test("Mining corrections preserve controlled evidence", () => {
  expectRoute(mining, "delete", "/sites/:id");
  expectRoute(miningControl, "patch", "/dispatches/:id/cancel");
  expectRoute(miningControl, "patch", "/fuel-reconciliations/:id/approve");
  assert.match(miningControl, /adjustment_in/);
  assert.match(miningControl, /adjustment_out/);
  assert.match(miningControl, /writeAuditEvent/);
  assert.doesNotMatch(miningControl, /FOREIGN_KEY_CHECKS/i);
});

test("Equipment Hire workflow and correction routes remain reachable", () => {
  for (const [method, route] of [
    ["post", "/customers"],
    ["post", "/enquiries"],
    ["post", "/quotations"],
    ["post", "/contracts"],
    ["post", "/contracts/:id/assets"],
    ["post", "/dispatches"],
    ["post", "/work-logs"],
    ["post", "/invoices"],
    ["post", "/payments"],
    ["post", "/returns"],
    ["patch", "/invoices/:id/void"],
    ["patch", "/contracts/:id/close"],
    ["patch", "/contracts/:id/financial-close"],
  ]) expectRoute(hire, method, route);

  expectRoute(hireCommercial, "post", "/contracts/:id/amendments");
  expectRoute(hireCommercial, "patch", "/amendments/:id/approve");
  expectRoute(hireCommercial, "post", "/damage-assessments");
  expectRoute(hireCommercial, "patch", "/damage-assessments/:id/settle");
});

test("Equipment Sales finalization and reminders remain reachable", () => {
  expectRoute(equipmentSales, "post", "/agreements/:id/payments");
  expectRoute(equipmentSales, "post", "/agreements/:id/delivery");
  expectRoute(equipmentSales, "post", "/agreements/:id/ownership-transfer");
  expectRoute(equipmentSalesFinal, "post", "/reminders/run");
});

test("automatic workspace notifications cover Mining and Hire risks", () => {
  for (const rule of [
    "mining.stockpile_low",
    "mining.fuel_tank_low",
    "mining.dispatch_pending",
    "mining.fuel_variance",
    "hire.invoice_overdue",
    "hire.contract_ending",
    "hire.deposit_pending",
    "hire.damage_open",
    "hire.work_log_pending",
  ]) assert.match(notifications, new RegExp(rule.replaceAll(".", "\\.")));

  assert.match(scheduler, /runNotificationSync/);
  assert.match(scheduler, /workspace: "group"/);
  assert.match(scheduler, /MIN_INTERVAL_MINUTES = 5/);
  assert.match(server, /startNotificationSyncScheduler\(\)/);
});

test("final Mining and Hire source contains no unfinished markers", () => {
  for (const source of [
    mining,
    miningControl,
    hire,
    hireCommercial,
    equipmentSales,
    equipmentSalesFinal,
    notifications,
    scheduler,
  ]) assert.doesNotMatch(source, /\b(?:TODO|FIXME|TBD)\b/i);
});
''', encoding='utf-8')

# Source-backed final acceptance record.
doc_path = ROOT / 'docs/MINING_HIRE_FINAL_ACCEPTANCE.md'
doc_path.write_text('''# Mining and Equipment Sales & Hire Final Acceptance

## Scope

This acceptance record verifies the production source paths for Mining Operations and Equipment Sales & Hire after the System Administrator-authorized Mining trial-data cleanup. It does not create new production trial records and does not alter Spare Parts data.

## Mining workflow coverage

| Stage | Protected application path |
|---|---|
| Administration | Create, update, safely remove/archive Mining sites and assign staff access |
| Daily operations | Daily logs, production, equipment logs, fuel logs, expenses and incidents |
| Physical control | Stockpiles, adjustments, transfers, dispatch and PDF evidence |
| Fuel control | Tanks, receipts/issues/transfers, reconciliation and consumption reporting |
| Workforce | Contractors, crews, approvals and workforce warnings |
| Period control | Site closings, approval and management intelligence |

## Equipment Sales & Hire workflow coverage

| Stage | Protected application path |
|---|---|
| Commercial entry | Customers, enquiries, availability and quotations |
| Contracting | Conversion, contracts, assets, rate cards, amendments and approvals |
| Operations | Dispatch, meters, work logs, returns and condition evidence |
| Finance | Invoices, deposits, payments, allocation, ageing and financial closing |
| Damage and release | Return inspection, damage assessment, settlement and contract closure |
| Equipment sales | Agreements, installments, payment receipts, delivery, ownership transfer and reminders |

## Controlled correction matrix

| Record family | Approved correction path |
|---|---|
| Mining site | Permanently remove only when empty; otherwise close/archive while preserving linked history |
| Mining stockpile or fuel balance | Documented adjustment movement and reconciliation; never direct database editing |
| Mining dispatch | Controlled cancellation with audit evidence |
| Mining daily/production/equipment/expense records | Status/approval controls and documented replacement or adjustment evidence |
| Hire quotation or contract | Status transition or approved amendment |
| Hire invoice | Protected void route; original evidence remains |
| Hire payment/deposit | Controlled allocation, approval and settlement evidence |
| Hire return/damage | Return inspection, damage assessment and settlement record |
| Equipment sale | Agreement status, payment allocation, delivery and ownership controls |

## Automatic operational alerts

The server refreshes notification rules automatically in production every 15 minutes by default, with a database advisory lock preventing concurrent sync. The interval can be configured but cannot be set below five minutes.

The rules cover Mining low stockpiles, low fuel, pending dispatch, reconciliation variance, incidents and closing review, plus Hire overdue invoices, ending contracts, pending approvals, draft work logs and open damage cases. The existing manual sync remains available for authorised investigation.

## Performance acceptance

Heavy Mining, Hire, shared-report, fleet, administration and worker-document pages use route-level dynamic imports. Authentication, workspace boundaries, role checks and permission wrappers remain outside the lazy-loaded pages and continue to execute before content is displayed.

## Evidence level

This release uses permanent source contracts, backend syntax/tests, frontend tests/lint/build, dependency audit, secret scans and CodeQL. A later real-business transaction should be entered only when the business has genuine Mining or Hire activity; artificial production test records are not recreated after cleanup.
''', encoding='utf-8')

print('Applied Mining and Equipment Hire final update.')
