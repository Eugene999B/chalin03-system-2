import { useEffect, useState } from "react";

export default function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    setIsInstalled(standalone);

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }

    function handleInstalled() {
      setIsInstalled(true);
      setInstallPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    if (installPrompt) {
      installPrompt.prompt();

      const result = await installPrompt.userChoice;

      if (result.outcome === "accepted") {
        setIsInstalled(true);
      }

      setInstallPrompt(null);
      return;
    }

    setShowIosHelp((current) => !current);
  }

  if (isInstalled) {
    return null;
  }

  return (
    <div style={{ marginBottom: "10px" }}>
      <button
        type="button"
        onClick={installApp}
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

      {showIosHelp && (
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
          On iPhone: tap Share, then choose Add to Home Screen.
        </div>
      )}
    </div>
  );
}