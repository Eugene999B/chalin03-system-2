import { useEffect } from "react";
import "./publicInteractionSafety.css";

const SECURE_APPLICATION_ROOTS = Object.freeze([
  "/login",
  "/staff",
  "/content-studio",
  "/intelligence",
  "/mining",
  "/equipment-hire-operations",
]);

function isSecureApplicationPath(pathname) {
  return SECURE_APPLICATION_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`)
  );
}

function secureApplicationDestination(destination) {
  if (destination.pathname !== "/login") return destination.href;

  const target = new URL(destination.href);
  target.pathname = "/staff";
  return target.href;
}

export default function PublicInteractionSafety() {
  useEffect(() => {
    const handleSecureApplicationClick = (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;

      let destination;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.origin !== window.location.origin) return;
      if (!isSecureApplicationPath(destination.pathname)) return;

      // Secure routes belong to a different application shell. Public Staff
      // Portal links may still point at /login for compatibility, but the real
      // secure entry is /staff: ProtectedRoute sends signed-out visitors to
      // Login while an existing staff session opens directly without logout.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.location.href = secureApplicationDestination(destination);
    };

    document.addEventListener("click", handleSecureApplicationClick, true);
    return () => document.removeEventListener("click", handleSecureApplicationClick, true);
  }, []);

  return null;
}
