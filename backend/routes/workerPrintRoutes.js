const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const {
  requireAuth,
} = require("../middleware/authMiddleware");
const {
  requirePermission,
} = require("../middleware/permissionMiddleware");
const {
  writeAuditEvent,
} = require("../services/auditTrailService");
const {
  calculateCardDates,
  ensureWorkerIdentitySchema,
  loadWorkerIdentitySettings,
} = require("../services/workerIdentityService");
const {
  normalizePdfImageBuffer,
} = require("../services/pdfImageService");

const router = express.Router();

const POINTS_PER_MM = 72 / 25.4;
const CARD_WIDTH = 85.6 * POINTS_PER_MM;
const CARD_HEIGHT = 53.98 * POINTS_PER_MM;

const NAVY = "#07182c";
const NAVY_LIGHT = "#153f68";
const GOLD = "#e7bf2e";
const WHITE = "#ffffff";
const TEXT = "#172033";
const MUTED = "#64748b";
const BORDER = "#dbe4ef";
const LIGHT = "#f8fafc";
const DANGER = "#991b1b";
const GHANA_RED = "#ce1126";
const GHANA_GREEN = "#006b3f";
const CARD_INK = "#0b1f33";
const CARD_SOFT = "#eef3f7";

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function positiveId(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function displayValue(value, fallback = "-") {
  const text = cleanText(value, 500);
  return text || fallback;
}

function titleCase(value) {
  return displayValue(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value, fallback = "-") {
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return displayValue(value, fallback);
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value = new Date()) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeFilename(value) {
  return (
    cleanText(value, 180)
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") ||
    "worker-document"
  );
}

function initials(name) {
  const value = cleanText(name, 180);

  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "C03"
  );
}

function findLogoPath() {
  const candidates = [
    path.resolve(
      __dirname,
      "..",
      "..",
      "frontend",
      "public",
      "chalin03-logo.png"
    ),

    path.resolve(
      process.cwd(),
      "..",
      "frontend",
      "public",
      "chalin03-logo.png"
    ),

    path.resolve(
      process.cwd(),
      "frontend",
      "public",
      "chalin03-logo.png"
    ),

    path.resolve(
      __dirname,
      "..",
      "assets",
      "chalin03-logo.png"
    ),
  ];

  return (
    candidates.find((candidate) =>
      fs.existsSync(candidate)
    ) || null
  );
}

const LOGO_PATH = findLogoPath();

function drawFallbackLogo(doc, x, y, size) {
  doc.save();

  doc
    .roundedRect(x, y, size, size, size * 0.2)
    .fill(NAVY);

  doc
    .lineWidth(Math.max(size * 0.035, 1))
    .strokeColor(GOLD)
    .roundedRect(
      x + size * 0.06,
      y + size * 0.06,
      size * 0.88,
      size * 0.88,
      size * 0.16
    )
    .stroke();

  doc
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(size * 0.26)
    .text(
      "C03",
      x,
      y + size * 0.34,
      {
        width: size,
        align: "center",
        lineBreak: false,
      }
    );

  doc.restore();
}

function drawLogo(doc, x, y, size) {
  if (LOGO_PATH) {
    try {
      doc
        .save()
        .roundedRect(x, y, size, size, size * 0.18)
        .clip();

      doc.image(LOGO_PATH, x, y, {
        fit: [size, size],
        align: "center",
        valign: "center",
      });

      doc.restore();
      return;
    } catch {
      try {
        doc.restore();
      } catch {
        // No active graphics state.
      }
    }
  }

  drawFallbackLogo(doc, x, y, size);
}

function drawPhoto(
  doc,
  photoBuffer,
  fullName,
  x,
  y,
  width,
  height,
  options = {}
) {
  const radius = options.radius ?? 8;
  const borderColor = options.borderColor || GOLD;
  const background = options.background || "#e7eef8";

  doc
    .save()
    .roundedRect(x, y, width, height, radius)
    .fill(background);

  if (photoBuffer && Buffer.isBuffer(photoBuffer)) {
    try {
      doc
        .roundedRect(x, y, width, height, radius)
        .clip();

      doc.image(photoBuffer, x, y, {
        fit: [width, height],
        align: "center",
        valign: "center",
      });
    } catch {
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(Math.min(width, height) * 0.25)
        .text(
          initials(fullName),
          x,
          y + height * 0.38,
          {
            width,
            align: "center",
            lineBreak: false,
          }
        );
    }
  } else {
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(Math.min(width, height) * 0.25)
      .text(
        initials(fullName),
        x,
        y + height * 0.38,
        {
          width,
          align: "center",
          lineBreak: false,
        }
      );
  }

  doc.restore();

  doc
    .lineWidth(1.2)
    .strokeColor(borderColor)
    .roundedRect(x, y, width, height, radius)
    .stroke();
}

function renderPdf(options, buildDocument) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(options);
    const chunks = [];
    let completed = false;

    doc.on("data", (chunk) => {
      chunks.push(chunk);
    });

    doc.on("end", () => {
      if (completed) return;
      completed = true;
      resolve(Buffer.concat(chunks));
    });

    doc.on("error", (error) => {
      if (completed) return;
      completed = true;
      reject(error);
    });

    try {
      buildDocument(doc);
      doc.end();
    } catch (error) {
      if (!completed) {
        completed = true;
        reject(error);
      }
    }
  });
}

async function loadWorkerPrintData(workerId) {
  await ensureWorkerIdentitySchema();
  const identitySettings = await loadWorkerIdentitySettings();
  const [profileRows] = await pool.query(
    `SELECT
       wp.*,
       u.username,
       u.role AS account_role,
       u.is_active AS account_is_active,
       supervisor.full_name AS supervisor_name,
       photo.file_data AS photo_data,
       photo.mime_type AS photo_mime_type
     FROM worker_profiles wp

     LEFT JOIN users u
       ON u.id = wp.user_id

     LEFT JOIN worker_profiles supervisor
       ON supervisor.id = wp.supervisor_worker_id

     LEFT JOIN worker_private_files photo
       ON photo.id = (
         SELECT latest_photo.id
         FROM worker_private_files latest_photo
         WHERE latest_photo.worker_id = wp.id
           AND latest_photo.file_category = 'photo'
           AND latest_photo.is_current = TRUE
           AND latest_photo.is_active = TRUE
         ORDER BY latest_photo.id DESC
         LIMIT 1
       )

     WHERE wp.id = ?
     LIMIT 1`,
    [workerId]
  );

  if (!profileRows.length) {
    return null;
  }

  profileRows[0].photo_data = await normalizePdfImageBuffer(
    profileRows[0].photo_data,
    profileRows[0].photo_mime_type
  );

  const [
    [assignments],
    [family],
    [emergencyContacts],
    [licenses],
    [documents],
    [property],
    [settingsRows],
  ] = await Promise.all([
    pool.query(
      `SELECT *
       FROM worker_assignments
       WHERE worker_id = ?
       ORDER BY is_active DESC, id DESC`,
      [workerId]
    ),

    pool.query(
      `SELECT *
       FROM worker_family_members
       WHERE worker_id = ?
       ORDER BY
         is_next_of_kin DESC,
         is_dependent DESC,
         id ASC`,
      [workerId]
    ),

    pool.query(
      `SELECT *
       FROM worker_emergency_contacts
       WHERE worker_id = ?
       ORDER BY
         is_primary DESC,
         priority_order ASC,
         id ASC`,
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
      `SELECT
         document_type,
         title,
         document_number,
         issued_date,
         expiry_date,
         status,
         notes,
         checksum_sha256
       FROM worker_documents
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
         business_name,
         branch_name,
         business_address,
         business_phone,
         owner_phone,
         receipt_footer
       FROM settings
       ORDER BY
         CASE WHEN branch_id = 1 THEN 0 ELSE 1 END,
         id ASC
       LIMIT 1`
    ),
  ]);

  const settings = settingsRows[0] || {};
  const cardDates = calculateCardDates(
    profileRows[0].id_card_issue_date ||
      profileRows[0].employment_start_date ||
      new Date(),
    identitySettings.validityMonths
  );

  profileRows[0].id_card_issue_date =
    profileRows[0].id_card_issue_date || cardDates.issueDate;
  profileRows[0].id_card_expiry_date =
    profileRows[0].id_card_expiry_date || cardDates.expiryDate;
  profileRows[0].id_card_serial =
    profileRows[0].id_card_serial || profileRows[0].employee_number;

  return {
    profile: profileRows[0],
    assignments,
    family,
    emergency_contacts: emergencyContacts,
    licenses,
    documents,
    property,
    company: {
      name:
        settings.business_name ||
        "Chalin 03 Company Limited",

      address:
        settings.business_address ||
        "Dunkwa Police Barrier, Ghana",

      phone:
        settings.business_phone ||
        settings.owner_phone ||
        "0249469080",

      footer:
        settings.receipt_footer ||
        "Official Chalin 03 Company Limited personnel document.",
    },
  };
}

function ensureSpace(doc, requiredHeight, continuationHeader) {
  const bottom =
    doc.page.height -
    doc.page.margins.bottom;

  if (doc.y + requiredHeight <= bottom) {
    return;
  }

  doc.addPage();

  if (continuationHeader) {
    continuationHeader();
  }
}

function drawProfileDocumentHeader(
  doc,
  data,
  continuation = false
) {
  const left = doc.page.margins.left;
  const width =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  doc
    .save()
    .roundedRect(
      left,
      doc.page.margins.top,
      width,
      continuation ? 56 : 72,
      12
    )
    .fill(NAVY);

  drawLogo(
    doc,
    left + 12,
    doc.page.margins.top + 10,
    continuation ? 36 : 50
  );

  doc
    .fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(continuation ? 14 : 18)
    .text(
      data.company.name.toUpperCase(),
      left + (continuation ? 58 : 74),
      doc.page.margins.top + 12,
      {
        width: width - 90,
        lineBreak: false,
        ellipsis: true,
      }
    );

  doc
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(continuation ? 9 : 11)
    .text(
      continuation
        ? "OFFICIAL WORKER PROFILE — CONTINUED"
        : "OFFICIAL WORKER PROFILE DOCUMENT",
      left + (continuation ? 58 : 74),
      doc.page.margins.top + (continuation ? 33 : 39),
      {
        width: width - 90,
        lineBreak: false,
      }
    );

  doc.restore();

  doc.y =
    doc.page.margins.top +
    (continuation ? 70 : 88);
}

function drawSectionTitle(doc, title, continuationHeader) {
  ensureSpace(doc, 35, continuationHeader);

  const left = doc.page.margins.left;
  const width =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  doc
    .save()
    .roundedRect(left, doc.y, width, 25, 6)
    .fill("#eaf0f8");

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(
      title.toUpperCase(),
      left + 10,
      doc.y + 7,
      {
        width: width - 20,
        lineBreak: false,
      }
    );

  doc.restore();
  doc.y += 33;
}

function drawDetailGrid(
  doc,
  details,
  continuationHeader
) {
  const left = doc.page.margins.left;
  const usableWidth =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  const gap = 10;
  const columnWidth =
    (usableWidth - gap) / 2;

  for (
    let index = 0;
    index < details.length;
    index += 2
  ) {
    ensureSpace(doc, 46, continuationHeader);

    const rowY = doc.y;
    const row = details.slice(index, index + 2);

    row.forEach(([label, value], columnIndex) => {
      const x =
        left +
        columnIndex *
          (columnWidth + gap);

      doc
        .save()
        .roundedRect(
          x,
          rowY,
          columnWidth,
          38,
          6
        )
        .fill(LIGHT)
        .strokeColor(BORDER)
        .lineWidth(0.7)
        .stroke();

      doc
        .fillColor(MUTED)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(
          String(label).toUpperCase(),
          x + 8,
          rowY + 6,
          {
            width: columnWidth - 16,
            lineBreak: false,
            ellipsis: true,
          }
        );

      doc
        .fillColor(TEXT)
        .font("Helvetica")
        .fontSize(9)
        .text(
          displayValue(value),
          x + 8,
          rowY + 18,
          {
            width: columnWidth - 16,
            height: 15,
            lineBreak: false,
            ellipsis: true,
          }
        );

      doc.restore();
    });

    doc.y = rowY + 44;
  }
}

function drawTable(
  doc,
  headers,
  rows,
  proportions,
  continuationHeader
) {
  const left = doc.page.margins.left;
  const width =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  const widths = proportions.map(
    (proportion) => width * proportion
  );

  function drawHeader() {
    ensureSpace(doc, 25, continuationHeader);

    const y = doc.y;
    let x = left;

    headers.forEach((header, index) => {
      doc
        .save()
        .rect(x, y, widths[index], 22)
        .fill(NAVY_LIGHT);

      doc
        .fillColor(WHITE)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(
          String(header).toUpperCase(),
          x + 5,
          y + 7,
          {
            width: widths[index] - 10,
            lineBreak: false,
            ellipsis: true,
          }
        );

      doc.restore();
      x += widths[index];
    });

    doc.y = y + 22;
  }

  drawHeader();

  if (!rows.length) {
    ensureSpace(doc, 32, continuationHeader);

    doc
      .save()
      .rect(left, doc.y, width, 28)
      .fill(LIGHT);

    doc
      .fillColor(MUTED)
      .font("Helvetica-Oblique")
      .fontSize(8)
      .text(
        "No records entered.",
        left + 8,
        doc.y + 9
      );

    doc.restore();
    doc.y += 34;
    return;
  }

  rows.forEach((row, rowIndex) => {
    if (
      doc.y + 31 >
      doc.page.height -
        doc.page.margins.bottom
    ) {
      doc.addPage();
      continuationHeader();
      drawHeader();
    }

    const y = doc.y;
    let x = left;

    row.forEach((value, columnIndex) => {
      doc
        .save()
        .rect(
          x,
          y,
          widths[columnIndex],
          28
        )
        .fill(
          rowIndex % 2 === 0
            ? WHITE
            : LIGHT
        )
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .stroke();

      doc
        .fillColor(TEXT)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          displayValue(value),
          x + 5,
          y + 7,
          {
            width:
              widths[columnIndex] - 10,
            height: 17,
            lineBreak: false,
            ellipsis: true,
          }
        );

      doc.restore();
      x += widths[columnIndex];
    });

    doc.y = y + 28;
  });

  doc.y += 7;
}

function buildWorkerProfilePdf(data, generatedBy) {
  const profile = data.profile;

  return renderPdf(
    {
      size: "A4",
      layout: "portrait",
      margins: {
        top: 34,
        bottom: 40,
        left: 34,
        right: 34,
      },
      bufferPages: true,
      info: {
        Title:
          `Official Worker Profile - ${profile.full_name}`,
        Author: data.company.name,
        Subject:
          "Official Chalin 03 worker personnel profile",
        Creator:
          "Chalin 03 Group Operations Platform",
      },
    },
    (doc) => {
      const continuationHeader = () =>
        drawProfileDocumentHeader(
          doc,
          data,
          true
        );

      drawProfileDocumentHeader(doc, data, false);

      const left = doc.page.margins.left;
      const photoWidth = 105;
      const photoHeight = 126;
      const photoX =
        doc.page.width -
        doc.page.margins.right -
        photoWidth;

      const summaryWidth =
        photoX - left - 18;

      drawPhoto(
        doc,
        profile.photo_data,
        profile.full_name,
        photoX,
        doc.y,
        photoWidth,
        photoHeight,
        {
          radius: 9,
        }
      );

      doc
        .fillColor(GOLD)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          displayValue(
            profile.employee_number
          ),
          left,
          doc.y + 4,
          {
            width: summaryWidth,
            lineBreak: false,
          }
        );

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(20)
        .text(
          displayValue(profile.full_name),
          left,
          doc.y + 21,
          {
            width: summaryWidth,
            height: 48,
            ellipsis: true,
          }
        );

      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(10)
        .text(
          [
            profile.job_title,
            profile.department,
          ]
            .filter(Boolean)
            .join(" • ") ||
            "Job details not recorded",
          left,
          doc.y + 70,
          {
            width: summaryWidth,
            height: 30,
            ellipsis: true,
          }
        );

      doc
        .fillColor(TEXT)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          `STATUS: ${titleCase(
            profile.employment_status
          )}`,
          left,
          doc.y + 108,
          {
            width: summaryWidth,
            lineBreak: false,
          }
        );

      doc.y += photoHeight + 17;

      drawSectionTitle(
        doc,
        "Personal and Contact Information",
        continuationHeader
      );

      drawDetailGrid(
        doc,
        [
          [
            "Employee Number",
            profile.employee_number,
          ],
          [
            "Preferred Name",
            profile.preferred_name,
          ],
          ["Phone", profile.phone],
          ["Email", profile.email],
          [
            "Date of Birth",
            formatDate(profile.date_of_birth),
          ],
          ["Gender", profile.gender],
          [
            "Nationality",
            profile.nationality,
          ],
          [
            "Marital Status",
            profile.marital_status,
          ],
          ["Hometown", profile.hometown],
          [
            "GhanaPost Address",
            profile.digital_address,
          ],
          [
            "Residential Address",
            profile.residential_address,
          ],
          [
            "Blood Group",
            profile.blood_group,
          ],
        ],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Identification and Employment",
        continuationHeader
      );

      drawDetailGrid(
        doc,
        [
          [
            "National ID Type",
            profile.national_id_type,
          ],
          [
            "National ID Number",
            profile.national_id_number,
          ],
          [
            "National ID Issue",
            formatDate(
              profile.national_id_issue_date
            ),
          ],
          [
            "National ID Expiry",
            formatDate(
              profile.national_id_expiry_date
            ),
          ],
          [
            "SSNIT Number",
            profile.ssnit_number,
          ],
          ["TIN Number", profile.tin_number],
          ["Job Title", profile.job_title],
          ["Department", profile.department],
          [
            "Employment Type",
            titleCase(
              profile.employment_type
            ),
          ],
          [
            "Employment Start",
            formatDate(
              profile.employment_start_date
            ),
          ],
          [
            "Employment End",
            formatDate(
              profile.employment_end_date
            ),
          ],
          [
            "Supervisor",
            profile.supervisor_name,
          ],
          [
            "Linked Account",
            profile.username,
          ],
          [
            "Account Role",
            profile.account_role,
          ],
          [
            "ID Card Serial",
            profile.id_card_serial ||
              profile.employee_number,
          ],
          [
            "ID Card Issue",
            formatDate(
              profile.id_card_issue_date,
              "Not issued"
            ),
          ],
          [
            "ID Card Expiry",
            formatDate(
              profile.id_card_expiry_date,
              "Employment duration"
            ),
          ],
        ],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Workspace and Location Assignments",
        continuationHeader
      );

      drawTable(
        doc,
        [
          "Workspace",
          "Location / Context",
          "Role / Duty",
          "Start",
          "Status",
        ],
        data.assignments.map((item) => [
          titleCase(item.workspace_code),
          item.context_label || "Group-wide",
          item.role_code || "-",
          formatDate(item.assignment_start),
          item.is_active ? "Active" : "Ended",
        ]),
        [0.18, 0.29, 0.2, 0.16, 0.17],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Family, Dependants and Next of Kin",
        continuationHeader
      );

      drawTable(
        doc,
        [
          "Name",
          "Relationship",
          "Phone",
          "Dependant",
          "Next of Kin",
        ],
        data.family.map((item) => [
          item.full_name,
          titleCase(item.relationship_type),
          item.phone || "-",
          item.is_dependent ? "Yes" : "No",
          item.is_next_of_kin ? "Yes" : "No",
        ]),
        [0.28, 0.2, 0.2, 0.15, 0.17],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Emergency Contacts",
        continuationHeader
      );

      drawTable(
        doc,
        [
          "Name",
          "Relationship",
          "Primary Phone",
          "Secondary Phone",
          "Priority",
        ],
        data.emergency_contacts.map(
          (item) => [
            item.full_name,
            titleCase(item.relationship_type),
            item.primary_phone,
            item.secondary_phone || "-",
            item.is_primary
              ? "Primary"
              : String(
                  item.priority_order || "-"
                ),
          ]
        ),
        [0.27, 0.2, 0.2, 0.19, 0.14],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Licences, Permits and Certifications",
        continuationHeader
      );

      drawTable(
        doc,
        [
          "Type",
          "Number",
          "Authority",
          "Issue",
          "Expiry",
        ],
        data.licenses.map((item) => [
          item.license_type,
          item.license_number || "-",
          item.issuing_authority || "-",
          formatDate(item.issued_date),
          formatDate(item.expiry_date),
        ]),
        [0.25, 0.2, 0.23, 0.16, 0.16],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Private Document Register",
        continuationHeader
      );

      drawTable(
        doc,
        [
          "Document",
          "Type",
          "Number",
          "Status",
          "Expiry",
        ],
        data.documents.map((item) => [
          item.title,
          titleCase(item.document_type),
          item.document_number || "-",
          titleCase(item.status),
          formatDate(item.expiry_date),
        ]),
        [0.31, 0.19, 0.2, 0.14, 0.16],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Company Property and PPE",
        continuationHeader
      );

      drawTable(
        doc,
        [
          "Description",
          "Type",
          "Code",
          "Issued",
          "Status",
        ],
        data.property.map((item) => [
          item.description,
          titleCase(item.property_type),
          item.property_code || "-",
          formatDate(item.issued_at),
          titleCase(item.status),
        ]),
        [0.34, 0.18, 0.18, 0.15, 0.15],
        continuationHeader
      );

      drawSectionTitle(
        doc,
        "Private Medical / Safety Notes",
        continuationHeader
      );

      ensureSpace(doc, 55, continuationHeader);

      doc
        .save()
        .roundedRect(
          doc.page.margins.left,
          doc.y,
          doc.page.width -
            doc.page.margins.left -
            doc.page.margins.right,
          45,
          6
        )
        .fill("#fff8e6")
        .strokeColor("#f6d97a")
        .stroke();

      doc
        .fillColor(TEXT)
        .font("Helvetica")
        .fontSize(9)
        .text(
          displayValue(
            profile.medical_notes,
            "No medical or safety notes recorded."
          ),
          doc.page.margins.left + 9,
          doc.y + 9,
          {
            width:
              doc.page.width -
              doc.page.margins.left -
              doc.page.margins.right -
              18,
            height: 28,
            ellipsis: true,
          }
        );

      doc.restore();
      doc.y += 55;

      drawSectionTitle(
        doc,
        "Authorization and Signatures",
        continuationHeader
      );

      ensureSpace(doc, 100, continuationHeader);

      const signatureWidth =
        (
          doc.page.width -
          doc.page.margins.left -
          doc.page.margins.right -
          30
        ) / 3;

      [
        "Worker Signature",
        "HR / Administrator",
        "Authorized Approval",
      ].forEach((label, index) => {
        const x =
          doc.page.margins.left +
          index * (signatureWidth + 15);

        doc
          .moveTo(x, doc.y + 45)
          .lineTo(
            x + signatureWidth,
            doc.y + 45
          )
          .strokeColor(MUTED)
          .lineWidth(0.7)
          .stroke();

        doc
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(7.5)
          .text(
            label,
            x,
            doc.y + 51,
            {
              width: signatureWidth,
              align: "center",
            }
          );
      });

      doc.y += 78;

      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7)
        .text(
          `Generated by ${displayValue(
            generatedBy,
            "Authorized user"
          )} on ${formatDateTime()}. This document contains protected personnel information and must be handled confidentially.`,
          doc.page.margins.left,
          doc.y,
          {
            width:
              doc.page.width -
              doc.page.margins.left -
              doc.page.margins.right,
            align: "center",
          }
        );
    }
  );
}

function fitSingleLine(
  doc,
  text,
  x,
  y,
  width,
  fontSize,
  minimumSize,
  options = {}
) {
  const value = displayValue(text);
  let size = fontSize;

  doc.font(options.font || "Helvetica");

  while (
    size > minimumSize &&
    doc.fontSize(size).widthOfString(value) >
      width
  ) {
    size -= 0.4;
  }

  doc
    .font(options.font || "Helvetica")
    .fontSize(size)
    .fillColor(options.color || TEXT)
    .text(value, x, y, {
      width,
      align: options.align || "left",
      lineBreak: false,
      ellipsis: true,
    });
}

function primaryAssignment(data) {
  return (
    data.assignments.find(
      (item) => item.is_active
    ) ||
    data.assignments[0] ||
    null
  );
}

function primaryEmergencyContact(data) {
  return (
    data.emergency_contacts.find(
      (item) => item.is_primary
    ) ||
    data.emergency_contacts[0] ||
    null
  );
}

function workspaceCardLabel(data) {
  const assignment = primaryAssignment(data);
  if (!assignment) return "GROUP OPERATIONS";

  const workspace = titleCase(assignment.workspace_code || "operations");
  const context = cleanText(assignment.context_label, 80);
  return context ? `${workspace} - ${context}` : workspace;
}

function drawCardSecurityBars(doc, value, x, y, width, height, scale) {
  const source = cleanText(value || "CHALIN03", 80) || "CHALIN03";
  const units = [...source].map((character) => character.charCodeAt(0));
  const total = Math.max(units.length * 3, 24);
  const gap = width / total;

  doc.save();
  for (let index = 0; index < total; index += 1) {
    const code = units[index % units.length];
    const lineWidth = ((code + index) % 3 === 0 ? 1.35 : 0.55) * scale;
    const lineHeight = height * (0.58 + ((code + index) % 5) * 0.08);
    doc
      .lineWidth(lineWidth)
      .strokeColor(index % 7 === 0 ? GOLD : CARD_INK)
      .moveTo(x + index * gap, y + height)
      .lineTo(x + index * gap, y + height - lineHeight)
      .stroke();
  }
  doc.restore();
}

function drawIdCardFront(
  doc,
  data,
  x,
  y,
  width,
  height
) {
  const profile = data.profile;
  const scale = width / CARD_WIDTH;
  const workspaceLabel = workspaceCardLabel(data);
  const serial = profile.id_card_serial || profile.employee_number;
  const status = titleCase(profile.employment_status || "active");

  doc.save();
  doc.roundedRect(x, y, width, height, 7 * scale).fill(WHITE);

  doc.rect(x, y, width, 46 * scale).fill(NAVY);
  doc.rect(x, y + 46 * scale, width, 2.5 * scale).fill(GOLD);
  doc.rect(x, y, 3.2 * scale, height / 3).fill(GHANA_RED);
  doc.rect(x, y + height / 3, 3.2 * scale, height / 3).fill(GOLD);
  doc.rect(x, y + (height / 3) * 2, 3.2 * scale, height / 3).fill(GHANA_GREEN);

  doc.save();
  doc.opacity(0.04);
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(31 * scale)
    .text("CHALIN 03", x + 82 * scale, y + 95 * scale, {
      width: width - 94 * scale,
      align: "right",
      lineBreak: false,
    });
  doc.restore();

  doc
    .roundedRect(x + 11 * scale, y + 7 * scale, 35 * scale, 35 * scale, 8 * scale)
    .fill(WHITE);
  drawLogo(doc, x + 14 * scale, y + 10 * scale, 29 * scale);

  fitSingleLine(
    doc,
    data.company.name.toUpperCase(),
    x + 53 * scale,
    y + 8 * scale,
    width - 65 * scale,
    10.5 * scale,
    6.2 * scale,
    { font: "Helvetica-Bold", color: WHITE }
  );

  fitSingleLine(
    doc,
    "OFFICIAL PERSONNEL IDENTIFICATION",
    x + 53 * scale,
    y + 24.5 * scale,
    width - 65 * scale,
    5.8 * scale,
    4.1 * scale,
    { font: "Helvetica-Bold", color: GOLD }
  );

  fitSingleLine(
    doc,
    workspaceLabel.toUpperCase(),
    x + 53 * scale,
    y + 35 * scale,
    width - 65 * scale,
    4.7 * scale,
    3.6 * scale,
    { font: "Helvetica-Bold", color: "#cbd5e1" }
  );

  drawPhoto(
    doc,
    profile.photo_data,
    profile.full_name,
    x + 12 * scale,
    y + 56 * scale,
    68 * scale,
    84 * scale,
    { radius: 7 * scale, borderColor: GOLD, background: CARD_SOFT }
  );

  doc
    .roundedRect(x + 88 * scale, y + 55 * scale, width - 100 * scale, 17 * scale, 8.5 * scale)
    .fill("#fff8dc");
  fitSingleLine(
    doc,
    profile.employee_number,
    x + 95 * scale,
    y + 60 * scale,
    width - 114 * scale,
    7.3 * scale,
    4.8 * scale,
    { font: "Helvetica-Bold", color: NAVY, align: "center" }
  );

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(4.3 * scale)
    .text("EMPLOYEE NAME", x + 90 * scale, y + 79 * scale, {
      width: width - 102 * scale,
      lineBreak: false,
    });

  fitSingleLine(
    doc,
    profile.full_name,
    x + 90 * scale,
    y + 87 * scale,
    width - 102 * scale,
    11.2 * scale,
    6.1 * scale,
    { font: "Helvetica-Bold", color: CARD_INK }
  );

  fitSingleLine(
    doc,
    profile.job_title || "Staff Member",
    x + 90 * scale,
    y + 104 * scale,
    width - 102 * scale,
    6.8 * scale,
    4.5 * scale,
    { font: "Helvetica-Bold", color: NAVY_LIGHT }
  );

  fitSingleLine(
    doc,
    profile.department || "Operations",
    x + 90 * scale,
    y + 116 * scale,
    width - 102 * scale,
    5.2 * scale,
    3.8 * scale,
    { color: MUTED }
  );

  doc
    .roundedRect(x + 88 * scale, y + 128 * scale, width - 100 * scale, 14 * scale, 4 * scale)
    .fill(CARD_SOFT);

  fitSingleLine(
    doc,
    `ISSUED ${formatDate(profile.id_card_issue_date, "NOT SET")}`,
    x + 94 * scale,
    y + 132 * scale,
    59 * scale,
    4.5 * scale,
    3.4 * scale,
    { font: "Helvetica-Bold", color: NAVY }
  );

  fitSingleLine(
    doc,
    `EXPIRES ${formatDate(profile.id_card_expiry_date, "NOT SET")}`,
    x + 155 * scale,
    y + 132 * scale,
    width - 167 * scale,
    4.5 * scale,
    3.4 * scale,
    { font: "Helvetica-Bold", color: NAVY, align: "right" }
  );

  doc
    .roundedRect(x + 12 * scale, y + height - 12.5 * scale, 68 * scale, 8.5 * scale, 4 * scale)
    .fill(NAVY);
  fitSingleLine(
    doc,
    status.toUpperCase(),
    x + 16 * scale,
    y + height - 10.2 * scale,
    60 * scale,
    4.2 * scale,
    3.2 * scale,
    { font: "Helvetica-Bold", color: GOLD, align: "center" }
  );

  fitSingleLine(
    doc,
    `CARD ${serial}`,
    x + 88 * scale,
    y + height - 10.2 * scale,
    width - 100 * scale,
    4.2 * scale,
    3.2 * scale,
    { font: "Helvetica-Bold", color: MUTED, align: "right" }
  );

  doc.restore();
  doc
    .lineWidth(1 * scale)
    .strokeColor(NAVY)
    .roundedRect(x, y, width, height, 7 * scale)
    .stroke();
}

function drawIdCardBack(
  doc,
  data,
  x,
  y,
  width,
  height
) {
  const profile = data.profile;
  const scale = width / CARD_WIDTH;
  const emergency = primaryEmergencyContact(data);
  const serial = profile.id_card_serial || profile.employee_number;
  const workspaceLabel = workspaceCardLabel(data);

  doc.save();
  doc.roundedRect(x, y, width, height, 7 * scale).fill(LIGHT);
  doc.rect(x, y, width, 38 * scale).fill(NAVY);
  doc.rect(x, y + 38 * scale, width, 2.4 * scale).fill(GOLD);

  drawLogo(doc, x + 11 * scale, y + 7 * scale, 24 * scale);
  fitSingleLine(
    doc,
    data.company.name.toUpperCase(),
    x + 43 * scale,
    y + 8 * scale,
    width - 55 * scale,
    8.7 * scale,
    5 * scale,
    { font: "Helvetica-Bold", color: WHITE }
  );
  fitSingleLine(
    doc,
    "SECURE WORKER CREDENTIAL • PROPERTY OF THE COMPANY",
    x + 43 * scale,
    y + 23 * scale,
    width - 55 * scale,
    4.7 * scale,
    3.5 * scale,
    { font: "Helvetica-Bold", color: GOLD }
  );

  doc
    .roundedRect(x + 11 * scale, y + 49 * scale, 103 * scale, 58 * scale, 6 * scale)
    .fill(WHITE)
    .strokeColor(BORDER)
    .lineWidth(0.7 * scale)
    .stroke();

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.2 * scale)
    .text("EMERGENCY & SAFETY", x + 17 * scale, y + 55 * scale, {
      width: 91 * scale,
      lineBreak: false,
    });

  fitSingleLine(
    doc,
    emergency?.full_name || "Not recorded",
    x + 17 * scale,
    y + 67 * scale,
    91 * scale,
    6.7 * scale,
    4.3 * scale,
    { font: "Helvetica-Bold", color: TEXT }
  );
  fitSingleLine(
    doc,
    emergency?.primary_phone || "No phone recorded",
    x + 17 * scale,
    y + 80 * scale,
    91 * scale,
    5.6 * scale,
    3.8 * scale,
    { color: TEXT }
  );
  fitSingleLine(
    doc,
    `Blood group: ${profile.blood_group || "Not recorded"}`,
    x + 17 * scale,
    y + 93 * scale,
    91 * scale,
    5.4 * scale,
    3.8 * scale,
    { font: "Helvetica-Bold", color: profile.blood_group ? DANGER : MUTED }
  );

  doc
    .roundedRect(x + 124 * scale, y + 49 * scale, width - 135 * scale, 58 * scale, 6 * scale)
    .fill(WHITE)
    .strokeColor(BORDER)
    .lineWidth(0.7 * scale)
    .stroke();

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.2 * scale)
    .text("CREDENTIAL VERIFICATION", x + 131 * scale, y + 55 * scale, {
      width: width - 149 * scale,
      lineBreak: false,
    });

  [
    ["SERIAL", serial],
    ["EMPLOYEE", profile.employee_number],
    ["CATEGORY", workspaceLabel],
    ["VALID UNTIL", formatDate(profile.id_card_expiry_date, "NOT SET")],
  ].forEach(([label, value], index) => {
    const rowY = y + (67 + index * 8.9) * scale;
    fitSingleLine(doc, `${label}:`, x + 131 * scale, rowY, 39 * scale, 4.2 * scale, 3.2 * scale, {
      font: "Helvetica-Bold",
      color: MUTED,
    });
    fitSingleLine(doc, value, x + 171 * scale, rowY, width - 183 * scale, 4.5 * scale, 3.2 * scale, {
      font: "Helvetica-Bold",
      color: TEXT,
    });
  });

  drawCardSecurityBars(
    doc,
    `${serial}-${profile.employee_number}-${profile.id_card_expiry_date}`,
    x + 131 * scale,
    y + 99 * scale,
    width - 146 * scale,
    7 * scale,
    scale
  );

  doc
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(4.8 * scale)
    .text(
      "This card identifies an authorized worker of Chalin 03 Company Limited. It is not a national identity document. Alteration, transfer or unauthorized duplication is prohibited.",
      x + 12 * scale,
      y + 114 * scale,
      { width: width - 24 * scale, align: "center", lineGap: 1.1 * scale }
    );

  doc
    .moveTo(x + 17 * scale, y + 137 * scale)
    .lineTo(x + 103 * scale, y + 137 * scale)
    .strokeColor(MUTED)
    .lineWidth(0.5 * scale)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(4.2 * scale)
    .text("Employee Signature", x + 17 * scale, y + 140 * scale, {
      width: 86 * scale,
      align: "center",
    });

  doc
    .moveTo(x + 139 * scale, y + 137 * scale)
    .lineTo(x + width - 17 * scale, y + 137 * scale)
    .strokeColor(MUTED)
    .lineWidth(0.5 * scale)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(4.2 * scale)
    .text("Authorized Signature", x + 139 * scale, y + 140 * scale, {
      width: width - 156 * scale,
      align: "center",
    });

  doc.rect(x, y + height - 8.5 * scale, width, 8.5 * scale).fill(NAVY);
  fitSingleLine(
    doc,
    `IF FOUND: ${data.company.address} • ${data.company.phone}`,
    x + 10 * scale,
    y + height - 6.5 * scale,
    width - 20 * scale,
    4 * scale,
    3.1 * scale,
    { font: "Helvetica-Bold", color: WHITE, align: "center" }
  );

  doc.restore();
  doc
    .lineWidth(1 * scale)
    .strokeColor(NAVY)
    .roundedRect(x, y, width, height, 7 * scale)
    .stroke();
}

function drawCutMarks(
  doc,
  x,
  y,
  width,
  height
) {
  const mark = 9;

  doc
    .save()
    .strokeColor("#94a3b8")
    .lineWidth(0.5);

  const corners = [
    [x, y, -1, -1],
    [x + width, y, 1, -1],
    [x, y + height, -1, 1],
    [x + width, y + height, 1, 1],
  ];

  corners.forEach(
    ([cornerX, cornerY, horizontal, vertical]) => {
      doc
        .moveTo(
          cornerX + horizontal * 2,
          cornerY
        )
        .lineTo(
          cornerX + horizontal * mark,
          cornerY
        )
        .stroke();

      doc
        .moveTo(
          cornerX,
          cornerY + vertical * 2
        )
        .lineTo(
          cornerX,
          cornerY + vertical * mark
        )
        .stroke();
    }
  );

  doc.restore();
}

function buildExactCardPdf(data) {
  return renderPdf(
    {
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title:
          `Chalin 03 Staff ID Card - ${data.profile.full_name}`,
        Author: data.company.name,
        Subject:
          "Exact CR80 worker ID card front and back",
        Creator:
          "Chalin 03 Group Operations Platform",
      },
    },
    (doc) => {
      doc.addPage({
        size: [
          CARD_WIDTH,
          CARD_HEIGHT,
        ],
        margin: 0,
      });

      drawIdCardFront(
        doc,
        data,
        0,
        0,
        CARD_WIDTH,
        CARD_HEIGHT
      );

      doc.addPage({
        size: [
          CARD_WIDTH,
          CARD_HEIGHT,
        ],
        margin: 0,
      });

      drawIdCardBack(
        doc,
        data,
        0,
        0,
        CARD_WIDTH,
        CARD_HEIGHT
      );
    }
  );
}

function buildA4CardSheetPdf(data) {
  return renderPdf(
    {
      size: "A4",
      layout: "portrait",
      margin: 0,
      bufferPages: true,
      info: {
        Title:
          `Chalin 03 Staff ID Card A4 Sheet - ${data.profile.full_name}`,
        Author: data.company.name,
        Subject:
          "A4 worker ID-card print sheet",
        Creator:
          "Chalin 03 Group Operations Platform",
      },
    },
    (doc) => {
      const gap = 26;
      const totalWidth =
        CARD_WIDTH * 2 + gap;

      const startX =
        (doc.page.width - totalWidth) / 2;

      const cardY = 132;

      drawLogo(doc, 42, 35, 48);

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(
          data.company.name.toUpperCase(),
          105,
          40,
          {
            width:
              doc.page.width - 145,
            lineBreak: false,
            ellipsis: true,
          }
        );

      doc
        .fillColor(GOLD)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(
          "STAFF ID CARD — A4 PRINT SHEET",
          105,
          67,
          {
            width:
              doc.page.width - 145,
            lineBreak: false,
          }
        );

      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(8)
        .text(
          "Print at Actual Size / 100%. Cut along the corner marks. Front and back are shown separately.",
          42,
          98,
          {
            width:
              doc.page.width - 84,
            align: "center",
          }
        );

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(
          "FRONT",
          startX,
          cardY - 18,
          {
            width: CARD_WIDTH,
            align: "center",
          }
        );

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(
          "BACK",
          startX + CARD_WIDTH + gap,
          cardY - 18,
          {
            width: CARD_WIDTH,
            align: "center",
          }
        );

      drawIdCardFront(
        doc,
        data,
        startX,
        cardY,
        CARD_WIDTH,
        CARD_HEIGHT
      );

      drawIdCardBack(
        doc,
        data,
        startX + CARD_WIDTH + gap,
        cardY,
        CARD_WIDTH,
        CARD_HEIGHT
      );

      drawCutMarks(
        doc,
        startX,
        cardY,
        CARD_WIDTH,
        CARD_HEIGHT
      );

      drawCutMarks(
        doc,
        startX + CARD_WIDTH + gap,
        cardY,
        CARD_WIDTH,
        CARD_HEIGHT
      );

      doc
        .fillColor(TEXT)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(
          "Printing Notes",
          54,
          cardY + CARD_HEIGHT + 65
        );

      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(9)
        .text(
          [
            "1. Select Actual Size or 100% in the printer dialog.",
            "2. Do not select Fit to Page or Shrink Oversized Pages.",
            "3. Use suitable card stock or laminate after cutting.",
            "4. Confirm the photograph, issue date and expiry date before final printing.",
            "5. This ID card remains the property of Chalin 03 Company Limited.",
          ].join("\n"),
          54,
          cardY + CARD_HEIGHT + 84,
          {
            width:
              doc.page.width - 108,
            lineGap: 5,
          }
        );

      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7)
        .text(
          `Generated on ${formatDateTime()} by the Chalin 03 Group Operations Platform.`,
          54,
          doc.page.height - 70,
          {
            width:
              doc.page.width - 108,
            align: "center",
          }
        );
    }
  );
}

async function recordPrint(
  req,
  workerId,
  documentType,
  layout,
  filename
) {
  await pool.query(
    `INSERT INTO worker_print_history (
       worker_id,
       document_type,
       print_layout,
       filename,
       generated_by,
       request_ip,
       request_user_agent
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      workerId,
      documentType,
      layout,
      filename,
      req.user?.id || null,
      cleanText(
        req.ip ||
          req.socket?.remoteAddress,
        50
      ) || null,
      cleanText(
        req.headers["user-agent"],
        255
      ) || null,
    ]
  );

  try {
    await writeAuditEvent({
      req,
      action:
        documentType === "worker_profile"
          ? "WORKER_PROFILE_PDF_GENERATED"
          : "WORKER_ID_CARD_PDF_GENERATED",

      actionType:
        documentType === "worker_profile"
          ? "workforce.profile.printed"
          : "workforce.id_card.printed",

      entityType: "worker",
      entityId: workerId,
      outcome: "success",
      severity: "notice",

      details:
        `Generated ${documentType} using ${layout} layout. File: ${filename}`,
    });
  } catch (error) {
    console.warn(
      "Worker print audit event skipped:",
      error.message
    );
  }
}

function applyPdfCorsHeaders(req, res) {
  const requestOrigin = cleanText(
    req.headers.origin,
    300
  );

  const allowedOrigins = new Set(
    [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://chalin03.com",
      "https://www.chalin03.com",
      process.env.FRONTEND_URL,
      process.env.FRONTEND_URL_ALT,
    ]
      .filter(Boolean)
      .map((origin) =>
        String(origin).trim()
      )
  );

  if (
    requestOrigin &&
    allowedOrigins.has(requestOrigin)
  ) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      requestOrigin
    );

    res.setHeader(
      "Access-Control-Allow-Credentials",
      "true"
    );

    const existingVary = String(
      res.getHeader("Vary") || ""
    );

    const varyValues = existingVary
      .split(",")
      .map((value) =>
        value.trim().toLowerCase()
      )
      .filter(Boolean);

    if (!varyValues.includes("origin")) {
      res.setHeader(
        "Vary",
        existingVary
          ? `${existingVary}, Origin`
          : "Origin"
      );
    }
  }

  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Disposition, Content-Length"
  );
}

function sendPdfBuffer(
  req,
  res,
  buffer,
  filename
) {
  applyPdfCorsHeaders(req, res);

  res.setHeader(
    "Content-Type",
    "application/pdf"
  );

  res.setHeader(
    "Content-Disposition",
    `inline; filename="${safeFilename(
      filename
    )}.pdf"`
  );

  res.setHeader(
    "Content-Length",
    String(buffer.length)
  );

  res.setHeader(
    "Cache-Control",
    "private, no-store"
  );

  return res.end(buffer);
}

router.get(
  "/workers-expanded/:id/profile-pdf",
  requireAuth,
  requirePermission(
    "workers.sensitive.view",
    "workers.documents.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);

    if (!workerId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid worker profile ID.",
      });
    }

    const data =
      await loadWorkerPrintData(workerId);

    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Worker profile not found.",
      });
    }

    const filename =
      `Chalin03_Worker_Profile_${safeFilename(
        data.profile.employee_number
      )}`;

    const generatedBy =
      req.user?.full_name ||
      req.user?.username ||
      "Authorized user";

    const buffer =
      await buildWorkerProfilePdf(
        data,
        generatedBy
      );

    await recordPrint(
      req,
      workerId,
      "worker_profile",
      "a4_profile",
      `${filename}.pdf`
    );

    return sendPdfBuffer(
      req,
      res,
      buffer,
      filename
    );
  })
);

router.get(
  "/workers-expanded/:id/id-card-pdf",
  requireAuth,
  requirePermission(
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const layout =
      cleanText(
        req.query.layout,
        20
      ).toLowerCase() || "card";

    if (!workerId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid worker profile ID.",
      });
    }

    if (!["card", "a4"].includes(layout)) {
      return res.status(400).json({
        status: "error",
        message:
          "ID-card layout must be card or a4.",
      });
    }

    const data =
      await loadWorkerPrintData(workerId);

    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Worker profile not found.",
      });
    }

    const filename =
      `Chalin03_ID_Card_${safeFilename(
        data.profile.employee_number
      )}_${layout}`;

    const buffer =
      layout === "a4"
        ? await buildA4CardSheetPdf(data)
        : await buildExactCardPdf(data);

    await recordPrint(
      req,
      workerId,
      "worker_id_card",
      layout === "a4"
        ? "a4_sheet"
        : "exact_card_size",
      `${filename}.pdf`
    );

    return sendPdfBuffer(
      req,
      res,
      buffer,
      filename
    );
  })
);

module.exports = router;