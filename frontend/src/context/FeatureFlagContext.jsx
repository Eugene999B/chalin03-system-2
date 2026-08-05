import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import axiosClient from "../api/axiosClient";

const FeatureFlagContext = createContext(null);
const TOKEN_KEY = "chalin03_token";
const TOKEN_CHECK_INTERVAL_MS = 1000;
const STATUS_REFRESH_INTERVAL_MS = 30000;

export const CHALIN_ONE_FEATURE_DEFAULTS = Object.freeze({
  aiEnabled: false,
  publicWebsite: false,
  contentStudio: false,
  chalinCopilot: false,
  chalinExecutive: false,
  chalinGuide: false,
  customerPortal: false,
  supplierPortal: false,
  applicantPortal: false,
  aiActions: false,
  aiScheduledJobs: false,
});

function currentToken() {
  try {
    return String(localStorage.getItem(TOKEN_KEY) || "");
  } catch {
    return "";
  }
}

function failClosedFlags(rawFlags) {
  const normalized = { ...CHALIN_ONE_FEATURE_DEFAULTS };

  if (!rawFlags || typeof rawFlags !== "object") {
    return normalized;
  }

  for (const featureKey of Object.keys(CHALIN_ONE_FEATURE_DEFAULTS)) {
    normalized[featureKey] = rawFlags[featureKey] === true;
  }

  return normalized;
}

async function requestFeatureSnapshot(tokenPresent) {
  const endpoint = tokenPresent ? "/features/staff" : "/features/public";
  const response = await axiosClient.get(endpoint, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  return {
    audience: tokenPresent ? "staff" : "public",
    flags: failClosedFlags(response.data?.flags),
  };
}

export function FeatureFlagProvider({ children }) {
  const [flags, setFlags] = useState(CHALIN_ONE_FEATURE_DEFAULTS);
  const [audience, setAudience] = useState("public");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const lastTokenRef = useRef(currentToken());
  const requestSequenceRef = useRef(0);

  const refreshFeatureFlags = useCallback(async () => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    const token = currentToken();

    setLoading(true);
    setError("");

    try {
      const snapshot = await requestFeatureSnapshot(Boolean(token));

      if (requestSequence !== requestSequenceRef.current) {
        return false;
      }

      setFlags(snapshot.flags);
      setAudience(snapshot.audience);
      return true;
    } catch (requestError) {
      if (requestSequence !== requestSequenceRef.current) {
        return false;
      }

      // Feature availability always fails closed. Ordinary Chalin 03 pages
      // continue to work even when this optional status request is unavailable.
      setFlags(CHALIN_ONE_FEATURE_DEFAULTS);
      setAudience(token ? "staff" : "public");
      setError(
        requestError.response?.data?.message ||
          "CHALIN ONE feature availability could not be confirmed."
      );
      return false;
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    const safeRefresh = () => {
      if (!active) return;
      refreshFeatureFlags();
    };

    safeRefresh();

    const tokenWatcher = window.setInterval(() => {
      const token = currentToken();

      if (token === lastTokenRef.current) {
        return;
      }

      lastTokenRef.current = token;
      safeRefresh();
    }, TOKEN_CHECK_INTERVAL_MS);

    const statusRefresh = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      safeRefresh();
    }, STATUS_REFRESH_INTERVAL_MS);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        safeRefresh();
      }
    };

    window.addEventListener("focus", safeRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      requestSequenceRef.current += 1;
      window.clearInterval(tokenWatcher);
      window.clearInterval(statusRefresh);
      window.removeEventListener("focus", safeRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshFeatureFlags]);

  const value = useMemo(
    () => ({
      flags,
      audience,
      loading,
      error,
      refreshFeatureFlags,
      isFeatureEnabled(featureKey) {
        if (!(featureKey in CHALIN_ONE_FEATURE_DEFAULTS)) {
          return false;
        }

        return flags[featureKey] === true;
      },
    }),
    [audience, error, flags, loading, refreshFeatureFlags]
  );

  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlags() {
  const context = useContext(FeatureFlagContext);

  if (!context) {
    throw new Error("useFeatureFlags must be used inside FeatureFlagProvider.");
  }

  return context;
}
