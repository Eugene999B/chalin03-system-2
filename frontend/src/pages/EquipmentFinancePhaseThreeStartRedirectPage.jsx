import { useEffect } from "react";
import { useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceOperationalStartImmediatePage from "./EquipmentFinanceOperationalStartImmediatePage";

const START_INSTALLMENT_PATH =
  "/equipment-catalogue/sales/phase-one/start-installment";
const APPLICATIONS_PATH = "/equipment-installment-finance/applications";
const CREATION_REDIRECT_FALLBACK_MS = 1250;

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

function stillOnStartScreen() {
  if (typeof window === "undefined") return false;
  const query = new URLSearchParams(window.location.search);
  return (
    window.location.pathname === APPLICATIONS_PATH && query.get("stage") === "start"
  );
}

export default function EquipmentFinancePhaseThreeStartRedirectPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let fallbackTimer = null;
    const interceptorId = axiosClient.interceptors.response.use((response) => {
      if (successfulCreation(response)) {
        // The wizard owns the normal committed-response redirect. Provide a
        // guarded fallback only if it is still on ?stage=start after that
        // handoff window. This prevents a second navigation from aborting the
        // Applications list, readiness and detail requests.
        window.clearTimeout(fallbackTimer);
        fallbackTimer = window.setTimeout(() => {
          if (!stillOnStartScreen()) return;
          navigate(safeNextPath(response), {
            replace: true,
            state: {
              financeCreationCompleted: true,
              applicationNumber:
                response.data?.application?.application_number || null,
            },
          });
        }, CREATION_REDIRECT_FALLBACK_MS);
      }
      return response;
    });

    return () => {
      window.clearTimeout(fallbackTimer);
      axiosClient.interceptors.response.eject(interceptorId);
    };
  }, [navigate]);

  return <EquipmentFinanceOperationalStartImmediatePage />;
}

export {
  cleanPath,
  safeNextPath,
  stillOnStartScreen,
  successfulCreation,
};
