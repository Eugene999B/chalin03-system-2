import { useLayoutEffect, useRef } from "react";
import EquipmentFinanceApplicationsPage from "./EquipmentFinanceApplicationsPage.jsx";

const OPTIONAL_RECOMMENDATION =
  "Affordability details are optional and have not been recorded. This does not block submission or approval.";

export default function EquipmentFinanceApplicationsOptionalPage() {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const rewrite = () => {
      const heroText = root.querySelector(".finance-simple__hero > div > span");
      if (heroText) {
        heroText.textContent =
          "Customer profile, KYC, guarantor and affordability details are optional support information. Missing optional fields never block submission, review or approval.";
      }

      root.querySelectorAll(".finance-simple__summary strong").forEach((element) => {
        if (
          element.textContent?.includes(
            "Complete customer affordability before submitting this application for approval"
          )
        ) {
          element.textContent = OPTIONAL_RECOMMENDATION;
        }
      });
    };

    rewrite();
    const observer = new MutationObserver(rewrite);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="finance-optional-approval-shell">
      <div className="finance-simple__notice is-info" role="status">
        <strong>Optional-information rule:</strong> only the customer and transaction details
        needed to create the installment are required. Blank identity, address, employment,
        affordability, guarantor, consent or document fields do not stop submission or
        approval by an authorised manager.
      </div>
      <EquipmentFinanceApplicationsPage />
    </div>
  );
}
