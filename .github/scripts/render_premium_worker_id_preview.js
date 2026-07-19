const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const backendRequire = createRequire(
  path.resolve(__dirname, "..", "..", "backend", "package.json")
);
const sharp = backendRequire("sharp");

const {
  buildA4ProofCardPdf,
  buildExactCr80CardPdf,
} = require("../../backend/services/premiumWorkerCardService");

async function main() {
  const outputDirectory = path.resolve(
    __dirname,
    "..",
    "..",
    "premium-worker-id-preview"
  );
  fs.mkdirSync(outputDirectory, { recursive: true });

  const photo = await sharp({
    create: {
      width: 720,
      height: 960,
      channels: 3,
      background: { r: 196, g: 111, b: 170 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" width="720" height="960">
            <rect width="720" height="960" fill="#d98ac2"/>
            <circle cx="360" cy="250" r="105" fill="#754b38"/>
            <path d="M190 900 C220 520 500 520 530 900 Z" fill="#29724f"/>
            <path d="M280 410 L440 410 L470 760 L250 760 Z" fill="#adc49a"/>
          </svg>
        `),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const data = {
    profile: {
      id: 1,
      full_name: "Appiah Amankwah Eugene",
      employee_number: "CH03-SP-0001",
      id_card_serial: "CH03-ID-0001-2026",
      job_title: "IT Personnel",
      department: "Group Operations",
      employment_status: "active",
      id_card_issue_date: "2026-07-19",
      id_card_expiry_date: "2028-07-19",
      photo_data: photo,
    },
    assignments: [
      {
        workspace_code: "spare_parts",
        context_label: "Dunkwa Police Barrier",
        is_active: 1,
      },
    ],
    company: {
      name: "Chalin 03 Company Limited",
      address: "Dunkwa Police Barrier, Ghana",
      phone: "0249469080",
    },
  };

  const [exactPdf, proofPdf] = await Promise.all([
    buildExactCr80CardPdf(data),
    buildA4ProofCardPdf(data),
  ]);

  fs.writeFileSync(
    path.join(outputDirectory, "approved-premium-worker-id-cr80.pdf"),
    exactPdf
  );
  fs.writeFileSync(
    path.join(outputDirectory, "approved-premium-worker-id-a4-proof.pdf"),
    proofPdf
  );

  console.log(`Premium worker ID previews written to ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
