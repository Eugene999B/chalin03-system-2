const express = require("express");
const crypto = require("crypto");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
} = require("../middleware/permissionMiddleware");
const {
  writeAuditEvent,
} = require("../services/auditTrailService");
const {
  getBusinessUnitId,
  normalizeCategory,
} = require("../services/categoryIsolationService");
const {
  allocateWorkerIdentity,
  cardDatesForReissue,
  ensureWorkerIdentitySchema,
} = require("../services/workerIdentityService");
const {
  assertSchemaReady,
} = require("../services/payrollFoundationService");

const router = express.Router();

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const PROFILE_EDIT_COLUMNS = Object.freeze([
  "employee_number",
  "user_id",
  "full_name",
  "preferred_name",
  "phone",
  "email",
  "date_of_birth",
  "gender",
  "nationality",
  "marital_status",
  "hometown",
  "residential_address",
  "digital_address",
  "national_id_type",
  "national_id_number",
  "national_id_issue_date",
  "national_id_expiry_date",
  "ssnit_number",
  "tin_number",
  "blood_group",
  "medical_notes",
  "id_card_issue_date",
  "id_card_expiry_date",
  "id_card_serial",
  "job_title",
  "department",
  "employment_type",
  "employment_start_date",
  "employment_end_date",
  "supervisor_worker_id",
  "notes",
]);

const SENSITIVE_PROFILE_FIELDS = Object.freeze([
  "date_of_birth",
  "national_id_type",
  "national_id_number",
  "national_id_issue_date",
  "national_id_expiry_date",
  "ssnit_number",
  "tin_number",
  "blood_group",
  "medical_notes",
]);

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function activeWorkerWorkspace(req) {
  return normalizeCategory(req.user?.workspace_code) || "spare_parts";
}

async function validateWorkerLinks({ payload, workspaceCode, workerId = null }) {
  if (payload.user_id) {
    const [userRows] = await pool.query(
      `SELECT id, primary_workspace_code, category_assignment_status
       FROM users
       WHERE id = ?
         AND is_active = TRUE
       LIMIT 1`,
      [payload.user_id]
    );

    const linkedUser = userRows[0];
    if (
      !linkedUser ||
      linkedUser.category_assignment_status !== "assigned" ||
      normalizeCategory(linkedUser.primary_workspace_code) !== workspaceCode
    ) {
      const error = new Error(
        "The linked login account must be active and assigned to this same business category."
      );
      error.statusCode = 409;
      error.code = "WORKER_ACCOUNT_CATEGORY_MISMATCH";
      throw error;
    }
  }

  if (payload.supervisor_worker_id) {
    const params = [payload.supervisor_worker_id, workspaceCode];
    let sql = `SELECT id
       FROM worker_profiles
       WHERE id = ?
         AND workspace_code = ?`;

    if (workerId) {
      sql += " AND id <> ?";
      params.push(workerId);
    }

    sql += " LIMIT 1";
    const [supervisorRows] = await pool.query(sql, params);
    if (!supervisorRows.length) {
      const error = new Error(
        "The selected supervisor must belong to this same business category."
      );
      error.statusCode = 409;
      error.code = "WORKER_SUPERVISOR_CATEGORY_MISMATCH";
      throw error;
    }
  }
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const result = cleanText(value, maxLength);
  return result || null;
}

function positiveId(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function booleanValue(value) {
  return value === true || Number(value || 0) === 1;
}

function dateOnly(value) {
  const text = cleanText(value, 20);

  return /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : null;
}

function permissionSet(req) {
  return new Set(
    Array.isArray(req.user?.effective_permissions)
      ? req.user.effective_permissions
      : []
  );
}

function userHasPermission(req, permission) {
  return permissionSet(req).has(permission);
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return null;
  }
}

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function safeFilename(value) {
  const name = cleanText(value, 255)
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return name || "private-file";
}

function decodeUpload({
  dataBase64,
  mimeType,
  allowedTypes,
  maxBytes,
}) {
  let raw = String(dataBase64 || "").trim();
  let detectedMime = cleanText(mimeType, 120).toLowerCase();

  const dataUrlMatch = raw.match(
    /^data:([^;,]+);base64,([\s\S]+)$/i
  );

  if (dataUrlMatch) {
    detectedMime = cleanText(
      dataUrlMatch[1],
      120
    ).toLowerCase();

    raw = dataUrlMatch[2];
  }

  raw = raw.replace(/\s+/g, "");

  if (!allowedTypes.has(detectedMime)) {
    const error = new Error(
      "The selected file type is not allowed."
    );
    error.statusCode = 400;
    throw error;
  }

  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    const error = new Error(
      "The uploaded file data is invalid."
    );
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(raw, "base64");

  if (!buffer.length) {
    const error = new Error(
      "The uploaded file is empty."
    );
    error.statusCode = 400;
    throw error;
  }

  if (buffer.length > maxBytes) {
    const error = new Error(
      `The uploaded file exceeds the ${Math.round(
        maxBytes / 1024 / 1024
      )} MB limit.`
    );
    error.statusCode = 413;
    throw error;
  }

  return {
    buffer,
    mimeType: detectedMime,
    checksum: sha256(buffer),
  };
}

function profilePayload(body = {}) {
  return {
    employee_number: cleanText(
      body.employee_number,
      80
    ).toUpperCase(),

    user_id: positiveId(body.user_id),

    full_name: cleanText(
      body.full_name,
      180
    ),

    preferred_name: nullableText(
      body.preferred_name,
      150
    ),

    phone: nullableText(body.phone, 30),
    email: nullableText(body.email, 180),
    date_of_birth: dateOnly(body.date_of_birth),
    gender: nullableText(body.gender, 30),
    nationality: nullableText(body.nationality, 80),
    marital_status: nullableText(
      body.marital_status,
      30
    ),
    hometown: nullableText(body.hometown, 150),
    residential_address: nullableText(
      body.residential_address,
      2000
    ),
    digital_address: nullableText(
      body.digital_address,
      80
    ),
    national_id_type: nullableText(
      body.national_id_type,
      60
    ),
    national_id_number: nullableText(
      body.national_id_number,
      120
    ),
    national_id_issue_date: dateOnly(
      body.national_id_issue_date
    ),
    national_id_expiry_date: dateOnly(
      body.national_id_expiry_date
    ),
    ssnit_number: nullableText(
      body.ssnit_number,
      80
    ),
    tin_number: nullableText(body.tin_number, 80),
    blood_group: nullableText(body.blood_group, 20),
    medical_notes: nullableText(
      body.medical_notes,
      4000
    ),
    id_card_issue_date: dateOnly(
      body.id_card_issue_date
    ),
    id_card_expiry_date: dateOnly(
      body.id_card_expiry_date
    ),
    id_card_serial: nullableText(
      body.id_card_serial,
      100
    ),
    job_title: nullableText(body.job_title, 150),
    department: nullableText(body.department, 150),
    employment_type:
      nullableText(body.employment_type, 60) ||
      "permanent",
    employment_start_date: dateOnly(
      body.employment_start_date
    ),
    employment_end_date: dateOnly(
      body.employment_end_date
    ),
    supervisor_worker_id: positiveId(
      body.supervisor_worker_id
    ),
    notes: nullableText(body.notes, 4000),
  };
}

function initialSalaryPayload(body = {}) {
  const amount = Number(body.basic_salary);
  const payFrequency = cleanText(body.pay_frequency || "monthly", 30).toLowerCase();
  const effectiveFrom = dateOnly(body.salary_effective_from || body.employment_start_date);
  const changeReason = nullableText(body.salary_change_reason, 1000) ||
    "Initial salary activated automatically when the worker profile was created.";

  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error("Enter a positive basic salary before creating the worker.");
    error.statusCode = 400;
    error.code = "WORKER_INITIAL_SALARY_REQUIRED";
    throw error;
  }
  if (!["monthly", "weekly", "biweekly"].includes(payFrequency)) {
    const error = new Error("Choose a valid salary pay frequency.");
    error.statusCode = 400;
    error.code = "WORKER_INITIAL_PAY_FREQUENCY_INVALID";
    throw error;
  }
  if (!effectiveFrom) {
    const error = new Error("Employment start date is required because it is also the initial salary effective date.");
    error.statusCode = 400;
    error.code = "WORKER_INITIAL_SALARY_EFFECTIVE_DATE_REQUIRED";
    throw error;
  }
  return {
    basic_salary: Number(amount.toFixed(2)),
    pay_frequency: payFrequency,
    effective_from: effectiveFrom,
    change_reason: changeReason,
  };
}

function redactWorkerDetail(detail, req) {
  const canSeeSensitive = userHasPermission(
    req,
    "workers.sensitive.view"
  );

  const canSeeDocuments = userHasPermission(
    req,
    "workers.documents.view"
  );

  if (!canSeeSensitive) {
    for (const field of SENSITIVE_PROFILE_FIELDS) {
      detail.profile[field] = null;
    }

    detail.family_members = [];
    detail.emergency_contacts = [];
    detail.profile_change_history = [];
  }

  if (!canSeeDocuments) {
    detail.private_files = [];

    detail.documents = detail.documents.map((item) => ({
      ...item,
      private_storage_key: null,
      checksum_sha256: null,
    }));

    detail.licenses = detail.licenses.map((item) => ({
      ...item,
      private_storage_key: null,
      checksum_sha256: null,
    }));
  }

  return {
    ...detail,
    permissions: {
      sensitive_visible: canSeeSensitive,
      documents_visible: canSeeDocuments,
    },
  };
}

async function workerExists(workerId, req) {
  const [rows] = await pool.query(
    `SELECT id
     FROM worker_profiles
     WHERE id = ?
       AND workspace_code = ?
     LIMIT 1`,
    [workerId, activeWorkerWorkspace(req)]
  );

  return rows.length > 0;
}

async function loadExpandedWorker(workerId, req) {
  const [profileRows] = await pool.query(
    `SELECT
       wp.*,
       u.username,
       u.role AS account_role,
       u.is_active AS account_is_active,
       supervisor.full_name AS supervisor_name,
       EXISTS (
         SELECT 1
         FROM worker_private_files photo
         WHERE photo.worker_id = wp.id
           AND photo.file_category = 'photo'
           AND photo.is_current = TRUE
           AND photo.is_active = TRUE
       ) AS has_photo
     FROM worker_profiles wp
     LEFT JOIN users u
       ON u.id = wp.user_id
     LEFT JOIN worker_profiles supervisor
       ON supervisor.id = wp.supervisor_worker_id
     WHERE wp.id = ?
       AND wp.workspace_code = ?
     LIMIT 1`,
    [workerId, activeWorkerWorkspace(req)]
  );

  if (!profileRows.length) {
    return null;
  }

  const [
    [assignments],
    [familyMembers],
    [emergencyContacts],
    [documents],
    [licenses],
    [property],
    [statusHistory],
    [profileHistory],
    [privateFiles],
  ] = await Promise.all([
    pool.query(
      `SELECT *
       FROM worker_assignments
       WHERE worker_id = ?
         AND workspace_code = ?
       ORDER BY is_active DESC, id DESC`,
      [workerId, activeWorkerWorkspace(req)]
    ),

    pool.query(
      `SELECT *
       FROM worker_family_members
       WHERE worker_id = ?
       ORDER BY
         is_next_of_kin DESC,
         is_dependent DESC,
         id DESC`,
      [workerId]
    ),

    pool.query(
      `SELECT *
       FROM worker_emergency_contacts
       WHERE worker_id = ?
       ORDER BY
         is_primary DESC,
         priority_order ASC,
         id DESC`,
      [workerId]
    ),

    pool.query(
      `SELECT *
       FROM worker_documents
       WHERE worker_id = ?
       ORDER BY expiry_date ASC, id DESC`,
      [workerId]
    ),

    pool.query(
      `SELECT *
       FROM worker_licenses
       WHERE worker_id = ?
       ORDER BY expiry_date ASC, id DESC`,
      [workerId]
    ),

    pool.query(
      `SELECT *
       FROM worker_property_assignments
       WHERE worker_id = ?
       ORDER BY status ASC, id DESC`,
      [workerId]
    ),

    pool.query(
      `SELECT
         history.*,
         changed_by_user.full_name AS changed_by_name
       FROM worker_status_history history
       LEFT JOIN users changed_by_user
         ON changed_by_user.id = history.changed_by
       WHERE history.worker_id = ?
       ORDER BY history.id DESC`,
      [workerId]
    ),

    pool.query(
      `SELECT
         history.*,
         changed_by_user.full_name AS changed_by_name
       FROM worker_profile_change_history history
       LEFT JOIN users changed_by_user
         ON changed_by_user.id = history.changed_by
       WHERE history.worker_id = ?
       ORDER BY history.id DESC
       LIMIT 100`,
      [workerId]
    ),

    pool.query(
      `SELECT
         id,
         worker_id,
         file_category,
         title,
         document_type,
         document_number,
         original_filename,
         mime_type,
         file_size_bytes,
         checksum_sha256,
         related_record_type,
         related_record_id,
         issued_date,
         expiry_date,
         is_current,
         is_active,
         notes,
         uploaded_by,
         uploaded_at
       FROM worker_private_files
       WHERE worker_id = ?
         AND is_active = TRUE
         AND file_category <> 'photo'
       ORDER BY uploaded_at DESC, id DESC`,
      [workerId]
    ),
  ]);

  return redactWorkerDetail(
    {
      profile: profileRows[0],
      assignments,
      family_members: familyMembers,
      emergency_contacts: emergencyContacts,
      documents,
      licenses,
      property,
      status_history: statusHistory,
      profile_change_history: profileHistory,
      private_files: privateFiles,
    },
    req
  );
}

router.get(
  "/workers-expanded/options",
  requireAuth,
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const workspaceCode = activeWorkerWorkspace(req);
    const canManage = userHasPermission(
      req,
      "workers.manage"
    );

    const [
      [users],
      [workers],
      [branches],
      [miningSites],
      [hireLocations],
    ] = await Promise.all([
      canManage
        ? pool.query(
            `SELECT
               id,
               full_name,
               username,
               role,
               is_active
             FROM users
             WHERE is_active = TRUE
               AND category_assignment_status = 'assigned'
               AND primary_workspace_code = ?
             ORDER BY full_name ASC`,
            [workspaceCode]
          )
        : Promise.resolve([[]]),

      pool.query(
        `SELECT
           id,
           employee_number,
           full_name,
           employment_status
         FROM worker_profiles
         WHERE workspace_code = ?
         ORDER BY full_name ASC`,
        [workspaceCode]
      ),

      pool.query(
        `SELECT
           id,
           branch_code AS code,
           name,
           location
         FROM branches
         WHERE is_active = TRUE
           AND ? = 'spare_parts'
         ORDER BY name ASC`,
        [workspaceCode]
      ),

      pool.query(
        `SELECT
           id,
           site_code AS code,
           site_name AS name,
           location
         FROM mining_sites
         WHERE is_active = TRUE
           AND status = 'active'
           AND ? = 'mining'
         ORDER BY site_name ASC`,
        [workspaceCode]
      ),

      pool.query(
        `SELECT
           location.id,
           location.code,
           location.name,
           location.address AS location
         FROM business_locations location
         INNER JOIN business_units unit
           ON unit.id = location.business_unit_id
         WHERE unit.code = 'equipment_hire'
           AND unit.is_enabled = TRUE
           AND location.is_active = TRUE
           AND ? = 'equipment_hire'
         ORDER BY location.name ASC`,
        [workspaceCode]
      ),
    ]);

    return res.json({
      status: "success",
      options: {
        users,
        workers,
        branches,
        mining_sites: miningSites,
        hire_locations: hireLocations,
      },
    });
  })
);

router.get(
  "/workers-expanded",
  requireAuth,
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const search = cleanText(req.query.search, 120);
    const status = cleanText(req.query.status, 40);
    const workspace = activeWorkerWorkspace(req);

    const where = ["wp.workspace_code = ?"];
    const params = [workspace];

    if (search) {
      const term = `%${search}%`;

      where.push(
        `(wp.employee_number LIKE ?
          OR wp.full_name LIKE ?
          OR wp.preferred_name LIKE ?
          OR wp.phone LIKE ?
          OR wp.job_title LIKE ?
          OR wp.department LIKE ?)`
      );

      params.push(term, term, term, term, term, term);
    }

    if (status) {
      where.push("wp.employment_status = ?");
      params.push(status);
    }


    const [rows] = await pool.query(
      `SELECT
         wp.id,
         wp.employee_number,
         wp.full_name,
         wp.preferred_name,
         wp.phone,
         wp.job_title,
         wp.department,
         wp.employment_type,
         wp.employment_status,
         wp.employment_start_date,
         wp.updated_at,
         u.username,
         u.is_active AS account_is_active,
         supervisor.full_name AS supervisor_name,
         EXISTS (
           SELECT 1
           FROM worker_private_files photo
           WHERE photo.worker_id = wp.id
             AND photo.file_category = 'photo'
             AND photo.is_current = TRUE
             AND photo.is_active = TRUE
         ) AS has_photo,
         (
           SELECT COUNT(*)
           FROM worker_assignments assignment
           WHERE assignment.worker_id = wp.id
             AND assignment.workspace_code = wp.workspace_code
             AND assignment.is_active = TRUE
         ) AS active_assignment_count,
         (
           SELECT COUNT(*)
           FROM worker_family_members family
           WHERE family.worker_id = wp.id
         ) AS family_member_count,
         (
           SELECT COUNT(*)
           FROM worker_emergency_contacts emergency
           WHERE emergency.worker_id = wp.id
         ) AS emergency_contact_count
       FROM worker_profiles wp
       LEFT JOIN users u
         ON u.id = wp.user_id
       LEFT JOIN worker_profiles supervisor
         ON supervisor.id = wp.supervisor_worker_id
       WHERE ${where.join(" AND ")}
       ORDER BY
         FIELD(
           wp.employment_status,
           'active',
           'suspended',
           'inactive',
           'terminated'
         ),
         wp.full_name ASC`,
      params
    );

    return res.json({
      status: "success",
      workers: rows,
    });
  })
);

router.post(
  "/workers-expanded",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view",
    "payroll.manage"
  ),
  asyncHandler(async (req, res) => {
    const payload = profilePayload(req.body);
    const initialSalary = initialSalaryPayload(req.body);

    if (!payload.full_name) {
      return res.status(400).json({
        status: "error",
        message: "Full legal name is required. Employee number is generated automatically.",
      });
    }

    const workspaceCode = activeWorkerWorkspace(req);
    const businessUnitId = await getBusinessUnitId(workspaceCode);
    await validateWorkerLinks({ payload, workspaceCode });
    await ensureWorkerIdentitySchema();

    const connection = await pool.getConnection();
    let identity = null;

    try {
      await connection.beginTransaction();
      await assertSchemaReady(connection);
      identity = await allocateWorkerIdentity(
        connection,
        workspaceCode,
        new Date()
      );

      payload.employee_number = identity.employeeNumber;
      payload.id_card_serial = identity.cardSerial;
      payload.id_card_issue_date = identity.issueDate;
      payload.id_card_expiry_date = identity.expiryDate;

      const columns = [
        ...PROFILE_EDIT_COLUMNS,
        "workspace_code",
        "business_unit_id",
        "employment_status",
        "created_by",
        "updated_by",
      ];

      const values = [
        ...PROFILE_EDIT_COLUMNS.map((column) => payload[column]),
        workspaceCode,
        businessUnitId,
        "active",
        req.user.id,
        req.user.id,
      ];

      const [result] = await connection.query(
        `INSERT INTO worker_profiles (
           ${columns.join(", ")}
         )
         VALUES (
           ${columns.map(() => "?").join(", ")}
         )`,
        values
      );

      const [salaryResult] = await connection.query(
        `INSERT INTO payroll_compensation_profiles (
           worker_id, workspace_code, effective_from, currency_code, pay_frequency,
           basic_salary, status, change_reason, created_by, approved_at
         ) VALUES (?, ?, ?, 'GHS', ?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP)`,
        [
          result.insertId,
          workspaceCode,
          initialSalary.effective_from,
          initialSalary.pay_frequency,
          initialSalary.basic_salary,
          initialSalary.change_reason,
          req.user.id,
        ]
      );

      await connection.query(
        `INSERT INTO worker_profile_change_history (
           worker_id,
           change_type,
           reason,
           before_json,
           after_json,
           changed_by
         )
         VALUES (?, 'profile_created', ?, NULL, ?, ?)`,
        [
          result.insertId,
          cleanText(req.body?.change_reason, 2000) ||
            "Initial worker profile created with automatic employee identity.",
          safeJson({
            ...payload,
            employee_number_is_automatic: true,
            card_validity_months: identity.validityMonths,
            initial_salary_auto_activated: true,
            initial_salary_profile_id: salaryResult.insertId,
            initial_pay_frequency: initialSalary.pay_frequency,
          }),
          req.user.id,
        ]
      );

      await connection.commit();

      await writeAuditEvent({
        req,
        action: "EXPANDED_WORKER_PROFILE_CREATED",
        actionType: "workforce.profile.created",
        entityType: "worker",
        entityId: result.insertId,
        severity: "notice",
        details:
          `Expanded worker profile ${payload.employee_number} was created with automatic identity and an active initial payroll salary record.`,
        metadata: {
          initial_salary_profile_id: salaryResult.insertId,
          initial_salary_effective_from: initialSalary.effective_from,
          initial_pay_frequency: initialSalary.pay_frequency,
        },
      });

      return res.status(201).json({
        status: "success",
        message:
          `Worker profile created. Employee number ${payload.employee_number} was generated automatically and the initial salary is active in Payroll.`,
        employee_number_is_automatic: true,
        card_validity_months: identity.validityMonths,
        initial_salary_auto_activated: true,
        initial_salary: {
          profile_id: salaryResult.insertId,
          basic_salary: initialSalary.basic_salary,
          pay_frequency: initialSalary.pay_frequency,
          effective_from: initialSalary.effective_from,
        },
        worker: await loadExpandedWorker(result.insertId, req),
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message:
            "The generated employee number, linked account or another unique value is already assigned.",
        });
      }

      throw error;
    } finally {
      connection.release();
    }
  })
);

router.get(
  "/workers-expanded/:id",
  requireAuth,
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);

    const worker = workerId
      ? await loadExpandedWorker(workerId, req)
      : null;

    if (!worker) {
      return res.status(404).json({
        status: "error",
        message: "Worker profile not found.",
      });
    }

    return res.json({
      status: "success",
      worker,
    });
  })
);

router.put(
  "/workers-expanded/:id",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const payload = profilePayload(req.body);
    const reason = cleanText(
      req.body?.change_reason,
      2000
    );

    if (
      !workerId ||
      !payload.full_name ||
      !reason
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Worker, full legal name and change reason are required.",
      });
    }

    const workspaceCode = activeWorkerWorkspace(req);
    await validateWorkerLinks({ payload, workspaceCode, workerId });

    const [beforeRows] = await pool.query(
      `SELECT *
       FROM worker_profiles
       WHERE id = ?
         AND workspace_code = ?
       LIMIT 1`,
      [workerId, workspaceCode]
    );

    if (!beforeRows.length) {
      return res.status(404).json({
        status: "error",
        message: "Worker profile not found.",
      });
    }

    // Employee number, card serial and validity are controlled by the identity service.
    payload.employee_number = beforeRows[0].employee_number;
    payload.id_card_serial = beforeRows[0].id_card_serial;
    payload.id_card_issue_date = beforeRows[0].id_card_issue_date;
    payload.id_card_expiry_date = beforeRows[0].id_card_expiry_date;

    try {
      const assignments = PROFILE_EDIT_COLUMNS.map(
        (column) => `${column} = ?`
      );

      await pool.query(
        `UPDATE worker_profiles
         SET ${assignments.join(", ")},
             updated_by = ?
         WHERE id = ?
           AND workspace_code = ?`,
        [
          ...PROFILE_EDIT_COLUMNS.map(
            (column) => payload[column]
          ),
          req.user.id,
          workerId,
          workspaceCode,
        ]
      );

      const [afterRows] = await pool.query(
        `SELECT *
         FROM worker_profiles
         WHERE id = ?
           AND workspace_code = ?
         LIMIT 1`,
        [workerId, workspaceCode]
      );

      await pool.query(
        `INSERT INTO worker_profile_change_history (
           worker_id,
           change_type,
           reason,
           before_json,
           after_json,
           changed_by
         )
         VALUES (?, 'profile_update', ?, ?, ?, ?)`,
        [
          workerId,
          reason,
          safeJson(beforeRows[0]),
          safeJson(afterRows[0]),
          req.user.id,
        ]
      );

      await writeAuditEvent({
        req,
        action: "EXPANDED_WORKER_PROFILE_UPDATED",
        actionType: "workforce.profile.updated",
        entityType: "worker",
        entityId: workerId,
        severity: "notice",
        details:
          `Expanded worker profile ${payload.employee_number} was updated. Reason: ${reason}`,
      });

      return res.json({
        status: "success",
        message: "Worker profile updated successfully.",
        worker: await loadExpandedWorker(workerId, req),
      });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message:
            "The employee number, linked account or another unique value is already assigned.",
        });
      }

      throw error;
    }
  })
);

router.post(
  "/workers-expanded/:id/reissue-id-card",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const reason = cleanText(req.body?.reason, 1000);

    if (!workerId || !reason) {
      return res.status(400).json({
        status: "error",
        message: "Worker and reissue reason are required.",
      });
    }

    const workspaceCode = activeWorkerWorkspace(req);
    const [beforeRows] = await pool.query(
      `SELECT id, employee_number, id_card_issue_date, id_card_expiry_date, id_card_serial
       FROM worker_profiles
       WHERE id = ? AND workspace_code = ?
       LIMIT 1`,
      [workerId, workspaceCode]
    );

    if (!beforeRows.length) {
      return res.status(404).json({
        status: "error",
        message: "Worker profile not found.",
      });
    }

    const dates = await cardDatesForReissue(new Date());
    const serial = beforeRows[0].id_card_serial || beforeRows[0].employee_number;

    await pool.query(
      `UPDATE worker_profiles
       SET id_card_issue_date = ?,
           id_card_expiry_date = ?,
           id_card_serial = ?,
           updated_by = ?
       WHERE id = ? AND workspace_code = ?`,
      [dates.issueDate, dates.expiryDate, serial, req.user.id, workerId, workspaceCode]
    );

    await pool.query(
      `INSERT INTO worker_profile_change_history (
         worker_id, change_type, reason, before_json, after_json, changed_by
       ) VALUES (?, 'id_card_reissued', ?, ?, ?, ?)`,
      [
        workerId,
        reason,
        safeJson(beforeRows[0]),
        safeJson({
          employee_number: beforeRows[0].employee_number,
          id_card_serial: serial,
          id_card_issue_date: dates.issueDate,
          id_card_expiry_date: dates.expiryDate,
          card_validity_months: dates.validityMonths,
        }),
        req.user.id,
      ]
    );

    await writeAuditEvent({
      req,
      action: "WORKER_ID_CARD_REISSUED",
      actionType: "workforce.id_card.reissued",
      entityType: "worker",
      entityId: workerId,
      severity: "notice",
      details:
        `Worker ID card was reissued until ${dates.expiryDate}. Reason: ${reason}`,
    });

    return res.json({
      status: "success",
      message:
        `ID card reissued successfully. New expiry date: ${dates.expiryDate}.`,
      card_validity_months: dates.validityMonths,
      worker: await loadExpandedWorker(workerId, req),
    });
  })
);

router.get(
  "/workers-expanded/:id/photo",
  requireAuth,
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);

    const [rows] = await pool.query(
      `SELECT
         file.original_filename,
         file.mime_type,
         file.file_size_bytes,
         file.checksum_sha256,
         file.file_data
       FROM worker_private_files file
       INNER JOIN worker_profiles worker
         ON worker.id = file.worker_id
       WHERE file.worker_id = ?
         AND worker.workspace_code = ?
         AND file.file_category = 'photo'
         AND file.is_current = TRUE
         AND file.is_active = TRUE
       ORDER BY file.id DESC
       LIMIT 1`,
      [workerId, activeWorkerWorkspace(req)]
    );

    if (!rows.length) {
      return res.status(404).json({
        status: "error",
        message: "Worker photograph not found.",
      });
    }

    const photo = rows[0];

    res.setHeader("Content-Type", photo.mime_type);
    res.setHeader(
      "Content-Length",
      String(photo.file_size_bytes)
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${safeFilename(
        photo.original_filename
      )}"`
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "X-Content-SHA256",
      photo.checksum_sha256
    );

    return res.end(photo.file_data);
  })
);

router.post(
  "/workers-expanded/:id/photo",
  requireAuth,
  requirePermission("workers.manage"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);

    if (!workerId || !(await workerExists(workerId, req))) {
      return res.status(404).json({
        status: "error",
        message: "Worker profile not found.",
      });
    }

    const upload = decodeUpload({
      dataBase64: req.body?.data_base64,
      mimeType: req.body?.mime_type,
      allowedTypes: PHOTO_MIME_TYPES,
      maxBytes: MAX_PHOTO_BYTES,
    });

    const filename = safeFilename(
      req.body?.file_name || "worker-photo"
    );

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE worker_private_files
         SET is_current = FALSE
         WHERE worker_id = ?
           AND file_category = 'photo'
           AND is_current = TRUE`,
        [workerId]
      );

      await connection.query(
        `INSERT INTO worker_private_files (
           worker_id,
           file_category,
           title,
           original_filename,
           mime_type,
           file_size_bytes,
           checksum_sha256,
           file_data,
           is_current,
           is_active,
           uploaded_by
         )
         VALUES (
           ?,
           'photo',
           'Worker Profile Photograph',
           ?,
           ?,
           ?,
           ?,
           ?,
           TRUE,
           TRUE,
           ?
         )`,
        [
          workerId,
          filename,
          upload.mimeType,
          upload.buffer.length,
          upload.checksum,
          upload.buffer,
          req.user.id,
        ]
      );

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }

      throw error;
    } finally {
      connection.release();
    }

    await writeAuditEvent({
      req,
      action: "WORKER_PHOTO_UPLOADED",
      actionType: "workforce.photo.uploaded",
      entityType: "worker",
      entityId: workerId,
      severity: "notice",
      details:
        `A private worker photograph was uploaded. SHA-256: ${upload.checksum}`,
    });

    return res.status(201).json({
      status: "success",
      message: "Worker photograph uploaded successfully.",
      checksum_sha256: upload.checksum,
      file_size_bytes: upload.buffer.length,
    });
  })
);

router.post(
  "/workers-expanded/:id/family",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const fullName = cleanText(req.body?.full_name, 180);
    const relationship = cleanText(
      req.body?.relationship_type,
      60
    );

    if (
      !workerId ||
      !(await workerExists(workerId, req)) ||
      !fullName ||
      !relationship
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Worker, relationship and family member name are required.",
      });
    }

    await pool.query(
      `INSERT INTO worker_family_members (
         worker_id,
         relationship_type,
         full_name,
         phone,
         date_of_birth,
         occupation,
         residential_address,
         is_dependent,
         is_next_of_kin,
         notes,
         created_by
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workerId,
        relationship,
        fullName,
        nullableText(req.body?.phone, 30),
        dateOnly(req.body?.date_of_birth),
        nullableText(req.body?.occupation, 150),
        nullableText(
          req.body?.residential_address,
          2000
        ),
        booleanValue(req.body?.is_dependent) ? 1 : 0,
        booleanValue(req.body?.is_next_of_kin) ? 1 : 0,
        nullableText(req.body?.notes, 2000),
        req.user.id,
      ]
    );

    return res.status(201).json({
      status: "success",
      message: "Family member recorded successfully.",
      worker: await loadExpandedWorker(workerId, req),
    });
  })
);

router.delete(
  "/workers-expanded/:id/family/:familyId",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const familyId = positiveId(req.params.familyId);

    await pool.query(
      `DELETE FROM worker_family_members
       WHERE id = ?
         AND worker_id = ?`,
      [familyId, workerId]
    );

    return res.json({
      status: "success",
      message: "Family member removed.",
      worker: await loadExpandedWorker(workerId, req),
    });
  })
);

router.post(
  "/workers-expanded/:id/emergency-contacts",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const fullName = cleanText(req.body?.full_name, 180);
    const relationship = cleanText(
      req.body?.relationship_type,
      80
    );
    const primaryPhone = cleanText(
      req.body?.primary_phone,
      30
    );

    if (
      !workerId ||
      !(await workerExists(workerId, req)) ||
      !fullName ||
      !relationship ||
      !primaryPhone
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Worker, contact name, relationship and primary phone are required.",
      });
    }

    const isPrimary = booleanValue(req.body?.is_primary);

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      if (isPrimary) {
        await connection.query(
          `UPDATE worker_emergency_contacts
           SET is_primary = FALSE
           WHERE worker_id = ?`,
          [workerId]
        );
      }

      await connection.query(
        `INSERT INTO worker_emergency_contacts (
           worker_id,
           full_name,
           relationship_type,
           primary_phone,
           secondary_phone,
           residential_address,
           priority_order,
           is_primary,
           notes,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workerId,
          fullName,
          relationship,
          primaryPhone,
          nullableText(req.body?.secondary_phone, 30),
          nullableText(
            req.body?.residential_address,
            2000
          ),
          Math.max(
            Number(req.body?.priority_order || 1),
            1
          ),
          isPrimary ? 1 : 0,
          nullableText(req.body?.notes, 2000),
          req.user.id,
        ]
      );

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }

      throw error;
    } finally {
      connection.release();
    }

    return res.status(201).json({
      status: "success",
      message: "Emergency contact recorded successfully.",
      worker: await loadExpandedWorker(workerId, req),
    });
  })
);

router.delete(
  "/workers-expanded/:id/emergency-contacts/:contactId",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const contactId = positiveId(req.params.contactId);

    await pool.query(
      `DELETE FROM worker_emergency_contacts
       WHERE id = ?
         AND worker_id = ?`,
      [contactId, workerId]
    );

    return res.json({
      status: "success",
      message: "Emergency contact removed.",
      worker: await loadExpandedWorker(workerId, req),
    });
  })
);

router.post(
  "/workers-expanded/:id/files",
  requireAuth,
  requirePermission(
    "workers.documents.manage",
    "workers.documents.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const title = cleanText(req.body?.title, 180);

    if (
      !workerId ||
      !(await workerExists(workerId, req)) ||
      !title
    ) {
      return res.status(400).json({
        status: "error",
        message: "Worker and document title are required.",
      });
    }

    const upload = decodeUpload({
      dataBase64: req.body?.data_base64,
      mimeType: req.body?.mime_type,
      allowedTypes: DOCUMENT_MIME_TYPES,
      maxBytes: MAX_DOCUMENT_BYTES,
    });

    const filename = safeFilename(
      req.body?.file_name || title
    );

    const documentType =
      cleanText(req.body?.document_type, 100) ||
      "other";

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [fileResult] = await connection.query(
        `INSERT INTO worker_private_files (
           worker_id,
           file_category,
           title,
           document_type,
           document_number,
           original_filename,
           mime_type,
           file_size_bytes,
           checksum_sha256,
           file_data,
           issued_date,
           expiry_date,
           is_current,
           is_active,
           notes,
           uploaded_by
         )
         VALUES (
           ?,
           'document',
           ?,
           ?,
           ?,
           ?,
           ?,
           ?,
           ?,
           ?,
           ?,
           ?,
           TRUE,
           TRUE,
           ?,
           ?
         )`,
        [
          workerId,
          title,
          documentType,
          nullableText(req.body?.document_number, 120),
          filename,
          upload.mimeType,
          upload.buffer.length,
          upload.checksum,
          upload.buffer,
          dateOnly(req.body?.issued_date),
          dateOnly(req.body?.expiry_date),
          nullableText(req.body?.notes, 2000),
          req.user.id,
        ]
      );

      const fileId = fileResult.insertId;

      const [documentResult] = await connection.query(
        `INSERT INTO worker_documents (
           worker_id,
           document_type,
           title,
           document_number,
           private_storage_key,
           checksum_sha256,
           issued_date,
           expiry_date,
           status,
           notes,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, ?)`,
        [
          workerId,
          documentType,
          title,
          nullableText(req.body?.document_number, 120),
          `database://worker_private_files/${fileId}`,
          upload.checksum,
          dateOnly(req.body?.issued_date),
          dateOnly(req.body?.expiry_date),
          nullableText(req.body?.notes, 2000),
          req.user.id,
        ]
      );

      await connection.query(
        `UPDATE worker_private_files
         SET related_record_type = 'worker_document',
             related_record_id = ?
         WHERE id = ?`,
        [documentResult.insertId, fileId]
      );

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }

      throw error;
    } finally {
      connection.release();
    }

    await writeAuditEvent({
      req,
      action: "WORKER_PRIVATE_DOCUMENT_UPLOADED",
      actionType: "workforce.document.uploaded",
      entityType: "worker",
      entityId: workerId,
      severity: "notice",
      details:
        `Private worker document "${title}" was uploaded. SHA-256: ${upload.checksum}`,
    });

    return res.status(201).json({
      status: "success",
      message: "Private worker document uploaded successfully.",
      checksum_sha256: upload.checksum,
      file_size_bytes: upload.buffer.length,
      worker: await loadExpandedWorker(workerId, req),
    });
  })
);

router.get(
  "/workers-expanded/:id/files/:fileId/download",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const fileId = positiveId(req.params.fileId);

    const [rows] = await pool.query(
      `SELECT
         original_filename,
         mime_type,
         file_size_bytes,
         checksum_sha256,
         file_data
       FROM worker_private_files file
       INNER JOIN worker_profiles wp ON wp.id = file.worker_id
       WHERE file.id = ?
         AND file.worker_id = ?
         AND wp.workspace_code = ?
         AND file.is_active = TRUE
         AND file.file_category <> 'photo'
       LIMIT 1`,
      [fileId, workerId, activeWorkerWorkspace(req)]
    );

    if (!rows.length) {
      return res.status(404).json({
        status: "error",
        message: "Private worker document not found.",
      });
    }

    const file = rows[0];

    res.setHeader("Content-Type", file.mime_type);
    res.setHeader(
      "Content-Length",
      String(file.file_size_bytes)
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFilename(
        file.original_filename
      )}"`
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "X-Content-SHA256",
      file.checksum_sha256
    );

    return res.end(file.file_data);
  })
);

module.exports = router;