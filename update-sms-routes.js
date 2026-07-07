const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = __dirname;
const smsRoutesPath = path.join(projectRoot, "backend", "routes", "smsRoutes.js");
const backupPath = path.join(
  projectRoot,
  "backend",
  "routes",
  `smsRoutes.backup-before-fix-${Date.now()}.js`
);

const fixedSendAndLogSms = `async function sendAndLogSms({ branchId, phone, message, smsType, sentBy }) {
  const normalizedPhone = normalizeGhanaPhone(phone);

  if (!normalizedPhone) {
    const failureMessage = "Invalid Ghana phone number.";

    await writeSmsLog({
      branchId,
      phone: phone || "",
      message,
      smsType,
      status: "failed",
      providerResponse: {
        error: failureMessage,
      },
      sentBy,
    });

    return {
      phone,
      normalized_phone: "",
      status: "failed",
      message: failureMessage,
      status_code: null,
      provider: null,
      provider_response: {
        error: failureMessage,
      },
    };
  }

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
    });

    await writeSmsLog({
      branchId,
      phone: normalizedPhone,
      message,
      smsType,
      status: "sent",
      providerResponse: result.providerResponse,
      sentBy,
    });

    return {
      phone,
      normalized_phone: normalizedPhone,
      status: "sent",
      message: "SMS sent successfully.",
      provider: result.provider,
      status_code: null,
      provider_response: result.providerResponse || null,
    };
  } catch (error) {
    const providerResponse = error.providerResponse || null;
    const failureMessage = error.message || "SMS failed.";

    await writeSmsLog({
      branchId,
      phone: normalizedPhone,
      message,
      smsType,
      status: "failed",
      providerResponse: {
        error: failureMessage,
        statusCode: error.statusCode || null,
        provider: error.provider || null,
        providerResponse,
      },
      sentBy,
    });

    return {
      phone,
      normalized_phone: normalizedPhone,
      status: "failed",
      message: failureMessage,
      status_code: error.statusCode || null,
      provider: error.provider || null,
      provider_response: providerResponse,
    };
  }
}`;

function runCheck(filePath) {
  execFileSync("node", ["--check", filePath], {
    stdio: "inherit",
  });
}

const currentCode = fs.readFileSync(smsRoutesPath, "utf8");

const functionStart = currentCode.indexOf("async function sendAndLogSms");
if (functionStart === -1) {
  console.error("Could not find async function sendAndLogSms.");
  process.exit(1);
}

const nextRouteStart = currentCode.indexOf("\nrouter.get(", functionStart);
const nextRouteStartDouble = currentCode.indexOf("\n\nrouter.get(", functionStart);

const routeStart =
  nextRouteStartDouble !== -1 ? nextRouteStartDouble : nextRouteStart;

if (routeStart === -1) {
  console.error("Could not find router.get after sendAndLogSms.");
  process.exit(1);
}

const updatedCode =
  currentCode.slice(0, functionStart) +
  fixedSendAndLogSms +
  currentCode.slice(routeStart);

fs.writeFileSync(backupPath, currentCode);
fs.writeFileSync(smsRoutesPath, updatedCode);

try {
  runCheck(smsRoutesPath);
  console.log("smsRoutes.js fixed successfully.");
  console.log(`Backup created: ${backupPath}`);
} catch (error) {
  fs.writeFileSync(smsRoutesPath, currentCode);
  console.error("The fix failed syntax check, so the original file was restored.");
  console.error(`Backup is still here: ${backupPath}`);
  process.exit(1);
}