import { useEffect, useState } from "react";

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIosDevice() {
  const userAgent = window.navigator.userAgent.toLowerCase();

  const normalIos =
    userAgent.includes("iphone") ||
    userAgent.includes("ipad") ||
    userAgent.includes("ipod");

  const ipadDesktopMode =
    window.navigator.platform === "MacIntel" &&
    window.navigator.maxTouchPoints > 1;

  return normalIos || ipadDesktopMode;
}

export default function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setIsInstalled(isStandaloneApp());

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
      setMessage("");
    }

    function handleInstalled() {
      setIsInstalled(true);
      setInstallPrompt(null);
      setMessage("");
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function handleInstallClick() {
    setMessage("");

    if (installPrompt) {
      installPrompt.prompt();

      const result = await installPrompt.userChoice;

      if (result.outcome === "accepted") {
        setIsInstalled(true);
      }

      setInstallPrompt(null);
      return;
    }

    if (isIosDevice()) {
      setMessage(
        "On iPhone/iPad: open this site in Safari, tap Share, then choose Add to Home Screen."
      );
      return;
    }

    setMessage(
      "Install prompt is not ready yet. On desktop Chrome/Edge, use the install icon in the address bar or open the browser menu and choose Install app."
    );
  }

  if (isInstalled) {
    return null;
  }

  return (
    <div style={{ marginBottom: "10px" }}>
      <button
        type="button"
        onClick={handleInstallClick}
        style={{
          width: "100%",
          border: "none",
          borderRadius: "9px",
          padding: "11px 12px",
          background: "#e0ba28",
          color: "#07182c",
          fontWeight: "900",
          cursor: "pointer",
        }}
      >
        Install App
      </button>

      {message && (
        <div
          style={{
            marginTop: "8px",
            padding: "10px",
            borderRadius: "9px",
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.85)",
            fontSize: "12px",
            lineHeight: "1.5",
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}