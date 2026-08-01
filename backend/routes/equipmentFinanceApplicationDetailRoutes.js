const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  buildFinanceSchedule,
} = require("../services/equipmentFinanceScheduleService");
const {
  buildCompleteness,
} = require("./equipmentFinanceCompanyWideApplicationRoutes");

const router = express.Router();

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function sendError(res, error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED",
      message: "The complete Finance review file is being prepared. Try again after deployment completes.",
    });
  }
  console.error("Could not load complete Finance application review file.", error);
  return res.status(500).json({
    status: "error",
    code: "EQUIPMENT_FINANCE_REVIEW_FILE_ERROR",
    message: "Could not load the complete Finance application review file.",
  });
}

router.get("/:id", requirePermission("fleet.assets.view"), async (req, res, next) => {
  const applicationId = positiveId(req.params.id);
  if (!applicationId) return next();
  try {
    const [applicationRows] = await pool.query(
      `SELECT
         application.*,
         customer.customer_name,
         customer.phone AS customer_phone,
         customer.email AS customer_email,
         customer.address AS customer_address,
         quotation.quotation_number,
         quotation.status AS quotation_status,
         quotation.proposed_first_due_date,
         quotation.proposed_interval_days AS quotation_interval_days,
         quotation.proposed_non_working_day_rule AS quotation_non_working_day_rule,
         asset.asset_code,
         asset.asset_name,
         asset.make,
         asset.model,
         asset.model_year,
         asset.serial_number,
         asset.chassis_number,
         asset.engine_number,
         asset.main_image_url,
         creator.full_name AS created_by_name,
         submitter.full_name AS submitted_by_name,
         reviewer.full_name AS reviewed_by_name
       FROM equipment_credit_applications application
       INNER JOIN hire_customers customer ON customer.id = application.customer_id
       INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
       INNER JOIN fleet_assets asset ON asset.id = application.asset_id
       LEFT JOIN users creator ON creator.id = application.created_by
       LEFT JOIN users submitter ON submitter.id = application.submitted_by
       LEFT JOIN users reviewer ON reviewer.id = application.reviewed_by
       WHERE application.id = ?
       LIMIT 1`,
      [applicationId]
    );
    const application = applicationRows[0];
    if (!application) {
      return res.status(404).json({
        status: "error",
        code: "EQUIPMENT_FINANCE_APPLICATION_NOT_FOUND",
        message: "Finance credit application was not found.",
      });
    }

    const [[kycRows], [decisionRows], [documentRows], [taskRows], [eventRows]] =
      await Promise.all([
        pool.query(
          "SELECT * FROM equipment_credit_application_kyc WHERE application_id = ? LIMIT 1",
          [applicationId]
        ),
        pool.query(
          `SELECT decision.*, user.full_name AS decided_by_name
           FROM equipment_credit_application_decisions decision
           LEFT JOIN users user ON user.id = decision.decided_by
           WHERE decision.application_id = ?
           ORDER BY decision.decision_version DESC, decision.id DESC`,
          [applicationId]
        ),
        pool.query(
          `SELECT document.id, document.document_category, document.document_label,
                  document.original_file_name, document.stored_mime_type,
                  document.byte_size, document.checksum_sha256,
                  document.document_status, document.notes,
                  document.uploaded_by, uploader.full_name AS uploaded_by_name,
                  document.verified_by, verifier.full_name AS verified_by_name,
                  document.verified_at, document.rejected_reason, document.created_at
           FROM equipment_finance_case_documents document
           LEFT JOIN users uploader ON uploader.id = document.uploaded_by
           LEFT JOIN users verifier ON verifier.id = document.verified_by
           WHERE document.application_id = ?
             AND document.document_status <> 'superseded'
           ORDER BY document.created_at DESC, document.id DESC`,
          [applicationId]
        ),
        pool.query(
          `SELECT task.id, task.task_type, task.task_status, task.priority,
                  task.title, task.description, task.assigned_role,
                  task.assigned_to, assignee.full_name AS assigned_to_name,
                  task.due_at, task.approval_required, task.approval_status,
                  task.created_at
           FROM equipment_finance_case_tasks task
           LEFT JOIN users assignee ON assignee.id = task.assigned_to
           WHERE task.application_id = ?
             AND task.task_status IN ('open','in_progress')
           ORDER BY FIELD(task.priority, 'critical','high','normal','low'),
                    task.due_at, task.id`,
          [applicationId]
        ),
        pool.query(
          `SELECT event.id, event.event_type, event.event_title,
                  event.event_description, event.event_status,
                  event.event_metadata_json, event.source_type, event.source_id,
                  event.occurred_at, event.recorded_by,
                  user.full_name AS recorded_by_name
           FROM equipment_finance_case_events event
           LEFT JOIN users user ON user.id = event.recorded_by
           WHERE event.application_id = ?
           ORDER BY event.occurred_at DESC, event.id DESC
           LIMIT 200`,
          [applicationId]
        ),
      ]);

    const kyc = kycRows[0] || {};
    let exactSchedule = null;
    try {
      exactSchedule = buildFinanceSchedule({
        selling_price: application.financed_amount,
        deposit: 0,
        installment_count: application.proposed_installment_count,
        first_due_date: application.proposed_first_due_date,
        payment_frequency: application.proposed_frequency,
        custom_interval_days:
          application.proposed_interval_days ?? application.quotation_interval_days,
        non_working_day_rule:
          application.proposed_non_working_day_rule ||
          application.quotation_non_working_day_rule ||
          "exact",
      });
    } catch (_error) {
      exactSchedule = null;
    }

    return res.json({
      status: "success",
      application: { ...application, hire_location_id: null },
      kyc,
      decisions: decisionRows,
      documents: documentRows,
      tasks: taskRows,
      timeline: eventRows.map((event) => ({
        ...event,
        metadata: (() => {
          try {
            return JSON.parse(event.event_metadata_json || "{}");
          } catch {
            return {};
          }
        })(),
      })),
      exact_schedule: exactSchedule,
      completeness: buildCompleteness(application, kyc, documentRows),
      policy: {
        scope: "company_wide",
        hire_location_id: null,
        hire_location_selection_required: false,
        independent_review_required: true,
        approved_schedule_immutable: true,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
