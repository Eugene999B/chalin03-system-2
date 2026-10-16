import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import EquipmentFinanceStartWizardPage from "./EquipmentFinanceStartWizardPage";
import "../styles/equipmentFinanceOperationalPolish.css";

const API = "/equipment-catalogue/sales/operational-polish";
const DRAFT_KEY = "chalin03.finance.start-installment.v2";
const LEGACY_DRAFT_KEY = "chalin03.finance.start-installment.v1";
const DRAFT_CONFLICT_CODE = "FINANCE_DRAFT_VERSION_CONFLICT";

function parseLocalDraft() {
  const current = window.localStorage.getItem(DRAFT_KEY);
  if (current) {
    try {
      return JSON.parse(current);
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }

  const legacy = window.localStorage.getItem(LEGACY_DRAFT_KEY);
  if (!legacy) return null;

  try {
    const migrated = JSON.parse(legacy);
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(migrated));
    window.localStorage.removeItem(LEGACY_DRAFT_KEY);
    return migrated;
  } catch {
    window.localStorage.removeItem(LEGACY_DRAFT_KEY);
    return null;
  }
}

function text(value) {
  return String(value || "").trim();
}

function numberValue(value) {
  const number = Number(String(value || "0").replaceAll(",", ""));
  return Number.isFinite(number) ? number : 0;
}

function localProgress(payload = {}) {
  const sellingPrice = numberValue(payload.offer?.selling_price);
  const deposit = numberValue(payload.offer?.deposit);
  const financed = Math.max(sellingPrice - deposit, 0);
  const guarantorRequired = financed >= 100000;
  const checks = [
    {
      code: "customer",
      label: "Customer",
      complete:
        (payload.customerMode === "existing" && Boolean(payload.customer_id)) ||
        (payload.customerMode === "new" &&
          Boolean(text(payload.customer?.customer_name)) &&
          Boolean(text(payload.customer?.phone))),
    },
    { code: "machine", label: "Excavator", complete: Boolean(payload.asset_id) },
    {
      code: "plan",
      label: "Payment plan",
      complete:
        sellingPrice > 0 &&
        deposit >= 0 &&
        deposit <= sellingPrice &&
        numberValue(payload.offer?.installment_count) > 0 &&
        Boolean(payload.offer?.first_due_date),
    },
    {
      code: "kyc",
      label: "KYC details",
      complete:
        Boolean(text(payload.kyc?.id_number)) &&
        Boolean(text(payload.kyc?.employment_type)) &&
        Boolean(text(payload.kyc?.occupation)) &&
        Boolean(text(payload.kyc?.residential_address || payload.customer?.address)),
    },
    {
      code: "affordability",
      label: "Affordability",
      complete:
        numberValue(payload.affordability?.monthly_salary_income) +
          numberValue(payload.affordability?.monthly_business_income) +
          numberValue(payload.affordability?.monthly_other_income) >
        0,
    },
    {
      code: "consent",
      label: "Consent",
      complete: Boolean(
        payload.kyc?.customer_consent_confirmed &&
          payload.kyc?.credit_assessment_consent_confirmed
      ),
    },
    {
      code: "guarantor",
      label: guarantorRequired ? "Guarantor" : "Guarantor not required",
      complete:
        !guarantorRequired ||
        Boolean(
          text(payload.kyc?.guarantor_name) &&
            text(payload.kyc?.guarantor_phone) &&
            text(payload.kyc?.guarantor_id_number)
        ),
    },
  ];
  const completed = checks.filter((item) => item.complete).length;
  return {
    checklist: checks,
    complete_count: completed,
    total_count: checks.length,
    completion_percent: Number(((completed / checks.length) * 100).toFixed(2)),
  };
}

function timeLabel(value) {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
}

export default function EquipmentFinanceOperationalStartPage() {
  const { effectivePermissions = [] } = useAuth();
  const canServerSave = effectivePermissions.includes("fleet.assets.manage");
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState(canServerSave ? "loading" : "local_only");
  const [progress, setProgress] = useState(() => localProgress(parseLocalDraft() || {}));
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [problem, setProblem] = useState("");
  const versionRef = useRef(null);
  const conflictRef = useRef(null);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);

  const restoreServerDraft = useCallback((draft) => {
    if (!draft?.payload) return;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.payload));
    versionRef.current = Number(draft.version || 1);
    setProgress(draft.progress || localProgress(draft.payload));
    setLastSavedAt(draft.last_saved_at || null);
  }, []);

  useEffect(() => {
    let active = true;
    async function prepare() {
      if (!canServerSave) {
        setSaveState("local_only");
        setReady(true);
        return;
      }
      try {
        const response = await axiosClient.get(`${API}/drafts/start-installment`);
        if (!active) return;
        const serverDraft = response.data?.draft;
        const localDraft = parseLocalDraft();
        if (!localDraft && serverDraft?.payload) {
          restoreServerDraft(serverDraft);
          setSaveState("restored");
        } else {
          versionRef.current = serverDraft?.version ?? null;
          setProgress(localProgress(localDraft || serverDraft?.payload || {}));
          setLastSavedAt(serverDraft?.last_saved_at || null);
          setSaveState(localDraft ? "pending" : "ready");
        }
      } catch (error) {
        if (active) {
          setProblem(
            error.response?.data?.message ||
              "Server autosave is temporarily unavailable. This device will still keep the draft."
          );
          setSaveState("offline");
        }
      } finally {
        if (active) setReady(true);
      }
    }
    prepare();
    return () => {
      active = false;
    };
  }, [canServerSave, restoreServerDraft]);

  const saveCurrentDraft = useCallback(
    async (forceConflictResolution = false) => {
      if (
        !canServerSave ||
        savingRef.current ||
        (conflictRef.current && !forceConflictResolution)
      ) {
        return;
      }
      const payload = parseLocalDraft();
      if (!payload) return;
      savingRef.current = true;
      queuedRef.current = false;
      setSaveState("saving");
      setProblem("");
      try {
        const response = await axiosClient.put(`${API}/drafts/start-installment`, {
          payload,
          known_version: versionRef.current,
        });
        const draft = response.data?.draft;
        versionRef.current = draft?.version ?? versionRef.current;
        conflictRef.current = null;
        setConflict(null);
        setProgress(draft?.progress || localProgress(payload));
        setLastSavedAt(draft?.last_saved_at || new Date().toISOString());
        setSaveState("saved");
      } catch (error) {
        if (
          error.response?.status === 409 &&
          error.response?.data?.code === DRAFT_CONFLICT_CODE &&
          error.response?.data?.current_draft
        ) {
          conflictRef.current = error.response.data.current_draft;
          setConflict(error.response.data.current_draft);
          setSaveState("conflict");
          setProblem(error.response.data.message);
        } else {
          setSaveState("offline");
          setProblem(
            error.response?.data?.message ||
              "Server autosave failed. The current device copy remains available."
          );
        }
      } finally {
        savingRef.current = false;
        if (queuedRef.current && !conflictRef.current) {
          queuedRef.current = false;
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("chalin03:finance-draft-change", {
                detail: { payload: parseLocalDraft() },
              })
            );
          }, 0);
        }
      }
    },
    [canServerSave]
  );

  useEffect(() => {
    if (!ready) return undefined;
    let timer = null;

    const scheduleSave = (event) => {
      const payload = event?.detail?.payload || parseLocalDraft();
      setProgress(localProgress(payload || {}));
      window.clearTimeout(timer);
      if (!canServerSave) return;
      if (!payload) {
        timer = window.setTimeout(() => {
          if (savingRef.current) {
            queuedRef.current = true;
            return;
          }
          axiosClient
            .delete(`${API}/drafts/start-installment`)
            .then(() => {
              versionRef.current = null;
              setLastSavedAt(null);
              setSaveState("ready");
            })
            .catch(() => setSaveState("offline"));
        }, 300);
        return;
      }
      timer = window.setTimeout(() => {
        if (savingRef.current) {
          queuedRef.current = true;
          return;
        }
        saveCurrentDraft();
      }, 800);
    };

    window.addEventListener("chalin03:finance-draft-change", scheduleSave);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("chalin03:finance-draft-change", scheduleSave);
    };
  }, [canServerSave, ready, saveCurrentDraft]);

  function useServerVersion() {
    restoreServerDraft(conflictRef.current);
    conflictRef.current = null;
    setConflict(null);
    setProblem("");
    setSaveState("restored");
  }

  async function keepDeviceVersion() {
    versionRef.current = conflictRef.current?.version ?? versionRef.current;
    setProblem("");
    setSaveState("pending");
    await saveCurrentDraft(true);
  }

  const statusText = useMemo(() => {
    const labels = {
      loading: "Checking server draft…",
      ready: "Server autosave ready",
      pending: "Waiting to save…",
      saving: "Saving securely…",
      saved: `Saved at ${timeLabel(lastSavedAt)}`,
      restored: "Server draft restored",
      conflict: "Draft needs your decision",
      offline: "Device copy protected",
      local_only: "Local draft only for this access level",
    };
    return labels[saveState] || "Draft protection active";
  }, [lastSavedAt, saveState]);

  if (!ready) {
    return (
      <main className="finance-ops finance-ops--loading">
        <div className="finance-ops__empty">Preparing secure draft recovery…</div>
      </main>
    );
  }

  return (
    <>
      <section className={`finance-draft-bar is-${saveState}`} aria-live="polite">
        <div className="finance-draft-bar__status">
          <span aria-hidden="true">{saveState === "saved" ? "✓" : "●"}</span>
          <div>
            <strong>{statusText}</strong>
            <small>
              {progress.complete_count || 0} of {progress.total_count || 7} checklist items complete
            </small>
          </div>
        </div>
        <div className="finance-draft-bar__progress">
          <div>
            <span style={{ width: `${progress.completion_percent || 0}%` }} />
          </div>
          <strong>{Math.round(progress.completion_percent || 0)}%</strong>
        </div>
        <div className="finance-draft-bar__checks">
          {(progress.checklist || []).map((item) => (
            <span className={item.complete ? "is-complete" : ""} key={item.code}>
              {item.complete ? "✓" : "○"} {item.label}
            </span>
          ))}
        </div>
      </section>

      {problem ? (
        <div className="finance-ops__notice is-warning" role="alert">
          <span>{problem}</span>
          {conflict ? (
            <div>
              <button type="button" onClick={useServerVersion}>Use latest server draft</button>
              <button type="button" onClick={keepDeviceVersion}>Keep this device draft</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <EquipmentFinanceStartWizardPage />
    </>
  );
}
