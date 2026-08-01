const PRIVATE_DOCUMENT_PATH =
  "/equipment-catalogue/sales/documents-delivery/documents/";
const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";

function isPrivateDocumentLink(anchor) {
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  try {
    const url = new URL(anchor.href, window.location.origin);
    return (
      url.pathname.includes(PRIVATE_DOCUMENT_PATH) &&
      url.pathname.endsWith("/content")
    );
  } catch {
    return false;
  }
}

function storedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function responseFileName(response, fallback) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
  return quoted || fallback;
}

async function authenticatedDownload(anchor) {
  const token = localStorage.getItem(TOKEN_KEY) || "";
  if (!token) throw new Error("Your secure session has ended. Sign in again.");

  const user = storedUser();
  const workspaceCode =
    user?.workspace_code || user?.active_workspace?.code || "equipment_hire";
  const response = await fetch(anchor.href, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Chalin03-Workspace": String(workspaceCode),
      "X-Chalin03-Division": "installment_finance",
      Accept: "application/pdf,image/jpeg,image/png,application/octet-stream",
    },
  });

  if (!response.ok) {
    let message = "The private Finance document could not be downloaded.";
    try {
      const payload = await response.json();
      message = payload?.message || message;
    } catch {
      // The protected endpoint may return a non-JSON infrastructure response.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = objectUrl;
  download.download = responseFileName(
    response,
    anchor.getAttribute("download") || "finance-private-document"
  );
  download.rel = "noopener";
  document.body.appendChild(download);
  download.click();
  download.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function showDownloadError(anchor, error) {
  const message = error?.message || "The private document download failed.";
  const workspace = anchor.closest(".phase5-workspace");
  const existing = workspace?.querySelector("[data-phase5-download-error]");
  if (existing) {
    existing.textContent = message;
    return;
  }
  if (!workspace) {
    window.alert(message);
    return;
  }
  const notice = document.createElement("div");
  notice.className = "phase5-alert is-error";
  notice.setAttribute("role", "alert");
  notice.setAttribute("data-phase5-download-error", "true");
  notice.textContent = message;
  workspace.prepend(notice);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const anchor = event.target?.closest?.("a");
    if (!isPrivateDocumentLink(anchor)) return;

    event.preventDefault();
    event.stopPropagation();
    if (anchor.dataset.secureDownloadBusy === "true") return;

    anchor.dataset.secureDownloadBusy = "true";
    anchor.setAttribute("aria-busy", "true");
    authenticatedDownload(anchor)
      .catch((error) => showDownloadError(anchor, error))
      .finally(() => {
        delete anchor.dataset.secureDownloadBusy;
        anchor.removeAttribute("aria-busy");
      });
  });
}
