const fs = require("fs");
const path = require("path");

const filePath = path.join(
  __dirname,
  "frontend",
  "src",
  "pages",
  "SmsPage.jsx"
);

const backupPath = path.join(
  __dirname,
  "frontend",
  "src",
  "pages",
  `SmsPage.backup-${Date.now()}.jsx`
);

function replaceBetween(source, startText, endText, replacement) {
  const start = source.indexOf(startText);

  if (start === -1) {
    throw new Error(`Could not find start text: ${startText}`);
  }

  const end = source.indexOf(endText, start);

  if (end === -1) {
    throw new Error(`Could not find end text after: ${startText}`);
  }

  return source.slice(0, start) + replacement + source.slice(end);
}

const helpersReplacement = `
  function formatProviderResponse(value) {
    if (!value) return "";

    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function buildSmsFailureMessage(data, fallback) {
    const baseMessage = data?.message || fallback || "SMS failed.";

    const rawResults = Array.isArray(data?.results)
      ? data.results
      : data?.result
      ? [data.result]
      : [];

    const failedResults = rawResults.filter(
      (result) => String(result?.status || "").toLowerCase() === "failed"
    );

    if (failedResults.length === 0) {
      return baseMessage;
    }

    const details = failedResults.map((result, index) => {
      const statusCode = result.status_code || result.statusCode || "";
      const providerResponse =
        result.provider_response || result.providerResponse || null;
      const providerText = formatProviderResponse(providerResponse);

      return [
        \`Failed SMS \${index + 1}: \${result.message || "SMS failed."}\`,
        statusCode ? \`HTTP Status: \${statusCode}\` : "",
        result.provider ? \`Provider: \${result.provider}\` : "",
        providerText ? \`Provider Response: \${providerText}\` : "",
      ]
        .filter(Boolean)
        .join("\\n");
    });

    return [baseMessage, ...details].join("\\n\\n");
  }

  function getFriendlyError(error, fallback) {
    return buildSmsFailureMessage(
      error?.response?.data,
      error?.message || fallback
    );
  }

`;

const sendCustomReplacement = `
  async function sendCustomSms(event) {
    event.preventDefault();

    setSending(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/custom", {
        target_type: targetType,
        phone: manualPhone,
        customer_ids: selectedCustomerIds,
        message,
        sms_type: "other",
        confirm_live_bulk: liveBulkConfirmed,
        confirm_text: liveBulkConfirmText,
      });

      const smsFeedback = buildSmsFailureMessage(
        response.data,
        "SMS sending completed."
      );

      const failedCount = Number(response.data?.failed_count || 0);
      const responseStatus = String(response.data?.status || "").toLowerCase();

      if (
        failedCount > 0 ||
        responseStatus === "partial" ||
        responseStatus === "error"
      ) {
        setError(smsFeedback);
        setNotice("");
      } else {
        setNotice(smsFeedback);
        setError("");
        setManualPhone("");
        setMessage("");
        setSelectedCustomerIds([]);
        resetLiveBulkConfirmation();
      }

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to send SMS."));
    } finally {
      setSending(false);
    }
  }

`;

const noticeErrorReplacement = `
      {notice && (
        <div className="success-box" style={{ whiteSpace: "pre-wrap" }}>
          {notice}
        </div>
      )}

      {error && (
        <div className="error-box" style={{ whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

`;

let code = fs.readFileSync(filePath, "utf8");

fs.writeFileSync(backupPath, code);

if (!code.includes("function formatProviderResponse")) {
  code = replaceBetween(
    code,
    "  function getFriendlyError(error, fallback) {",
    "  function escapeCsvValue(value) {",
    helpersReplacement
  );
}

code = replaceBetween(
  code,
  "  async function sendCustomSms(event) {",
  "  function formatDateTime(value) {",
  sendCustomReplacement
);

const returnStart = code.indexOf("  return (");
const noticeStart = code.indexOf("      {notice &&", returnStart);

if (noticeStart === -1) {
  throw new Error("Could not find notice/error message area.");
}

const marginMarker = 'marginBottom: "18px"';
const marginMarkerIndex = code.indexOf(marginMarker, noticeStart);

if (marginMarkerIndex === -1) {
  throw new Error("Could not find SMS status card after notice/error area.");
}

const statusCardStart = code.lastIndexOf("      <div", marginMarkerIndex);

if (statusCardStart === -1 || statusCardStart <= noticeStart) {
  throw new Error("Could not find start of SMS status card.");
}

code =
  code.slice(0, noticeStart) +
  noticeErrorReplacement +
  code.slice(statusCardStart);

fs.writeFileSync(filePath, code);

console.log("SmsPage.jsx updated successfully.");
console.log(`Backup created: ${backupPath}`);