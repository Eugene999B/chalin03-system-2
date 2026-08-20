import { useLayoutEffect, useRef } from "react";
import EquipmentFinanceStartWizardEnhancedPage from "./EquipmentFinanceStartWizardEnhancedPage.jsx";

function replaceText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

export default function EquipmentFinanceStartWizardOptionalPage() {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    replaceText(
      root.querySelector(".finance-profile__hero > div > span"),
      "All customer profile fields below are optional except the legal name and primary phone used when creating a new customer. Leaving any other field blank does not block draft creation, submission, review or approval."
    );

    const notice = root.querySelector(".finance-profile__notice");
    if (notice) {
      notice.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = "Optional customer details: ";
      notice.append(
        heading,
        document.createTextNode(
          "Record only the information available and useful to the company. Missing KYC, affordability, guarantor, consent or supporting-document details never prevent submission or approval. Documents may be added to the private vault when available."
        )
      );
    }

    replaceText(
      root.querySelector(".finance-profile__status > span"),
      "optional sections recorded"
    );
  }, []);

  return (
    <div ref={rootRef} className="finance-optional-profile-shell">
      <EquipmentFinanceStartWizardEnhancedPage />
    </div>
  );
}
