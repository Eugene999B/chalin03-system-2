const fs = require("node:fs");
const path = require("node:path");

const { run } = require("./runRelease31DisposableDrill");

function evidencePath() {
  return path.resolve(
    process.env.RELEASE31_DRILL_EVIDENCE_PATH ||
      path.join(__dirname, "../release31-disposable-drill-evidence.json")
  );
}

async function main() {
  try {
    await run();
  } catch (error) {
    const evidence = {
      status: "failed",
      generated_at: new Date().toISOString(),
      error: {
        name: error?.name || "Error",
        code: error?.code || null,
        message: error?.message || "Unknown Release 3.1 drill failure.",
        errno: error?.errno ?? null,
        sql_state: error?.sqlState || null,
        sql_message: error?.sqlMessage || null,
        sql: error?.sql ? String(error.sql).slice(0, 4000) : null,
        stack: error?.stack ? String(error.stack).slice(0, 8000) : null,
      },
    };
    fs.writeFileSync(evidencePath(), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { evidencePath, main };
