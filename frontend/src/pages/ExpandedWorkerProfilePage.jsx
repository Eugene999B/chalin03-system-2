import {
  useEffect,
  useMemo,
  useState,
} from "react";

import axiosClient from "../api/axiosClient";
import {
  useAuth,
} from "../context/AuthContext";

import WorkerHrLettersPanel from "../components/WorkerHrLettersPanel";
import WorkerPayrollPanel from "../components/WorkerPayrollPanel";

import "../styles/expandedWorkerProfile.css";

const today = new Date()
  .toISOString()
  .slice(0, 10);

const emptyCreateForm = {
  full_name: "",
  preferred_name: "",
  phone: "",
  email: "",
  job_title: "",
  department: "",
  employment_type: "permanent",
  employment_start_date: today,
  basic_salary: "",
  pay_frequency: "monthly",
};

const profileFields = [
  ["full_name", "Full legal name"],
  ["preferred_name", "Preferred name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["date_of_birth", "Date of birth", "date"],
  ["gender", "Gender"],
  ["nationality", "Nationality"],
  ["marital_status", "Marital status"],
  ["hometown", "Hometown"],
  ["digital_address", "GhanaPost digital address"],
  ["national_id_type", "National ID type"],
  ["national_id_number", "National ID number"],
  ["national_id_issue_date", "ID issue date", "date"],
  ["national_id_expiry_date", "ID expiry date", "date"],
  ["ssnit_number", "SSNIT number"],
  ["tin_number", "TIN number"],
  ["blood_group", "Blood group"],
  ["job_title", "Job title"],
  ["department", "Department"],
  ["employment_start_date", "Employment start date", "date"],
  ["employment_end_date", "Employment end date", "date"],
];

const tabItems = [
  ["overview", "Profile Overview"],
  ["personal", "Personal & National ID"],
  ["family", "Family & Emergency"],
  ["employment", "Employment & Assignments"],
  ["documents", "Documents & Licences"],
  ["letters", "Letters & HR Correspondence"],
  ["property", "Property & History"],
];

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-GB");
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-GB");
}

function formatBytes(value) {
  const bytes = Number(value || 0);

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function errorMessage(error, fallback) {
  return (
    error.response?.data?.message ||
    error.message ||
    fallback
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error("The selected file could not be read."));

    reader.readAsDataURL(file);
  });
}


function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
    } catch {
      // Fall back to an HTML image below.
    }
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(
        new Error("The selected photograph could not be decoded.")
      );
      element.src = objectUrl;
    });

    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function optimizeWorkerPhoto(file) {
  const allowedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  if (!allowedTypes.has(file.type)) {
    throw new Error("Choose a JPEG, PNG or WebP photograph.");
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error("The selected photograph is too large. Choose an image below 15 MB.");
  }

  const source = await loadImageSource(file);
  const sourceWidth = Number(source.naturalWidth || source.width || 0);
  const sourceHeight = Number(source.naturalHeight || source.height || 0);

  if (!sourceWidth || !sourceHeight) {
    source.close?.();
    throw new Error("The selected photograph has invalid dimensions.");
  }

  const maximumDimension = 1200;
  const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    source.close?.();
    throw new Error("This browser could not prepare the worker photograph.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  source.close?.();

  let mimeType = "image/webp";
  let quality = 0.84;
  let blob = await canvasToBlob(canvas, mimeType, quality);

  if (!blob) {
    mimeType = "image/jpeg";
    blob = await canvasToBlob(canvas, mimeType, 0.84);
  }

  while (blob && blob.size > 2 * 1024 * 1024 && quality > 0.6) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, mimeType, quality);
  }

  if (!blob || blob.size > 2 * 1024 * 1024) {
    throw new Error("The photograph could not be reduced below the secure 2 MB upload limit.");
  }

  const stem = String(file.name || "worker-photo")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "") || "worker-photo";

  return {
    fileName: `${stem}.${mimeType === "image/webp" ? "webp" : "jpg"}`,
    mimeType,
    dataUrl: await fileToDataUrl(blob),
    size: blob.size,
  };
}

function Notice({
  type = "info",
  children,
}) {
  return (
    <div className={`worker-notice ${type}`}>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}) {
  return (
    <label className="worker-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function EmptyState({
  children,
}) {
  return (
    <div className="worker-empty">
      {children}
    </div>
  );
}

function ProtectedUnlock({
  token,
  onToken,
}) {
  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const active =
    token?.value &&
    token.expiresAt > Date.now();

  async function unlock(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.post(
        "/release2-final/security/unlock",
        {
          password,
        }
      );

      setPassword("");

      onToken({
        value:
          response.data.protected_action_token,
        expiresAt:
          Date.now() +
          Number(
            response.data.expires_in_minutes || 10
          ) *
            60 *
            1000,
      });
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Protected Action Unlock failed."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="worker-unlock">
      <div>
        <strong>Protected Action Unlock</strong>
        <span>
          Required before worker deactivation or
          other sensitive status changes.
        </span>
      </div>

      {active ? (
        <Notice type="success">
          Protected actions are unlocked temporarily.
        </Notice>
      ) : (
        <form onSubmit={unlock}>
          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Current password"
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            disabled={loading}
          >
            {loading ? "Unlocking..." : "Unlock"}
          </button>
        </form>
      )}

      {error ? (
        <Notice type="error">{error}</Notice>
      ) : null}
    </div>
  );
}

export default function ExpandedWorkerProfilePage() {
  const auth = useAuth();
  const activeWorkspaceCode =
    auth.workspaceCode || auth.user?.workspace_code || "spare_parts";
  const activeWorkspaceLabel =
    activeWorkspaceCode === "mining"
      ? "Mining Operations"
      : activeWorkspaceCode === "equipment_hire"
        ? "Equipment Hire"
        : "Spare Parts";

  const canManage = auth.hasPermission(
    "workers.manage"
  );

  const canSensitive = auth.hasPermission(
    "workers.sensitive.view"
  );

  const canDocuments = auth.hasPermission(
    "workers.documents.view"
  );

  const canManageDocuments = auth.hasPermission(
    "workers.documents.manage"
  );

  const canDeactivate = auth.hasPermission(
    "workers.deactivate"
  );

  const canPayrollView = auth.hasPermission(
    "payroll.view"
  );

  const canPayrollManage = auth.hasPermission(
    "payroll.manage"
  );

  const [workers, setWorkers] =
    useState([]);

  const [options, setOptions] =
    useState({
      users: [],
      workers: [],
      branches: [],
      mining_sites: [],
      hire_locations: [],
    });

  const [selectedId, setSelectedId] =
    useState(null);

  const [detail, setDetail] =
    useState(null);

  const [activeTab, setActiveTab] =
    useState("overview");

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("");


  const [createOpen, setCreateOpen] =
    useState(false);

  const [createForm, setCreateForm] =
    useState(emptyCreateForm);

  const [profileForm, setProfileForm] =
    useState({});

  const [photoUrl, setPhotoUrl] =
    useState("");

  const [workerPhotoUrls, setWorkerPhotoUrls] =
    useState({});

  const [photoLoading, setPhotoLoading] =
    useState(false);

  const [familyForm, setFamilyForm] =
    useState({
      relationship_type: "spouse",
      full_name: "",
      phone: "",
      date_of_birth: "",
      occupation: "",
      residential_address: "",
      is_dependent: false,
      is_next_of_kin: false,
      notes: "",
    });

  const [emergencyForm, setEmergencyForm] =
    useState({
      full_name: "",
      relationship_type: "",
      primary_phone: "",
      secondary_phone: "",
      residential_address: "",
      priority_order: 1,
      is_primary: false,
      notes: "",
    });

  const [assignmentForm, setAssignmentForm] =
    useState({
      workspace_code: activeWorkspaceCode,
      role_code: "",
      context_id: "",
      assignment_start: today,
      notes: "",
    });

  const [documentForm, setDocumentForm] =
    useState({
      document_type: "ghana_card",
      title: "",
      document_number: "",
      issued_date: "",
      expiry_date: "",
      notes: "",
    });

  const [documentFile, setDocumentFile] =
    useState(null);

  const [licenseForm, setLicenseForm] =
    useState({
      license_type: "",
      license_number: "",
      issuing_authority: "",
      issued_date: "",
      expiry_date: "",
      notes: "",
    });

  const [propertyForm, setPropertyForm] =
    useState({
      property_type: "ppe",
      property_code: "",
      description: "",
      issued_at: today,
      expected_return_date: "",
      condition_issued: "good",
      notes: "",
    });

  const [statusForm, setStatusForm] =
    useState({
      status: "inactive",
      reason: "",
    });

  const [protectedToken, setProtectedToken] =
    useState(null);

  const [printChoiceOpen, setPrintChoiceOpen] =
    useState(false);

  const [printLoading, setPrintLoading] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const selectedProfile = detail?.profile;

  const assignmentContextOptions = useMemo(() => {
    if (
      assignmentForm.workspace_code ===
      "spare_parts"
    ) {
      return options.branches;
    }

    if (
      assignmentForm.workspace_code ===
      "mining"
    ) {
      return options.mining_sites;
    }

    if (
      assignmentForm.workspace_code ===
      "equipment_hire"
    ) {
      return options.hire_locations;
    }

    return [];
  }, [
    assignmentForm.workspace_code,
    options,
  ]);

  async function loadWorkerThumbnails(workerRows) {
    const photographedWorkers = (workerRows || []).filter(
      (worker) => Number(worker.has_photo || 0) === 1
    );

    const entries = await Promise.all(
      photographedWorkers.map(async (worker) => {
        try {
          const response = await axiosClient.get(
            `/release2-final/workers-expanded/${worker.id}/photo`,
            { responseType: "blob" }
          );

          return [String(worker.id), URL.createObjectURL(response.data)];
        } catch {
          return null;
        }
      })
    );

    const nextUrls = Object.fromEntries(entries.filter(Boolean));
    setWorkerPhotoUrls((current) => {
      Object.values(current).forEach((url) => URL.revokeObjectURL(url));
      return nextUrls;
    });
  }

  async function loadWorkers() {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get(
        "/release2-final/workers-expanded",
        {
          params: {
            search,
            status: statusFilter,
          },
        }
      );

      const nextWorkers = response.data.workers || [];
      setWorkers(nextWorkers);
      loadWorkerThumbnails(nextWorkers).catch(() => {});
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker profiles could not be loaded."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadOptions() {
    try {
      const response = await axiosClient.get(
        "/release2-final/workers-expanded/options"
      );

      setOptions(
        response.data.options || {
          users: [],
          workers: [],
          branches: [],
          mining_sites: [],
          hire_locations: [],
        }
      );
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker options could not be loaded."
        )
      );
    }
  }

  async function loadPhoto(workerId, hasPhoto) {
    if (photoUrl) {
      URL.revokeObjectURL(photoUrl);
      setPhotoUrl("");
    }

    if (!workerId || !hasPhoto) {
      return;
    }

    try {
      const response = await axiosClient.get(
        `/release2-final/workers-expanded/${workerId}/photo`,
        {
          responseType: "blob",
        }
      );

      setPhotoUrl(
        URL.createObjectURL(response.data)
      );
    } catch {
      setPhotoUrl("");
    }
  }

  async function loadDetail(workerId) {
    if (!workerId) {
      setSelectedId(null);
      setDetail(null);
      return;
    }

    setError("");

    try {
      const response = await axiosClient.get(
        `/release2-final/workers-expanded/${workerId}`
      );

      const worker = response.data.worker;

      setSelectedId(Number(workerId));
      setDetail(worker);
      setProfileForm({
        ...worker.profile,
        user_id:
          worker.profile.user_id || "",
        supervisor_worker_id:
          worker.profile.supervisor_worker_id || "",
        date_of_birth:
          worker.profile.date_of_birth
            ? String(worker.profile.date_of_birth).slice(
                0,
                10
              )
            : "",
        national_id_issue_date:
          worker.profile.national_id_issue_date
            ? String(
                worker.profile.national_id_issue_date
              ).slice(0, 10)
            : "",
        national_id_expiry_date:
          worker.profile.national_id_expiry_date
            ? String(
                worker.profile.national_id_expiry_date
              ).slice(0, 10)
            : "",
        id_card_issue_date:
          worker.profile.id_card_issue_date
            ? String(
                worker.profile.id_card_issue_date
              ).slice(0, 10)
            : "",
        id_card_expiry_date:
          worker.profile.id_card_expiry_date
            ? String(
                worker.profile.id_card_expiry_date
              ).slice(0, 10)
            : "",
        employment_start_date:
          worker.profile.employment_start_date
            ? String(
                worker.profile.employment_start_date
              ).slice(0, 10)
            : "",
        employment_end_date:
          worker.profile.employment_end_date
            ? String(
                worker.profile.employment_end_date
              ).slice(0, 10)
            : "",
        change_reason: "",
      });

      await loadPhoto(
        workerId,
        worker.profile.has_photo
      );
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker detail could not be loaded."
        )
      );
    }
  }

  useEffect(() => {
    loadWorkers();
    loadOptions();
    // Initial bootstrap only; refresh actions explicitly reload the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (photoUrl) {
      URL.revokeObjectURL(photoUrl);
    }
  }, [photoUrl]);

  useEffect(() => () => {
    Object.values(workerPhotoUrls).forEach((url) => {
      URL.revokeObjectURL(url);
    });
  }, [workerPhotoUrls]);

  async function refreshSelected() {
    await loadWorkers();

    if (selectedId) {
      await loadDetail(selectedId);
    }

    await loadOptions();
  }

  async function createWorker(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        "/release2-final/workers-expanded",
        {
          ...createForm,
          change_reason:
            "Initial worker profile created.",
        }
      );

      const workerId =
        response.data.worker.profile.id;

      const generatedEmployeeNumber =
        response.data.worker.profile.employee_number;

      setCreateForm(emptyCreateForm);
      setCreateOpen(false);
      setActiveTab("payroll");
      setMessage(
        `${response.data.message} Generated employee number: ${generatedEmployeeNumber}.`
      );

      await loadWorkers();
      await loadOptions();
      await loadDetail(workerId);
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker profile could not be created."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateProfile(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.put(
        `/release2-final/workers-expanded/${selectedId}`,
        profileForm
      );

      setDetail(response.data.worker);
      setMessage(response.data.message);
      await refreshSelected();
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker profile could not be updated."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setPhotoLoading(true);
    setError("");
    setMessage("");

    try {
      const optimized = await optimizeWorkerPhoto(file);

      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${selectedId}/photo`,
        {
          file_name: optimized.fileName,
          mime_type: optimized.mimeType,
          data_base64: optimized.dataUrl,
        }
      );

      setMessage(
        `${response.data.message} Optimized upload: ${formatBytes(optimized.size)}.`
      );
      await loadDetail(selectedId);
      await loadWorkers();
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker photograph could not be uploaded."
        )
      );
    } finally {
      setPhotoLoading(false);
    }
  }

  async function saveFamily(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${selectedId}/family`,
        familyForm
      );

      setDetail(response.data.worker);
      setMessage(response.data.message);

      setFamilyForm({
        relationship_type: "spouse",
        full_name: "",
        phone: "",
        date_of_birth: "",
        occupation: "",
        residential_address: "",
        is_dependent: false,
        is_next_of_kin: false,
        notes: "",
      });
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Family member could not be saved."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeFamily(familyId) {
    if (
      !window.confirm(
        "Remove this family-member record?"
      )
    ) {
      return;
    }

    try {
      const response = await axiosClient.delete(
        `/release2-final/workers-expanded/${selectedId}/family/${familyId}`
      );

      setDetail(response.data.worker);
      setMessage(response.data.message);
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Family member could not be removed."
        )
      );
    }
  }

  async function saveEmergency(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${selectedId}/emergency-contacts`,
        emergencyForm
      );

      setDetail(response.data.worker);
      setMessage(response.data.message);

      setEmergencyForm({
        full_name: "",
        relationship_type: "",
        primary_phone: "",
        secondary_phone: "",
        residential_address: "",
        priority_order: 1,
        is_primary: false,
        notes: "",
      });
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Emergency contact could not be saved."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeEmergency(contactId) {
    if (
      !window.confirm(
        "Remove this emergency-contact record?"
      )
    ) {
      return;
    }

    try {
      const response = await axiosClient.delete(
        `/release2-final/workers-expanded/${selectedId}/emergency-contacts/${contactId}`
      );

      setDetail(response.data.worker);
      setMessage(response.data.message);
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Emergency contact could not be removed."
        )
      );
    }
  }

  async function addAssignment(event) {
    event.preventDefault();

    const selectedContext =
      assignmentContextOptions.find(
        (item) =>
          Number(item.id) ===
          Number(assignmentForm.context_id)
      );

    let contextType = null;
    let branchId = null;

    if (
      assignmentForm.workspace_code ===
      "spare_parts"
    ) {
      contextType = "branch";
      branchId =
        Number(assignmentForm.context_id) || null;
    }

    if (
      assignmentForm.workspace_code ===
      "mining"
    ) {
      contextType = "mining_site";
    }

    if (
      assignmentForm.workspace_code ===
      "equipment_hire"
    ) {
      contextType = "hire_location";
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        `/release2-final/workers/${selectedId}/assignments`,
        {
          workspace_code:
            assignmentForm.workspace_code,
          branch_id: branchId,
          context_type: contextType,
          context_id:
            Number(assignmentForm.context_id) ||
            null,
          context_label:
            selectedContext?.name || null,
          role_code: assignmentForm.role_code,
          assignment_start:
            assignmentForm.assignment_start,
          notes: assignmentForm.notes,
        }
      );

      setMessage(response.data.message);

      setAssignmentForm({
        workspace_code: activeWorkspaceCode,
        role_code: "",
        context_id: "",
        assignment_start: today,
        notes: "",
      });

      await refreshSelected();
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker assignment could not be saved."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadDocument(event) {
    event.preventDefault();

    if (!documentFile) {
      setError("Choose a private document file.");
      return;
    }

    if (documentFile.size > 5 * 1024 * 1024) {
      setError(
        "Private worker documents must not exceed 5 MB."
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const dataUrl = await fileToDataUrl(
        documentFile
      );

      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${selectedId}/files`,
        {
          ...documentForm,
          file_name: documentFile.name,
          mime_type: documentFile.type,
          data_base64: dataUrl,
        }
      );

      setDetail(response.data.worker);
      setMessage(response.data.message);

      setDocumentForm({
        document_type: "ghana_card",
        title: "",
        document_number: "",
        issued_date: "",
        expiry_date: "",
        notes: "",
      });

      setDocumentFile(null);

      const fileInput =
        document.getElementById(
          "worker-private-document-input"
        );

      if (fileInput) {
        fileInput.value = "";
      }
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Private document could not be uploaded."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function downloadPrivateFile(file) {
    try {
      const response = await axiosClient.get(
        `/release2-final/workers-expanded/${selectedId}/files/${file.id}/download`,
        {
          responseType: "blob",
        }
      );

      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");

      link.href = url;
      link.download =
        file.original_filename ||
        "worker-document";

      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Private document could not be downloaded."
        )
      );
    }
  }

  async function addLicense(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        `/release2-final/workers/${selectedId}/licenses`,
        licenseForm
      );

      setMessage(response.data.message);

      setLicenseForm({
        license_type: "",
        license_number: "",
        issuing_authority: "",
        issued_date: "",
        expiry_date: "",
        notes: "",
      });

      await loadDetail(selectedId);
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Licence could not be saved."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function addProperty(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        `/release2-final/workers/${selectedId}/property`,
        propertyForm
      );

      setMessage(response.data.message);

      setPropertyForm({
        property_type: "ppe",
        property_code: "",
        description: "",
        issued_at: today,
        expected_return_date: "",
        condition_issued: "good",
        notes: "",
      });

      await loadDetail(selectedId);
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Company property could not be assigned."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(event) {
    event.preventDefault();

    if (
      !protectedToken?.value ||
      protectedToken.expiresAt <= Date.now()
    ) {
      setError(
        "Unlock protected actions before changing worker status."
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        `/release2-final/workers/${selectedId}/status`,
        statusForm,
        {
          headers: {
            "X-Protected-Action-Token":
              protectedToken.value,
          },
        }
      );

      setMessage(response.data.message);

      setStatusForm({
        status: "inactive",
        reason: "",
      });

      await refreshSelected();
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker status could not be changed."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function reissueIdCard() {
    const reason = window.prompt(
      "Enter the reason for reissuing this worker ID card."
    );
    if (!reason?.trim()) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${selectedId}/reissue-id-card`,
        { reason: reason.trim() }
      );
      setDetail(response.data.worker);
      setMessage(response.data.message);
      await refreshSelected();
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Worker ID card could not be reissued."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function openPrintPdf(endpoint, loadingKey) {
    const previewWindow = window.open("", "_blank");

    if (!previewWindow) {
      setError(
        "The browser blocked the print-preview window. Allow pop-ups for localhost and try again."
      );
      return;
    }

    previewWindow.opener = null;

    previewWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Preparing Chalin 03 Print Document</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              font-family: Arial, sans-serif;
              background: #07182c;
              color: #ffffff;
            }

            div {
              text-align: center;
            }

            strong {
              display: block;
              margin-bottom: 8px;
              color: #e7bf2e;
              font-size: 20px;
            }
          </style>
        </head>

        <body>
          <div>
            <strong>Chalin 03</strong>
            Preparing professional print preview...
          </div>
        </body>
      </html>
    `);

    previewWindow.document.close();

    setPrintLoading(loadingKey);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.get(
        endpoint,
        {
          responseType: "blob",
        }
      );

      const pdfBlob = new Blob(
        [response.data],
        {
          type: "application/pdf",
        }
      );

      const url = URL.createObjectURL(pdfBlob);

      previewWindow.location.href = url;
      setPrintChoiceOpen(false);

      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 5 * 60 * 1000);
    } catch (requestError) {
      previewWindow.close();

      setError(
        errorMessage(
          requestError,
          "The professional print document could not be generated."
        )
      );
    } finally {
      setPrintLoading("");
    }
  }

  function setProfileValue(key, value) {
    setProfileForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  if (loading && workers.length === 0) {
    return (
      <div className="expanded-worker-loading">
        Loading expanded worker profiles...
      </div>
    );
  }

  return (
    <main className="expanded-worker-page">
      <header className="expanded-worker-hero">
        <div>
          <p>People &amp; Payroll</p>
          <h1>Worker Profiles</h1>
          <span>
            Create each worker once, record the starting salary at onboarding,
            and let Payroll use that salary automatically every month.
            Personal, employment, document and company-property history stays
            together in the same worker record.
          </span>
        </div>

        {canManage && canPayrollManage ? (
          <button
            type="button"
            onClick={() =>
              setCreateOpen((current) => !current)
            }
          >
            {createOpen
              ? "Close New Worker Form"
              : "Add New Worker"}
          </button>
        ) : null}
      </header>

      <Notice type="info">
        Showing {activeWorkspaceLabel} worker profiles only. Users, assignments, photographs and private documents from other business categories are not available here.
      </Notice>

      {message ? (
        <Notice type="success">{message}</Notice>
      ) : null}

      {error ? (
        <Notice type="error">{error}</Notice>
      ) : null}

      {!canSensitive ? (
        <Notice type="warning">
          Sensitive national-ID, family, medical and
          private history information is hidden from
          this account.
        </Notice>
      ) : null}

      {canManage && !canPayrollManage ? (
        <Notice type="warning">
          Worker onboarding now includes the worker's starting salary. Ask a System Administrator to grant Payroll Manage permission before creating a new worker.
        </Notice>
      ) : null}

      {createOpen ? (
        <section className="expanded-worker-card">
          <h2>Create Worker Profile</h2>

          <form
            className="expanded-worker-form-grid"
            onSubmit={createWorker}
          >
            <Notice type="info">
              Create the worker and starting salary together. Employee number and ID-card dates are generated automatically; the salary becomes active in Payroll from the employment start date.
            </Notice>

            <Field label="Employee number">
              <input
                type="text"
                value="Generated automatically after saving"
                readOnly
                disabled
              />
            </Field>

            {[
              ["full_name", "Full legal name"],
              ["preferred_name", "Preferred name"],
              ["phone", "Phone"],
              ["email", "Email", "email"],
              ["job_title", "Job title"],
              ["department", "Department"],
              [
                "employment_start_date",
                "Employment start date",
                "date",
              ],
            ].map(([key, label, type = "text"]) => (
              <Field key={key} label={label}>
                <input
                  type={type}
                  value={createForm[key]}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  required={["full_name", "employment_start_date"].includes(key)}
                />
              </Field>
            ))}

            <Field label="Basic salary (GHS)">
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={createForm.basic_salary}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    basic_salary: event.target.value,
                  }))
                }
                placeholder="e.g. 3500.00"
              />
              <small>Payroll will use this salary automatically from the employment start date.</small>
            </Field>

            <Field label="Pay frequency">
              <select
                value={createForm.pay_frequency}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    pay_frequency: event.target.value,
                  }))
                }
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
              </select>
            </Field>

            <Field label="Employment type">
              <select
                value={createForm.employment_type}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    employment_type:
                      event.target.value,
                  }))
                }
              >
                <option value="permanent">
                  Permanent
                </option>
                <option value="contract">
                  Contract
                </option>
                <option value="temporary">
                  Temporary
                </option>
                <option value="casual">
                  Casual
                </option>
                <option value="intern">
                  Intern
                </option>
              </select>
            </Field>

            <button
              type="submit"
              disabled={saving}
            >
              {saving
                ? "Creating Worker..."
                : "Create Worker & Activate Salary"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="expanded-worker-toolbar">
        <input
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Search employee number, name, phone, title or department"
        />

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value)
          }
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">
            Suspended
          </option>
          <option value="inactive">Inactive</option>
          <option value="terminated">
            Terminated
          </option>
        </select>

        <div className="worker-category-filter" aria-label="Active worker category">
          {activeWorkspaceLabel}
        </div>

        <button
          type="button"
          onClick={loadWorkers}
        >
          Apply Filters
        </button>
      </section>

      <div className="expanded-worker-layout">
        <aside className="expanded-worker-list">
          <strong className="expanded-worker-list-title">
            {workers.length} worker
            {workers.length === 1 ? "" : "s"}
          </strong>

          {workers.length === 0 ? (
            <EmptyState>
              No worker profiles match the filters.
            </EmptyState>
          ) : (
            workers.map((worker) => (
              <button
                type="button"
                key={worker.id}
                className={
                  Number(selectedId) ===
                  Number(worker.id)
                    ? "expanded-worker-list-item active"
                    : "expanded-worker-list-item"
                }
                onClick={() => {
                  setActiveTab("overview");
                  loadDetail(worker.id);
                }}
              >
                <span className="worker-list-avatar">
                  {workerPhotoUrls[String(worker.id)] ? (
                    <img
                      src={workerPhotoUrls[String(worker.id)]}
                      alt={`${worker.full_name} profile`}
                    />
                  ) : (
                    initials(worker.full_name)
                  )}
                </span>

                <span>
                  <strong>
                    {worker.full_name}
                  </strong>

                  <small>
                    {worker.employee_number}
                  </small>

                  <small>
                    {worker.job_title || "No job title"}
                    {" · "}
                    {worker.employment_status}
                  </small>
                </span>
              </button>
            ))
          )}
        </aside>

        <section className="expanded-worker-content">
          {!selectedProfile ? (
            <EmptyState>
              Select a worker to open the complete
              personnel profile.
            </EmptyState>
          ) : (
            <>
              <article className="worker-profile-banner">
                <div className="worker-profile-photo">
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={`${selectedProfile.full_name} profile`}
                    />
                  ) : (
                    <span>
                      {initials(
                        selectedProfile.full_name
                      )}
                    </span>
                  )}

                  {canManage ? (
                    <label>
                      {photoLoading
                        ? "Uploading..."
                        : "Upload Photo"}

                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={uploadPhoto}
                        disabled={photoLoading}
                      />
                    </label>
                  ) : null}
                </div>

                <div className="worker-profile-heading">
                  <p>
                    {selectedProfile.employee_number}
                  </p>

                  <h2>
                    {selectedProfile.full_name}
                  </h2>

                  <span>
                    {selectedProfile.preferred_name
                      ? `Known as ${selectedProfile.preferred_name} · `
                      : ""}
                    {selectedProfile.job_title ||
                      "No job title"}
                    {" · "}
                    {selectedProfile.department ||
                      "No department"}
                  </span>

                  <div className="worker-profile-badges">
                    <b>
                      {
                        selectedProfile.employment_status
                      }
                    </b>

                    <b>
                      {selectedProfile.username
                        ? `Account: ${selectedProfile.username}`
                        : "No linked system account"}
                    </b>

                    <b>
                      {selectedProfile.account_is_active
                        ? "Account active"
                        : "Account inactive / none"}
                    </b>
                  </div>

                  {canSensitive ? (
                    <div className="worker-print-pack-actions">
                      {canDocuments ? (
                        <button
                          type="button"
                          onClick={() =>
                            openPrintPdf(
                              `/release2-final/workers-expanded/${selectedId}/profile-pdf`,
                              "profile"
                            )
                          }
                          disabled={Boolean(printLoading)}
                        >
                          {printLoading === "profile"
                            ? "Preparing Profile..."
                            : "Print Full Profile"}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setPrintChoiceOpen(true)
                        }
                        disabled={Boolean(printLoading)}
                        >
                          Print ID Card
                        </button>

                        {canManage ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={reissueIdCard}
                            disabled={saving || Boolean(printLoading)}
                          >
                            Reissue ID Card
                          </button>
                        ) : null}
                    </div>
                  ) : null}
                </div>
              </article>

              <nav className="worker-profile-tabs">
                {[
                  ...tabItems,
                  ...(canPayrollView ? [["payroll", "Salary & Payroll"]] : []),
                ].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    className={
                      activeTab === key ? "active" : ""
                    }
                    onClick={() => setActiveTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              {activeTab === "overview" ? (
                <div className="worker-tab-stack">
                  <section className="expanded-worker-card">
                    <h3>Personnel Summary</h3>

                    <div className="worker-summary-grid">
                      {[
                        [
                          "Employment status",
                          selectedProfile.employment_status,
                        ],
                        [
                          "Employment type",
                          selectedProfile.employment_type,
                        ],
                        [
                          "Start date",
                          formatDate(
                            selectedProfile.employment_start_date
                          ),
                        ],
                        [
                          "Supervisor",
                          selectedProfile.supervisor_name ||
                            "-",
                        ],
                        [
                          "Phone",
                          selectedProfile.phone || "-",
                        ],
                        [
                          "Email",
                          selectedProfile.email || "-",
                        ],
                        [
                          "ID card issued",
                          formatDate(selectedProfile.id_card_issue_date),
                        ],
                        [
                          "ID card expires",
                          formatDate(selectedProfile.id_card_expiry_date),
                        ],
                        [
                          "Active assignments",
                          detail.assignments.filter(
                            (item) => item.is_active
                          ).length,
                        ],
                        [
                          "Family records",
                          detail.family_members.length,
                        ],
                        [
                          "Emergency contacts",
                          detail.emergency_contacts.length,
                        ],
                        [
                          "Private files",
                          detail.private_files.length,
                        ],
                        [
                          "Licences",
                          detail.licenses.length,
                        ],
                        [
                          "Property issued",
                          detail.property.filter(
                            (item) =>
                              item.status === "issued"
                          ).length,
                        ],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <span>{label}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="expanded-worker-card">
                    <h3>Current Assignments</h3>

                    {detail.assignments.filter(
                      (item) => item.is_active
                    ).length === 0 ? (
                      <EmptyState>
                        No active workspace assignment.
                      </EmptyState>
                    ) : (
                      <div className="worker-record-grid">
                        {detail.assignments
                          .filter(
                            (item) => item.is_active
                          )
                          .map((item) => (
                            <article key={item.id}>
                              <strong>
                                {item.workspace_code}
                              </strong>
                              <span>
                                {item.context_label ||
                                  "Group-wide"}
                              </span>
                              <small>
                                {item.role_code ||
                                  "No role recorded"}
                              </small>
                            </article>
                          ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {activeTab === "payroll" && canPayrollView ? (
                <WorkerPayrollPanel
                  workerId={selectedId}
                  worker={selectedProfile}
                  workspaceLabel={activeWorkspaceLabel}
                />
              ) : null}

              {activeTab === "personal" ? (
                <section className="expanded-worker-card">
                  <h3>
                    Personal, Contact and National ID
                  </h3>

                  {!canSensitive ? (
                    <Notice type="warning">
                      Your account cannot view or edit
                      sensitive identification and medical
                      information.
                    </Notice>
                  ) : null}

                  <form
                    className="expanded-worker-form-grid"
                    onSubmit={updateProfile}
                  >
                    <Field label="Employee number (system generated)">
                      <input
                        type="text"
                        value={
                          selectedProfile.employee_number || ""
                        }
                        readOnly
                        disabled
                      />
                    </Field>

                    {profileFields.map(
                      ([key, label, type = "text"]) => (
                        <Field key={key} label={label}>
                          <input
                            type={type}
                            value={profileForm[key] || ""}
                            onChange={(event) =>
                              setProfileValue(
                                key,
                                event.target.value
                              )
                            }
                            disabled={
                              !canManage ||
                              (SENSITIVE_FIELD_KEYS.has(
                                key
                              ) &&
                                !canSensitive)
                            }
                            required={key === "full_name"}
                          />
                        </Field>
                      )
                    )}

                    <Field label="Residential address">
                      <textarea
                        value={
                          profileForm.residential_address ||
                          ""
                        }
                        onChange={(event) =>
                          setProfileValue(
                            "residential_address",
                            event.target.value
                          )
                        }
                        disabled={!canManage}
                      />
                    </Field>

                    <Field label="Private medical or safety notes">
                      <textarea
                        value={
                          profileForm.medical_notes || ""
                        }
                        onChange={(event) =>
                          setProfileValue(
                            "medical_notes",
                            event.target.value
                          )
                        }
                        disabled={
                          !canManage || !canSensitive
                        }
                      />
                    </Field>

                    <Field label="General worker notes">
                      <textarea
                        value={profileForm.notes || ""}
                        onChange={(event) =>
                          setProfileValue(
                            "notes",
                            event.target.value
                          )
                        }
                        disabled={!canManage}
                      />
                    </Field>

                    <Field label="Linked system account">
                      <select
                        value={profileForm.user_id || ""}
                        onChange={(event) =>
                          setProfileValue(
                            "user_id",
                            event.target.value
                          )
                        }
                        disabled={!canManage}
                      >
                        <option value="">
                          No linked account
                        </option>

                        {options.users.map((user) => (
                          <option
                            key={user.id}
                            value={user.id}
                          >
                            {user.full_name} —{" "}
                            {user.username} ({user.role})
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Supervisor">
                      <select
                        value={
                          profileForm.supervisor_worker_id ||
                          ""
                        }
                        onChange={(event) =>
                          setProfileValue(
                            "supervisor_worker_id",
                            event.target.value
                          )
                        }
                        disabled={!canManage}
                      >
                        <option value="">
                          No supervisor recorded
                        </option>

                        {options.workers
                          .filter(
                            (worker) =>
                              Number(worker.id) !==
                              Number(selectedId)
                          )
                          .map((worker) => (
                            <option
                              key={worker.id}
                              value={worker.id}
                            >
                              {worker.employee_number} —{" "}
                              {worker.full_name}
                            </option>
                          ))}
                      </select>
                    </Field>

                    {canManage ? (
                      <>
                        <Field label="Reason for profile changes">
                          <textarea
                            value={
                              profileForm.change_reason ||
                              ""
                            }
                            onChange={(event) =>
                              setProfileValue(
                                "change_reason",
                                event.target.value
                              )
                            }
                            required
                          />
                        </Field>

                        <button
                          type="submit"
                          disabled={saving}
                        >
                          {saving
                            ? "Saving Profile..."
                            : "Save Complete Profile"}
                        </button>
                      </>
                    ) : null}
                  </form>
                </section>
              ) : null}

              {activeTab === "family" ? (
                <div className="worker-tab-stack">
                  {!canSensitive ? (
                    <Notice type="warning">
                      Family and emergency-contact
                      information is restricted.
                    </Notice>
                  ) : (
                    <>
                      {canManage ? (
                        <section className="expanded-worker-card">
                          <h3>Add Family Member or Dependant</h3>

                          <form
                            className="expanded-worker-form-grid"
                            onSubmit={saveFamily}
                          >
                            <Field label="Relationship">
                              <select
                                value={
                                  familyForm.relationship_type
                                }
                                onChange={(event) =>
                                  setFamilyForm(
                                    (current) => ({
                                      ...current,
                                      relationship_type:
                                        event.target.value,
                                    })
                                  )
                                }
                              >
                                <option value="spouse">
                                  Spouse
                                </option>
                                <option value="father">
                                  Father
                                </option>
                                <option value="mother">
                                  Mother
                                </option>
                                <option value="child">
                                  Child
                                </option>
                                <option value="guardian">
                                  Guardian
                                </option>
                                <option value="sibling">
                                  Sibling
                                </option>
                                <option value="other">
                                  Other
                                </option>
                              </select>
                            </Field>

                            {[
                              ["full_name", "Full name"],
                              ["phone", "Phone"],
                              [
                                "date_of_birth",
                                "Date of birth",
                                "date",
                              ],
                              ["occupation", "Occupation"],
                            ].map(
                              ([
                                key,
                                label,
                                type = "text",
                              ]) => (
                                <Field
                                  key={key}
                                  label={label}
                                >
                                  <input
                                    type={type}
                                    value={familyForm[key]}
                                    onChange={(event) =>
                                      setFamilyForm(
                                        (current) => ({
                                          ...current,
                                          [key]:
                                            event.target
                                              .value,
                                        })
                                      )
                                    }
                                    required={
                                      key === "full_name"
                                    }
                                  />
                                </Field>
                              )
                            )}

                            <Field label="Residential address">
                              <textarea
                                value={
                                  familyForm.residential_address
                                }
                                onChange={(event) =>
                                  setFamilyForm(
                                    (current) => ({
                                      ...current,
                                      residential_address:
                                        event.target.value,
                                    })
                                  )
                                }
                              />
                            </Field>

                            <label className="worker-checkbox">
                              <input
                                type="checkbox"
                                checked={
                                  familyForm.is_dependent
                                }
                                onChange={(event) =>
                                  setFamilyForm(
                                    (current) => ({
                                      ...current,
                                      is_dependent:
                                        event.target.checked,
                                    })
                                  )
                                }
                              />
                              Financial dependant
                            </label>

                            <label className="worker-checkbox">
                              <input
                                type="checkbox"
                                checked={
                                  familyForm.is_next_of_kin
                                }
                                onChange={(event) =>
                                  setFamilyForm(
                                    (current) => ({
                                      ...current,
                                      is_next_of_kin:
                                        event.target.checked,
                                    })
                                  )
                                }
                              />
                              Next of kin
                            </label>

                            <button type="submit">
                              Add Family Member
                            </button>
                          </form>
                        </section>
                      ) : null}

                      <section className="expanded-worker-card">
                        <h3>
                          Family, Dependants and Next of Kin
                        </h3>

                        {detail.family_members.length === 0 ? (
                          <EmptyState>
                            No family records have been
                            entered.
                          </EmptyState>
                        ) : (
                          <div className="worker-table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Relationship</th>
                                  <th>Phone</th>
                                  <th>Dependant</th>
                                  <th>Next of kin</th>
                                  <th />
                                </tr>
                              </thead>

                              <tbody>
                                {detail.family_members.map(
                                  (item) => (
                                    <tr key={item.id}>
                                      <td>
                                        <strong>
                                          {item.full_name}
                                        </strong>
                                        <small>
                                          {item.occupation ||
                                            ""}
                                        </small>
                                      </td>
                                      <td>
                                        {
                                          item.relationship_type
                                        }
                                      </td>
                                      <td>
                                        {item.phone || "-"}
                                      </td>
                                      <td>
                                        {item.is_dependent
                                          ? "Yes"
                                          : "No"}
                                      </td>
                                      <td>
                                        {item.is_next_of_kin
                                          ? "Yes"
                                          : "No"}
                                      </td>
                                      <td>
                                        {canManage ? (
                                          <button
                                            type="button"
                                            className="danger"
                                            onClick={() =>
                                              removeFamily(
                                                item.id
                                              )
                                            }
                                          >
                                            Remove
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>

                      {canManage ? (
                        <section className="expanded-worker-card">
                          <h3>Add Emergency Contact</h3>

                          <form
                            className="expanded-worker-form-grid"
                            onSubmit={saveEmergency}
                          >
                            {[
                              ["full_name", "Full name"],
                              [
                                "relationship_type",
                                "Relationship",
                              ],
                              [
                                "primary_phone",
                                "Primary phone",
                              ],
                              [
                                "secondary_phone",
                                "Secondary phone",
                              ],
                            ].map(([key, label]) => (
                              <Field
                                key={key}
                                label={label}
                              >
                                <input
                                  value={
                                    emergencyForm[key]
                                  }
                                  onChange={(event) =>
                                    setEmergencyForm(
                                      (current) => ({
                                        ...current,
                                        [key]:
                                          event.target.value,
                                      })
                                    )
                                  }
                                  required={[
                                    "full_name",
                                    "relationship_type",
                                    "primary_phone",
                                  ].includes(key)}
                                />
                              </Field>
                            ))}

                            <Field label="Priority order">
                              <input
                                type="number"
                                min="1"
                                value={
                                  emergencyForm.priority_order
                                }
                                onChange={(event) =>
                                  setEmergencyForm(
                                    (current) => ({
                                      ...current,
                                      priority_order:
                                        event.target.value,
                                    })
                                  )
                                }
                              />
                            </Field>

                            <Field label="Residential address">
                              <textarea
                                value={
                                  emergencyForm.residential_address
                                }
                                onChange={(event) =>
                                  setEmergencyForm(
                                    (current) => ({
                                      ...current,
                                      residential_address:
                                        event.target.value,
                                    })
                                  )
                                }
                              />
                            </Field>

                            <label className="worker-checkbox">
                              <input
                                type="checkbox"
                                checked={
                                  emergencyForm.is_primary
                                }
                                onChange={(event) =>
                                  setEmergencyForm(
                                    (current) => ({
                                      ...current,
                                      is_primary:
                                        event.target.checked,
                                    })
                                  )
                                }
                              />
                              Primary emergency contact
                            </label>

                            <button type="submit">
                              Add Emergency Contact
                            </button>
                          </form>
                        </section>
                      ) : null}

                      <section className="expanded-worker-card">
                        <h3>Emergency Contacts</h3>

                        {detail.emergency_contacts.length ===
                        0 ? (
                          <EmptyState>
                            No emergency contacts have been
                            entered.
                          </EmptyState>
                        ) : (
                          <div className="worker-record-grid">
                            {detail.emergency_contacts.map(
                              (item) => (
                                <article key={item.id}>
                                  <strong>
                                    {item.full_name}
                                  </strong>
                                  <span>
                                    {
                                      item.relationship_type
                                    }
                                    {item.is_primary
                                      ? " · Primary"
                                      : ""}
                                  </span>
                                  <small>
                                    {item.primary_phone}
                                    {item.secondary_phone
                                      ? ` / ${item.secondary_phone}`
                                      : ""}
                                  </small>

                                  {canManage ? (
                                    <button
                                      type="button"
                                      className="danger"
                                      onClick={() =>
                                        removeEmergency(
                                          item.id
                                        )
                                      }
                                    >
                                      Remove
                                    </button>
                                  ) : null}
                                </article>
                              )
                            )}
                          </div>
                        )}
                      </section>
                    </>
                  )}
                </div>
              ) : null}

              {activeTab === "employment" ? (
                <div className="worker-tab-stack">
                  {canManage ? (
                    <section className="expanded-worker-card">
                      <h3>Add Category Assignment</h3>

                      <form
                        className="expanded-worker-form-grid"
                        onSubmit={addAssignment}
                      >
                        <Field label="Business category">
                          <input
                            value={activeWorkspaceLabel}
                            readOnly
                            aria-readonly="true"
                          />
                        </Field>

                        <Field label="Branch / Site / Location">
                          <select
                            value={
                              assignmentForm.context_id
                            }
                            onChange={(event) =>
                              setAssignmentForm(
                                (current) => ({
                                  ...current,
                                  context_id:
                                    event.target.value,
                                })
                              )
                            }
                            disabled={
                              assignmentContextOptions.length ===
                              0
                            }
                          >
                            <option value="">
                              Category-wide / not selected
                            </option>

                            {assignmentContextOptions.map(
                              (item) => (
                                <option
                                  key={item.id}
                                  value={item.id}
                                >
                                  {item.code} — {item.name}
                                </option>
                              )
                            )}
                          </select>
                        </Field>

                        <Field label="Role or duty">
                          <input
                            value={
                              assignmentForm.role_code
                            }
                            onChange={(event) =>
                              setAssignmentForm(
                                (current) => ({
                                  ...current,
                                  role_code:
                                    event.target.value,
                                })
                              )
                            }
                          />
                        </Field>

                        <Field label="Assignment start">
                          <input
                            type="date"
                            value={
                              assignmentForm.assignment_start
                            }
                            onChange={(event) =>
                              setAssignmentForm(
                                (current) => ({
                                  ...current,
                                  assignment_start:
                                    event.target.value,
                                })
                              )
                            }
                          />
                        </Field>

                        <Field label="Assignment notes">
                          <textarea
                            value={
                              assignmentForm.notes
                            }
                            onChange={(event) =>
                              setAssignmentForm(
                                (current) => ({
                                  ...current,
                                  notes:
                                    event.target.value,
                                })
                              )
                            }
                          />
                        </Field>

                        <button type="submit">
                          Add Assignment
                        </button>
                      </form>
                    </section>
                  ) : null}

                  <section className="expanded-worker-card">
                    <h3>Assignment History</h3>

                    {detail.assignments.length === 0 ? (
                      <EmptyState>
                        No assignments have been recorded.
                      </EmptyState>
                    ) : (
                      <div className="worker-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Workspace</th>
                              <th>Context</th>
                              <th>Role</th>
                              <th>Period</th>
                              <th>Status</th>
                            </tr>
                          </thead>

                          <tbody>
                            {detail.assignments.map(
                              (item) => (
                                <tr key={item.id}>
                                  <td>
                                    {item.workspace_code}
                                  </td>
                                  <td>
                                    {item.context_label ||
                                      "Category-wide"}
                                  </td>
                                  <td>
                                    {item.role_code || "-"}
                                  </td>
                                  <td>
                                    {formatDate(
                                      item.assignment_start
                                    )}
                                    {" — "}
                                    {formatDate(
                                      item.assignment_end
                                    )}
                                  </td>
                                  <td>
                                    {item.is_active
                                      ? "Active"
                                      : "Ended"}
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {canDeactivate ? (
                    <section className="expanded-worker-card">
                      <ProtectedUnlock
                        token={protectedToken}
                        onToken={setProtectedToken}
                      />

                      <h3>Employment Status and Access</h3>

                      <form
                        className="expanded-worker-form-grid"
                        onSubmit={changeStatus}
                      >
                        <Field label="New status">
                          <select
                            value={statusForm.status}
                            onChange={(event) =>
                              setStatusForm(
                                (current) => ({
                                  ...current,
                                  status:
                                    event.target.value,
                                })
                              )
                            }
                          >
                            <option value="active">
                              Active
                            </option>
                            <option value="inactive">
                              Inactive
                            </option>
                            <option value="suspended">
                              Suspended
                            </option>
                            <option value="terminated">
                              Terminated
                            </option>
                          </select>
                        </Field>

                        <Field label="Reason">
                          <textarea
                            value={statusForm.reason}
                            onChange={(event) =>
                              setStatusForm(
                                (current) => ({
                                  ...current,
                                  reason:
                                    event.target.value,
                                })
                              )
                            }
                            required
                          />
                        </Field>

                        <button type="submit">
                          Change Worker Status
                        </button>
                      </form>

                      <Notice type="warning">
                        Deactivation ends active assignments,
                        disables the linked account and revokes
                        all linked sessions. Reactivation never
                        restores access automatically.
                      </Notice>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "documents" ? (
                <div className="worker-tab-stack">
                  {!canDocuments ? (
                    <Notice type="warning">
                      Private worker documents are hidden
                      from this account.
                    </Notice>
                  ) : (
                    <>
                      {canManageDocuments ? (
                        <section className="expanded-worker-card">
                          <h3>
                            Upload Private Worker Document
                          </h3>

                          <form
                            className="expanded-worker-form-grid"
                            onSubmit={uploadDocument}
                          >
                            <Field label="Document type">
                              <select
                                value={
                                  documentForm.document_type
                                }
                                onChange={(event) =>
                                  setDocumentForm(
                                    (current) => ({
                                      ...current,
                                      document_type:
                                        event.target.value,
                                    })
                                  )
                                }
                              >
                                <option value="ghana_card">
                                  Ghana Card
                                </option>
                                <option value="passport">
                                  Passport
                                </option>
                                <option value="birth_certificate">
                                  Birth Certificate
                                </option>
                                <option value="employment_contract">
                                  Employment Contract
                                </option>
                                <option value="certificate">
                                  Certificate
                                </option>
                                <option value="medical">
                                  Medical / Safety
                                </option>
                                <option value="other">
                                  Other
                                </option>
                              </select>
                            </Field>

                            {[
                              ["title", "Document title"],
                              [
                                "document_number",
                                "Document number",
                              ],
                              [
                                "issued_date",
                                "Issue date",
                                "date",
                              ],
                              [
                                "expiry_date",
                                "Expiry date",
                                "date",
                              ],
                            ].map(
                              ([
                                key,
                                label,
                                type = "text",
                              ]) => (
                                <Field
                                  key={key}
                                  label={label}
                                >
                                  <input
                                    type={type}
                                    value={
                                      documentForm[key]
                                    }
                                    onChange={(event) =>
                                      setDocumentForm(
                                        (current) => ({
                                          ...current,
                                          [key]:
                                            event.target
                                              .value,
                                        })
                                      )
                                    }
                                    required={
                                      key === "title"
                                    }
                                  />
                                </Field>
                              )
                            )}

                            <Field label="Private file">
                              <input
                                id="worker-private-document-input"
                                type="file"
                                accept="application/pdf,image/jpeg,image/png,image/webp"
                                onChange={(event) =>
                                  setDocumentFile(
                                    event.target.files?.[0] ||
                                      null
                                  )
                                }
                                required
                              />
                            </Field>

                            <Field label="Notes">
                              <textarea
                                value={documentForm.notes}
                                onChange={(event) =>
                                  setDocumentForm(
                                    (current) => ({
                                      ...current,
                                      notes:
                                        event.target.value,
                                    })
                                  )
                                }
                              />
                            </Field>

                            <button type="submit">
                              Upload Private Document
                            </button>
                          </form>

                          <small>
                            Allowed: PDF, JPEG, PNG and WebP.
                            Maximum size: 5 MB. The file is
                            stored privately with a SHA-256
                            checksum.
                          </small>
                        </section>
                      ) : null}

                      <section className="expanded-worker-card">
                        <h3>Private Files</h3>

                        {detail.private_files.length === 0 ? (
                          <EmptyState>
                            No private files have been
                            uploaded.
                          </EmptyState>
                        ) : (
                          <div className="worker-table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Document</th>
                                  <th>Type</th>
                                  <th>Size</th>
                                  <th>Expiry</th>
                                  <th>Checksum</th>
                                  <th />
                                </tr>
                              </thead>

                              <tbody>
                                {detail.private_files.map(
                                  (file) => (
                                    <tr key={file.id}>
                                      <td>
                                        <strong>
                                          {file.title}
                                        </strong>
                                        <small>
                                          {
                                            file.original_filename
                                          }
                                        </small>
                                      </td>
                                      <td>
                                        {
                                          file.document_type
                                        }
                                      </td>
                                      <td>
                                        {formatBytes(
                                          file.file_size_bytes
                                        )}
                                      </td>
                                      <td>
                                        {formatDate(
                                          file.expiry_date
                                        )}
                                      </td>
                                      <td className="worker-checksum">
                                        {
                                          file.checksum_sha256
                                        }
                                      </td>
                                      <td>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            downloadPrivateFile(
                                              file
                                            )
                                          }
                                        >
                                          Download
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>

                      {canManageDocuments ? (
                        <section className="expanded-worker-card">
                          <h3>Add Licence or Permit</h3>

                          <form
                            className="expanded-worker-form-grid"
                            onSubmit={addLicense}
                          >
                            {[
                              [
                                "license_type",
                                "Licence or permit type",
                              ],
                              [
                                "license_number",
                                "Licence number",
                              ],
                              [
                                "issuing_authority",
                                "Issuing authority",
                              ],
                              [
                                "issued_date",
                                "Issue date",
                                "date",
                              ],
                              [
                                "expiry_date",
                                "Expiry date",
                                "date",
                              ],
                            ].map(
                              ([
                                key,
                                label,
                                type = "text",
                              ]) => (
                                <Field
                                  key={key}
                                  label={label}
                                >
                                  <input
                                    type={type}
                                    value={licenseForm[key]}
                                    onChange={(event) =>
                                      setLicenseForm(
                                        (current) => ({
                                          ...current,
                                          [key]:
                                            event.target
                                              .value,
                                        })
                                      )
                                    }
                                    required={
                                      key ===
                                      "license_type"
                                    }
                                  />
                                </Field>
                              )
                            )}

                            <Field label="Notes">
                              <textarea
                                value={licenseForm.notes}
                                onChange={(event) =>
                                  setLicenseForm(
                                    (current) => ({
                                      ...current,
                                      notes:
                                        event.target.value,
                                    })
                                  )
                                }
                              />
                            </Field>

                            <button type="submit">
                              Save Licence
                            </button>
                          </form>
                        </section>
                      ) : null}

                      <section className="expanded-worker-card">
                        <h3>Licences and Permits</h3>

                        {detail.licenses.length === 0 ? (
                          <EmptyState>
                            No licences or permits recorded.
                          </EmptyState>
                        ) : (
                          <div className="worker-record-grid">
                            {detail.licenses.map((item) => (
                              <article key={item.id}>
                                <strong>
                                  {item.license_type}
                                </strong>
                                <span>
                                  {item.license_number || "-"}
                                </span>
                                <small>
                                  Expires:{" "}
                                  {formatDate(
                                    item.expiry_date
                                  )}
                                </small>
                              </article>
                            ))}
                          </div>
                        )}
                      </section>
                    </>
                  )}
                </div>
              ) : null}

              {activeTab === "letters" ? (
                <WorkerHrLettersPanel
                  worker={selectedProfile}
                  canView={canDocuments}
                  canManage={canManageDocuments}
                  openPdf={openPrintPdf}
                  onMessage={setMessage}
                  onError={setError}
                />
              ) : null}

              {activeTab === "property" ? (
                <div className="worker-tab-stack">
                  {canManage ? (
                    <section className="expanded-worker-card">
                      <h3>
                        Assign Company Property or PPE
                      </h3>

                      <form
                        className="expanded-worker-form-grid"
                        onSubmit={addProperty}
                      >
                        {[
                          [
                            "property_type",
                            "Property type",
                          ],
                          [
                            "property_code",
                            "Property code",
                          ],
                          ["description", "Description"],
                          [
                            "issued_at",
                            "Issued date",
                            "date",
                          ],
                          [
                            "expected_return_date",
                            "Expected return date",
                            "date",
                          ],
                          [
                            "condition_issued",
                            "Condition issued",
                          ],
                        ].map(
                          ([
                            key,
                            label,
                            type = "text",
                          ]) => (
                            <Field key={key} label={label}>
                              <input
                                type={type}
                                value={propertyForm[key]}
                                onChange={(event) =>
                                  setPropertyForm(
                                    (current) => ({
                                      ...current,
                                      [key]:
                                        event.target.value,
                                    })
                                  )
                                }
                                required={
                                  key === "description"
                                }
                              />
                            </Field>
                          )
                        )}

                        <Field label="Notes">
                          <textarea
                            value={propertyForm.notes}
                            onChange={(event) =>
                              setPropertyForm(
                                (current) => ({
                                  ...current,
                                  notes:
                                    event.target.value,
                                })
                              )
                            }
                          />
                        </Field>

                        <button type="submit">
                          Assign Property
                        </button>
                      </form>
                    </section>
                  ) : null}

                  <section className="expanded-worker-card">
                    <h3>Company Property History</h3>

                    {detail.property.length === 0 ? (
                      <EmptyState>
                        No company property has been
                        assigned.
                      </EmptyState>
                    ) : (
                      <div className="worker-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Property</th>
                              <th>Code</th>
                              <th>Issued</th>
                              <th>Expected return</th>
                              <th>Status</th>
                            </tr>
                          </thead>

                          <tbody>
                            {detail.property.map((item) => (
                              <tr key={item.id}>
                                <td>
                                  <strong>
                                    {item.description}
                                  </strong>
                                  <small>
                                    {item.property_type}
                                  </small>
                                </td>
                                <td>
                                  {item.property_code || "-"}
                                </td>
                                <td>
                                  {formatDate(
                                    item.issued_at
                                  )}
                                </td>
                                <td>
                                  {formatDate(
                                    item.expected_return_date
                                  )}
                                </td>
                                <td>{item.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="expanded-worker-card">
                    <h3>Employment Status History</h3>

                    {detail.status_history.length === 0 ? (
                      <EmptyState>
                        No status changes have been recorded.
                      </EmptyState>
                    ) : (
                      <div className="worker-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Change</th>
                              <th>Reason</th>
                              <th>Changed by</th>
                            </tr>
                          </thead>

                          <tbody>
                            {detail.status_history.map(
                              (item) => (
                                <tr key={item.id}>
                                  <td>
                                    {formatDateTime(
                                      item.changed_at
                                    )}
                                  </td>
                                  <td>
                                    {item.previous_status ||
                                      "-"}
                                    {" → "}
                                    {item.new_status}
                                  </td>
                                  <td>{item.reason}</td>
                                  <td>
                                    {item.changed_by_name ||
                                      "-"}
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {canSensitive ? (
                    <section className="expanded-worker-card">
                      <h3>Profile Change History</h3>

                      {detail.profile_change_history
                        .length === 0 ? (
                        <EmptyState>
                          No profile edits have been
                          recorded.
                        </EmptyState>
                      ) : (
                        <div className="worker-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Change type</th>
                                <th>Reason</th>
                                <th>Changed by</th>
                              </tr>
                            </thead>

                            <tbody>
                              {detail.profile_change_history.map(
                                (item) => (
                                  <tr key={item.id}>
                                    <td>
                                      {formatDateTime(
                                        item.changed_at
                                      )}
                                    </td>
                                    <td>
                                      {item.change_type}
                                    </td>
                                    <td>
                                      {item.reason || "-"}
                                    </td>
                                    <td>
                                      {item.changed_by_name ||
                                        "-"}
                                    </td>
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      {printChoiceOpen ? (
        <div
          className="worker-print-choice-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPrintChoiceOpen(false);
            }
          }}
        >
          <section
            className="worker-print-choice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="worker-print-choice-title"
          >
            <header>
              <div>
                <p>Release 2F — Worker Print Pack</p>

                <h2 id="worker-print-choice-title">
                  Choose ID Card Print Format
                </h2>

                <span>
                  Both formats contain the redesigned modern Chalin 03
                  employee card with clean identity, verification and security sections.
                </span>
              </div>

              <button
                type="button"
                className="worker-print-close"
                onClick={() =>
                  setPrintChoiceOpen(false)
                }
                aria-label="Close print choices"
              >
                ×
              </button>
            </header>

            <div className="worker-print-choice-grid">
              <article>
                <div className="worker-print-format-preview exact worker-id-preview-modern">
                  <span className="worker-id-mini-card front">
                    <b>C03</b>
                    <i>EMPLOYEE ID</i>
                    <small>Photo · Name · Role</small>
                  </span>
                  <span className="worker-id-mini-card back">
                    <b>VERIFICATION</b>
                    <i>Emergency · Serial</i>
                    <small>Security bars</small>
                  </span>
                </div>

                <h3>Exact Card Size</h3>

                <p>
                  CR80 standard card dimensions:
                  85.60 × 53.98 mm. The PDF contains
                  the front and back as two separate,
                  exact-size pages.
                </p>

                <strong>
                  Best for card printers and professional
                  ID-card production.
                </strong>

                <button
                  type="button"
                  onClick={() =>
                    openPrintPdf(
                      `/release2-final/workers-expanded/${selectedId}/id-card-pdf?layout=card`,
                      "card"
                    )
                  }
                  disabled={Boolean(printLoading)}
                >
                  {printLoading === "card"
                    ? "Preparing Card..."
                    : "Open Exact Card PDF"}
                </button>
              </article>

              <article>
                <div className="worker-print-format-preview a4 worker-id-preview-modern">
                  <span className="worker-id-a4-sheet">A4</span>
                  <span className="worker-id-mini-card sheet">
                    <b>FRONT + BACK</b>
                    <i>100% actual size</i>
                    <small>Cut marks included</small>
                  </span>
                </div>

                <h3>A4 Print Sheet</h3>

                <p>
                  Places the front and back together on
                  one A4 sheet with labels, cut marks and
                  printing instructions.
                </p>

                <strong>
                  Best for ordinary office printers,
                  cutting and lamination.
                </strong>

                <button
                  type="button"
                  onClick={() =>
                    openPrintPdf(
                      `/release2-final/workers-expanded/${selectedId}/id-card-pdf?layout=a4`,
                      "a4"
                    )
                  }
                  disabled={Boolean(printLoading)}
                >
                  {printLoading === "a4"
                    ? "Preparing A4 Sheet..."
                    : "Open A4 Print Sheet"}
                </button>
              </article>
            </div>

            <footer>
              <span>
                Confirm the worker photograph, employee
                number, ID-card issue date and expiry date
                before final printing.
              </span>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

const SENSITIVE_FIELD_KEYS = new Set([
  "date_of_birth",
  "national_id_type",
  "national_id_number",
  "national_id_issue_date",
  "national_id_expiry_date",
  "ssnit_number",
  "tin_number",
  "blood_group",
]);