import { useEffect, useState } from "react";

const INSTALL_STORAGE_KEY = "chalin03_app_installed";

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

function getStoredInstalledStatus() {
  return localStorage.getItem(INSTALL_STORAGE_KEY) === "yes";
}

function saveInstalledStatus() {
  localStorage.setItem(INSTALL_STORAGE_KEY, "yes");
}

export default function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const alreadyInstalled = isStandaloneApp() || getStoredInstalledStatus();

    if (alreadyInstalled) {
      setIsInstalled(true);
      saveInstalledStatus();
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
      setMessage("");
      setIsInstalled(false);
    }

    function handleInstalled() {
      saveInstalledStatus();
      setIsInstalled(true);
      setInstallPrompt(null);
      setMessage("✅ Chalin 03 app has been installed successfully.");
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

    if (isInstalled || getStoredInstalledStatus() || isStandaloneApp()) {
      setIsInstalled(true);
      saveInstalledStatus();
      setMessage("✅ Chalin 03 app is already installed on this device.");
      return;
    }

    if (installPrompt) {
      installPrompt.prompt();

      const result = await installPrompt.userChoice;

      if (result.outcome === "accepted") {
        saveInstalledStatus();
        setIsInstalled(true);
        setMessage("✅ Chalin 03 app has been installed successfully.");
      } else {
        setMessage("Installation was cancelled.");
      }

      setInstallPrompt(null);
      return;
    }

    if (isIosDevice()) {
      setMessage(
        "On iPhone/iPad: open this site in Safari, tap Share, then choose Add to Home Screen. After adding it, open the app from your Home Screen."
      );
      return;
    }

    setMessage(
      "If Chalin 03 is already on your desktop, open it from your desktop/start menu. If not, use Chrome/Edge address-bar install icon or browser menu → Install app."
    );
  }

  return (
    <div style={{ marginBottom: "10px" }}>
      <button
        type="button"
        onClick={handleInstallClick}
        disabled={isInstalled}
        style={{
          width: "100%",
          border: "none",
          borderRadius: "9px",
          padding: "11px 12px",
          background: isInstalled ? "#16a34a" : "#e0ba28",
          color: isInstalled ? "#ffffff" : "#07182c",
          fontWeight: "900",
          cursor: isInstalled ? "default" : "pointer",
        }}
      >
        {isInstalled ? "App Installed ✓" : "Install App"}
      </button>

      {message && (
        <div
          style={{
            marginTop: "8px",
            padding: "10px",
            borderRadius: "9px",
            background: isInstalled
              ? "rgba(22, 163, 74, 0.18)"
              : "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.9)",
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