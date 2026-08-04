import { useEffect } from "react";
import { useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceOperationalStartImmediatePage from "./EquipmentFinanceOperationalStartImmediatePage";

const START_INSTALLMENT_PATH =
  "/equipment-catalogue/sales/phase-one/start-installment";
const APPLICATIONS_PATH = "/equipment-installment-finance/applications";

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

export default function EquipmentFinancePhaseThreeStartRedirectPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const interceptorId = axiosClient.interceptors.response.use((response) => {
      if (successfulCreation(response)) {
        // Move to the authoritative application file as soon as the committed
        // creation response arrives. This avoids the old delayed redirect racing
        // with server-draft deletion and returning the user to ?stage=start.
        navigate(safeNextPath(response), {
          replace: true,
          state: {
            financeCreationCompleted: true,
            applicationNumber:
              response.data?.application?.application_number || null,
          },
        });
      }
      return response;
    });

    return () => {
      axiosClient.interceptors.response.eject(interceptorId);
    };
  }, [navigate]);

  return <EquipmentFinanceOperationalStartImmediatePage />;
}

export { cleanPath, safeNextPath, successfulCreation };
