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
    Number(response?.data?.application?.id || 0) > 0
  );
}

export default function EquipmentFinanceCustomerPhotoStartPage() {
  useEffect(() => {
    const requestInterceptor = installFinanceCustomerPhotoRequestBridge();
    const responseInterceptor = axiosClient.interceptors.response.use((response) => {
      if (successfulCreation(response) && readFinanceCustomerPhoto()) {
        const photoResult = response.data?.customer_photo;
        if (!photoResult || photoResult.stored !== false) {
          clearFinanceCustomerPhoto();
        } else {
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
      }
      return response;
    });

    return () => {
      axiosClient.interceptors.request.eject(requestInterceptor);
      axiosClient.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  return (
    <>
      <EquipmentFinanceCustomerPhotoPanel />
      <EquipmentFinanceOperationalStartImmediatePage />
    </>
  );
}
