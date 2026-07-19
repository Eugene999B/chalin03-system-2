from pathlib import Path


path = Path("backend/services/workerCardDrawingService.js")
source = path.read_text(encoding="utf-8")

old = '''  drawInfoRow(
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

  doc.rect(0, 147, CARD_WIDTH, 6).fill(NAVY);'''

new = '''  doc.roundedRect(82, 119, 150, 10, 2.5).fill("#eef3f7");
  doc
    .lineWidth(0.45)
    .strokeColor(BORDER)
    .roundedRect(82, 119, 150, 10, 2.5)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.3)
    .text("WORKSPACE", 87, 122.2, {
      width: 34,
      lineBreak: false,
    });
  fitText(doc, workArea, 120, 121.2, 106, 4.7, 3.8, {
    color: NAVY,
    align: "right",
  });

  doc.roundedRect(9, 128, 95, 18, 3).fill(LIGHT);
  doc
    .lineWidth(0.5)
    .strokeColor(BORDER)
    .roundedRect(9, 128, 95, 18, 3)
    .stroke();
  doc
    .moveTo(56.5, 130)
    .lineTo(56.5, 144)
    .strokeColor(BORDER)
    .stroke();

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.4)
    .text("ISSUE DATE", 14, 130.7, {
      width: 38,
      align: "center",
      lineBreak: false,
    });
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.4)
    .text(formatDate(profile.id_card_issue_date), 11, 136.7, {
      width: 43,
      align: "center",
      lineBreak: false,
    });

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.4)
    .text("EXPIRY DATE", 59, 130.7, {
      width: 41,
      align: "center",
      lineBreak: false,
    });
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.4)
    .text(formatDate(profile.id_card_expiry_date), 58, 136.7, {
      width: 43,
      align: "center",
      lineBreak: false,
    });

  doc.roundedRect(108, 130, 38, 15, 3).fill("#eef8f0");
  doc
    .lineWidth(0.45)
    .strokeColor("#9fd4aa")
    .roundedRect(108, 130, 38, 15, 3)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.1)
    .text("STATUS", 108, 132.1, {
      width: 38,
      align: "center",
      lineBreak: false,
    });
  fitText(doc, status.toUpperCase(), 110, 136.3, 34, 5.4, 4.2, {
    color: GREEN,
    align: "center",
  });

  doc
    .moveTo(153, 136)
    .lineTo(229, 136)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.15)
    .text("AUTHORIZED SIGNATURE", 153, 139.2, {
      width: 76,
      align: "center",
      lineBreak: false,
    });

  doc.rect(0, 147, CARD_WIDTH, 6).fill(NAVY);'''

if new in source:
    print("Premium worker ID front layout is already corrected.")
elif old not in source:
    raise RuntimeError("Could not locate the old overlapping front-card layout.")
else:
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print("Corrected premium worker ID front-card lower layout.")
