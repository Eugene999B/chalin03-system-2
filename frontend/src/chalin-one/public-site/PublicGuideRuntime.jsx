import { useCallback, useEffect, useRef, useState } from "react";
import PublicGuideWidget from "./PublicGuideWidget";
import { getPublicGuideAvailability } from "./publicGuideApi";

const GUIDE_STATUS_REFRESH_MS = 30000;

export default function PublicGuideRuntime() {
  const [enabled, setEnabled] = useState(false);
  const requestRef = useRef(0);
  const controllerRef = useRef(null);

  const refresh = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const next = await getPublicGuideAvailability({ signal: controller.signal });
      if (requestId === requestRef.current) setEnabled(next === true);
    } catch (error) {
      if (error?.name !== "AbortError" && requestId === requestRef.current) {
        setEnabled(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    refresh();
    const interval = window.setInterval(() => {
      if (active && document.visibilityState === "visible") refresh();
    }, GUIDE_STATUS_REFRESH_MS);
    const visible = () => {
      if (active && document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      requestRef.current += 1;
      controllerRef.current?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  return enabled ? <PublicGuideWidget /> : null;
}

export { GUIDE_STATUS_REFRESH_MS };
