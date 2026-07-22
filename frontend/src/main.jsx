import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import EmergencyCommandOverlay from "./components/EmergencyCommandOverlay.jsx";
import { installCommandGateHistoryTracker } from "./utils/commandGateHistoryTracker.js";
import "./index.css";
import "./styles/userPermissionManager.mobile.css";
import "./styles/commandGateExtensions.css";

installCommandGateHistoryTracker();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <EmergencyCommandOverlay />
  </React.StrictMode>
);

async function removeDevelopmentServiceWorkerCaches() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();

    await Promise.all(
      registrations.map((registration) => registration.unregister())
    );

    if ("caches" in window) {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }

    if (registrations.length > 0) {
      console.log(
        "✅ Development service workers and old local caches were removed"
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not fully clear development service-worker caches:",
      error
    );
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => {
          console.log("✅ Chalin 03 service worker registered");
        })
        .catch((error) => {
          console.error("❌ Service worker registration failed:", error);
        });

      return;
    }

    removeDevelopmentServiceWorkerCaches();
  });
}
