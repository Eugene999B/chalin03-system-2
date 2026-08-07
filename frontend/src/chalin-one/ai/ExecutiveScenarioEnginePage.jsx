import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../../api/axiosClient";
import { getAiStatus } from "./aiApi";
import "./executiveScenarioEngine.css";

const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = (() => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 29);
  return date.toISOString().slice(0, 10);
})();

const PRESETS = Object.freeze({
  protect_cash: Object.freeze({
    key: "protect_cash",
    label: "Protect cash",
    description: "Defensive plan: preserve revenue, improve collections and reduce operating cost.",
    revenue_change_pct: -5,
    collection_rate_delta_pp: 8,
    operating_cost_change_pct: -10,
    receivables_recovery_pct: 20,
  }),
  balanced: Object.freeze({
    key: "balanced",
    label: "Balanced plan",
    description: "Moderate growth with better collections, mild cost control and receivable recovery.",
    revenue_change_pct: 10,
    collection_rate_delta_pp: 5,
    operating_cost_change_pct: 2,
    receivables_recovery_pct: 15,
  }),
  growth_push: Object.freeze({
    key: "growth_push",
    label: "Growth push",
    description: "Aggressive revenue growth with controlled cost expansion and collection discipline.",
    revenue_change_pct: 25,
    collection_rate_delta_pp: 3,
    operating_cost_change_pct: 12,
    receivables_recovery_pct: 10,
  }),
  stress_test: Object.freeze({
    key: "stress_test",
    label: "Stress test",
    description: "Pressure case: lower revenue and collections while costs increase.",
    revenue_change_pct: -20,
    collection_rate_delta_pp: -10,
    operating_cost_change_pct: 15,
    receivables_recovery_pct: 0,
  }),
});

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value, digits = 2) {
  return Number(asNumber(value).toFixed(digits));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function money(value) {
  return `GHS ${asNumber(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(value) {
  return `${asNumber(value).toLocaleString("en-GH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function deltaMoney(value) {
  const number = round(value);
  if (Math.abs(number) < 0.005) return "No change";
  return `${number > 0 ? "+" : "−"}${money(Math.abs(number))}`;
}

function deltaPct(value) {
  const number = round(value, 1);
  if (Math.abs(number) < 0.05) return "No change";
  return `${number > 0 ? "+" : "−"}${Math.abs(number).toFixed(1)} pp`;
}

function permissionsFrom(status) {
  return new Set(
    Array.isArray(status?.permissions?.permissions)
      ? status.permissions.permissions
      : []
  );
}

export function calculateExecutiveScenario(group = {}, inputs = {}) {
  const baselineRevenue = asNumber(group.recorded_revenue);
  const baselineCash = asNumber(group.cash_received);
  const baselineCost = asNumber(group.operating_cost);
  const baselineReceivables = asNumber(group.outstanding_receivables);
  const baselineCollectionRate = baselineRevenue > 0
    ? clamp(asNumber(group.collection_rate) || (baselineCash / baselineRevenue) * 100, 0, 100)
    : 0;

  const revenueChange = clamp(asNumber(inputs.revenue_change_pct), -50, 100);
  const collectionDelta = clamp(asNumber(inputs.collection_rate_delta_pp), -40, 40);
  const costChange = clamp(asNumber(inputs.operating_cost_change_pct), -50, 100);
  const recoveryRate = clamp(asNumber(inputs.receivables_recovery_pct), 0, 100);

  const modeledRevenue = baselineRevenue * (1 + revenueChange / 100);
  const targetCollectionRate = clamp(baselineCollectionRate + collectionDelta, 0, 100);
  const modeledPeriodCollections = modeledRevenue * (targetCollectionRate / 100);
  const recoveredExistingReceivables = baselineReceivables * (recoveryRate / 100);
  const modeledCashInflow = modeledPeriodCollections + recoveredExistingReceivables;
  const modeledOperatingCost = baselineCost * (1 + costChange / 100);
  const modeledIndicativeBalance = modeledRevenue - modeledOperatingCost;
  const remainingExistingReceivables = Math.max(
    0,
    baselineReceivables - recoveredExistingReceivables
  );
  const modeledCostRatio = modeledRevenue > 0
    ? (modeledOperatingCost / modeledRevenue) * 100
    : 0;

  return Object.freeze({
    inputs: Object.freeze({
      revenue_change_pct: round(revenueChange, 1),
      collection_rate_delta_pp: round(collectionDelta, 1),
      operating_cost_change_pct: round(costChange, 1),
      receivables_recovery_pct: round(recoveryRate, 1),
    }),
    baseline: Object.freeze({
      recorded_revenue: round(baselineRevenue),
      cash_received: round(baselineCash),
      operating_cost: round(baselineCost),
      outstanding_receivables: round(baselineReceivables),
      collection_rate: round(baselineCollectionRate, 2),
      indicative_balance: round(asNumber(group.indicative_balance) || baselineRevenue - baselineCost),
    }),
    modeled: Object.freeze({
      recorded_revenue: round(modeledRevenue),
      period_collections: round(modeledPeriodCollections),
      recovered_existing_receivables: round(recoveredExistingReceivables),
      total_cash_inflow: round(modeledCashInflow),
      operating_cost: round(modeledOperatingCost),
      indicative_balance: round(modeledIndicativeBalance),
      existing_receivables_remaining: round(remainingExistingReceivables),
      collection_rate: round(targetCollectionRate, 2),
      cost_ratio: round(modeledCostRatio, 2),
    }),
    deltas: Object.freeze({
      recorded_revenue: round(modeledRevenue - baselineRevenue),
      period_collections: round(modeledPeriodCollections - baselineCash),
      total_cash_inflow: round(modeledCashInflow - baselineCash),
      operating_cost: round(modeledOperatingCost - baselineCost),
      indicative_balance: round(modeledIndicativeBalance - (baselineRevenue - baselineCost)),
      existing_receivables_remaining: round(remainingExistingReceivables - baselineReceivables),
      collection_rate_pp: round(targetCollectionRate - baselineCollectionRate, 2),
    }),
  });
}

function Metric({ label, baseline, scenario, delta, inverse = false }) {
  const rawDelta = asNumber(scenario) - asNumber(baseline);
  const good = inverse ? rawDelta <= 0 : rawDelta >= 0;
  return (
    <div className="cse-metric">
      <span>{label}</span>
      <strong>{scenario}</strong>
      <small data-state={Math.abs(rawDelta) < 0.005 ? "flat" : good ? "good" : "bad"}>
        {delta}
      </small>
      <em>Baseline {baseline}</em>
    </div>
  );
}

function Lever({ label, value, min, max, step = 1, suffix = "%", onChange, help }) {
  return (
    <label className="cse-lever">
      <div>
        <span>{label}</span>
        <strong>{value > 0 ? "+" : ""}{value}{suffix}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <small>{help}</small>
    </label>
  );
}

function ScenarioMiniCard({ preset, result, selected, onSelect }) {
  return (
    <button
      type="button"
      className="cse-preset"
      data-selected={selected ? "true" : "false"}
      onClick={onSelect}
    >
      <span>{preset.label}</span>
      <strong>{money(result.modeled.indicative_balance)}</strong>
      <small>{deltaMoney(result.deltas.indicative_balance)} indicative balance</small>
      <em>{preset.description}</em>
    </button>
  );
}

function ComparisonBars({ baseline, scenarios }) {
  const rows = [
    { key: "recorded_revenue", label: "Revenue", inverse: false },
    { key: "total_cash_inflow", label: "Cash inflow", inverse: false },
    { key: "operating_cost", label: "Operating cost", inverse: true },
    { key: "indicative_balance", label: "Indicative balance", inverse: false },
  ];
  const baselineMap = {
    recorded_revenue: baseline.recorded_revenue,
    total_cash_inflow: baseline.cash_received,
    operating_cost: baseline.operating_cost,
    indicative_balance: baseline.indicative_balance,
  };
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [
      Math.abs(asNumber(baselineMap[row.key])),
      ...scenarios.map((scenario) => Math.abs(asNumber(scenario.result.modeled[row.key]))),
    ])
  );

  return (
    <div className="cse-bars">
      {rows.map((row) => (
        <section key={row.key} className="cse-bar-row">
          <strong>{row.label}</strong>
          <div className="cse-bar-stack">
            <div className="cse-bar-line">
              <span>Baseline</span>
              <i style={{ width: `${Math.max(2, Math.abs(asNumber(baselineMap[row.key])) / maxValue) * 100}%` }} />
              <em>{money(baselineMap[row.key])}</em>
            </div>
            {scenarios.map((scenario) => (
              <div className="cse-bar-line" key={`${row.key}-${scenario.key}`} data-kind="scenario">
                <span>{scenario.label}</span>
                <i style={{ width: `${Math.max(2, Math.abs(asNumber(scenario.result.modeled[row.key])) / maxValue) * 100}%` }} />
                <em>{money(scenario.result.modeled[row.key])}</em>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ExecutiveScenarioEnginePage() {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [period, setPeriod] = useState({ from: THIRTY_DAYS_AGO, to: TODAY });
  const [selectedPreset, setSelectedPreset] = useState("balanced");
  const [custom, setCustom] = useState({ ...PRESETS.balanced });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nextPeriod = period, signal) => {
    setLoading(true);
    setError("");
    try {
      const [aiStatus, response] = await Promise.all([
        getAiStatus({ signal }),
        axiosClient.get("/group-executive/summary", {
          params: { from: nextPeriod.from, to: nextPeriod.to, branch_scope: "all" },
          signal,
          timeout: 120000,
        }),
      ]);
      const permissions = permissionsFrom(aiStatus);
      if (
        aiStatus?.flags?.chalinExecutive !== true ||
        !permissions.has("ai.executive.use")
      ) {
        throw new Error("Chalin Executive is disabled or not granted to this account.");
      }
      setStatus(aiStatus);
      setSummary(response.data?.summary || null);
    } catch (requestError) {
      if (requestError?.name === "CanceledError" || requestError?.code === "ERR_CANCELED") return;
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Executive scenario baseline could not be loaded."
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const controller = new AbortController();
    load(period, controller.signal);
    return () => controller.abort();
    // Initial baseline only; period changes apply explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseline = summary?.group || {};
  const customResult = useMemo(
    () => calculateExecutiveScenario(baseline, custom),
    [baseline, custom]
  );
  const presetResults = useMemo(
    () => Object.values(PRESETS).map((preset) => ({
      ...preset,
      result: calculateExecutiveScenario(baseline, preset),
    })),
    [baseline]
  );
  const comparisonScenarios = useMemo(() => [
    {
      key: "protect_cash",
      label: "Protect cash",
      result: calculateExecutiveScenario(baseline, PRESETS.protect_cash),
    },
    {
      key: "balanced",
      label: "Balanced",
      result: calculateExecutiveScenario(baseline, PRESETS.balanced),
    },
    {
      key: "custom",
      label: "Custom",
      result: customResult,
    },
  ], [baseline, customResult]);

  function choosePreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    setSelectedPreset(key);
    setCustom({ ...preset });
  }

  function updateLever(key, value) {
    setSelectedPreset("custom");
    setCustom((current) => ({ ...current, key: "custom", label: "Custom", [key]: value }));
  }

  return (
    <main className="cse-shell">
      <header className="cse-topbar">
        <div>
          <span className="cse-kicker">CHALIN ONE · Chalin Executive</span>
          <h1>Scenario Comparison Engine</h1>
          <p>
            Compare transparent management scenarios against live Group Executive Control figures. Nothing here is a forecast, accounting entry, approval or operational instruction.
          </p>
        </div>
        <div className="cse-top-actions">
          <span className="cse-mode-pill">Provider: {status?.provider?.key || "disabled"}</span>
          <span className="cse-mode-pill">No-write simulation</span>
          <Link className="cse-button cse-button-secondary" to="/intelligence/executive-scorecard">Scorecard</Link>
          <Link className="cse-button cse-button-secondary" to="/intelligence">Intelligence</Link>
        </div>
      </header>

      <section className="cse-filterbar">
        <label>
          Baseline from
          <input
            type="date"
            value={period.from}
            max={period.to}
            onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label>
          Baseline to
          <input
            type="date"
            value={period.to}
            min={period.from}
            max={TODAY}
            onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <button
          type="button"
          className="cse-button cse-button-primary"
          disabled={loading}
          onClick={() => load(period)}
        >
          {loading ? "Refreshing…" : "Refresh baseline"}
        </button>
      </section>

      {error ? (
        <section className="cse-error" role="alert">
          <strong>Scenario engine unavailable</strong>
          <p>{error}</p>
          <small>The group baseline remains restricted to the original System Administrator.</small>
        </section>
      ) : null}

      {loading && !summary ? (
        <section className="cse-loading" role="status">
          <span className="cse-spinner" />
          <strong>Loading authoritative baseline…</strong>
          <small>No scenario is calculated until the Group Executive baseline is available.</small>
        </section>
      ) : null}

      {summary ? (
        <>
          <section className="cse-baseline-grid" aria-label="Scenario baseline">
            <div><span>Revenue</span><strong>{money(baseline.recorded_revenue)}</strong></div>
            <div><span>Cash received</span><strong>{money(baseline.cash_received)}</strong></div>
            <div><span>Operating cost</span><strong>{money(baseline.operating_cost)}</strong></div>
            <div><span>Existing receivables</span><strong>{money(baseline.outstanding_receivables)}</strong></div>
            <div><span>Collection rate</span><strong>{pct(baseline.collection_rate)}</strong></div>
            <div><span>Indicative balance</span><strong>{money(baseline.indicative_balance)}</strong></div>
          </section>

          <section className="cse-section">
            <div className="cse-section-heading">
              <div>
                <span>Preset comparison</span>
                <h2>Test four management postures instantly</h2>
              </div>
              <small>{summary.period?.from} → {summary.period?.to}</small>
            </div>
            <div className="cse-preset-grid">
              {presetResults.map((preset) => (
                <ScenarioMiniCard
                  key={preset.key}
                  preset={preset}
                  result={preset.result}
                  selected={selectedPreset === preset.key}
                  onSelect={() => choosePreset(preset.key)}
                />
              ))}
            </div>
          </section>

          <section className="cse-editor-grid">
            <article className="cse-section cse-controls">
              <div className="cse-section-heading">
                <div>
                  <span>Custom assumptions</span>
                  <h2>Move the levers</h2>
                </div>
                <small>{selectedPreset === "custom" ? "Custom scenario" : PRESETS[selectedPreset]?.label}</small>
              </div>
              <Lever
                label="Revenue change"
                value={custom.revenue_change_pct}
                min={-50}
                max={100}
                onChange={(value) => updateLever("revenue_change_pct", value)}
                help="Applies a percentage change to baseline recorded revenue."
              />
              <Lever
                label="Collection-rate change"
                value={custom.collection_rate_delta_pp}
                min={-40}
                max={40}
                suffix=" pp"
                onChange={(value) => updateLever("collection_rate_delta_pp", value)}
                help="Adds percentage points to the baseline cash-collection rate; result is capped between 0% and 100%."
              />
              <Lever
                label="Operating-cost change"
                value={custom.operating_cost_change_pct}
                min={-50}
                max={100}
                onChange={(value) => updateLever("operating_cost_change_pct", value)}
                help="Applies a percentage change to baseline Spare Parts + Mining operating cost."
              />
              <Lever
                label="Recover existing receivables"
                value={custom.receivables_recovery_pct}
                min={0}
                max={100}
                onChange={(value) => updateLever("receivables_recovery_pct", value)}
                help="Models cash recovered from the current outstanding receivables stock; it does not assume new credit sales disappear."
              />
            </article>

            <article className="cse-section">
              <div className="cse-section-heading">
                <div>
                  <span>Modeled outcome</span>
                  <h2>Custom scenario vs baseline</h2>
                </div>
                <small>Deterministic formulas</small>
              </div>
              <div className="cse-metric-grid">
                <Metric
                  label="Modeled revenue"
                  baseline={money(customResult.baseline.recorded_revenue)}
                  scenario={money(customResult.modeled.recorded_revenue)}
                  delta={deltaMoney(customResult.deltas.recorded_revenue)}
                />
                <Metric
                  label="Period collections"
                  baseline={money(customResult.baseline.cash_received)}
                  scenario={money(customResult.modeled.period_collections)}
                  delta={deltaMoney(customResult.deltas.period_collections)}
                />
                <Metric
                  label="Total cash inflow"
                  baseline={money(customResult.baseline.cash_received)}
                  scenario={money(customResult.modeled.total_cash_inflow)}
                  delta={deltaMoney(customResult.deltas.total_cash_inflow)}
                />
                <Metric
                  label="Operating cost"
                  baseline={money(customResult.baseline.operating_cost)}
                  scenario={money(customResult.modeled.operating_cost)}
                  delta={deltaMoney(customResult.deltas.operating_cost)}
                  inverse
                />
                <Metric
                  label="Indicative balance"
                  baseline={money(customResult.baseline.indicative_balance)}
                  scenario={money(customResult.modeled.indicative_balance)}
                  delta={deltaMoney(customResult.deltas.indicative_balance)}
                />
                <Metric
                  label="Existing receivables remaining"
                  baseline={money(customResult.baseline.outstanding_receivables)}
                  scenario={money(customResult.modeled.existing_receivables_remaining)}
                  delta={deltaMoney(customResult.deltas.existing_receivables_remaining)}
                  inverse
                />
                <Metric
                  label="Collection rate"
                  baseline={pct(customResult.baseline.collection_rate)}
                  scenario={pct(customResult.modeled.collection_rate)}
                  delta={deltaPct(customResult.deltas.collection_rate_pp)}
                />
                <Metric
                  label="Cost ratio"
                  baseline={pct(baseline.cost_ratio)}
                  scenario={pct(customResult.modeled.cost_ratio)}
                  delta={deltaPct(customResult.modeled.cost_ratio - asNumber(baseline.cost_ratio))}
                  inverse
                />
              </div>
            </article>
          </section>

          <section className="cse-section">
            <div className="cse-section-heading">
              <div>
                <span>Side-by-side comparison</span>
                <h2>Baseline vs defensive, balanced and custom cases</h2>
              </div>
              <small>Same authoritative baseline</small>
            </div>
            <ComparisonBars baseline={customResult.baseline} scenarios={comparisonScenarios} />
          </section>

          <section className="cse-section cse-formulas">
            <div className="cse-section-heading">
              <div>
                <span>Formula transparency</span>
                <h2>Exactly how the scenario is calculated</h2>
              </div>
              <small>No hidden AI math</small>
            </div>
            <div className="cse-formula-grid">
              <div><strong>Modeled revenue</strong><code>baseline revenue × (1 + revenue change %)</code></div>
              <div><strong>Target collection rate</strong><code>clamp(baseline collection rate + change in percentage points, 0%, 100%)</code></div>
              <div><strong>Period collections</strong><code>modeled revenue × target collection rate</code></div>
              <div><strong>Recovered receivables</strong><code>existing receivables × recovery %</code></div>
              <div><strong>Total modeled cash inflow</strong><code>period collections + recovered existing receivables</code></div>
              <div><strong>Modeled operating cost</strong><code>baseline operating cost × (1 + cost change %)</code></div>
              <div><strong>Indicative balance</strong><code>modeled revenue − modeled operating cost</code></div>
              <div><strong>Existing receivables remaining</strong><code>existing receivables − recovered existing receivables</code></div>
            </div>
          </section>

          <footer className="cse-warning">
            <strong>Management simulation only.</strong> These outputs are not predictions, budgets, statutory accounts, lending decisions or instructions. They change no CHALIN 03 record and create no AI action proposal. A human must decide whether any assumption is realistic.
          </footer>
        </>
      ) : null}
    </main>
  );
}

export { PRESETS };
