import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

/** Fail closed until the server verifies this particular logged-in account. */
export default function useSaleDiscountPermission(userId, branchId) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    setAllowed(false);
    if (!userId) return () => { active = false; };

    axiosClient.get("/auth/discount-permission", {
      headers: { "Cache-Control": "no-store" },
    }).then((response) => {
      if (active) setAllowed(response.data?.can_apply_discount === true);
    }).catch(() => {
      if (active) setAllowed(false);
    });

    return () => { active = false; };
  }, [userId, branchId]);

  return allowed;
}
