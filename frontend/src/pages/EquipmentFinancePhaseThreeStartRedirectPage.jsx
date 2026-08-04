import { useEffect } from "react";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceOperationalStartImmediatePage from "./EquipmentFinanceOperationalStartImmediatePage";

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

        // Migration note: the retired SPA handoff was
        // navigate(safeNextPath(response), { replace: true }). It changed the
        // rendered route without reliably changing the production browser URL.
        // A real browser replacement is intentional here. It creates one stable
        // Applications document with the exact committed application URL, while
        // cancelling the old wizard's delayed navigation and request controllers.
        window.location.replace(safeNextPath(response));
      }
      return response;
    });

    return () => {
      axiosClient.interceptors.response.eject(interceptorId);
    };
  }, []);

  return <EquipmentFinanceOperationalStartImmediatePage />;
}

export {
  cleanPath,
  clearCommittedDraft,
  safeNextPath,
  successfulCreation,
};
