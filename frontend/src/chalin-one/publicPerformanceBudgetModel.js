export const PUBLIC_PERFORMANCE_BASELINE = Object.freeze({
  previous_entry_js_bytes: 1399460,
  previous_public_app_js_bytes: 81500,
  previous_public_app_css_bytes: 105120,
});

export const PUBLIC_PERFORMANCE_BUDGETS = Object.freeze({
  entry_js_bytes: 320 * 1024,
  public_entry_js_bytes: 300 * 1024,
  public_app_js_bytes: 160 * 1024,
  public_app_css_bytes: 150 * 1024,
  public_critical_js_bytes: 760 * 1024,
  public_critical_css_bytes: 190 * 1024,
});

export function formatBudgetBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 0) return "0 kB";
  return `${(bytes / 1024).toFixed(1)} kB`;
}

export function performanceReductionPercent(previousBytes, nextBytes) {
  const previous = Number(previousBytes || 0);
  const next = Number(nextBytes || 0);
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(next) || next < 0) {
    return 0;
  }
  return Math.max(0, Math.round((1 - next / previous) * 100));
}
