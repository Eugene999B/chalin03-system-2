const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const sharp = require("sharp");

const POINTS_PER_MM = 72 / 25.4;
const CARD_WIDTH = 85.6 * POINTS_PER_MM;
const CARD_HEIGHT = 53.98 * POINTS_PER_MM;
const CARD_PIXEL_WIDTH = 1011;
const CARD_PIXEL_HEIGHT = 638;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const NAVY = "#07182c";
const NAVY_LIGHT = "#173d61";
const GOLD = "#d9ad24";
const PALE_GOLD = "#fff7d6";
const WHITE = "#ffffff";
const TEXT = "#102033";
const MUTED = "#5c6b7c";
const BORDER = "#d8e0e9";
const LIGHT = "#f5f7fa";

const LOGO_PATH = path.resolve(
  __dirname,
  "..",
  "assets",
  "chalin03-logo.png"
);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function xml(value) {
  return cleanText(value, 1000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
  if (Number.isNaN(date.getTime())) return cleanText(value, 30) || fallback;
  return date
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
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

function workspaceLabel(data) {
  const assignment =
    data.assignments?.find((item) => Number(item.is_active) === 1) ||
    data.assignments?.[0] ||
    null;

  if (!assignment) return "GROUP OPERATIONS";

  const workspace = titleCase(assignment.workspace_code || "operations");
  const context = cleanText(assignment.context_label, 70);
  return context ? `${workspace} · ${context}` : workspace;
}

function primaryEmergencyContact(data) {
  return (
    data.emergency_contacts?.find((item) => Number(item.is_primary) === 1) ||
    data.emergency_contacts?.[0] ||
    null
  );
}

function imageDataUri(buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function logoBuffer() {
  try {
    return fs.readFileSync(LOGO_PATH);
  } catch {
    return null;
  }
}

function guillochePaths() {
  const paths = [];
  for (let index = 0; index < 13; index += 1) {
    const y = 130 + index * 38;
    const shift = index % 2 === 0 ? 0 : 55;
    paths.push(
      `<path d="M -120 ${y} C 90 ${y - 95 + shift}, 265 ${y + 92 - shift}, 500 ${y} S 910 ${y - 85 + shift}, 1140 ${y + 12}" fill="none" stroke="#173d61" stroke-width="1.4" opacity="0.055"/>`
    );
    paths.push(
      `<path d="M -140 ${y + 13} C 90 ${y + 100 - shift}, 280 ${y - 86 + shift}, 520 ${y + 10} S 900 ${y + 95 - shift}, 1150 ${y - 3}" fill="none" stroke="#d9ad24" stroke-width="1" opacity="0.07"/>`
    );
  }
  return paths.join("");
}

function barcodeSvg(value, x, y, width, height) {
  const source = cleanText(value || "CHALIN03", 100) || "CHALIN03";
  const codes = [...source].map((character) => character.charCodeAt(0));
  const total = Math.max(82, codes.length * 7);
  const unit = width / total;
  const bars = [];

  for (let index = 0; index < total; index += 1) {
    const code = codes[index % codes.length];
    const barWidth = ((code + index) % 4 === 0 ? 2.2 : 1) * unit;
    const barHeight = height * (0.58 + ((code + index) % 5) * 0.095);
    const fill = index % 13 === 0 ? GOLD : NAVY;
    bars.push(
      `<rect x="${(x + index * unit).toFixed(2)}" y="${(
        y +
        height -
        barHeight
      ).toFixed(2)}" width="${Math.max(0.7, barWidth).toFixed(
        2
      )}" height="${barHeight.toFixed(2)}" fill="${fill}"/>`
    );
  }

  return bars.join("");
}

function photoArtwork(profile) {
  const photo = imageDataUri(profile.photo_data, "image/png");
  if (photo) {
    return `<image href="${photo}" x="48" y="173" width="265" height="341" preserveAspectRatio="xMidYMid slice" clip-path="url(#photoClip)"/>`;
  }

  return `
    <rect x="48" y="173" width="265" height="341" rx="20" fill="#e9eef5"/>
    <text x="180.5" y="360" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="82" font-weight="800" fill="${NAVY}">${xml(
      initials(profile.full_name)
    )}</text>`;
}

function logoArtwork(x, y, width, height) {
  const logo = imageDataUri(logoBuffer(), "image/png");
  if (logo) {
    return `<image href="${logo}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="${NAVY}" stroke="${GOLD}" stroke-width="4"/>
    <text x="${x + width / 2}" y="${y + height * 0.62}" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="${width * 0.28}" font-weight="900" fill="${GOLD}">C03</text>`;
}

function frontSvg(data) {
  const profile = data.profile || {};
  const companyName = truncate(
    data.company?.name || "Chalin 03 Company Limited",
    42
  ).toUpperCase();
  const employeeNumber = truncate(profile.employee_number || "NOT ASSIGNED", 30);
  const serial = truncate(
    profile.id_card_serial || profile.employee_number || "NOT ASSIGNED",
    30
  );
  const fullName = truncate(profile.full_name || "Worker Name", 38);
  const jobTitle = truncate(profile.job_title || "Staff Member", 42);
  const department = truncate(profile.department || "Operations", 42);
  const workArea = truncate(workspaceLabel(data), 48).toUpperCase();
  const status = titleCase(profile.employment_status || "active").toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_PIXEL_WIDTH}" height="${CARD_PIXEL_HEIGHT}" viewBox="0 0 ${CARD_PIXEL_WIDTH} ${CARD_PIXEL_HEIGHT}">
  <defs>
    <linearGradient id="header" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#061426"/>
      <stop offset="1" stop-color="#153f68"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f2f5f9"/>
    </linearGradient>
    <clipPath id="cardClip"><rect x="0" y="0" width="1011" height="638" rx="28"/></clipPath>
    <clipPath id="photoClip"><rect x="48" y="173" width="265" height="341" rx="20"/></clipPath>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#061426" flood-opacity="0.2"/>
    </filter>
  </defs>

  <g clip-path="url(#cardClip)">
    <rect width="1011" height="638" fill="url(#body)"/>
    ${guillochePaths()}
    <rect x="0" y="0" width="1011" height="142" fill="url(#header)"/>
    <rect x="0" y="136" width="1011" height="7" fill="${GOLD}"/>
    <rect x="0" y="0" width="10" height="638" fill="${GOLD}"/>

    <text x="930" y="410" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="108" font-weight="900" fill="#07182c" opacity="0.035">CHALIN 03</text>

    <rect x="32" y="22" width="92" height="92" rx="20" fill="#ffffff" opacity="0.98"/>
    ${logoArtwork(39, 29, 78, 78)}

    <text x="148" y="57" font-family="Arial, DejaVu Sans, sans-serif" font-size="31" font-weight="900" letter-spacing="0.4" fill="#ffffff">${xml(
      companyName
    )}</text>
    <text x="148" y="88" font-family="Arial, DejaVu Sans, sans-serif" font-size="17" font-weight="800" letter-spacing="2.2" fill="${GOLD}">STAFF IDENTIFICATION CARD</text>
    <text x="148" y="112" font-family="Arial, DejaVu Sans, sans-serif" font-size="12" font-weight="700" letter-spacing="1.6" fill="#cbd5e1">AUTHORIZED PERSONNEL · CORPORATE CREDENTIAL</text>

    <text x="965" y="43" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="700" letter-spacing="1.3" fill="#b9c5d2">CARD SERIAL</text>
    <text x="965" y="67" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="17" font-weight="900" fill="#ffffff">${xml(
      serial
    )}</text>
    <text x="965" y="103" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="700" letter-spacing="1.1" fill="${GOLD}">NOT A NATIONAL ID</text>

    <rect x="39" y="164" width="283" height="359" rx="25" fill="#ffffff" stroke="${GOLD}" stroke-width="5" filter="url(#softShadow)"/>
    ${photoArtwork(profile)}
    <rect x="62" y="530" width="237" height="42" rx="21" fill="${NAVY}"/>
    <text x="180.5" y="558" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="15" font-weight="900" letter-spacing="1.7" fill="${GOLD}">${xml(
      status
    )}</text>

    <text x="354" y="181" font-family="Arial, DejaVu Sans, sans-serif" font-size="12" font-weight="800" letter-spacing="1.7" fill="${MUTED}">EMPLOYEE NUMBER</text>
    <rect x="354" y="195" width="612" height="54" rx="27" fill="${PALE_GOLD}" stroke="#eedb8c" stroke-width="1.5"/>
    <text x="660" y="230" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="22" font-weight="900" letter-spacing="1.2" fill="${NAVY}">${xml(
      employeeNumber
    )}</text>

    <text x="354" y="285" font-family="Arial, DejaVu Sans, sans-serif" font-size="12" font-weight="800" letter-spacing="1.7" fill="${MUTED}">EMPLOYEE NAME</text>
    <text x="354" y="329" font-family="Arial, DejaVu Sans, sans-serif" font-size="35" font-weight="900" fill="${TEXT}">${xml(
      fullName
    )}</text>
    <rect x="354" y="347" width="92" height="5" rx="2.5" fill="${GOLD}"/>

    <text x="354" y="392" font-family="Arial, DejaVu Sans, sans-serif" font-size="21" font-weight="800" fill="${NAVY_LIGHT}">${xml(
      jobTitle
    )}</text>
    <text x="354" y="425" font-family="Arial, DejaVu Sans, sans-serif" font-size="16" font-weight="700" fill="${MUTED}">${xml(
      department
    )}</text>

    <rect x="354" y="451" width="612" height="43" rx="12" fill="#e9eef5"/>
    <text x="374" y="478" font-family="Arial, DejaVu Sans, sans-serif" font-size="13" font-weight="900" letter-spacing="1.2" fill="${NAVY}">WORK AREA</text>
    <text x="947" y="478" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="14" font-weight="800" fill="${TEXT}">${xml(
      workArea
    )}</text>

    <rect x="354" y="512" width="612" height="73" rx="14" fill="#ffffff" stroke="${BORDER}" stroke-width="2"/>
    <line x1="660" y1="524" x2="660" y2="573" stroke="${BORDER}" stroke-width="2"/>
    <text x="380" y="538" font-family="Arial, DejaVu Sans, sans-serif" font-size="10" font-weight="800" letter-spacing="1.6" fill="${MUTED}">DATE ISSUED</text>
    <text x="380" y="566" font-family="Arial, DejaVu Sans, sans-serif" font-size="17" font-weight="900" fill="${NAVY}">${xml(
      formatDate(profile.id_card_issue_date)
    )}</text>
    <text x="687" y="538" font-family="Arial, DejaVu Sans, sans-serif" font-size="10" font-weight="800" letter-spacing="1.6" fill="${MUTED}">VALID UNTIL</text>
    <text x="687" y="566" font-family="Arial, DejaVu Sans, sans-serif" font-size="17" font-weight="900" fill="${NAVY}">${xml(
      formatDate(profile.id_card_expiry_date)
    )}</text>

    <rect x="0" y="607" width="1011" height="31" fill="${NAVY}"/>
    <text x="505.5" y="627" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="10" font-weight="700" letter-spacing="2.1" fill="#dbe5ef">CHALIN 03 · CORPORATE STAFF ID · PROPERTY OF THE COMPANY</text>
  </g>
  <rect x="1.5" y="1.5" width="1008" height="635" rx="27" fill="none" stroke="${NAVY}" stroke-width="3"/>
</svg>`;
}

function backSvg(data) {
  const profile = data.profile || {};
  const emergency = primaryEmergencyContact(data);
  const companyName = truncate(
    data.company?.name || "Chalin 03 Company Limited",
    42
  ).toUpperCase();
  const employeeNumber = truncate(profile.employee_number || "NOT ASSIGNED", 30);
  const serial = truncate(
    profile.id_card_serial || profile.employee_number || "NOT ASSIGNED",
    30
  );
  const workArea = truncate(workspaceLabel(data), 42).toUpperCase();
  const emergencyName = truncate(emergency?.full_name || "Not recorded", 34);
  const emergencyPhone = truncate(
    emergency?.primary_phone || "No phone recorded",
    30
  );
  const returnAddress = truncate(
    `${data.company?.address || "Dunkwa Police Barrier, Ghana"} · ${
      data.company?.phone || "0249469080"
    }`,
    90
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_PIXEL_WIDTH}" height="${CARD_PIXEL_HEIGHT}" viewBox="0 0 ${CARD_PIXEL_WIDTH} ${CARD_PIXEL_HEIGHT}">
  <defs>
    <linearGradient id="backHeader" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#061426"/>
      <stop offset="1" stop-color="#153f68"/>
    </linearGradient>
    <clipPath id="cardClip"><rect x="0" y="0" width="1011" height="638" rx="28"/></clipPath>
  </defs>

  <g clip-path="url(#cardClip)">
    <rect width="1011" height="638" fill="${LIGHT}"/>
    ${guillochePaths()}
    <rect x="0" y="0" width="1011" height="126" fill="url(#backHeader)"/>
    <rect x="0" y="120" width="1011" height="7" fill="${GOLD}"/>

    <rect x="31" y="20" width="82" height="82" rx="18" fill="#ffffff"/>
    ${logoArtwork(37, 26, 70, 70)}
    <text x="137" y="57" font-family="Arial, DejaVu Sans, sans-serif" font-size="29" font-weight="900" fill="#ffffff">${xml(
      companyName
    )}</text>
    <text x="137" y="88" font-family="Arial, DejaVu Sans, sans-serif" font-size="14" font-weight="800" letter-spacing="1.9" fill="${GOLD}">SECURE CORPORATE CREDENTIAL · COMPANY PROPERTY</text>
    <text x="966" y="48" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="800" letter-spacing="1.2" fill="#b9c5d2">EMPLOYEE</text>
    <text x="966" y="74" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="18" font-weight="900" fill="#ffffff">${xml(
      employeeNumber
    )}</text>

    <rect x="36" y="154" width="449" height="218" rx="20" fill="#ffffff" stroke="${BORDER}" stroke-width="2"/>
    <rect x="36" y="154" width="449" height="48" rx="20" fill="#eef2f7"/>
    <rect x="36" y="184" width="449" height="18" fill="#eef2f7"/>
    <text x="61" y="186" font-family="Arial, DejaVu Sans, sans-serif" font-size="16" font-weight="900" letter-spacing="1.3" fill="${NAVY}">EMERGENCY &amp; SAFETY</text>
    <text x="61" y="238" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="800" letter-spacing="1.4" fill="${MUTED}">PRIMARY CONTACT</text>
    <text x="61" y="272" font-family="Arial, DejaVu Sans, sans-serif" font-size="22" font-weight="900" fill="${TEXT}">${xml(
      emergencyName
    )}</text>
    <text x="61" y="307" font-family="Arial, DejaVu Sans, sans-serif" font-size="18" font-weight="700" fill="${NAVY_LIGHT}">${xml(
      emergencyPhone
    )}</text>
    <text x="61" y="347" font-family="Arial, DejaVu Sans, sans-serif" font-size="15" font-weight="800" fill="${MUTED}">BLOOD GROUP: <tspan fill="${
      profile.blood_group ? "#991b1b" : MUTED
    }">${xml(profile.blood_group || "NOT RECORDED")}</tspan></text>

    <rect x="515" y="154" width="460" height="218" rx="20" fill="#ffffff" stroke="${BORDER}" stroke-width="2"/>
    <rect x="515" y="154" width="460" height="48" rx="20" fill="#eef2f7"/>
    <rect x="515" y="184" width="460" height="18" fill="#eef2f7"/>
    <text x="540" y="186" font-family="Arial, DejaVu Sans, sans-serif" font-size="16" font-weight="900" letter-spacing="1.3" fill="${NAVY}">CREDENTIAL DETAILS</text>

    <text x="540" y="235" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="800" letter-spacing="1.1" fill="${MUTED}">CARD SERIAL</text>
    <text x="945" y="235" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="15" font-weight="900" fill="${TEXT}">${xml(
      serial
    )}</text>
    <text x="540" y="270" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="800" letter-spacing="1.1" fill="${MUTED}">WORKSPACE</text>
    <text x="945" y="270" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="14" font-weight="900" fill="${TEXT}">${xml(
      workArea
    )}</text>
    <text x="540" y="305" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="800" letter-spacing="1.1" fill="${MUTED}">ISSUED</text>
    <text x="945" y="305" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="15" font-weight="900" fill="${TEXT}">${xml(
      formatDate(profile.id_card_issue_date)
    )}</text>
    <text x="540" y="340" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="800" letter-spacing="1.1" fill="${MUTED}">VALID UNTIL</text>
    <text x="945" y="340" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="15" font-weight="900" fill="${NAVY}">${xml(
      formatDate(profile.id_card_expiry_date)
    )}</text>

    <rect x="36" y="395" width="939" height="76" rx="16" fill="${PALE_GOLD}" stroke="#ead477" stroke-width="1.5"/>
    <text x="505.5" y="422" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="13" font-weight="900" letter-spacing="1.4" fill="${NAVY}">IMPORTANT</text>
    <text x="505.5" y="450" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="13" font-weight="700" fill="${TEXT}">This card identifies a Chalin 03 worker. It is not a national, ECOWAS, travel or government identity document.</text>

    <line x1="66" y1="520" x2="377" y2="520" stroke="${MUTED}" stroke-width="2"/>
    <line x1="634" y1="520" x2="945" y2="520" stroke="${MUTED}" stroke-width="2"/>
    <text x="221.5" y="545" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="700" fill="${MUTED}">EMPLOYEE SIGNATURE</text>
    <text x="789.5" y="545" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="700" fill="${MUTED}">AUTHORIZED SIGNATURE</text>

    ${barcodeSvg(`${serial}-${employeeNumber}`, 64, 558, 883, 37)}
    <text x="505.5" y="605" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="9" font-weight="700" letter-spacing="1.2" fill="${MUTED}">${xml(
      serial
    )}</text>

    <rect x="0" y="611" width="1011" height="27" fill="${NAVY}"/>
    <text x="505.5" y="629" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="9.5" font-weight="800" letter-spacing="0.7" fill="#ffffff">IF FOUND, RETURN TO: ${xml(
      returnAddress.toUpperCase()
    )}</text>
  </g>
  <rect x="1.5" y="1.5" width="1008" height="635" rx="27" fill="none" stroke="${NAVY}" stroke-width="3"/>
</svg>`;
}

async function renderWorkerCardArtwork(data) {
  const [front, back] = await Promise.all([
    sharp(Buffer.from(frontSvg(data)))
      .png({ compressionLevel: 7 })
      .toBuffer(),
    sharp(Buffer.from(backSvg(data)))
      .png({ compressionLevel: 7 })
      .toBuffer(),
  ]);

  return { front, back };
}

function renderPdf(options, buildDocument) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(options);
    const chunks = [];
    let settled = false;

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    try {
      buildDocument(doc);
      doc.end();
    } catch (error) {
      settled = true;
      reject(error);
    }
  });
}

async function buildExactCr80CardPdf(data) {
  const artwork = await renderWorkerCardArtwork(data);

  return renderPdf(
    {
      size: [CARD_WIDTH, CARD_HEIGHT],
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      compress: true,
      bufferPages: true,
      info: {
        Title: `Chalin 03 Staff ID Card - ${cleanText(
          data.profile?.full_name,
          180
        )}`,
        Author: data.company?.name || "Chalin 03 Company Limited",
        Subject: "Two-page ISO/IEC ID-1 CR80 corporate staff card",
        Creator: "Chalin 03 Group Operations Platform",
      },
    },
    (doc) => {
      // The constructor creates page 1. Using it directly avoids PDFKit's
      // autoFirstPage/addPage edge case that previously produced a blank page.
      doc.image(artwork.front, 0, 0, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });

      doc.addPage({
        size: [CARD_WIDTH, CARD_HEIGHT],
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      doc.image(artwork.back, 0, 0, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
    }
  );
}

function drawCutMarks(doc, x, y, width, height) {
  const mark = 9;
  const offset = 3;
  doc.save().strokeColor("#718096").lineWidth(0.55);

  [
    [x, y, -1, -1],
    [x + width, y, 1, -1],
    [x, y + height, -1, 1],
    [x + width, y + height, 1, 1],
  ].forEach(([cornerX, cornerY, horizontal, vertical]) => {
    doc
      .moveTo(cornerX + horizontal * offset, cornerY)
      .lineTo(cornerX + horizontal * mark, cornerY)
      .stroke();
    doc
      .moveTo(cornerX, cornerY + vertical * offset)
      .lineTo(cornerX, cornerY + vertical * mark)
      .stroke();
  });

  doc.restore();
}

async function buildA4ProofCardPdf(data) {
  const artwork = await renderWorkerCardArtwork(data);

  return renderPdf(
    {
      size: "A4",
      layout: "portrait",
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      compress: true,
      bufferPages: true,
      info: {
        Title: `Chalin 03 Staff ID A4 Proof - ${cleanText(
          data.profile?.full_name,
          180
        )}`,
        Author: data.company?.name || "Chalin 03 Company Limited",
        Subject: "Single-page A4 proof sheet for a CR80 corporate staff card",
        Creator: "Chalin 03 Group Operations Platform",
      },
    },
    (doc) => {
      const gap = 24;
      const totalWidth = CARD_WIDTH * 2 + gap;
      const startX = (A4_WIDTH - totalWidth) / 2;
      const cardY = 165;

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(
          cleanText(data.company?.name || "Chalin 03 Company Limited", 150).toUpperCase(),
          42,
          42,
          { width: A4_WIDTH - 84, align: "center", lineBreak: false }
        );
      doc
        .fillColor(GOLD)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("CR80 STAFF ID — FRONT AND BACK PRINT PROOF", 42, 72, {
          width: A4_WIDTH - 84,
          align: "center",
          lineBreak: false,
        });
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(8.5)
        .text(
          "Print at Actual Size / 100%. Do not use Fit to Page. The finished card size is 85.60 × 53.98 mm.",
          55,
          99,
          { width: A4_WIDTH - 110, align: "center" }
        );

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("FRONT", startX, cardY - 19, {
          width: CARD_WIDTH,
          align: "center",
        });
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("BACK", startX + CARD_WIDTH + gap, cardY - 19, {
          width: CARD_WIDTH,
          align: "center",
        });

      doc.image(artwork.front, startX, cardY, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
      doc.image(artwork.back, startX + CARD_WIDTH + gap, cardY, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });
      drawCutMarks(doc, startX, cardY, CARD_WIDTH, CARD_HEIGHT);
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
        .text("Professional printing instructions", 55, 390);
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(9)
        .text(
          [
            "1. Select Actual Size or 100% in the printer dialog.",
            "2. Use a CR80 card printer for direct duplex printing, or print this proof on suitable card stock.",
            "3. Do not select Fit, Shrink Oversized Pages or borderless enlargement.",
            "4. Confirm the photograph, employee number, issue date and expiry date before production.",
            "5. This is a corporate staff credential and must never be represented as a Ghana Card, ECOWAS card or government ID.",
          ].join("\n"),
          55,
          414,
          { width: A4_WIDTH - 110, lineGap: 6 }
        );

      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          "Generated by the Chalin 03 Group Operations Platform.",
          55,
          A4_HEIGHT - 58,
          { width: A4_WIDTH - 110, align: "center" }
        );
    }
  );
}

module.exports = {
  A4_HEIGHT,
  A4_WIDTH,
  CARD_HEIGHT,
  CARD_PIXEL_HEIGHT,
  CARD_PIXEL_WIDTH,
  CARD_WIDTH,
  backSvg,
  buildA4ProofCardPdf,
  buildExactCr80CardPdf,
  frontSvg,
  renderWorkerCardArtwork,
};
