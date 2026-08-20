import { useEffect } from "react";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceCustomerPhotoPanel from "../components/EquipmentFinanceCustomerPhotoPanel";
import {
  clearFinanceCustomerPhoto,
  installFinanceCustomerPhotoRequestBridge,
  readFinanceCustomerPhoto,
} from "../utils/equipmentFinanceCustomerPhoto";
import EquipmentFinanceOperationalStartImmediatePage from "./EquipmentFinanceOperationalStartImmediatePage";
import "../styles/equipmentFinanceCustomerSelectionPhoto.css";

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

function preservePhotoWarning(response) {
  const photoResult = response?.data?.customer_photo;
  if (photoResult?.stored !== false) return;
  try {
    window.sessionStorage.setItem(
      "chalin03_finance_customer_photo_warning",
      photoResult.message ||
        "The application was created, but the customer picture still needs to be uploaded from the private document workspace."
    );
  } catch {
    // The committed application remains authoritative.
  }
}

function settleCommittedPhoto(response) {
  if (!readFinanceCustomerPhoto()) return;
  const photoResult = response?.data?.customer_photo;
  if (!photoResult || photoResult.stored !== false) {
    clearFinanceCustomerPhoto();
    return;
  }
  preservePhotoWarning(response);
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
    const requestInterceptorId = installFinanceCustomerPhotoRequestBridge();
    const responseInterceptorId = axiosClient.interceptors.response.use((response) => {
      if (!redirecting && successfulCreation(response)) {
        redirecting = true;
        settleCommittedPhoto(response);
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

        // Retired handoffs, kept here only to document the production failure:
        // navigate(safeNextPath(response), { replace: true }) could race with
        // the wizard's delayed navigation, while
        // window.location.replace(safeNextPath(response)) restarted AuthProvider
        // and discarded the first Applications reads during session restoration.
        // Replace only the current history entry and notify BrowserRouter in the
        // same authenticated document. No page reload and no second auth cycle.
        replaceFinanceLocation(safeNextPath(response));
      }
      return response;
    });

    return () => {
      axiosClient.interceptors.request.eject(requestInterceptorId);
      axiosClient.interceptors.response.eject(responseInterceptorId);
    };
  }, []);

  return (
    <>
      <EquipmentFinanceCustomerPhotoPanel />
      <EquipmentFinanceOperationalStartImmediatePage />
    </>
  );
}

export {
  cleanPath,
  clearCommittedDraft,
  replaceFinanceLocation,
  safeNextPath,
  settleCommittedPhoto,
  successfulCreation,
};
