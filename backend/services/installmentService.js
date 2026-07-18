const { normalizeGhanaPhone } = require("./smsService");

function cleanText(value, maxLength = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Number(number.toFixed(2));
}

function positiveInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function dateOnly(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function addMonthsUtc(date, months) {
  const result = new Date(date.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function nextScheduleDate(firstDate, frequency, offset) {
  const date = new Date(`${firstDate}T00:00:00Z`);

  if (frequency === "weekly") {
    date.setUTCDate(date.getUTCDate() + offset * 7);
  } else if (frequency === "fortnightly") {
    date.setUTCDate(date.getUTCDate() + offset * 14);
  } else {
    return addMonthsUtc(date, offset).toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function buildInstallmentSchedule({
  financedAmount,
  installmentCount,
  firstDueDate,
  frequency,
  customDueDates = [],
}) {
  const financed = money(financedAmount);
  const count = positiveInteger(installmentCount);
  const first = dateOnly(firstDueDate);
  const allowed = new Set(["weekly", "fortnightly", "monthly", "custom"]);

  if (financed === null || financed <= 0) {
    throw new Error("Financed amount must be greater than zero.");
  }

  if (!count || count > 120) {
    throw new Error("Installment count must be between 1 and 120.");
  }

  if (!first) {
    throw new Error("A valid first payment date is required.");
  }

  if (!allowed.has(frequency)) {
    throw new Error("Payment frequency must be weekly, fortnightly, monthly, or custom.");
  }

  let dueDates = [];

  if (frequency === "custom") {
    dueDates = Array.isArray(customDueDates)
      ? customDueDates.map(dateOnly).filter(Boolean)
      : [];

    if (dueDates.length !== count) {
      throw new Error("Custom payment plans require one valid due date for every installment.");
    }

    dueDates = [...dueDates].sort();

    if (new Set(dueDates).size !== dueDates.length) {
      throw new Error("Custom installment dates cannot contain duplicates.");
    }
  } else {
    dueDates = Array.from({ length: count }, (_, index) =>
      nextScheduleDate(first, frequency, index)
    );
  }

  const baseAmount = Math.floor((financed * 100) / count) / 100;
  let allocated = 0;

  return dueDates.map((dueDate, index) => {
    const amount =
      index === dueDates.length - 1
        ? Number((financed - allocated).toFixed(2))
        : Number(baseAmount.toFixed(2));
    allocated = Number((allocated + amount).toFixed(2));

    return {
      sequence_number: index + 1,
      due_date: dueDate,
      scheduled_amount: amount,
      amount_paid: 0,
      schedule_status: "upcoming",
    };
  });
}

function validateInstallmentPlan(rawPlan, { total, deposit }) {
  const plan = rawPlan || {};
  const cleanTotal = money(total);
  const cleanDeposit = money(deposit);
  const frequency = String(plan.frequency || "monthly").trim().toLowerCase();
  const installmentCount = positiveInteger(plan.installment_count, 3);
  const firstDueDate = dateOnly(plan.first_due_date);
  const graceDays = Math.max(0, Math.min(Number(plan.grace_days || 0), 60));
  const deliveryPolicy = ["immediate", "after_full_payment"].includes(
    String(plan.delivery_policy || "")
  )
    ? String(plan.delivery_policy)
    : "immediate";
  const lateChargeType = ["none", "fixed", "percentage"].includes(
    String(plan.late_charge_type || "")
  )
    ? String(plan.late_charge_type)
    : "none";
  const lateChargeValue = money(plan.late_charge_value || 0) ?? 0;

  if (cleanTotal === null || cleanDeposit === null) {
    throw new Error("Sale total and deposit must be valid non-negative amounts.");
  }

  if (cleanDeposit >= cleanTotal) {
    throw new Error("An installment sale must leave an outstanding balance.");
  }

  if (!cleanText(plan.customer_phone || "", 30)) {
    throw new Error("A customer phone number is required for installment sales.");
  }

  if (!Boolean(plan.terms_accepted)) {
    throw new Error("The customer must accept the installment terms before the sale is saved.");
  }

  const normalizedPhone = normalizeGhanaPhone(plan.customer_phone);
  if (!normalizedPhone) {
    throw new Error("Enter a valid Ghana customer phone number for installment reminders.");
  }

  const financedAmount = Number((cleanTotal - cleanDeposit).toFixed(2));
  const schedule = buildInstallmentSchedule({
    financedAmount,
    installmentCount,
    firstDueDate,
    frequency,
    customDueDates: plan.custom_due_dates,
  });

  return {
    frequency,
    installment_count: installmentCount,
    first_due_date: schedule[0].due_date,
    final_due_date: schedule[schedule.length - 1].due_date,
    grace_days: graceDays,
    delivery_policy: deliveryPolicy,
    late_charge_type: lateChargeType,
    late_charge_value: lateChargeValue,
    guarantor_name: cleanText(plan.guarantor_name, 150),
    guarantor_phone: cleanText(plan.guarantor_phone, 30),
    guarantor_location: cleanText(plan.guarantor_location, 180),
    terms_accepted: Boolean(plan.terms_accepted),
    notes: cleanText(plan.notes, 2000),
    customer_phone_normalized: normalizedPhone,
    financed_amount: financedAmount,
    schedule,
  };
}

async function nextAgreementNumber(connection, { branchId, branchCode }) {
  const year = new Date().getUTCFullYear();

  await connection.query(
    `INSERT IGNORE INTO installment_sequences (branch_id, sequence_year, last_number)
     VALUES (?, ?, 0)`,
    [branchId, year]
  );

  const [rows] = await connection.query(
    `SELECT last_number
     FROM installment_sequences
     WHERE branch_id = ? AND sequence_year = ?
     FOR UPDATE`,
    [branchId, year]
  );

  const nextNumber = Number(rows[0]?.last_number || 0) + 1;

  await connection.query(
    `UPDATE installment_sequences
     SET last_number = ?
     WHERE branch_id = ? AND sequence_year = ?`,
    [nextNumber, branchId, year]
  );

  const safeBranchCode = String(branchCode || `B${branchId}`)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

  return `INS-${safeBranchCode}-${year}-${String(nextNumber).padStart(6, "0")}`;
}

async function createAgreementForSale(connection, {
  branchId,
  branchCode,
  saleId,
  debtId,
  customer,
  saleItems,
  total,
  deposit,
  plan,
  userId,
}) {
  const validated = validateInstallmentPlan(
    { ...plan, customer_phone: customer?.phone },
    { total, deposit }
  );
  const [[branchSettings]] = await connection.query(
    `SELECT require_manager_approval
     FROM installment_settings
     WHERE branch_id = ?
     LIMIT 1`,
    [branchId]
  );
  const requiresApproval = Boolean(branchSettings?.require_manager_approval);

  if (requiresApproval && Number(deposit || 0) > 0.005) {
    throw new Error(
      "This store requires manager approval before any installment deposit is collected. Save the agreement with a zero deposit, obtain approval, then record the first payment from Installment Sales."
    );
  }

  const agreementNumber = await nextAgreementNumber(connection, {
    branchId,
    branchCode,
  });
  const approvalStatus = requiresApproval ? "pending" : "not_required";
  const agreementStatus = requiresApproval ? "pending_approval" : "active";
  const deliveryStatus =
    requiresApproval || validated.delivery_policy === "after_full_payment"
      ? "reserved"
      : "delivered";
  const deliveredAt = deliveryStatus === "delivered" ? new Date() : null;

  const [result] = await connection.query(
    `INSERT INTO installment_agreements (
      branch_id, agreement_number, sale_id, debt_id, customer_id,
      customer_name, customer_phone, customer_location,
      agreement_status, approval_status,
      sale_total, deposit_amount, financed_amount, scheduled_total,
      amount_paid, outstanding_balance,
      payment_frequency, installment_count, first_due_date, next_due_date,
      final_due_date, grace_days, late_charge_type, late_charge_value,
      delivery_policy, delivery_status, delivered_at, delivered_by,
      guarantor_name, guarantor_phone, guarantor_location,
      terms_accepted, agreement_notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchId,
      agreementNumber,
      saleId,
      debtId || null,
      customer?.id || null,
      customer?.name || "Installment Customer",
      validated.customer_phone_normalized,
      customer?.location || null,
      agreementStatus,
      approvalStatus,
      total,
      deposit,
      validated.financed_amount,
      validated.financed_amount,
      deposit,
      validated.financed_amount,
      validated.frequency,
      validated.installment_count,
      validated.first_due_date,
      validated.first_due_date,
      validated.final_due_date,
      validated.grace_days,
      validated.late_charge_type,
      validated.late_charge_value,
      validated.delivery_policy,
      deliveryStatus,
      deliveredAt,
      deliveryStatus === "delivered" ? userId : null,
      validated.guarantor_name,
      validated.guarantor_phone,
      validated.guarantor_location,
      validated.terms_accepted,
      validated.notes,
      userId || null,
    ]
  );

  const agreementId = result.insertId;

  for (const item of saleItems || []) {
    const [saleItemRows] = await connection.query(
      `SELECT id FROM sale_items
       WHERE sale_id = ? AND product_id = ?
       ORDER BY id DESC LIMIT 1`,
      [saleId, item.product_id]
    );

    await connection.query(
      `INSERT INTO installment_agreement_items (
        agreement_id, sale_item_id, product_id, product_name,
        quantity, unit_price, line_total, reservation_status,
        delivered_quantity, delivered_at, delivered_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agreementId,
        saleItemRows[0]?.id || null,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_price,
        item.line_total,
        deliveryStatus === "reserved" ? "reserved" : "delivered",
        deliveryStatus === "delivered" ? item.quantity : 0,
        deliveredAt,
        deliveryStatus === "delivered" ? userId : null,
      ]
    );
  }

  for (const row of validated.schedule) {
    await connection.query(
      `INSERT INTO installment_schedule (
        agreement_id, sequence_number, due_date, scheduled_amount,
        amount_paid, schedule_status
      ) VALUES (?, ?, ?, ?, 0, 'upcoming')`,
      [
        agreementId,
        row.sequence_number,
        row.due_date,
        row.scheduled_amount,
      ]
    );
  }

  if (debtId) {
    await connection.query(
      `UPDATE debts SET due_date = ? WHERE id = ? AND branch_id = ?`,
      [validated.first_due_date, debtId, branchId]
    );
  }

  return {
    id: agreementId,
    agreement_number: agreementNumber,
    status: agreementStatus,
    financed_amount: validated.financed_amount,
    outstanding_balance: validated.financed_amount,
    first_due_date: validated.first_due_date,
    next_due_date: validated.first_due_date,
    final_due_date: validated.final_due_date,
    payment_frequency: validated.frequency,
    installment_count: validated.installment_count,
    delivery_policy: validated.delivery_policy,
    delivery_status: deliveryStatus,
    schedule: validated.schedule,
  };
}

function deriveScheduleStatus(row, todayText = new Date().toISOString().slice(0, 10)) {
  const dueAmount = Number(row.scheduled_amount || 0) +
    Number(row.late_charge_amount || 0) -
    Number(row.waived_charge_amount || 0);
  const paid = Number(row.amount_paid || 0);

  if (paid >= dueAmount - 0.005) return "paid";
  if (paid > 0) return row.due_date < todayText ? "overdue" : "partial";
  if (row.due_date < todayText) return "overdue";
  if (row.due_date === todayText) return "due";
  return "upcoming";
}

async function refreshAgreementFinancials(connection, agreementId) {
  const [scheduleRows] = await connection.query(
    `SELECT *
     FROM installment_schedule
     WHERE agreement_id = ?
     ORDER BY sequence_number
     FOR UPDATE`,
    [agreementId]
  );

  const today = new Date().toISOString().slice(0, 10);
  let overdueAmount = 0;
  let nextDueDate = null;
  let lateChargesTotal = 0;
  let waivedChargesTotal = 0;

  const [[agreementForCharges]] = await connection.query(
    `SELECT
      ia.*,
      COALESCE(settings.reminder_days_before, 3) AS reminder_days_before
     FROM installment_agreements ia
     LEFT JOIN installment_settings settings ON settings.branch_id = ia.branch_id
     WHERE ia.id = ?
     FOR UPDATE`,
    [agreementId]
  );

  for (const row of scheduleRows) {
    const graceDate = new Date(`${row.due_date}T00:00:00Z`);
    graceDate.setUTCDate(
      graceDate.getUTCDate() + Number(agreementForCharges?.grace_days || 0)
    );
    const afterGrace = graceDate.toISOString().slice(0, 10) < today;
    const baseRemaining = Math.max(
      Number(row.scheduled_amount || 0) - Number(row.amount_paid || 0),
      0
    );

    if (
      afterGrace &&
      baseRemaining > 0.005 &&
      Number(row.late_charge_amount || 0) <= 0 &&
      agreementForCharges?.late_charge_type !== "none" &&
      Number(agreementForCharges?.late_charge_value || 0) > 0
    ) {
      const charge =
        agreementForCharges.late_charge_type === "percentage"
          ? Number(
              (
                (Number(row.scheduled_amount || 0) *
                  Number(agreementForCharges.late_charge_value || 0)) /
                100
              ).toFixed(2)
            )
          : Number(agreementForCharges.late_charge_value || 0);

      await connection.query(
        `UPDATE installment_schedule
         SET late_charge_amount = ?
         WHERE id = ?`,
        [charge, row.id]
      );
      row.late_charge_amount = charge;
    }

    lateChargesTotal += Number(row.late_charge_amount || 0);
    waivedChargesTotal += Number(row.waived_charge_amount || 0);

    // Cancelled and waived schedule rows remain immutable history. Their charge
    // evidence still contributes to the agreement ledger, but they must never
    // become due or overdue again after a controlled reschedule/cancellation.
    if (["cancelled", "waived"].includes(row.schedule_status)) {
      continue;
    }

    const status = deriveScheduleStatus(row, today);
    const dueAmount =
      Number(row.scheduled_amount || 0) +
      Number(row.late_charge_amount || 0) -
      Number(row.waived_charge_amount || 0);
    const remaining = Math.max(dueAmount - Number(row.amount_paid || 0), 0);

    if (status === "overdue") overdueAmount += remaining;
    if (!nextDueDate && remaining > 0) nextDueDate = row.due_date;

    if (status !== row.schedule_status) {
      await connection.query(
        `UPDATE installment_schedule
         SET schedule_status = ?,
             fully_paid_at = CASE
               WHEN ? = 'paid' THEN COALESCE(fully_paid_at, NOW())
               ELSE fully_paid_at
             END
         WHERE id = ?`,
        [status, status, row.id]
      );
      row.schedule_status = status;
    }
  }

  const [[paymentTotals]] = await connection.query(
    `SELECT COALESCE(SUM(amount), 0) AS installment_collections
     FROM installment_payments
     WHERE agreement_id = ? AND is_voided = 0`,
    [agreementId]
  );

  const agreement = agreementForCharges;

  if (!agreement) throw new Error("Installment agreement was not found.");

  const amountPaid =
    Number(agreement.deposit_amount || 0) +
    Number(paymentTotals.installment_collections || 0);
  const outstandingBalance = Math.max(
    Number(agreement.sale_total || 0) +
      Number(lateChargesTotal || 0) -
      Number(waivedChargesTotal || 0) -
      amountPaid,
    0
  );
  const completed = outstandingBalance <= 0.005;
  const reminderDaysBefore = Math.max(
    0,
    Number(agreement.reminder_days_before || 3)
  );
  const dueSoonLimit = new Date(`${today}T00:00:00Z`);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + reminderDaysBefore);
  const dueSoonLimitText = dueSoonLimit.toISOString().slice(0, 10);

  let agreementStatus;
  if (["cancelled", "defaulted"].includes(agreement.agreement_status)) {
    agreementStatus = agreement.agreement_status;
  } else if (agreement.approval_status === "pending") {
    agreementStatus = "pending_approval";
  } else if (agreement.approval_status === "rejected") {
    agreementStatus = "cancelled";
  } else if (completed) {
    agreementStatus = "completed";
  } else if (overdueAmount > 0) {
    agreementStatus = "overdue";
  } else if (nextDueDate === today) {
    agreementStatus = "payment_due";
  } else if (nextDueDate && nextDueDate <= dueSoonLimitText) {
    agreementStatus = "due_soon";
  } else {
    agreementStatus = "active";
  }

  await connection.query(
    `UPDATE installment_agreements
     SET amount_paid = ?,
         late_charges_total = ?,
         waived_charges_total = ?,
         outstanding_balance = ?,
         overdue_amount = ?,
         next_due_date = ?,
         agreement_status = ?,
         completed_at = CASE
           WHEN ? THEN COALESCE(completed_at, NOW())
           ELSE completed_at
         END
     WHERE id = ?`,
    [
      amountPaid,
      Number(lateChargesTotal.toFixed(2)),
      Number(waivedChargesTotal.toFixed(2)),
      outstandingBalance,
      Number(overdueAmount.toFixed(2)),
      completed ? null : nextDueDate,
      agreementStatus,
      completed ? 1 : 0,
      agreementId,
    ]
  );

  await connection.query(
    `UPDATE sales
     SET amount_paid = LEAST(total, ?),
         balance = GREATEST(total - ?, 0)
     WHERE id = ?`,
    [amountPaid, amountPaid, agreement.sale_id]
  );

  if (agreement.debt_id) {
    await connection.query(
      `UPDATE debts
       SET amount_paid = LEAST(amount_owed, ?),
           balance = GREATEST(amount_owed - ?, 0),
           status = CASE
             WHEN GREATEST(amount_owed - ?, 0) <= 0.005 THEN 'paid'
             WHEN ? > 0 THEN 'partial'
             ELSE 'unpaid'
           END,
           due_date = ?
       WHERE id = ?`,
      [
        amountPaid,
        amountPaid,
        amountPaid,
        amountPaid,
        completed ? null : nextDueDate,
        agreement.debt_id,
      ]
    );
  }

  return {
    ...agreement,
    amount_paid: amountPaid,
    late_charges_total: Number(lateChargesTotal.toFixed(2)),
    waived_charges_total: Number(waivedChargesTotal.toFixed(2)),
    outstanding_balance: Number(outstandingBalance.toFixed(2)),
    overdue_amount: Number(overdueAmount.toFixed(2)),
    next_due_date: completed ? null : nextDueDate,
    agreement_status: agreementStatus,
    schedule: scheduleRows,
  };
}

async function refreshBranchAgreements(connection, branchId) {
  const [rows] = await connection.query(
    `SELECT id
     FROM installment_agreements
     WHERE branch_id = ?
       AND agreement_status IN (
         'active',
         'due_soon',
         'payment_due',
         'overdue',
         'pending_approval'
       )
     ORDER BY id
     LIMIT 500`,
    [branchId]
  );

  const refreshed = [];

  for (const row of rows) {
    refreshed.push(await refreshAgreementFinancials(connection, row.id));
  }

  return refreshed;
}

module.exports = {
  buildInstallmentSchedule,
  cleanText,
  createAgreementForSale,
  dateOnly,
  deriveScheduleStatus,
  money,
  positiveInteger,
  refreshAgreementFinancials,
  refreshBranchAgreements,
  validateInstallmentPlan,
};
