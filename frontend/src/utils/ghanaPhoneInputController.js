const PHONE_HINT = /(?:phone|mobile|whatsapp|telephone|tel|contact\s*(?:number|phone))/i;
const SEARCH_HINT = /(?:search|query|filter)/i;

function isPhoneInput(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  if (input.disabled || input.readOnly) return false;

  const signature = [
    input.name,
    input.id,
    input.placeholder,
    input.autocomplete,
    input.getAttribute("aria-label"),
  ]
    .filter(Boolean)
    .join(" ");

  if (SEARCH_HINT.test(signature)) return false;
  if (input.type === "tel") return true;
  if (PHONE_HINT.test(signature)) return true;

  const parentText = input.parentElement?.textContent || "";
  return PHONE_HINT.test(parentText.slice(0, 120)) && !SEARCH_HINT.test(parentText.slice(0, 120));
}

function canonicalizeLocalDigits(value) {
  const raw = String(value ?? "").trim();
  let digits = raw.replace(/\D/g, "");

  if (digits.startsWith("233")) {
    digits = digits.slice(3);
  }

  if (digits.startsWith("0")) {
    digits = digits.slice(0, 10);
    if (digits.length === 10) {
      return `+233${digits.slice(1)}`;
    }
    return `+233${digits}`;
  }

  digits = digits.slice(0, 9);
  return digits ? `+233${digits}` : "";
}

function emitInput(input) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function bindPhoneInput(input) {
  if (input.dataset.c03PhoneBound === "true") return;
  input.dataset.c03PhoneBound = "true";
  input.setAttribute("inputmode", "tel");
  input.setAttribute("autocomplete", "tel");

  if (input.value.trim()) {
    const normalized = canonicalizeLocalDigits(input.value);
    if (normalized !== input.value) {
      input.value = normalized;
      emitInput(input);
    }
  }

  const normalize = (event) => {
    const raw = event.target.value;
    const normalized = canonicalizeLocalDigits(raw);

    if (normalized !== raw) {
      event.target.value = normalized;
    }

    if (event.target.value === "+233") {
      try {
        event.target.setSelectionRange(event.target.value.length, event.target.value.length);
      } catch {
        // Ignore unsupported selection APIs.
      }
    }
  };

  input.addEventListener("focus", () => {
    if (!input.value.trim()) {
      input.value = "+233";
      emitInput(input);
      requestAnimationFrame(() => {
        try {
          input.setSelectionRange(input.value.length, input.value.length);
        } catch {
          // Ignore unsupported selection APIs.
        }
      });
    }
  });

  input.addEventListener("beforeinput", (event) => {
    if (event.inputType === "deleteContentBackward" && input.value === "+233") {
      event.preventDefault();
    }
  });

  input.addEventListener("input", normalize);
  input.addEventListener("blur", normalize);
}

function scan(root = document) {
  if (root instanceof HTMLInputElement && isPhoneInput(root)) {
    bindPhoneInput(root);
  }

  root.querySelectorAll?.("input").forEach((input) => {
    if (isPhoneInput(input)) bindPhoneInput(input);
  });
}

export function installGhanaPhoneInputController() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__chalin03GhanaPhoneInputControllerInstalled) return;
  window.__chalin03GhanaPhoneInputControllerInstalled = true;

  scan();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function normalizeGhanaPhone(value) {
  const normalized = canonicalizeLocalDigits(value);
  return normalized.length === 13 && /^\+233\d{9}$/.test(normalized)
    ? normalized
    : null;
}
