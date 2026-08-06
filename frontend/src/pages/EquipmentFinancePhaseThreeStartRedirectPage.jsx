import { useEffect } from "react";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceCustomerPhotoStartPage from "./EquipmentFinanceCustomerPhotoStartPage";

const START_INSTALLMENT_PATH =
  "/equipment-catalogue/sales/phase-one/start-installment";
const APPLICATIONS_PATH = "/equipment-installment-finance/applications";
const DRAFT_KEY = "chalin03.finance.start-installment.v2";
const LEGACY_DRAFT_KEY = "chalin03.finance.start-installment.v1";

function cleanPath(value) {
  return String(value || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/api(?=\/)/, "")
    .replace(/\?.*$/, "");
}

function successfulCreation(response) {
  return (
    String(response?.config?.method || "get").toLowerCase() === "post" &&
    cleanPath(response?.config?.url) === START_INSTALLMENT_PATH &&
    Number(response?.status) >= 200 &&
    Number(response?.status) < 300 &&
    Number(response?.data?.application?.id) > 0
  );
}

function safeNextPath(response) {
  const applicationId = Number(response?.data?.application?.id);
  const supplied = String(response?.data?.next_path || "").trim();
  if (
    supplied.startsWith(`${APPLICATIONS_PATH}?`) ||
    supplied === APPLICATIONS_PATH
  ) {
    return supplied;
  }
  return `${APPLICATIONS_PATH}?application=${applicationId}`;
}

function clearCommittedDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
    window.localStorage.removeItem(LEGACY_DRAFT_KEY);
    window.dispatchEvent(
      new CustomEvent("chalin03:finance-draft-change", {
        detail: { payload: null },
      })
    );
  } catch {
    // The committed application remains authoritative even if local cleanup is unavailable.
  }
}

function replaceFinanceLocation(nextPath) {
  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (currentPath === nextPath) return;

  window.history.replaceState(window.history.state, "", nextPath);
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: window.history.state })
  );
}

export default function EquipmentFinancePhaseThreeStartRedirectPage() {
  useEffect(() => {
    let redirecting = false;
    const interceptorId = axiosClient.interceptors.response.use((response) => {
      if (!redirecting && successfulCreation(response)) {
        redirecting = true;
        clearCommittedDraft();
        try {
          window.sessionStorage.setItem(
            "chalin03_finance_creation_notice",
            String(
              response.data?.application?.application_number ||
                "Installment application created."
            )
          );
        } catch {
          // Notice storage is not required for the committed handoff.
        }

        // Replace only the current history entry and notify BrowserRouter in the
        // same authenticated document. No page reload and no second auth cycle.
        replaceFinanceLocation(safeNextPath(response));
      }
      return response;
    });

    return () => {
      axiosClient.interceptors.response.eject(interceptorId);
    };
  }, []);

  return <EquipmentFinanceCustomerPhotoStartPage />;
}

export {
  cleanPath,
  clearCommittedDraft,
  replaceFinanceLocation,
  safeNextPath,
  successfulCreation,
};
