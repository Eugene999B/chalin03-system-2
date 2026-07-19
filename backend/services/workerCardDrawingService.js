const fs = require("node:fs");
const path = require("node:path");

const POINTS_PER_MM = 72 / 25.4;
const CARD_WIDTH = 85.6 * POINTS_PER_MM;
const CARD_HEIGHT = 53.98 * POINTS_PER_MM;

const NAVY = "#07182c";
const NAVY_LIGHT = "#173d61";
const GOLD = "#d9ad24";
const WHITE = "#ffffff";
const TEXT = "#102033";
const MUTED = "#5c6b7c";
const BORDER = "#d8e0e9";
const LIGHT = "#f6f8fb";
const GREEN = "#17823b";

const LOGO_PATH = path.resolve(
  __dirname,
  "..",
  "assets",
  "chalin03-logo.png"
);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function truncate(value, maximum = 60) {
  const text = cleanText(value, 500);
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(1, maximum - 1)).trim()}…`;
}

function titleCase(value) {
  return cleanText(value, 100)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value, fallback = "NOT SET") {
  if (!value) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return cleanText(value, 30) || fallback;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function workspaceLabel(data) {
  const assignment =
    data.assignments?.find((item) => Number(item.is_active) === 1) ||
    data.assignments?.[0] ||
    null;

  if (!assignment) return "Group Operations";

  const workspace = titleCase(
    assignment.workspace_code || "operations"
  );
  const context = cleanText(assignment.context_label, 70);

  return context ? `${workspace} · ${context}` : workspace;
}

function initials(value) {
  return (
    cleanText(value, 180)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "C03"
  );
}

function logoBuffer() {
  try {
    return fs.readFileSync(LOGO_PATH);
  } catch {
    return null;
  }
}

function fitText(
  doc,
  text,
  x,
  y,
  width,
  preferredSize,
  minimumSize,
  options = {}
) {
  const value = cleanText(text, 220);
  const font = options.font || "Helvetica-Bold";
  let size = preferredSize;

  doc.font(font);
  while (size > minimumSize) {
    doc.fontSize(size);
    if (doc.widthOfString(value) <= width) break;
    size -= 0.25;
  }

  doc
    .fillColor(options.color || TEXT)
    .font(font)
    .fontSize(size)
    .text(value, x, y, {
      width,
      align: options.align || "left",
      lineBreak: false,
      ellipsis: true,
    });
}

function drawSecurityBackground(doc) {
  doc.save();
  doc.opacity(0.055).lineWidth(0.35);

  for (let index = 0; index < 9; index += 1) {
    const y = 43 + index * 12;

    doc
      .strokeColor(index % 2 === 0 ? NAVY_LIGHT : GOLD)
      .moveTo(-20, y)
      .bezierCurveTo(40, y - 20, 95, y + 19, 148, y)
      .bezierCurveTo(190, y - 18, 230, y + 18, 270, y)
      .stroke();
  }

  for (let index = 0; index < 6; index += 1) {
    doc
      .strokeColor(index % 2 === 0 ? GOLD : NAVY_LIGHT)
      .ellipse(197, 94, 19 + index * 6, 8 + index * 3)
      .stroke();
  }

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(53)
    .text("03", 170, 78, {
      width: 60,
      align: "center",
      lineBreak: false,
    });

  doc.restore();
}

function drawLogo(doc, x, y, size) {
  const logo = logoBuffer();

  doc.save();
  doc.roundedRect(x, y, size, size, 4).fill(NAVY);
  doc
    .lineWidth(0.8)
    .strokeColor(GOLD)
    .roundedRect(x, y, size, size, 4)
    .stroke();

  if (logo) {
    try {
      doc.image(logo, x + 2, y + 2, {
        fit: [size - 4, size - 4],
        align: "center",
        valign: "center",
      });
      doc.restore();
      return;
    } catch {
      // Use the C03 fallback below.
    }
  }

  doc
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(size * 0.24)
    .text("C03", x, y + size * 0.36, {
      width: size,
      align: "center",
      lineBreak: false,
    });

  doc.restore();
}

function drawPhoto(doc, profile, x, y, width, height) {
  doc.save();
  doc.roundedRect(x, y, width, height, 5).fill("#edf1f6");
  doc.roundedRect(x, y, width, height, 5).clip();

  if (Buffer.isBuffer(profile.photo_data) && profile.photo_data.length) {
    try {
      doc.image(profile.photo_data, x, y, {
        cover: [width, height],
        align: "center",
        valign: "center",
      });
    } catch {
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(20)
        .text(initials(profile.full_name), x, y + height * 0.42, {
          width,
          align: "center",
        });
    }
  } else {
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(initials(profile.full_name), x, y + height * 0.42, {
        width,
        align: "center",
      });
  }

  doc.restore();
  doc
    .lineWidth(1.2)
    .strokeColor(GOLD)
    .roundedRect(x, y, width, height, 5)
    .stroke();
}

function drawRoundIcon(doc, x, y, label) {
  doc.save();
  doc.circle(x, y, 5).fill(NAVY);
  doc
    .fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(4.8)
    .text(label, x - 5, y - 1.8, {
      width: 10,
      align: "center",
      lineBreak: false,
    });
  doc.restore();
}

function drawInfoRow(
  doc,
  label,
  value,
  x,
  y,
  width,
  icon,
  options = {}
) {
  drawRoundIcon(doc, x + 5, y + 6, icon);

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(4.4)
    .text(label.toUpperCase(), x + 14, y, {
      width: width - 14,
      lineBreak: false,
    });

  fitText(
    doc,
    value,
    x + 14,
    y + 6.4,
    width - 14,
    options.size || 7.2,
    options.minimumSize || 5.2,
    {
      color: options.color || NAVY,
    }
  );
}

function beginCard(doc, x, y, scale) {
  doc.save();
  doc.translate(x, y);
  doc.scale(scale);
  doc.roundedRect(0, 0, CARD_WIDTH, CARD_HEIGHT, 6).clip();
  doc.rect(0, 0, CARD_WIDTH, CARD_HEIGHT).fill(WHITE);
  drawSecurityBackground(doc);
}

function endCard(doc, x, y, scale) {
  doc.restore();
  doc.save();
  doc.translate(x, y);
  doc.scale(scale);
  doc
    .lineWidth(0.8)
    .strokeColor(NAVY)
    .roundedRect(
      0.4,
      0.4,
      CARD_WIDTH - 0.8,
      CARD_HEIGHT - 0.8,
      6
    )
    .stroke();
  doc.restore();
}

function drawFrontCard(doc, data, x = 0, y = 0, scale = 1) {
  const profile = data.profile || {};
  const companyName = truncate(
    data.company?.name || "Chalin 03 Company Limited",
    48
  ).toUpperCase();
  const employeeNumber = truncate(
    profile.employee_number || "NOT ASSIGNED",
    28
  );
  const fullName = truncate(profile.full_name || "Worker Name", 42);
  const jobTitle = truncate(profile.job_title || "Staff Member", 38);
  const department = truncate(
    profile.department || "Group Operations",
    38
  );
  const workArea = truncate(workspaceLabel(data), 44);
  const status = titleCase(profile.employment_status || "active");

  beginCard(doc, x, y, scale);

  doc.rect(0, 0, CARD_WIDTH, 39).fill(NAVY);
  doc
    .moveTo(0, 38)
    .lineTo(180, 38)
    .bezierCurveTo(206, 38, 219, 33, CARD_WIDTH, 27)
    .lineTo(CARD_WIDTH, 40)
    .lineTo(0, 40)
    .closePath()
    .fill(GOLD);
  doc
    .moveTo(0, 40)
    .lineTo(180, 40)
    .bezierCurveTo(206, 40, 221, 35, CARD_WIDTH, 29)
    .lineTo(CARD_WIDTH, 43)
    .lineTo(0, 43)
    .closePath()
    .fill(WHITE);

  drawLogo(doc, 8, 6, 27);
  fitText(doc, companyName, 42, 7, 160, 11.5, 8.4, {
    color: WHITE,
  });

  doc
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(5.8)
    .text("STAFF IDENTIFICATION CARD", 42, 23, {
      width: 145,
      lineBreak: false,
      characterSpacing: 0.45,
    });

  drawPhoto(doc, profile, 9, 48, 65, 76);

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(4.5)
    .text("EMPLOYEE NAME", 82, 48, {
      width: 150,
      lineBreak: false,
    });
  fitText(doc, fullName, 82, 54, 151, 10.8, 7.4, {
    color: NAVY,
  });
  doc.rect(82, 68, 70, 1.2).fill(GOLD);

  drawInfoRow(
    doc,
    "Employee ID",
    employeeNumber,
    82,
    73,
    150,
    "ID",
    {
      size: 8.5,
      minimumSize: 6.3,
    }
  );
  drawInfoRow(doc, "Role / Title", jobTitle, 82, 91, 150, "R");
  drawInfoRow(doc, "Department", department, 82, 108, 150, "D");
  drawInfoRow(
    doc,
    "Workspace",
    workArea,
    82,
    125,
    150,
    "W",
    {
      size: 6.3,
      minimumSize: 4.8,
    }
  );

  doc.roundedRect(9, 128, 95, 17, 3).fill(LIGHT);
  doc
    .lineWidth(0.5)
    .strokeColor(BORDER)
    .roundedRect(9, 128, 95, 17, 3)
    .stroke();
  doc
    .moveTo(56.5, 130)
    .lineTo(56.5, 143)
    .strokeColor(BORDER)
    .stroke();

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.7)
    .text("ISSUE DATE", 14, 131, {
      width: 38,
      align: "center",
    });
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.7)
    .text(formatDate(profile.id_card_issue_date), 11, 137, {
      width: 43,
      align: "center",
      lineBreak: false,
    });

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.7)
    .text("EXPIRY DATE", 59, 131, {
      width: 41,
      align: "center",
    });
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.7)
    .text(formatDate(profile.id_card_expiry_date), 58, 137, {
      width: 43,
      align: "center",
      lineBreak: false,
    });

  doc
    .fillColor(GREEN)
    .font("Helvetica-Bold")
    .fontSize(5.8)
    .text(status, 107, 137, {
      width: 42,
      align: "center",
      lineBreak: false,
    });

  doc
    .moveTo(155, 138)
    .lineTo(229, 138)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.6)
    .text("AUTHORIZED SIGNATURE", 155, 141, {
      width: 74,
      align: "center",
      lineBreak: false,
    });

  doc.rect(0, 147, CARD_WIDTH, 6).fill(NAVY);
  endCard(doc, x, y, scale);
}

function drawHologramSeal(doc, x, y, radius) {
  const colors = ["#7dd3fc", "#c084fc", "#fde68a", "#86efac"];

  doc.save();
  colors.forEach((color, index) => {
    doc
      .opacity(0.33)
      .lineWidth(1.2)
      .strokeColor(color)
      .circle(x, y, radius - index * 2.6)
      .stroke();
  });

  doc
    .opacity(0.2)
    .fillColor(GOLD)
    .circle(x, y, radius - 4)
    .fill();
  doc
    .opacity(0.8)
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(radius * 0.65)
    .text("03", x - radius, y - radius * 0.27, {
      width: radius * 2,
      align: "center",
      lineBreak: false,
    });
  doc.restore();
}

function drawBackCard(
  doc,
  data,
  qrBuffer,
  x = 0,
  y = 0,
  scale = 1
) {
  const profile = data.profile || {};
  const companyName = truncate(
    data.company?.name || "Chalin 03 Company Limited",
    48
  ).toUpperCase();
  const employeeNumber = truncate(
    profile.employee_number || "NOT ASSIGNED",
    28
  );
  const serial = truncate(
    profile.id_card_serial || profile.employee_number || "NOT ASSIGNED",
    30
  );
  const returnAddress = truncate(
    data.company?.address || "Dunkwa Police Barrier, Ghana",
    72
  );
  const phone = truncate(data.company?.phone || "0249469080", 30);

  beginCard(doc, x, y, scale);

  doc.rect(0, 0, CARD_WIDTH, 36).fill(NAVY);
  doc.rect(0, 35, CARD_WIDTH, 2).fill(GOLD);

  drawLogo(doc, 8, 5, 26);
  fitText(doc, companyName, 42, 8, 150, 10.8, 8.2, {
    color: WHITE,
  });
  doc
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(4.8)
    .text("SECURE CORPORATE CREDENTIAL", 42, 23, {
      width: 140,
      lineBreak: false,
      characterSpacing: 0.45,
    });

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(6.8)
    .text("If found, please return to", 10, 43, {
      width: 130,
      lineBreak: false,
    });
  fitText(
    doc,
    data.company?.name || "Chalin 03 Company Limited",
    10,
    51,
    132,
    7.5,
    6,
    { color: NAVY }
  );

  doc
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(4.5)
    .text(
      "This card is company property and must be returned upon request or termination of employment.",
      10,
      61,
      {
        width: 132,
        lineGap: 1.2,
      }
    );
  doc
    .moveTo(10, 77)
    .lineTo(101, 77)
    .strokeColor(GOLD)
    .lineWidth(0.7)
    .stroke();

  doc.roundedRect(180, 41, 52, 58, 4).fill(WHITE);
  doc
    .lineWidth(0.7)
    .strokeColor(GOLD)
    .roundedRect(180, 41, 52, 58, 4)
    .stroke();
  doc.image(qrBuffer, 184, 44, {
    fit: [44, 44],
    align: "center",
    valign: "center",
  });
  doc.roundedRect(184, 89, 44, 7, 2).fill(NAVY);
  doc
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(4.2)
    .text("SCAN TO VERIFY", 184, 91, {
      width: 44,
      align: "center",
      lineBreak: false,
    });

  doc.roundedRect(10, 83, 150, 42, 4).fill(LIGHT);
  doc
    .lineWidth(0.55)
    .strokeColor(BORDER)
    .roundedRect(10, 83, 150, 42, 4)
    .stroke();

  const details = [
    ["CARD SERIAL", serial],
    ["EMPLOYEE ID", employeeNumber],
    [
      "VALIDITY",
      `${formatDate(profile.id_card_issue_date)} – ${formatDate(
        profile.id_card_expiry_date
      )}`,
    ],
    ["WEBSITE", "chalin03.com"],
  ];

  details.forEach(([label, value], index) => {
    const rowY = 87 + index * 9;

    doc
      .fillColor(MUTED)
      .font("Helvetica-Bold")
      .fontSize(3.8)
      .text(label, 16, rowY, {
        width: 40,
        lineBreak: false,
      });

    fitText(doc, value, 59, rowY - 0.5, 94, 5.3, 4.1, {
      color: NAVY,
    });
  });

  drawHologramSeal(doc, 197, 116, 16);

  doc.rect(0, 128, CARD_WIDTH, 11).fill(NAVY);
  doc
    .fillColor(WHITE)
    .font("Helvetica-Bold")
    .fontSize(4.1)
    .text(`TEL: ${phone}`, 8, 131.5, {
      width: 55,
      lineBreak: false,
    });
  doc
    .fillColor(WHITE)
    .font("Helvetica")
    .fontSize(3.9)
    .text(returnAddress, 66, 131.2, {
      width: 166,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });

  doc
    .moveTo(18, 145)
    .lineTo(96, 145)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();
  doc
    .moveTo(146, 145)
    .lineTo(224, 145)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.2)
    .text("EMPLOYEE SIGNATURE", 18, 147, {
      width: 78,
      align: "center",
    });
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.2)
    .text("AUTHORIZED SIGNATURE", 146, 147, {
      width: 78,
      align: "center",
    });

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(3.1)
    .text(
      "CORPORATE CREDENTIAL — NOT A NATIONAL OR TRAVEL IDENTITY DOCUMENT",
      44,
      150,
      {
        width: 154,
        align: "center",
        lineBreak: false,
      }
    );

  doc.rect(0, 152, CARD_WIDTH, 1).fill(GOLD);
  endCard(doc, x, y, scale);
}

module.exports = {
  CARD_HEIGHT,
  CARD_WIDTH,
  GOLD,
  MUTED,
  NAVY,
  TEXT,
  WHITE,
  drawBackCard,
  drawFrontCard,
  drawLogo,
  formatDate,
};
