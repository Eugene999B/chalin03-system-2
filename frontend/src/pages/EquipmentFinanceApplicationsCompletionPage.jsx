import { useEffect, useRef } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import EquipmentFinanceApplicationsOptionalPage from "./EquipmentFinanceApplicationsOptionalPage.jsx";
import "../styles/installmentCompletionPhaseOne.css";

const API = "/equipment-catalogue/sales/credit-applications";

function clean(value) {
  return String(value || "").trim();
}

function caseOperationsPath(applicationId) {
  const params = new URLSearchParams({
    stage: "case-operations",
    case_type: "application",
    case_id: String(applicationId),
  });
  return `/equipment-installment-finance/applications?${params.toString()}`;
}

function protectedApplicationImagePath(applicationId) {
  return `${API}/${applicationId}/image`;
}

function applicationNumberFromCard(card) {
  return clean(card.querySelector(".finance-simple__card-head small")?.textContent);
}

function applicationNumberFromDialog(dialog) {
  return clean(dialog.querySelector(".finance-simple__section-header h2")?.textContent);
}

function addCaseLink(container, application) {
  if (!container || container.querySelector('[data-completion-case-link="true"]')) return;
  const anchor = document.createElement("a");
  anchor.href = caseOperationsPath(application.id);
  anchor.dataset.completionCaseLink = "true";
  anchor.append(document.createTextNode("Case Operations"));
  container.append(anchor);
}

function hydrateCard(card, application) {
  if (!(card instanceof HTMLElement) || !application?.id) return;
  card.dataset.completionPhaseOneCard = "true";
  card.dataset.financeApplicationId = String(application.id);

  const imageContainer = card.querySelector(".finance-simple__machine-image");
  if (
    application.has_image &&
    imageContainer &&
    !imageContainer.querySelector("img")
  ) {
    imageContainer.querySelector("span")?.remove();
    const image = document.createElement("img");
    image.alt = application.asset_name || "Finance excavator";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = protectedApplicationImagePath(application.id);
    imageContainer.append(image);
  }

  addCaseLink(card.querySelector(".finance-simple__card-actions"), application);
}

function hydrateDialog(dialog, application) {
  if (!(dialog instanceof HTMLElement) || !application?.id) return;
  dialog.dataset.completionPhaseOneDialog = "true";
  addCaseLink(dialog.querySelector(".finance-simple__card-actions"), application);
}

export default function EquipmentFinanceApplicationsCompletionPage() {
  const rootRef = useRef(null);
  const applicationsRef = useRef(new Map());
  const lookupsRef = useRef(new Map());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    let active = true;
    let frame = 0;

    const applyKnownApplications = () => {
      frame = 0;
      if (!active) return;

      root.querySelectorAll(".finance-simple__card").forEach((card) => {
        const applicationNumber = applicationNumberFromCard(card);
        const application = applicationsRef.current.get(applicationNumber);
        if (application) {
          hydrateCard(card, application);
          return;
        }
        if (!applicationNumber || lookupsRef.current.has(applicationNumber)) return;

        const lookup = axiosClient
          .get(API, {
            params: {
              page: 1,
              page_size: 1,
              status: "all",
              search: applicationNumber,
            },
          })
          .then((response) => {
            const found = (response.data?.applications || []).find(
              (item) => clean(item.application_number) === applicationNumber
            );
            if (found) applicationsRef.current.set(applicationNumber, found);
          })
          .catch(() => undefined)
          .finally(() => {
            lookupsRef.current.delete(applicationNumber);
            scheduleHydration();
          });
        lookupsRef.current.set(applicationNumber, lookup);
      });

      root.querySelectorAll('.finance-simple__dialog[aria-label="Credit application file"]').forEach((dialog) => {
        const applicationNumber = applicationNumberFromDialog(dialog);
        const application = applicationsRef.current.get(applicationNumber);
        if (application) hydrateDialog(dialog, application);
      });
    };

    const scheduleHydration = () => {
      if (!active || frame) return;
      frame = window.requestAnimationFrame(applyKnownApplications);
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
        scheduleHydration();
      }
    });
    observer.observe(root, { childList: true, subtree: true });

    axiosClient
      .get(API, {
        params: { page: 1, page_size: 100, status: "all" },
      })
      .then((response) => {
        if (!active) return;
        for (const application of response.data?.applications || []) {
          applicationsRef.current.set(clean(application.application_number), application);
        }
        scheduleHydration();
      })
      .catch(() => {
        // The authoritative Applications page displays its own truthful error state.
      });

    scheduleHydration();
    return () => {
      active = false;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={rootRef} data-testid="finance-applications-completion-layer">
      <section className="installment-completion installment-completion--embedded">
        <div className="installment-completion__payment-guide">
          <div className="installment-completion__section-heading">
            <div>
              <p className="installment-completion__eyebrow">Application register and decisions</p>
              <h2>Applications & Approvals</h2>
              <span>
                Use this page for the complete register, draft work and manager decisions.
                Assigned work is in the Inbox; the full history of one record is in Case Operations.
              </span>
            </div>
            <div className="installment-completion__quick-links">
              <Link to="/equipment-installment-finance/applications?stage=inbox">Task Inbox</Link>
              <Link to="/equipment-installment-finance/applications?stage=case-operations">
                Case Operations
              </Link>
            </div>
          </div>
        </div>
      </section>
      <EquipmentFinanceApplicationsOptionalPage />
    </div>
  );
}

export {
  addCaseLink,
  applicationNumberFromCard,
  caseOperationsPath,
  hydrateCard,
  protectedApplicationImagePath,
};
