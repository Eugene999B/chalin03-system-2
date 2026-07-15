function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function snapshotExpected(closing) {
  return JSON.stringify({
    cash: Number(closing.expected_cash || 0),
    momo: Number(closing.expected_momo || 0),
    bank: Number(closing.expected_bank || 0),
    other: Number(closing.expected_other || 0),
    total: Number(closing.expected_total || 0),
  });
}

function snapshotCounted(closing) {
  return JSON.stringify({
    cash: Number(closing.cash_counted || 0),
    momo: Number(closing.momo_counted || 0),
    bank: Number(closing.bank_counted || 0),
    other: Number(closing.other_counted || 0),
    total: Number(closing.total_counted || 0),
  });
}

async function markClosingStale(
  connection,
  {
    branchId,
    transactionDate,
    reason,
    sourceEntityType,
    sourceEntityId,
    changedBy,
    approvedBy = null,
  }
) {
  const closingDate = toDateOnly(transactionDate);
  if (!closingDate) return null;

  const [rows] = await connection.query(
    `SELECT *
     FROM daily_closings
     WHERE branch_id = ? AND closing_date = ?
     LIMIT 1
     FOR UPDATE`,
    [branchId, closingDate]
  );

  const closing = rows[0];
  if (!closing) return null;

  const nextRevision = Number(closing.latest_revision_number || 1) + 1;

  await connection.query(
    `INSERT INTO daily_closing_revisions (
      daily_closing_id,
      branch_id,
      closing_date,
      revision_number,
      revision_type,
      reason,
      expected_snapshot_json,
      counted_snapshot_json,
      difference_total,
      source_entity_type,
      source_entity_id,
      changed_by,
      approved_by
    ) VALUES (?, ?, ?, ?, 'post_closing_change', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      closing.id,
      branchId,
      closingDate,
      nextRevision,
      String(reason || "Underlying record changed after closing").slice(0, 5000),
      snapshotExpected(closing),
      snapshotCounted(closing),
      Number(closing.difference_total || 0),
      sourceEntityType || null,
      sourceEntityId === undefined || sourceEntityId === null
        ? null
        : String(sourceEntityId),
      changedBy || null,
      approvedBy || null,
    ]
  );

  await connection.query(
    `UPDATE daily_closings
     SET stale_after_close = 1,
         stale_detected_at = NOW(),
         latest_revision_number = ?,
         verification_status = 'variance_review',
         verified_by = NULL,
         verified_at = NULL
     WHERE id = ?`,
    [nextRevision, closing.id]
  );

  return {
    id: closing.id,
    closing_date: closingDate,
    revision_number: nextRevision,
  };
}

async function findClosingForDate(connection, branchId, transactionDate) {
  const closingDate = toDateOnly(transactionDate);
  if (!closingDate) return null;
  const [rows] = await connection.query(
    `SELECT id, closing_date, stale_after_close, verification_status
     FROM daily_closings
     WHERE branch_id = ? AND closing_date = ?
     LIMIT 1`,
    [branchId, closingDate]
  );
  return rows[0] || null;
}

module.exports = {
  findClosingForDate,
  markClosingStale,
  toDateOnly,
};
