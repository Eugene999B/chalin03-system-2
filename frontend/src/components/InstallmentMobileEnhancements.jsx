import { useEffect } from "react";

function dispatchFiles(target, files) {
  if (!target || !files?.length) return false;
  try {
    const transfer = new DataTransfer();
    [...files].forEach((file) => transfer.items.add(file));
    target.files = transfer.files;
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

function enhancePhotoField(field) {
  if (!(field instanceof HTMLElement) || field.dataset.installmentPhotoPicker === "true") return;
  const input = field.querySelector('input[type="file"][accept*="image/"]');
  if (!input) return;

  const title = String(field.querySelector(":scope > span")?.textContent || "").toLowerCase();
  const isExcavatorPhotoField =
    title.includes("full machine photos") || title.includes("add more photos");
  if (!isExcavatorPhotoField) return;

  field.dataset.installmentPhotoPicker = "true";
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.style.position = "absolute";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";

  const picker = document.createElement("div");
  picker.className = "installment-photo-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Excavator photo options");

  const takeButton = document.createElement("button");
  takeButton.type = "button";
  takeButton.className = "installment-photo-picker__button is-primary";
  takeButton.textContent = "Take New Photo";

  const chooseButton = document.createElement("button");
  chooseButton.type = "button";
  chooseButton.className = "installment-photo-picker__button";
  chooseButton.textContent = "Choose Existing Photo";

  const helper = document.createElement("small");
  helper.className = "installment-photo-picker__helper";
  helper.textContent = "Use the camera for a new picture, or select photos already saved on this device.";

  const cameraInput = document.createElement("input");
  cameraInput.type = "file";
  cameraInput.accept = "image/*";
  cameraInput.multiple = true;
  cameraInput.setAttribute("capture", "environment");
  cameraInput.hidden = true;

  const galleryInput = document.createElement("input");
  galleryInput.type = "file";
  galleryInput.accept = "image/*";
  galleryInput.multiple = true;
  galleryInput.hidden = true;

  cameraInput.addEventListener("change", () => {
    dispatchFiles(input, cameraInput.files);
    cameraInput.value = "";
  });
  galleryInput.addEventListener("change", () => {
    dispatchFiles(input, galleryInput.files);
    galleryInput.value = "";
  });

  takeButton.addEventListener("click", () => cameraInput.click());
  chooseButton.addEventListener("click", () => galleryInput.click());

  picker.append(takeButton, chooseButton, helper, cameraInput, galleryInput);
  input.insertAdjacentElement("afterend", picker);
}

function injectInstallmentHardeningStyles() {
  const existing = document.getElementById("installment-finance-hardening-styles");
  if (existing) return existing;
  const style = document.createElement("style");
  style.id = "installment-finance-hardening-styles";
  style.textContent = `
    @media (min-width: 1200px) {
      body.finance-installment-page--start .finance-simple__hero {
        min-height: 150px !important;
        padding-top: 1.35rem !important;
        padding-bottom: 1.45rem !important;
      }
      body.finance-installment-page--start .finance-simple__hero h1 {
        font-size: clamp(2rem, 3.4vw, 3.65rem) !important;
      }
      body.finance-installment-page--start .finance-simple__hero span {
        max-width: 860px !important;
      }
    }
    @media (max-width: 767px) {
      body.installment-finance-mobile .finance-simple__dialog button,
      body.installment-finance-mobile .finance-simple__dialog a {
        min-height: 48px;
      }
      body.installment-finance-mobile .finance-simple__dialog {
        padding-bottom: max(1rem, env(safe-area-inset-bottom)) !important;
      }
      body.installment-finance-mobile .finance-simple__table-wrap {
        scrollbar-width: thin;
        -webkit-overflow-scrolling: touch;
      }
    }
  `;
  document.head.appendChild(style);
  return style;
}

function enhanceMobileDialogKeyboard() {
  const close = (event) => {
    if (event.key !== "Escape") return;
    const dialog = document.querySelector('.finance-simple__dialog[role="dialog"], .finance-accounts__dialog[role="dialog"]');
    if (!dialog) return;
    const closeButton = [...dialog.querySelectorAll("button")].find((button) => /^close$/i.test(button.textContent.trim()));
    if (closeButton) closeButton.click();
  };
  window.addEventListener("keydown", close);
  return () => window.removeEventListener("keydown", close);
}

export default function InstallmentMobileEnhancements() {
  useEffect(() => {
    const root = document.body;
    root.classList.add("installment-finance-mobile");
    const style = injectInstallmentHardeningStyles();
    const removeKeyboardHandler = enhanceMobileDialogKeyboard();

    let frame = 0;
    const scan = () => {
      frame = 0;
      document.querySelectorAll(".finance-simple__field").forEach(enhancePhotoField);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(scan);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      removeKeyboardHandler();
      root.classList.remove("installment-finance-mobile");
      style?.remove();
      document
        .querySelectorAll(".finance-simple__field[data-installment-photo-picker='true']")
        .forEach((field) => {
          delete field.dataset.installmentPhotoPicker;
        });
    };
  }, []);

  return null;
}
