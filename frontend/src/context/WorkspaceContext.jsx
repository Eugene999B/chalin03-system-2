import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "./AuthContext";

const WorkspaceContext = createContext(null);

const STORAGE_KEYS = {
  mining: "chalin03_active_context_mining",
  equipment_hire: "chalin03_active_context_equipment_hire",
};

const FINANCE_VIRTUAL_CONTEXT = Object.freeze({
  id: 1,
  code: "FINANCE",
  name: "Company-wide Finance portfolio",
  is_virtual: true,
});

function isInstallmentFinancePath() {
  return (
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/equipment-installment-finance")
  );
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function contextStorageKey(workspaceCode) {
  return STORAGE_KEYS[workspaceCode] || null;
}

function getStoredContextId(workspaceCode) {
  const key = contextStorageKey(workspaceCode);
  if (!key) return null;
  return positiveId(localStorage.getItem(key));
}

function persistContextId(workspaceCode, contextId) {
  const key = contextStorageKey(workspaceCode);
  if (!key) return;

  const cleanId = positiveId(contextId);
  if (cleanId) {
    localStorage.setItem(key, String(cleanId));
  } else {
    localStorage.removeItem(key);
  }
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export function WorkspaceContextProvider({ children }) {
  const {
    token,
    role,
    loading: authLoading,
    isLoggedIn,
    workspaceCode,
    isMiningWorkspace,
    isEquipmentHireWorkspace,
  } = useAuth();

  const isManagedWorkspace = isMiningWorkspace || isEquipmentHireWorkspace;
  const [options, setOptions] = useState([]);
  const [contextType, setContextType] = useState("");
  const [selectedContextId, setSelectedContextId] = useState(null);
  const [defaultContextId, setDefaultContextId] = useState(null);
  const [automaticAccess, setAutomaticAccess] = useState(false);
  const [requiresSelection, setRequiresSelection] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const clearContextState = useCallback(() => {
    setOptions([]);
    setContextType("");
    setSelectedContextId(null);
    setDefaultContextId(null);
    setAutomaticAccess(false);
    setRequiresSelection(false);
    setLoading(false);
    setSavingDefault(false);
    setError("");
    setMessage("");
  }, []);

  const loadOptions = useCallback(async () => {
    if (
      authLoading ||
      !isLoggedIn ||
      !token ||
      !isManagedWorkspace
    ) {
      clearContextState();
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/workspace-context/options");
      const loadedOptions = Array.isArray(response.data?.options)
        ? response.data.options
        : [];
      const validIds = new Set(
        loadedOptions.map((option) => positiveId(option.id)).filter(Boolean)
      );
      const storedId = getStoredContextId(workspaceCode);
      const apiDefaultId = positiveId(response.data?.default_context_id);
      const isAutomatic = Boolean(response.data?.automatic_access);

      let nextSelectedId = null;

      if (storedId && validIds.has(storedId)) {
        nextSelectedId = storedId;
      } else if (apiDefaultId && validIds.has(apiDefaultId)) {
        nextSelectedId = apiDefaultId;
      } else if (loadedOptions.length === 1) {
        nextSelectedId = positiveId(loadedOptions[0].id);
      } else if (!isAutomatic && loadedOptions.length > 0) {
        nextSelectedId = positiveId(loadedOptions[0].id);
      }

      persistContextId(workspaceCode, nextSelectedId);
      setOptions(loadedOptions);
      setContextType(response.data?.context_type || "");
      setSelectedContextId(nextSelectedId);
      setDefaultContextId(apiDefaultId);
      setAutomaticAccess(isAutomatic);
      setRequiresSelection(Boolean(response.data?.requires_selection));
      setMessage(response.data?.message || "");
    } catch (requestError) {
      setOptions([]);
      setSelectedContextId(null);
      setDefaultContextId(null);
      setAutomaticAccess(role === "admin");
      setRequiresSelection(true);
      setMessage("");
      setError(
        apiMessage(
          requestError,
          "Could not load the Mining site or Equipment Hire location list."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [
    authLoading,
    clearContextState,
    isLoggedIn,
    isManagedWorkspace,
    role,
    token,
    workspaceCode,
  ]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const selectContext = useCallback(
    (value) => {
      const contextId = positiveId(value);

      if (contextId && !options.some((option) => Number(option.id) === contextId)) {
        setError("That site or location is not available to this account.");
        return false;
      }

      if (!contextId && !automaticAccess) {
        setError("Choose one of the sites or locations assigned to your account.");
        return false;
      }

      persistContextId(workspaceCode, contextId);
      setSelectedContextId(contextId);
      setError("");
      return true;
    },
    [automaticAccess, options, workspaceCode]
  );

  const makeDefault = useCallback(async () => {
    const contextId = positiveId(selectedContextId);
    if (!contextId) {
      setError("Choose a site or location before setting a default.");
      return false;
    }

    setSavingDefault(true);
    setError("");

    try {
      const response = await axiosClient.put(
        `/workspace-context/default/${contextId}`
      );
      setDefaultContextId(contextId);
      setOptions((current) =>
        current.map((option) => ({
          ...option,
          is_default: Number(option.id) === contextId,
        }))
      );
      setMessage(response.data?.message || "Default context updated.");
      return true;
    } catch (requestError) {
      setError(
        apiMessage(requestError, "Could not update the default site or location.")
      );
      return false;
    } finally {
      setSavingDefault(false);
    }
  }, [selectedContextId]);

  const selectedContext = useMemo(
    () =>
      options.find(
        (option) => Number(option.id) === Number(selectedContextId)
      ) || null,
    [options, selectedContextId]
  );

  const value = useMemo(
    () => ({
      isManagedWorkspace,
      workspaceCode,
      contextType,
      options,
      selectedContextId,
      selectedContext,
      defaultContextId,
      automaticAccess,
      requiresSelection,
      loading,
      savingDefault,
      error,
      message,
      canSelectAll: automaticAccess,
      selectContext,
      makeDefault,
      reloadOptions: loadOptions,
    }),
    [
      automaticAccess,
      contextType,
      defaultContextId,
      error,
      isManagedWorkspace,
      loadOptions,
      loading,
      makeDefault,
      message,
      options,
      requiresSelection,
      savingDefault,
      selectContext,
      selectedContext,
      selectedContextId,
      workspaceCode,
    ]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext() {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error(
      "useWorkspaceContext must be used inside WorkspaceContextProvider."
    );
  }

  if (isInstallmentFinancePath()) {
    return {
      ...context,
      isManagedWorkspace: false,
      workspaceCode: "equipment_installment_finance",
      contextType: "finance_portfolio",
      options: [],
      selectedContextId: FINANCE_VIRTUAL_CONTEXT.id,
      selectedContext: FINANCE_VIRTUAL_CONTEXT,
      defaultContextId: FINANCE_VIRTUAL_CONTEXT.id,
      automaticAccess: true,
      requiresSelection: false,
      loading: false,
      savingDefault: false,
      error: "",
      message: "Installment Finance is independent from Equipment Hire locations.",
      canSelectAll: true,
      selectContext: () => true,
      makeDefault: async () => true,
      reloadOptions: async () => true,
    };
  }

  return context;
}
