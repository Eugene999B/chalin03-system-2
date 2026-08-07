function slowRequestThreshold(env = process.env) {
  const configured = Number(env.EQUIPMENT_FINANCE_SLOW_REQUEST_MS);
  return Number.isFinite(configured) && configured >= 250
    ? configured
    : 1500;
}

function equipmentFinancePerformanceLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const thresholdMs = slowRequestThreshold();

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs < thresholdMs) return;

    console.warn(
      JSON.stringify({
        event: "equipment_finance_slow_request",
        request_id: req.requestId || req.id || null,
        method: req.method,
        path: `${req.baseUrl || ""}${req.path || ""}`,
        status_code: res.statusCode,
        duration_ms: Number(durationMs.toFixed(1)),
        threshold_ms: thresholdMs,
        user_id: Number(req.user?.id || 0) || null,
      })
    );
  });

  next();
}

module.exports = {
  equipmentFinancePerformanceLogger,
  slowRequestThreshold,
};
