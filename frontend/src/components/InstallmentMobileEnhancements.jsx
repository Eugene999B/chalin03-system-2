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

export default function InstallmentMobileEnhancements() {
  useEffect(() => {
    const root = document.body;
    root.classList.add("installment-finance-mobile");

    let frame = 0;
    const scan = () => {
      frame = 0;
      document
        .querySelectorAll(".finance-simple__field")
        .forEach(enhancePhotoField);
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
      root.classList.remove("installment-finance-mobile");
      document
        .querySelectorAll(".finance-simple__field[data-installment-photo-picker='true']")
        .forEach((field) => {
          delete field.dataset.installmentPhotoPicker;
        });
    };
  }, []);

  return null;
}
