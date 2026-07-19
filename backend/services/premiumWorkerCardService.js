const PDFDocument = require("pdfkit");

const {
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
} = require("./workerCardDrawingService");
const {
  createVerificationQr,
} = require("./workerCardVerificationService");

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
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
  const qrBuffer = await createVerificationQr(data.profile || {});

  return renderPdf(
    {
      autoFirstPage: false,
      compress: true,
      bufferPages: true,
      info: {
        Title: `Chalin 03 Staff ID Card - ${cleanText(
          data.profile?.full_name,
          180
        )}`,
        Author:
          data.company?.name ||
          "Chalin 03 Company Limited",
        Subject:
          "Two-page ISO/IEC ID-1 CR80 corporate staff credential",
        Creator:
          "Chalin 03 Group Operations Platform",
      },
    },
    (doc) => {
      doc.addPage({
        size: [CARD_WIDTH, CARD_HEIGHT],
        margin: 0,
      });
      drawFrontCard(doc, data);

      doc.addPage({
        size: [CARD_WIDTH, CARD_HEIGHT],
        margin: 0,
      });
      drawBackCard(doc, data, qrBuffer);
    }
  );
}

async function buildA4ProofCardPdf(data) {
  const qrBuffer = await createVerificationQr(
    data.profile || {}
  );

  return renderPdf(
    {
      autoFirstPage: false,
      compress: true,
      bufferPages: true,
      info: {
        Title: `Chalin 03 Staff ID Card A4 Proof - ${cleanText(
          data.profile?.full_name,
          180
        )}`,
        Author:
          data.company?.name ||
          "Chalin 03 Company Limited",
        Subject:
          "Single-page A4 proof of the approved CR80 staff card",
        Creator:
          "Chalin 03 Group Operations Platform",
      },
    },
    (doc) => {
      doc.addPage({ size: "A4", margin: 0 });
      doc.rect(0, 0, A4_WIDTH, A4_HEIGHT).fill(WHITE);

      drawLogo(doc, 42, 32, 42);
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(17)
        .text(
          (
            data.company?.name ||
            "Chalin 03 Company Limited"
          ).toUpperCase(),
          96,
          38,
          {
            width: A4_WIDTH - 138,
            lineBreak: false,
            ellipsis: true,
          }
        );
      doc
        .fillColor(GOLD)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          "APPROVED STAFF IDENTIFICATION CARD — A4 PRINT PROOF",
          96,
          62,
          {
            width: A4_WIDTH - 138,
            lineBreak: false,
          }
        );

      const gap = 24;
      const startX =
        (A4_WIDTH - CARD_WIDTH * 2 - gap) / 2;
      const cardY = 122;

      drawFrontCard(doc, data, startX, cardY, 1);
      drawBackCard(
        doc,
        data,
        qrBuffer,
        startX + CARD_WIDTH + gap,
        cardY,
        1
      );

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("FRONT", startX, cardY - 18, {
          width: CARD_WIDTH,
          align: "center",
        });
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          "BACK",
          startX + CARD_WIDTH + gap,
          cardY - 18,
          {
            width: CARD_WIDTH,
            align: "center",
          }
        );

      doc
        .fillColor(TEXT)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(
          "Printing instructions",
          58,
          cardY + CARD_HEIGHT + 62
        );
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(9)
        .text(
          [
            "1. Print at Actual Size / 100%.",
            "2. Do not use Fit to Page or Shrink Oversized Pages.",
            "3. Use CR80-compatible card stock or a duplex card printer.",
            "4. Verify the employee number, photograph, issue date, expiry date and QR result before production.",
            "5. This is a corporate credential and not a national or travel identity document.",
          ].join("\n"),
          58,
          cardY + CARD_HEIGHT + 82,
          {
            width: A4_WIDTH - 116,
            lineGap: 5,
          }
        );
    }
  );
}

module.exports = {
  A4_HEIGHT,
  A4_WIDTH,
  CARD_HEIGHT,
  CARD_WIDTH,
  buildA4ProofCardPdf,
  buildExactCr80CardPdf,
};
