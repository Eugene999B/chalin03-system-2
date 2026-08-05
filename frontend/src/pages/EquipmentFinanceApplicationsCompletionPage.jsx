import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import EquipmentFinanceApplicationsOptionalPage from "./EquipmentFinanceApplicationsOptionalPage.jsx";
import "../styles/installmentCompletionPhaseOne.css";
import "../styles/equipmentFinanceProductionHotfix.css";

const API = "/equipment-catalogue/sales/credit-applications";
const ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "system_admin",
  "system_administrator",
  "super_admin",
]);

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

function isAdministrator(user) {
  return [user?.workspace_role, user?.access_role, user?.role]
    .map((value) => clean(value).toLowerCase())
    .some((role) => ADMIN_ROLES.has(role));
}

function addCaseLink(container, application) {
  if (!container || container.querySelector('[data-completion-case-link="true"]')) return;
  const anchor = document.createElement("a");
  anchor.href = caseOperationsPath(application.id);
  anchor.dataset.completionCaseLink = "true";
  anchor.append(document.createTextNode("Case Operations"));
  container.append(anchor);
}

function relabelAdministratorActions(container, administrator) {
  if (!administrator || !container) return;
  container.querySelectorAll("button").forEach((button) => {
    const currentLabel = clean(button.textContent).toLowerCase();
    if (!["submit", "submit for review"].includes(currentLabel)) return;
    button.textContent = "Approve Now";
    button.dataset.adminApprovalAction = "true";
    button.title =
      "Administrators approve directly. A separate manager review is not required.";
  });
}

function imageFallback(imageContainer, message) {
  const fallback = document.createElement("span");
  fallback.textContent = message;
  imageContainer.replaceChildren(fallback);
  imageContainer.dataset.completionImageState = "failed";
}

async function hydrateApplicationImage(imageContainer, application) {
  if (!application?.has_image || !imageContainer) return;
  if (["loading", "loaded"].includes(imageContainer.dataset.completionImageState)) return;

  imageContainer.dataset.completionImageState = "loading";
  imageContainer.replaceChildren();

  try {
    const response = await axiosClient.get(protectedApplicationImagePath(application.id), {
      responseType: "blob",
    });
    if (!(response.data instanceof Blob) || response.data.size < 1) {
      throw new Error("The excavator picture response was empty.");
    }

    const objectUrl = URL.createObjectURL(response.data);
    if (!imageContainer.isConnected) {
      URL.revokeObjectURL(objectUrl);
      return;
    }

    const image = document.createElement("img");
    image.alt = application.asset_name || "Finance excavator";
    image.loading = "lazy";
    image.decoding = "async";
    image.dataset.completionObjectUrl = objectUrl;
    image.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(objectUrl);
        imageFallback(imageContainer, "Excavator picture unavailable");
      },
      { once: true }
    );
    image.src = objectUrl;
    imageContainer.replaceChildren(image);
    imageContainer.dataset.completionImageState = "loaded";
  } catch (_error) {
    if (imageContainer.isConnected) {
      imageFallback(imageContainer, "Excavator picture unavailable");
    }
  }
}

function hydrateCard(card, application, { administrator = false } = {}) {
  if (!(card instanceof HTMLElement) || !application?.id) return;
  card.dataset.completionPhaseOneCard = "true";
  card.dataset.financeApplicationId = String(application.id);

  void hydrateApplicationImage(
    card.querySelector(".finance-simple__machine-image"),
    application
  );

  const actions = card.querySelector(".finance-simple__card-actions");
  addCaseLink(actions, application);
  relabelAdministratorActions(actions, administrator);
}

function hydrateDialog(dialog, application, { administrator = false } = {}) {
  if (!(dialog instanceof HTMLElement) || !application?.id) return;
  dialog.dataset.completionPhaseOneDialog = "true";
  const actions = dialog.querySelector(".finance-simple__card-actions");
  addCaseLink(actions, application);
  relabelAdministratorActions(actions, administrator);
}

function releaseHydratedImages(root) {
  root
    ?.querySelectorAll("img[data-completion-object-url]")
    .forEach((image) => {
      const objectUrl = image.dataset.completionObjectUrl;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
}

export default function EquipmentFinanceApplicationsCompletionPage() {
  const { user } = useAuth();
  const administrator = useMemo(() => isAdministrator(user), [user]);
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
          hydrateCard(card, application, { administrator });
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

      root
        .querySelectorAll('.finance-simple__dialog[aria-label="Credit application file"]')
        .forEach((dialog) => {
          const applicationNumber = applicationNumberFromDialog(dialog);
          const application = applicationsRef.current.get(applicationNumber);
          if (application) hydrateDialog(dialog, application, { administrator });
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
      releaseHydratedImages(root);
    };
  }, [administrator]);

  return (
    <div ref={rootRef} data-testid="finance-applications-completion-layer">
      <section className="installment-completion installment-completion--embedded">
        <div className="installment-completion__payment-guide">
          <div className="installment-completion__section-heading">
            <div>
              <p className="installment-completion__eyebrow">Application register and decisions</p>
              <h2>Applications & Approvals</h2>
              <span>
                Use this page for the complete register, draft work and authorised decisions.
                Administrators can approve an installment directly without waiting for a separate
                manager review. Assigned staff work remains in the Inbox, and the full history of
                one record remains in Case Operations.
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
  hydrateApplicationImage,
  hydrateCard,
  isAdministrator,
  protectedApplicationImagePath,
  relabelAdministratorActions,
};
