import { useEffect } from "react";

const TARGETS = [
  "A human manager must verify every fact, contract term, disciplinary reason and legal requirement before issue.",
  "No boss signature is configured. Drafts can be prepared, but approval is blocked until the authorised signature is saved in Document Signature Settings.",
  "Sent means Arkesel accepted the SMS submission. Delivered appears only when Arkesel confirms delivery to the phone. Chalin 03 checks Sent records briefly in the background and stops checking terminal failures.",
];

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hideTarget(target) {
  const normalizedTarget = clean(target);
  const elements = document.querySelectorAll("div,section,article,aside,p,li,span");

  for (const element of elements) {
    const text = clean(element.innerText || element.textContent);
    if (!text || !text.includes(normalizedTarget)) continue;
    if (text.length > normalizedTarget.length + 500) continue;

    element.style.display = "none";
    element.setAttribute("data-chalin03-hidden-platform-copy", "true");
    return;
  }
}

export default function PlatformNoticeCleanup() {
  useEffect(() => {
    const cleanNow = () => TARGETS.forEach(hideTarget);
    cleanNow();

    const observer = new MutationObserver(() => cleanNow());
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
