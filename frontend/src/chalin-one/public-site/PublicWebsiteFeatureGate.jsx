import { useCallback, useEffect, useRef, useState } from "react";

const STATUS_REFRESH_INTERVAL_MS = 30000;
const PUBLIC_API_BASE = String(
  import.meta.env.VITE_API_URL || "http://localhost:5000/api"
).replace(/\/+$/, "");
const PUBLIC_FEATURE_ENDPOINT = `${PUBLIC_API_BASE}/features/public`;

async function requestPublicWebsiteEnabled(signal) {
  const response = await fetch(PUBLIC_FEATURE_ENDPOINT, {
    method: "GET",
    signal,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error("Public website availability could not be confirmed.");
  }

  const payload = await response.json();
  return payload?.flags?.publicWebsite === true;
}

export default function PublicWebsiteFeatureGate({
  children,
  fallback = null,
  loadingFallback = null,
}) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const requestSequenceRef = useRef(0);
  const controllerRef = useRef(null);

  const refresh = useCallback(async ({ showLoading = false } = {}) => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (showLoading) setLoading(true);

    try {
      const nextEnabled = await requestPublicWebsiteEnabled(controller.signal);
      if (requestSequence === requestSequenceRef.current) {
        setEnabled(nextEnabled);
      }
    } catch (error) {
      if (error?.name !== "AbortError" && requestSequence === requestSequenceRef.current) {
        // Public availability always fails closed. The unavailable surface is
        // rendered instead of guessing that a disabled website should be open.
        setEnabled(false);
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    refresh({ showLoading: true });

    const intervalId = window.setInterval(() => {
      if (!active || document.visibilityState === "hidden") return;
      refresh();
    }, STATUS_REFRESH_INTERVAL_MS);

    const refreshWhenVisible = () => {
      if (active && document.visibilityState === "visible") refresh();
    };
    const refreshWhenFocused = () => {
      if (active) refresh();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenFocused);

    return () => {
      active = false;
      requestSequenceRef.current += 1;
      controllerRef.current?.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenFocused);
    };
  }, [refresh]);

  if (loading) return loadingFallback;
  return enabled ? children : fallback;
}

export {
  PUBLIC_FEATURE_ENDPOINT,
  STATUS_REFRESH_INTERVAL_MS,
  requestPublicWebsiteEnabled,
};
