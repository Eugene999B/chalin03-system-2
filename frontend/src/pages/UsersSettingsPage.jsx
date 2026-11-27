import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/staffManagement.css";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const emptyUserForm = {
  full_name: "",
  username: "",
  password: "",
  role: "cashier",
  phone: "",
  branch_ids: [],
  can_access_all_branches: false,
};

const emptyResetPasswordForm = {
  userId: "",
  fullName: "",
  username: "",
  password: "",
  confirmPassword: "",
};

const SYSTEM_ADMIN_ID = 1;
const SYSTEM_ADMIN_USERNAME = "admin";

const roleCards = {
  admin: {
    title: "Admin",
    subtitle: "Full system control",
    badge: "System Control",
    icon: "👑",
    tone: "admin",
    description:
      "Can manage users, settings, reports, operations, backups and system controls.",
  },
  manager: {
    title: "Manager",
    subtitle: "Business operations",
    badge: "Management",
    icon: "🧭",
    tone: "manager",
    description:
      "Can manage stock, reports, expenses, purchases, returns and business operations.",
  },
  staff: {
    title: "Staff",
    subtitle: "General operational access",
    badge: "Staff Access",
    icon: "👤",
    tone: "default",
    description: "Staff access for separately assigned workspaces.",
  },
  cashier: {
    title: "Cashier",
    subtitle: "Sales and daily work",
    badge: "Sales Desk",
    icon: "🧾",
    tone: "cashier",
    description:
      "Can record sales, view daily work pages, handle receipts and customer-facing activity.",
  },
  auditor: {
    title: "Auditor",
    subtitle: "Audit and accounting",
    badge: "Audit Access",
    icon: "🧮",
    tone: "auditor",
    description:
      "Can access audit/accounting, sign-offs, accounting intelligence and exports as requested by the boss.",
  },
};

function getRoleCard(role) {
  return roleCards[String(role || "").toLowerCase()] || {
    title: role || "User",
    subtitle: "System user",
    badge: "Staff",
    icon: "👤",
    tone: "default",
    description: "System user account.",
  };
}

function getBranchId(branch) {
  return Number(branch?.id || branch?.branch_id || 0);
}

function getBranchCode(branch) {
  return branch?.code || branch?.branch_code || "";
}

function getBranchName(branch) {
  return branch?.name || branch?.branch_name || "Store";
}

function getBranchLocation(branch) {
  return branch?.location || branch?.branch_location || "";
}

function normalizeBranches(data) {
  if (Array.isArray(data?.branches)) return data.branches;
  if (Array.isArray(data?.stores)) return data.stores;
  if (Array.isArray(data)) return data;
  return [];
}

function formatBranchLabel(branch) {
  const code = getBranchCode(branch);
  const name = getBranchName(branch);
  const location = getBranchLocation(branch);

  return `${code ? `${code} - ` : ""}${name}${location ? ` (${location})` : ""}`;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getInitials(name) {
  const cleanName = String(name || "User").trim();

  if (!cleanName) return "U";

  return cleanName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getRoleLabel(role) {
  return getRoleCard(role).title;
}

function strongPasswordError(password) {
  const text = String(password || "");

  if (text.length < 8) {
    return "Temporary password must be at least 8 characters long.";
  }

  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text)) {
    return "Temporary password must include uppercase and lowercase letters.";
  }

  if (!/\d/.test(text)) {
    return "Temporary password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    return "Temporary password must include at least one symbol.";
  }

  return "";
}

function StaffActionDialog({title,subtitle,onClose,busy,children}){
 const ref=useRef(null);
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;dialog.showModal();return()=>{if(dialog.open)dialog.close();};},[]);
 return createPortal(<dialog ref={ref} className="staff-action-dialog" aria-labelledby="staff-action-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
 <header className="staff-dialog-head"><div><small>STAFF MANAGEMENT</small><h2 id="staff-action-title">{title}</h2><p>{subtitle}</p></div><button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></header>
 <div className="staff-dialog-body">{children}</div></dialog>,document.body);
}
export default function UsersSettingsPage() {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [resetPasswordForm, setResetPasswordForm] = useState(
    emptyResetPasswordForm
  );

  const [settings, setSettings] = useState({
    business_name: "",
    business_address: "",
    business_phone: "",
    owner_phone: "",
    branch_name: "",
    receipt_prefix: "",
    tax_rate: 0,
    debt_reminder_days: 30,
    daily_summary_time: "18:00:00",
    receipt_footer: "",
    worker_id_card_validity_months: 24,
    worker_employee_number_prefix: "CH03",
  });
  const [systemAdminLoginPhone, setSystemAdminLoginPhone] = useState("");
  const [savingSystemAdminLoginPhone, setSavingSystemAdminLoginPhone] =
    useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [authReset, setAuthReset] = useState(null);
  const [authResetMode,setAuthResetMode]=useState("unlock");
  const [authFeedback,setAuthFeedback]=useState(null);
  const [staffSearch,setStaffSearch]=useState("");
  const [staffFilter,setStaffFilter]=useState("all");
  const [expandedStaff,setExpandedStaff]=useState(null);
  const [staffStatusBusy,setStaffStatusBusy]=useState(null);
  const [passwordlessMode,setPasswordlessMode]=useState(null);
  const [authResetCode, setAuthResetCode] = useState("");
  const [authResetReason, setAuthResetReason] = useState("");
  const [authResetBusy, setAuthResetBusy] = useState(false);
  const [offboardingUserId, setOffboardingUserId] = useState("");
  const [roleDraftByUser, setRoleDraftByUser] = useState({});
  const [savingRoleUserId, setSavingRoleUserId] = useState(null);
  const [activePanel, setActivePanel] = useState("users");

  const selectedBranchId = Number(
    currentUser?.branch_id || currentUser?.default_branch_id || 0
  );

  const selectedRoleCard = getRoleCard(userForm.role);
 const visibleUsers=useMemo(()=>users.filter(u=>{
 const query=staffSearch.trim().toLowerCase();
 return (!query||[u.full_name,u.username,u.role,u.phone].some(v=>String(v||"").toLowerCase().includes(query)))&&(staffFilter==="all"||(staffFilter==="active"&&u.is_active&&!u.is_login_locked)||(staffFilter==="security"&&u.is_active&&(u.is_login_locked||u.authenticator_active===false))||(staffFilter==="disabled"&&!u.is_active));
 }),[users,staffSearch,staffFilter]);
 useEffect(()=>{let mounted=true;axiosClient.get("/auth/passwordless/mode").then(({data})=>{if(mounted)setPasswordlessMode(data?.enforced===true?true:data?.enforced===false?false:null);}).catch(()=>{if(mounted)setPasswordlessMode(null);});return()=>{mounted=false;};},[]);

  const userStats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => Boolean(user.is_active)).length;
    const disabled = total - active;

    const counts = users.reduce(
      (summary, user) => {
        const role = String(user.role || "unknown").toLowerCase();
        summary[role] = (summary[role] || 0) + 1;
        return summary;
      },
      {
        admin: 0,
        manager: 0,
        cashier: 0,
        auditor: 0,
      }
    );

    return {
      total,
      active,
      disabled,
      counts,
    };
  }, [users]);

  function isOriginalSystemAdministrator(user) {
    return (
      Number(user?.id) === SYSTEM_ADMIN_ID &&
      String(user?.username || "").toLowerCase() === SYSTEM_ADMIN_USERNAME &&
      String(user?.role || "").toLowerCase() === "admin"
    );
  }

  function canCurrentUserSecurelyOffboardAccounts() {
        return isOriginalSystemAdministrator(currentUser);
      }

  function canCurrentUserResetAccounts() {
    return isOriginalSystemAdministrator(currentUser);
  }

  function canSecurelyOffboardUser(user) {
        if (!canCurrentUserSecurelyOffboardAccounts()) return false;
        if (Number(user.id) === Number(currentUser?.id)) return false;
        if (isOriginalSystemAdministrator(user)) return false;
        return Boolean(user.is_active);
      }

  function getCurrentStoreName() {
    return (
      currentUser?.branch_name ||
      currentUser?.branch?.name ||
      settings.branch_name ||
      "Selected Store"
    );
  }

  function getCurrentStoreLabel() {
    const storeName = getCurrentStoreName();
    const location =
      currentUser?.branch_location ||
      currentUser?.branch?.location ||
      currentUser?.selected_branch?.location ||
      "";

    return `${storeName}${location ? ` - ${location}` : ""}`;
  }

  async function loadBranches() {
    const response = await axiosClient.get("/branches");
    const loadedBranches = normalizeBranches(response.data);

    setBranches(loadedBranches);

    setUserForm((previousForm) => {
      if (previousForm.branch_ids.length > 0) return previousForm;

      if (selectedBranchId) {
        return {
          ...previousForm,
          branch_ids: [selectedBranchId],
        };
      }

      const firstBranchId = getBranchId(loadedBranches[0]);

      if (firstBranchId) {
        return {
          ...previousForm,
          branch_ids: [firstBranchId],
        };
      }

      return previousForm;
    });
  }

  async function loadUsers() {
    const response = await axiosClient.get("/users");
    setUsers(response.data.users || []);
  }

  async function loadSettings() {
    const response = await axiosClient.get("/settings");
    setSettings(response.data.settings || {});
  }

  async function loadSystemAdminLoginPhone() {
    if (!isOriginalSystemAdministrator(currentUser)) return;

    const response = await axiosClient.get(
      "/settings/system-admin-login-phone"
    );
    setSystemAdminLoginPhone(
      response.data.system_admin_login_phone || ""
    );
  }

  async function loadPageData() {
    setError("");
    setMessage("");

    const loadErrors = [];

    try {
      await loadBranches();
    } catch (error) {
      loadErrors.push(
        error.response?.data?.message ||
          "Failed to load stores. Make sure the branches route is working."
      );
    }

    try {
      await loadUsers();
    } catch (error) {
      loadErrors.push(
        error.response?.data?.message ||
          "Failed to load users. Make sure you are logged in as admin."
      );
    }

    try {
      await loadSettings();
    } catch (error) {
      loadErrors.push(
        error.response?.data?.message ||
          "Failed to load selected-store settings."
      );
    }

    if (isOriginalSystemAdministrator(currentUser)) {
      try {
        await loadSystemAdminLoginPhone();
      } catch (error) {
        loadErrors.push(
          error.response?.data?.message ||
            "Failed to load the System Administrator login phone."
        );
      }
    }

    if (loadErrors.length > 0) {
      setError(loadErrors.join("\n"));
      return;
    }

    setMessage("Users and settings loaded successfully.");
  }

  useEffect(() => {
    loadPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUserChange(event) {
    const { name, value, checked, type } = event.target;

    setUserForm((previousForm) => {
      const nextForm = {
        ...previousForm,
        [name]: type === "checkbox" ? checked : value,
      };

      if (name === "role" && value === "admin") {
        nextForm.can_access_all_branches = true;
      }

      if (name === "role" && value !== "admin") {
        nextForm.can_access_all_branches = false;

        if (nextForm.branch_ids.length === 0 && selectedBranchId) {
          nextForm.branch_ids = [selectedBranchId];
        }
      }

      if (name === "can_access_all_branches" && checked) {
        nextForm.branch_ids = branches
          .map((branch) => getBranchId(branch))
          .filter((branchId) => branchId > 0);
      }

      if (name === "can_access_all_branches" && !checked) {
        nextForm.branch_ids =
          nextForm.branch_ids.length > 0
            ? nextForm.branch_ids
            : selectedBranchId
            ? [selectedBranchId]
            : [];
      }

      return nextForm;
    });
  }

  function handleRoleSelect(roleKey) {
    handleUserChange({
      target: {
        name: "role",
        value: roleKey,
        type: "select-one",
      },
    });
  }

  function handleBranchAccessChange(branchId, checked) {
    setUserForm((previousForm) => {
      const currentBranchIds = previousForm.branch_ids.map((id) => Number(id));

      let nextBranchIds = checked
        ? [...new Set([...currentBranchIds, branchId])]
        : currentBranchIds.filter((id) => Number(id) !== Number(branchId));

      if (nextBranchIds.length === 0 && selectedBranchId) {
        nextBranchIds = [selectedBranchId];
      }

      return {
        ...previousForm,
        branch_ids: nextBranchIds,
      };
    });
  }

  function handleSettingsChange(event) {
    setSettings({
      ...settings,
      [event.target.name]: event.target.value,
    });
  }

  function handleResetPasswordChange(event) {
    setResetPasswordForm({
      ...resetPasswordForm,
      [event.target.name]: event.target.value,
    });
  }

  function openSecurityRecovery(user,mode="unlock"){
 setAuthReset(user);setAuthResetMode(mode);setAuthResetCode("");setAuthResetReason("");setAuthFeedback(null);setResetPasswordForm(emptyResetPasswordForm);setError("");setMessage("");
 }
 function closeSecurityRecovery(){
 if(authResetBusy)return;setAuthReset(null);setAuthResetCode("");setAuthResetReason("");setAuthFeedback(null);
 }
 async function revokeStaffAuthenticator(event) {
 event.preventDefault();
 if(!authReset||authResetBusy||authFeedback?.kind==="success")return;
 if(!/^\d{6}$/.test(authResetCode)||authResetReason.trim().length<8){setAuthFeedback({kind:"error",text:"Enter a reason of at least eight characters and your current six-digit Authenticator code."});return;}
 const target=authReset;setAuthResetBusy(true);setAuthFeedback(null);setError("");setMessage("");
 try{
 const {data}=await axiosClient.post("/auth/passwordless/administrator/revoke-authenticator",{user_id:target.id,authenticator_code:authResetCode,reason:authResetReason.trim(),mode:authResetMode});
 if(data?.status!=="success")throw Error("No success confirmation received.");
 const text=data.message||"Account recovery completed.";setAuthFeedback({kind:"success",text});
 setUsers(previous=>previous.map(u=>Number(u.id)===Number(target.id)?{...u,is_login_locked:false,failed_login_attempts:0,...(authResetMode==="reenroll"?{authenticator_active:false}:{})}:u));
 try{await loadUsers();}catch{setAuthFeedback({kind:"success",text:text+" Staff list refresh failed; refresh the page."});}
 }catch(err){setAuthFeedback({kind:"error",text:err.response?.data?.message||(err.response?"Staff security reset could not be completed.":"No response received. Refresh the account before retrying; the action may have completed.")});}
 finally{setAuthResetBusy(false);setAuthResetCode("");}
 }
  function openResetPassword(user) {
    setMessage("");
    setError("");

    if (!canCurrentUserResetAccounts()) {
      setError(
        "Only the original System Administrator can unlock or reset user accounts."
      );
      return;
    }

    if (isOriginalSystemAdministrator(user)) {
      setError(
        "The original System Administrator requires Owner Break-Glass recovery in Release 2B."
      );
      return;
    }

    setActivePanel("users");

    setResetPasswordForm({
      userId: user.id,
      fullName: user.full_name,
      username: user.username,
      password: "",
      confirmPassword: "",
    });
  }

  function closeResetPassword() {
    setResetPasswordForm(emptyResetPasswordForm);
  }

  function getUserBranchNames(user) {
    if (user.can_access_all_branches) return "All stores";

    if (Array.isArray(user.branches) && user.branches.length > 0) {
      return user.branches.map((branch) => formatBranchLabel(branch)).join(", ");
    }

    if (user.default_branch_id) {
      const branch = branches.find(
        (item) => Number(getBranchId(item)) === Number(user.default_branch_id)
      );

      return branch
        ? formatBranchLabel(branch)
        : `Store ID ${user.default_branch_id}`;
    }

    return "-";
  }

  function getAccessTypeText(user) {
    if (user.can_access_all_branches) return "All-store access";
    if (Array.isArray(user.branches) && user.branches.length > 1) {
      return "Multiple stores";
    }
    return "Selected store";
  }

  async function createUser(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (
      !userForm.can_access_all_branches &&
      (!Array.isArray(userForm.branch_ids) || userForm.branch_ids.length === 0)
    ) {
      setError("Select at least one store for this user.");
      return;
    }

    try {
      await axiosClient.post("/users", {
        ...userForm,
        branch_ids: userForm.branch_ids.map((branchId) => Number(branchId)),
        can_access_all_branches:
          userForm.can_access_all_branches || userForm.role === "admin",
      });

      setMessage("User created successfully.");
      setUserForm({
        ...emptyUserForm,
        branch_ids: selectedBranchId ? [selectedBranchId] : [],
      });
      loadUsers();
      setActivePanel("users");
    } catch (error) {
      setError(error.response?.data?.message || "Failed to create user.");
    }
  }

  async function changeUserRole(user) {
    const nextRole = String(roleDraftByUser[user.id] || user.role).toLowerCase();
    const currentRole = String(user.role || "").toLowerCase();
    if (nextRole === currentRole) return;
    const originalOwner = isOriginalSystemAdministrator(currentUser);
    if (Number(user.id) === Number(currentUser?.id) ||
        isOriginalSystemAdministrator(user) ||
        (nextRole === "admin" && !originalOwner) ||
        String(user.primary_workspace_code || "") !== "spare_parts" ||
        String(user.category_assignment_status || "") !== "assigned") {
      setError("This account or role requires separate administrator approval.");
      return;
    }
    const confirmed = window.confirm(
      `Change ${user.full_name} (@${user.username}) from ${getRoleLabel(currentRole)} to ${getRoleLabel(nextRole)}?\n\nTheir permissions will change, and they must sign in again.` +
      (currentRole === "admin" ? "\n\nDemoting an administrator removes their all-store access." : "")
    );
    if (!confirmed) return;
    setSavingRoleUserId(user.id);
    setError("");
    setMessage("");
    try {
      const result = await axiosClient.patch(`/users/${user.id}/role`, { role: nextRole });
      setRoleDraftByUser(previous => {
        const updated = { ...previous };
        delete updated[user.id];
        return updated;
      });
      await loadUsers();
      setMessage(result.data?.message || "Role updated. The user must sign in again.");
    } catch (err) {
      setError(err.response?.data?.message || "Role update failed. Refresh the account to confirm its role.");
    } finally {
      setSavingRoleUserId(null);
    }
  }

  async function toggleUserStatus(userId) {
    if(staffStatusBusy!==null)return;
    const target=users.find(u=>Number(u.id)===Number(userId));
    if(!target||!window.confirm((target.is_active?"Temporarily disable ":"Reactivate ")+(target.full_name||target.username)+"?"))return;
    setStaffStatusBusy(userId);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.patch(
        `/users/${userId}/toggle-status`
      );

      setMessage(response.data.message);
      await loadUsers();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to change user status.");
    } finally{setStaffStatusBusy(null);}
  }

  async function secureOffboardUser(user) {
        setMessage("");
        setError("");

        if (!canSecurelyOffboardUser(user)) {
          setError(
            "Only the original System Administrator can securely offboard another active user account."
          );
          return;
        }

        const firstConfirm = window.confirm(
          `Securely offboard this account?

Name: ${user.full_name}
Username: ${user.username}
Role: ${user.role}

This disables login, revokes all active sessions and assigned access, and preserves the user identity on historical sales, payments, approvals and audit records.`
        );

        if (!firstConfirm) return;

        const typedConfirm = window.prompt(
          `Type OFFBOARD ${user.username} to confirm secure offboarding.`
        );

        if (typedConfirm !== `OFFBOARD ${user.username}`) {
          setError("Secure offboarding cancelled. Confirmation text did not match.");
          return;
        }

        setOffboardingUserId(user.id);

        try {
          const response = await axiosClient.delete(`/users/${user.id}`);

          setMessage(
            response.data.message ||
              "User account securely offboarded and historical identity preserved."
          );
          await loadUsers();
        } catch (error) {
          setError(
            error.response?.data?.message || "Failed to securely offboard user."
          );
        } finally {
          setOffboardingUserId("");
        }
      }

      async function resetUserPassword(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!resetPasswordForm.userId) {
      setError("Select a user first.");
      return;
    }

    if (!resetPasswordForm.password || !resetPasswordForm.confirmPassword) {
      setError("New password and confirm password are required.");
      return;
    }

    const passwordPolicyError = strongPasswordError(
      resetPasswordForm.password
    );

    if (passwordPolicyError) {
      setError(passwordPolicyError);
      return;
    }

    if (resetPasswordForm.password !== resetPasswordForm.confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    const confirmed = window.confirm(
      `Reset password for ${resetPasswordForm.fullName}?`
    );

    if (!confirmed) return;

    setResettingPassword(true);

    try {
      const response = await axiosClient.patch(
        `/users/${resetPasswordForm.userId}/reset-password`,
        {
          password: resetPasswordForm.password,
          confirm_password: resetPasswordForm.confirmPassword,
        }
      );

      setMessage(
        response.data.message ||
          `Password reset successfully for ${resetPasswordForm.fullName}.`
      );

      closeResetPassword();
      loadUsers();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to reset password.");
    } finally {
      setResettingPassword(false);
    }
  }

  async function saveSystemAdminLoginPhone() {
    setMessage("");
    setError("");

    if (!systemAdminLoginPhone.trim()) {
      setError("Enter the System Administrator login phone.");
      return;
    }

    setSavingSystemAdminLoginPhone(true);
    try {
      const response = await axiosClient.patch(
        "/settings/system-admin-login-phone",
        { system_admin_login_phone: systemAdminLoginPhone.trim() }
      );
      setSystemAdminLoginPhone(
        response.data.system_admin_login_phone || systemAdminLoginPhone.trim()
      );
      setMessage(
        response.data.message ||
          "System Administrator login phone updated successfully."
      );
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to update the System Administrator login phone."
      );
    } finally {
      setSavingSystemAdminLoginPhone(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    try {
      const response = await axiosClient.put("/settings", {
        ...settings,
        tax_rate: Number(settings.tax_rate || 0),
        debt_reminder_days: Number(settings.debt_reminder_days || 30),
        worker_id_card_validity_months: Number(
          settings.worker_id_card_validity_months || 24
        ),
      });

      setSettings(response.data.settings);
      setMessage(`Settings updated successfully for ${getCurrentStoreName()}.`);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to update settings.");
    }
  }

  return (
    <div className="users-control-page">
      <style>{`
        .users-control-page {
          --navy: #07182c;
          --navy-2: #0d2f55;
          --gold: #e0ba28;
          --paper: #f8fafc;
          --muted: #64748b;
          --line: #dbe3ef;
          --danger: #b91c1c;
          --success: #166534;
          min-height: 100%;
          color: #0f172a;
        }

        .users-control-page * {
          box-sizing: border-box;
        }

        .users-hero {
          position: relative;
          overflow: hidden;
          border-radius: 32px;
          padding: 24px;
          margin-bottom: 18px;
          color: #ffffff;
          background:
            radial-gradient(circle at 15% 10%, rgba(224, 186, 40, 0.28), transparent 34%),
            radial-gradient(circle at 90% 14%, rgba(59, 130, 246, 0.22), transparent 30%),
            linear-gradient(135deg, #07182c 0%, #0d2f55 58%, #111827 100%);
          box-shadow: 0 28px 70px rgba(7, 24, 44, 0.24);
        }

        .users-hero-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: start;
        }

        .users-eyebrow {
          margin: 0 0 8px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--gold);
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .users-hero h1 {
          margin: 0;
          font-size: clamp(30px, 4vw, 52px);
          line-height: 0.95;
          letter-spacing: -0.06em;
          font-weight: 950;
        }

        .users-hero p {
          max-width: 820px;
          margin: 12px 0 0;
          color: rgba(255, 255, 255, 0.74);
          line-height: 1.6;
          font-weight: 750;
        }

        .users-role-change {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 7px;
          border: 1px solid #cfdfd9;
          background: #f3f9f6;
          border-radius: 10px;
          padding: 7px;
        }
        .users-role-change label { font-size: 11px; font-weight: 800; color: #31584d; }
        .users-role-change select {
          min-width: 112px;
          max-width: 180px;
          padding: 8px 10px;
          border: 1px solid #b7cdc4;
          border-radius: 7px;
          color: #17392e;
          background: white;
          font-size: 13px;
        }
        .users-role-change button:disabled { opacity: .5; cursor: not-allowed; }
        @media (max-width: 700px) {
          .users-role-change { width: 100%; }
          .users-role-change select { flex: 1; max-width: none; min-width: 100px; }
        }

        .users-hero-actions,
        .users-actions-row,
        .users-panel-tabs {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .users-hero-actions {
          justify-content: flex-end;
        }

        .users-primary-action,
        .users-secondary-action,
        .users-danger-action,
        .users-success-action,
        .users-ghost-action {
          border: none;
          border-radius: 16px;
          padding: 11px 14px;
          font-weight: 950;
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }

        .users-primary-action:hover,
        .users-secondary-action:hover,
        .users-danger-action:hover,
        .users-success-action:hover,
        .users-ghost-action:hover {
          transform: translateY(-1px);
        }

        .users-primary-action {
          background: linear-gradient(135deg, var(--gold), #f6d85d);
          color: var(--navy);
          box-shadow: 0 14px 34px rgba(224, 186, 40, 0.22);
        }

        .users-secondary-action {
          background: #ffffff;
          color: var(--navy);
          border: 1px solid #e2e8f0;
        }

        .users-ghost-action {
          background: rgba(255, 255, 255, 0.10);
          border: 1px solid rgba(255, 255, 255, 0.24);
          color: #ffffff;
        }

        .users-danger-action {
          background: #b91c1c;
          color: #ffffff;
        }

        .users-success-action {
          background: #166534;
          color: #ffffff;
        }

        .users-store-strip {
          margin-top: 18px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .users-store-pill {
          min-width: 0;
          padding: 14px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.10);
          border: 1px solid rgba(255, 255, 255, 0.16);
          backdrop-filter: blur(12px);
        }

        .users-store-pill label {
          display: block;
          margin: 0 0 5px;
          color: rgba(255, 255, 255, 0.58);
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .users-store-pill strong {
          display: block;
          color: #ffffff;
          font-size: 17px;
          font-weight: 950;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .users-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }

        .users-stat-card,
        .users-card {
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid #e2e8f0;
          box-shadow: 0 22px 56px rgba(15, 23, 42, 0.07);
        }

        .users-stat-card {
          padding: 18px;
          border-radius: 26px;
        }

        .users-stat-card span {
          display: block;
          color: var(--muted);
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .users-stat-card strong {
          display: block;
          margin-top: 8px;
          color: var(--navy);
          font-size: 32px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.05em;
        }

        .users-stat-card small {
          display: block;
          margin-top: 8px;
          color: #64748b;
          font-weight: 800;
        }

        .users-panel-tabs {
          margin-bottom: 18px;
        }

        .users-panel-tab {
          border: 1px solid #dbe3ef;
          border-radius: 999px;
          padding: 10px 14px;
          background: #ffffff;
          color: #334155;
          font-weight: 950;
          cursor: pointer;
        }

        .users-panel-tab.active {
          background: var(--navy);
          color: #ffffff;
          border-color: var(--navy);
          box-shadow: 0 12px 30px rgba(7, 24, 44, 0.16);
        }

        .users-message {
          margin-bottom: 16px;
          border-radius: 18px;
          padding: 14px;
          font-weight: 850;
          white-space: pre-line;
        }

        .users-message.success {
          background: #f0fdf4;
          color: #166534;
          border: 1px solid #bbf7d0;
        }

        .users-message.error {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .users-warning-banner {
          margin-bottom: 18px;
          padding: 16px;
          border-radius: 22px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 12px;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
          font-weight: 850;
        }

        .users-layout-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
          gap: 18px;
          align-items: start;
          margin-bottom: 18px;
        }

        .users-card {
          border-radius: 28px;
          overflow: hidden;
        }

        .users-card-header {
          padding: 18px;
          border-bottom: 1px solid #eef2f7;
          background:
            radial-gradient(circle at 0% 0%, rgba(224, 186, 40, 0.13), transparent 30%),
            linear-gradient(135deg, #ffffff, #f8fafc);
        }

        .users-card-header h2 {
          margin: 0;
          color: var(--navy);
          font-size: 22px;
          letter-spacing: -0.04em;
          font-weight: 950;
        }

        .users-card-header p {
          margin: 6px 0 0;
          color: var(--muted);
          font-weight: 750;
          line-height: 1.5;
        }

        .users-card-body {
          padding: 18px;
        }

        .users-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .users-field.full {
          grid-column: 1 / -1;
        }

        .users-field label,
        .users-section-label {
          display: block;
          margin: 0 0 7px;
          color: #334155;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .users-field input,
        .users-field select,
        .users-field textarea {
          width: 100%;
          border: 1px solid #dbe3ef;
          border-radius: 16px;
          background: #ffffff;
          color: #0f172a;
          padding: 12px 13px;
          outline: none;
          font-weight: 800;
        }

        .users-field textarea {
          min-height: 95px;
          resize: vertical;
        }

        .users-field input:focus,
        .users-field select:focus,
        .users-field textarea:focus {
          border-color: var(--gold);
          box-shadow: 0 0 0 4px rgba(224, 186, 40, 0.16);
        }

        .users-role-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 10px;
        }

        .users-role-card {
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 13px;
          background: #ffffff;
          cursor: pointer;
          text-align: left;
          transition: 0.18s ease;
        }

        .users-role-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
        }

        .users-role-card.active {
          border-color: rgba(224, 186, 40, 0.8);
          background: #fffbeb;
          box-shadow: 0 14px 34px rgba(224, 186, 40, 0.13);
        }

        .users-role-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .users-role-top strong {
          color: var(--navy);
          font-weight: 950;
        }

        .users-role-card p {
          margin: 8px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.45;
          font-weight: 750;
        }

        .users-mini-badge,
        .users-role-badge,
        .users-status-badge,
        .users-access-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 950;
          white-space: nowrap;
        }

        .users-role-badge.admin {
          background: #fef3c7;
          color: #92400e;
        }

        .users-role-badge.manager {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .users-role-badge.cashier {
          background: #f0fdf4;
          color: #166534;
        }

        .users-role-badge.auditor {
          background: #f5f3ff;
          color: #6d28d9;
        }

        .users-role-badge.default {
          background: #f1f5f9;
          color: #475569;
        }

        .users-status-badge.active {
          background: #f0fdf4;
          color: #166534;
        }

        .users-status-badge.disabled {
          background: #fef2f2;
          color: #991b1b;
        }

        .users-access-badge {
          background: #f8fafc;
          color: #334155;
          border: 1px solid #e2e8f0;
        }

        .users-permission-box {
          margin-top: 14px;
          padding: 14px;
          border-radius: 20px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .users-permission-box strong {
          display: block;
          color: var(--navy);
          font-weight: 950;
          margin-bottom: 7px;
        }

        .users-permission-box p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.5;
          font-weight: 750;
        }

        .users-check-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px;
          border-radius: 16px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #334155;
          font-weight: 850;
        }

        .users-check-row input {
          width: auto;
          margin-top: 3px;
        }

        .users-store-access-grid {
          display: grid;
          gap: 9px;
          margin-top: 10px;
        }

        .users-store-check {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          padding: 10px;
          border-radius: 16px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          font-weight: 850;
        }

        .users-store-check input {
          width: auto;
        }

        .users-store-check span {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .users-settings-section {
          margin-bottom: 18px;
          padding: 16px;
          border-radius: 24px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .users-settings-section h3 {
          margin: 0 0 12px;
          color: var(--navy);
          font-size: 17px;
          font-weight: 950;
        }

        .users-reset-card {
          margin-bottom: 18px;
          border: 2px solid #2563eb;
        }

        .users-reset-warning {
          margin-top: 14px;
          padding: 13px;
          border-radius: 16px;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
          line-height: 1.5;
          font-weight: 800;
        }

        .users-table-wrap {
          width: 100%;
          overflow-x: auto;
        }

        .users-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0 10px;
        }

        .users-table th {
          color: #64748b;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          text-align: left;
          padding: 0 12px 6px;
          white-space: nowrap;
        }

        .users-table td {
          background: #ffffff;
          border-top: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
          padding: 13px 12px;
          vertical-align: middle;
          font-weight: 800;
        }

        .users-table td:first-child {
          border-left: 1px solid #e2e8f0;
          border-radius: 18px 0 0 18px;
        }

        .users-table td:last-child {
          border-right: 1px solid #e2e8f0;
          border-radius: 0 18px 18px 0;
        }

        .users-staff-cell {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          min-width: 210px;
        }

        .users-avatar {
          width: 42px;
          height: 42px;
          border-radius: 15px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, var(--navy), var(--navy-2));
          color: var(--gold);
          font-weight: 950;
        }

        .users-staff-name {
          display: block;
          color: var(--navy);
          font-weight: 950;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .users-staff-sub {
          display: block;
          margin-top: 3px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .users-small-button {
          border: none;
          border-radius: 12px;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 950;
          cursor: pointer;
        }

        .users-small-button.neutral {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .users-small-button.warning {
          background: #fff7ed;
          color: #9a3412;
        }

        .users-small-button.success {
          background: #f0fdf4;
          color: #166534;
        }

        .users-small-button.danger {
          background: #7f1d1d;
          color: #ffffff;
        }

        .users-small-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .users-protected-note {
          display: block;
          margin-top: 7px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .users-empty-state {
          padding: 28px;
          border-radius: 24px;
          text-align: center;
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          color: #64748b;
          font-weight: 850;
        }

        @media (max-width: 1100px) {
          .users-hero-grid,
          .users-layout-grid {
            grid-template-columns: 1fr;
          }

          .users-hero-actions {
            justify-content: flex-start;
          }

          .users-store-strip,
          .users-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .users-control-page {
            margin-left: -6px;
            margin-right: -6px;
          }

          .users-hero {
            border-radius: 24px;
            padding: 18px;
          }

          .users-hero h1 {
            font-size: 32px;
          }

          .users-store-strip,
          .users-stats-grid,
          .users-form-grid,
          .users-role-grid {
            grid-template-columns: 1fr;
          }

          .users-card-header,
          .users-card-body {
            padding: 15px;
          }

          .users-actions-row,
          .users-hero-actions,
          .users-panel-tabs {
            width: 100%;
          }

          .users-primary-action,
          .users-secondary-action,
          .users-danger-action,
          .users-success-action,
          .users-ghost-action,
          .users-panel-tab {
            width: 100%;
          }

          .users-control-page { min-width:0; max-width:100%; }
        }
      `}</style>

      <section className="users-hero">
        <div className="users-hero-grid">
          <div>
            <p className="users-eyebrow">⚙️ Admin Control Room</p>
            <h1>Users & Settings</h1>
            <p>
              Manage staff logins, role permissions, store access and selected-store
              business settings for Chalin 03 Company Limited.
            </p>
          </div>

          <div className="users-hero-actions">
            <button
              type="button"
              className="users-ghost-action"
              onClick={() => setActivePanel("create")}
            >
              Create User
            </button>
            <button
              type="button"
              className="users-primary-action"
              onClick={loadPageData}
            >
              Refresh Control Room
            </button>
          </div>
        </div>

        <div className="users-store-strip">
          <div className="users-store-pill">
            <label>Selected Store</label>
            <strong>{getCurrentStoreLabel()}</strong>
          </div>

          <div className="users-store-pill">
            <label>Signed In As</label>
            <strong>{currentUser?.full_name || currentUser?.username || "Admin"}</strong>
          </div>

          <div className="users-store-pill">
            <label>Your Role</label>
            <strong>{getRoleLabel(currentUser?.role || "admin")}</strong>
          </div>

          <div className="users-store-pill">
            <label>Store Access</label>
            <strong>
              {currentUser?.can_access_all_branches
                ? "All Stores"
                : selectedBranchId
                ? `Store ID ${selectedBranchId}`
                : "Selected Store"}
            </strong>
          </div>
        </div>
      </section>

      <section className="users-stats-grid">
        <div className="users-stat-card">
          <span>Total Users</span>
          <strong>{userStats.total}</strong>
          <small>All staff accounts registered</small>
        </div>

        <div className="users-stat-card">
          <span>Active</span>
          <strong>{userStats.active}</strong>
          <small>Can currently log in</small>
        </div>

        <div className="users-stat-card">
          <span>Auditors</span>
          <strong>{userStats.counts.auditor || 0}</strong>
          <small>Audit and accounting access</small>
        </div>

        <div className="users-stat-card">
          <span>Disabled</span>
          <strong>{userStats.disabled}</strong>
          <small>Blocked staff accounts</small>
        </div>
      </section>

      <div className="users-panel-tabs">
        <button
          type="button"
          className={`users-panel-tab ${activePanel === "create" ? "active" : ""}`}
          onClick={() => setActivePanel("create")}
        >
          Create Staff User
        </button>
        <button
          type="button"
          className={`users-panel-tab ${activePanel === "settings" ? "active" : ""}`}
          onClick={() => setActivePanel("settings")}
        >
          Business & ID Settings
        </button>
        <button
          type="button"
          className={`users-panel-tab ${activePanel === "users" ? "active" : ""}`}
          onClick={() => setActivePanel("users")}
        >
          Staff Users
        </button>
      </div>

      {(message||error)&&<div className={"staff-feedback-toast "+(error?"is-error":"is-success")} role={error?"alert":"status"}><div><strong>{error?"Action needs attention":"Action completed"}</strong><p>{error||message}</p></div><button type="button" aria-label="Dismiss message" onClick={()=>{setError("");setMessage("");}}>×</button></div>}

      {canCurrentUserSecurelyOffboardAccounts() && (
        <div className="users-warning-banner">
          <div>🛡️</div>
          <div>
            <strong>Original System Administrator secure-offboarding mode is active.</strong>
            <br />
            Temporary Disable retains assigned access for reactivation. Secure Offboard
            revokes login, sessions and assigned access while permanently preserving the
            staff identity on historical financial and audit records.
          </div>
        </div>
      )}

      <div className="users-layout-grid">
        {(activePanel === "create" || activePanel === "settings") && (
          <>
            {activePanel === "create" && (
              <form className="users-card" onSubmit={createUser}>
                <div className="users-card-header">
                  <h2>Create Staff User</h2>
                  <p>
                    Add a new cashier, auditor, manager or admin account with the
                    correct store access.
                  </p>
                </div>

                <div className="users-card-body">
                  <div className="users-form-grid">
                    <div className="users-field">
                      <label>Full Name</label>
                      <input
                        name="full_name"
                        value={userForm.full_name}
                        onChange={handleUserChange}
                        placeholder="Example: Kofi Mensah"
                      />
                    </div>

                    <div className="users-field">
                      <label>Username</label>
                      <input
                        name="username"
                        value={userForm.username}
                        onChange={handleUserChange}
                        placeholder="Example: kofi"
                      />
                    </div>

                    <div className="users-field">
                      <label>Password</label>
                      <input
                        name="password"
                        type="password"
                        value={userForm.password}
                        onChange={handleUserChange}
                        placeholder="Minimum 6 characters"
                      />
                    </div>

                    <div className="users-field">
                      <label>Phone</label>
                      <input
                        name="phone"
                        value={userForm.phone}
                        onChange={handleUserChange}
                        placeholder="Example: 0240000000"
                      />
                    </div>

                    <div className="users-field full">
                      <label>Role</label>
                      <select
                        name="role"
                        value={userForm.role}
                        onChange={handleUserChange}
                      >
                        <option value="cashier">Cashier</option>
                        <option value="auditor">Auditor</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>

                      <div className="users-role-grid">
                        {Object.entries(roleCards).filter(([roleKey]) => roleKey !== "staff").map(([roleKey, roleInfo]) => (
                          <button
                            key={roleKey}
                            type="button"
                            className={`users-role-card ${
                              userForm.role === roleKey ? "active" : ""
                            }`}
                            onClick={() => handleRoleSelect(roleKey)}
                          >
                            <div className="users-role-top">
                              <strong>
                                {roleInfo.icon} {roleInfo.title}
                              </strong>
                              <span className={`users-role-badge ${roleInfo.tone}`}>
                                {roleInfo.badge}
                              </span>
                            </div>
                            <p>{roleInfo.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="users-field full">
                      <div className="users-permission-box">
                        <strong>
                          {selectedRoleCard.icon} {selectedRoleCard.title}: {" "}
                          {selectedRoleCard.subtitle}
                        </strong>
                        <p>{selectedRoleCard.description}</p>
                      </div>
                    </div>

                    <div className="users-field full">
                      <span className="users-section-label">Store Access</span>

                      <label className="users-check-row">
                        <input
                          type="checkbox"
                          name="can_access_all_branches"
                          checked={Boolean(
                            userForm.can_access_all_branches ||
                              userForm.role === "admin"
                          )}
                          onChange={handleUserChange}
                          disabled={userForm.role === "admin"}
                        />
                        <span>
                          Allow access to all stores
                          <br />
                          <small>
                            Admin users automatically get all-store access. Auditor
                            all-store access should be enabled only if the boss wants
                            the auditor to review all branches.
                          </small>
                        </span>
                      </label>

                      {!userForm.can_access_all_branches &&
                        userForm.role !== "admin" && (
                          <div className="users-store-access-grid">
                            {branches.length === 0 ? (
                              <div className="users-empty-state">
                                No stores found.
                              </div>
                            ) : (
                              branches.map((branch) => {
                                const branchId = getBranchId(branch);

                                return (
                                  <label
                                    key={branchId}
                                    className="users-store-check"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={userForm.branch_ids
                                        .map((id) => Number(id))
                                        .includes(branchId)}
                                      onChange={(event) =>
                                        handleBranchAccessChange(
                                          branchId,
                                          event.target.checked
                                        )
                                      }
                                    />
                                    <span>{formatBranchLabel(branch)}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        )}
                    </div>
                  </div>

                  <div style={{ marginTop: "16px" }}>
                    <button type="submit" className="users-primary-action">
                      Create User
                    </button>
                  </div>
                </div>
              </form>
            )}

            {activePanel === "settings" && (
              <form className="users-card" onSubmit={saveSettings}>
                <div className="users-card-header">
                  <h2>Selected Business & ID Settings</h2>
                  <p>
                    Settings below affect only the currently selected store and
                    receipt/business identity.
                  </p>
                </div>

                <div className="users-card-body">
                  {isOriginalSystemAdministrator(currentUser) && (
                    <div className="users-settings-section">
                      <h3>Protected System Administrator Login</h3>
                      <p
                        style={{
                          marginTop: 0,
                          color: "#64748b",
                          fontWeight: 750,
                          lineHeight: 1.55,
                        }}
                      >
                        This number is used only to sign in to the protected
                        System Administrator account. It is separate from the
                        Owner Security Alert Phone and the Business Phone /
                        Receipt MoMo Number below.
                      </p>
                      <div className="users-form-grid">
                        <div className="users-field">
                          <label>System Administrator Login Phone</label>
                          <input
                            value={systemAdminLoginPhone}
                            onChange={(event) =>
                              setSystemAdminLoginPhone(event.target.value)
                            }
                            placeholder="Example: 0240000000"
                            inputMode="tel"
                            autoComplete="tel"
                          />
                        </div>
                        <div
                          className="users-field"
                          style={{ alignSelf: "end" }}
                        >
                          <button
                            type="button"
                            className="users-primary-action"
                            onClick={saveSystemAdminLoginPhone}
                            disabled={savingSystemAdminLoginPhone}
                          >
                            {savingSystemAdminLoginPhone
                              ? "Saving Login Phone…"
                              : "Save Login Phone"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="users-settings-section">
                    <h3>Business Information</h3>
                    <div className="users-form-grid">
                      <div className="users-field">
                        <label>Store / Branch Name</label>
                        <input
                          name="branch_name"
                          value={settings.branch_name || ""}
                          onChange={handleSettingsChange}
                          placeholder="Example: Chalin 03 Main Store"
                        />
                      </div>

                      <div className="users-field">
                        <label>Business Name</label>
                        <input
                          name="business_name"
                          value={settings.business_name || ""}
                          onChange={handleSettingsChange}
                        />
                      </div>

                      <div className="users-field">
                        <label>Business Phone / Receipt MoMo Number</label>
                        <input
                          name="business_phone"
                          value={settings.business_phone || ""}
                          onChange={handleSettingsChange}
                          placeholder="Shown on this store’s receipt as telephone and MoMo number"
                        />
                      </div>

                      <div className="users-field">
                        <label>Owner Security Alert Phone</label>
                        <input
                          name="owner_phone"
                          value={settings.owner_phone || ""}
                          onChange={handleSettingsChange}
                          placeholder="Used for protected owner/security alerts only"
                        />
                      </div>

                      <div className="users-field full">
                        <label>Business Address</label>
                        <input
                          name="business_address"
                          value={settings.business_address || ""}
                          onChange={handleSettingsChange}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="users-settings-section">
                    <h3>Worker Identity Cards</h3>
                    <p style={{ marginTop: 0, color: "#64748b", fontWeight: 750 }}>
                      These group-wide rules automatically control employee numbers and every new or reissued worker ID card across Spare Parts, Mining and Equipment Hire.
                    </p>
                    <div className="users-form-grid">
                      <div className="users-field">
                        <label>Employee number prefix</label>
                        <input
                          name="worker_employee_number_prefix"
                          value={settings.worker_employee_number_prefix || "CH03"}
                          onChange={handleSettingsChange}
                          maxLength={12}
                          placeholder="CH03"
                        />
                      </div>

                      <div className="users-field">
                        <label>Card lifespan (months)</label>
                        <input
                          type="number"
                          name="worker_id_card_validity_months"
                          min="1"
                          max="120"
                          value={settings.worker_id_card_validity_months || 24}
                          onChange={handleSettingsChange}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="users-settings-section">
                    <h3>Receipt & Customer Settings</h3>
                    <div className="users-form-grid">
                      <div className="users-field">
                        <label>Receipt Prefix</label>
                        <input
                          name="receipt_prefix"
                          value={settings.receipt_prefix || ""}
                          onChange={handleSettingsChange}
                          placeholder="Example: CHL-MAIN"
                        />
                      </div>

                      <div className="users-field">
                        <label>Tax Rate (%)</label>
                        <input
                          type="number"
                          name="tax_rate"
                          value={settings.tax_rate || 0}
                          onChange={handleSettingsChange}
                        />
                      </div>

                      <div className="users-field">
                        <label>Debt Reminder Days</label>
                        <input
                          type="number"
                          name="debt_reminder_days"
                          value={settings.debt_reminder_days || 30}
                          onChange={handleSettingsChange}
                        />
                      </div>

                      <div className="users-field">
                        <label>Daily Summary Time</label>
                        <input
                          type="time"
                          name="daily_summary_time"
                          value={String(
                            settings.daily_summary_time || "18:00:00"
                          ).slice(0, 5)}
                          onChange={handleSettingsChange}
                        />
                      </div>

                      <div className="users-field full">
                        <label>Receipt Footer</label>
                        <textarea
                          name="receipt_footer"
                          value={settings.receipt_footer || ""}
                          onChange={handleSettingsChange}
                          placeholder="Example: Thank you for doing business with Chalin 03."
                        />
                      </div>
                    </div>
                  </div>

                  <button type="submit" className="users-primary-action">
                    Save Business & ID Settings
                  </button>
                </div>
              </form>
            )}

            <aside className="users-card">
              <div className="users-card-header">
                <h2>Role Permission Guide</h2>
                <p>Quick guide for explaining the system to the boss.</p>
              </div>

              <div className="users-card-body">
                <div className="users-role-grid" style={{ gridTemplateColumns: "1fr" }}>
                  {Object.entries(roleCards).map(([roleKey, roleInfo]) => (
                    <div key={roleKey} className="users-permission-box">
                      <strong>
                        {roleInfo.icon} {roleInfo.title}{" "}
                        <span className={`users-role-badge ${roleInfo.tone}`}>
                          {roleInfo.badge}
                        </span>
                      </strong>
                      <p>{roleInfo.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {authReset && (
 <StaffActionDialog title="Account security recovery" subtitle={(authReset.full_name||authReset.username)+" · @"+authReset.username} busy={authResetBusy} onClose={closeSecurityRecovery}>
 {authFeedback?.kind==="success"?<div className="staff-result success" role="status"><h3>✓ Recovery completed</h3><p>{authFeedback.text}</p><button type="button" className="staff-button primary" disabled={authResetBusy} onClick={closeSecurityRecovery}>Done</button></div>:<form className="staff-recovery-form" onSubmit={revokeStaffAuthenticator}>
 <p className="staff-helper">Confirm the staff member's identity before making security changes.</p>
 <div className="staff-choice-grid">
 <button type="button" className={"staff-choice "+(authResetMode==="unlock"?"selected":"")} aria-pressed={authResetMode==="unlock"} disabled={authResetBusy} onClick={()=>{setAuthResetMode("unlock");setAuthFeedback(null);}}><strong>Unlock sign-in</strong><small>Clear lock and temporary attempt limits. Keep existing Authenticator.</small></button>
 <button type="button" className={"staff-choice "+(authResetMode==="reenroll"?"selected":"")} aria-pressed={authResetMode==="reenroll"} disabled={authResetBusy} onClick={()=>{setAuthResetMode("reenroll");setAuthFeedback(null);}}><strong>Reset Authenticator</strong><small>Revoke old keys, backup codes and sessions. Require fresh phone verification and setup.</small></button>
 </div>
 <div className="staff-notice">{authResetMode==="reenroll"?"Confirm the registered phone can receive verification SMS before resetting. The old Authenticator will stop working.":"Previous sessions and pending sign-in requests are revoked. Existing Authenticator and backup codes are retained."} Staff permissions and business records are unchanged.</div>
 <div className="staff-field"><label htmlFor="staff-recovery-reason">Reason for recovery</label><textarea id="staff-recovery-reason" rows={2} value={authResetReason} onChange={e=>setAuthResetReason(e.target.value)} maxLength={500} disabled={authResetBusy} placeholder="E.g. Staff unable to complete sign-in" required /></div>
 <div className="staff-field"><label htmlFor="staff-recovery-code">Your System Administrator Authenticator code</label><input id="staff-recovery-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={authResetCode} onChange={e=>setAuthResetCode(e.target.value.replace(/\D/g,"").slice(0,6))} disabled={authResetBusy} placeholder="6-digit code" required /><small>Use a fresh code from your own Authenticator, not the staff member's.</small></div>
 {authFeedback?.kind==="error"&&<div className="staff-result error" role="alert"><strong>Recovery not confirmed</strong><p>{authFeedback.text}</p></div>}
 <div className="staff-dialog-actions"><button type="button" className="staff-button secondary" disabled={authResetBusy} onClick={closeSecurityRecovery}>Cancel</button><button type="submit" className="staff-button primary" disabled={authResetBusy}>{authResetBusy?"Processing…":authResetMode==="reenroll"?"Confirm Authenticator reset":"Confirm unlock"}</button></div>
 </form>}</StaffActionDialog>)}
      {resetPasswordForm.userId && (
        <StaffActionDialog title="Legacy password reset" subtitle={resetPasswordForm.fullName+" · @"+resetPasswordForm.username} busy={resettingPassword} onClose={closeResetPassword}>
          <div className="users-card-header">
            <h2>Unlock & Reset legacy password</h2>
            <p>
              Resetting the account for{" "}
              <strong>{resetPasswordForm.fullName}</strong> (
              {resetPasswordForm.username}). Existing sessions will be revoked.
            </p>
          </div>

          <div className="users-card-body">
            <form onSubmit={resetUserPassword}>
              <div className="users-form-grid">
                <div className="users-field">
                  <label>New Password</label>
                  <input
                    type="password"
                    name="password"
                    minLength={8}
                    value={resetPasswordForm.password}
                    onChange={handleResetPasswordChange}
                    placeholder="Enter new temporary password"
                  />
                </div>

                <div className="users-field">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    name="confirmPassword"
                    minLength={8}
                    value={resetPasswordForm.confirmPassword}
                    onChange={handleResetPasswordChange}
                    placeholder="Confirm new temporary password"
                  />
                </div>
              </div>

              <div className="users-actions-row" style={{ marginTop: "14px" }}>
                <button
                  type="submit"
                  className="users-primary-action"
                  disabled={resettingPassword}
                >
                  {resettingPassword ? "Resetting..." : "Reset Password"}
                </button>

                <button
                  type="button"
                  className="users-secondary-action"
                  onClick={closeResetPassword}
                >
                  Cancel
                </button>
              </div>
            </form>

            <div className="users-reset-warning">
              Only the original System Administrator may perform this action.
              The account lock is cleared, all previous sessions are revoked,
              and the user must change the temporary password immediately after
              login. Never send the temporary password by SMS.
            </div>
            {error&&<div className="staff-result error" role="alert">{error}</div>}
          </div>
        </StaffActionDialog>
      )}

      {activePanel==="users"&&<section className="users-card staff-directory">
 <div className="staff-directory-head"><div><small>PEOPLE & ACCESS</small><h2>Staff directory</h2><p>Review access and manage account security.</p></div><button type="button" className="staff-button secondary" onClick={()=>setActivePanel("create")}>+ Add staff</button></div>
 <div className="staff-toolbar"><label className="staff-search"><span>Search staff</span><input type="search" placeholder="Name, username, role or phone" value={staffSearch} onChange={e=>setStaffSearch(e.target.value)}/></label><div className="staff-filters" aria-label="Filter staff">{[["all","All staff"],["active","Active"],["security","Needs attention"],["disabled","Disabled"]].map(([key,label])=><button key={key} type="button" aria-pressed={staffFilter===key} onClick={()=>setStaffFilter(key)}>{label}</button>)}</div></div>
 <p className="staff-count">{visibleUsers.length} of {users.length} accounts</p>
 <div className="staff-directory-grid">{visibleUsers.length===0&&<div className="users-empty-state">No matching staff accounts.</div>}
 {visibleUsers.map(user=>{
 const roleInfo=getRoleCard(user.role),protectedAdmin=isOriginalSystemAdministrator(user),ownAccount=Number(user.id)===Number(currentUser?.id);
 const canRecover=canCurrentUserResetAccounts()&&!protectedAdmin&&!ownAccount&&String(user.role).toLowerCase()!=="admin"&&user.is_active;
 const canChangeRole=!protectedAdmin&&!ownAccount&&String(user.primary_workspace_code || "") === "spare_parts"&&String(user.category_assignment_status || "")==="assigned";
 const nextRole=String(roleDraftByUser[user.id]||user.role).toLowerCase(),roleChanged=nextRole!==String(user.role||"").toLowerCase(),isRoleSaving=Number(savingRoleUserId)===Number(user.id),expanded=expandedStaff===user.id;
 return <article key={user.id} className="staff-person-card">
 <div className="staff-person-top"><div className="staff-person-avatar">{getInitials(user.full_name||user.username)}</div><div className="staff-person-name"><h3>{user.full_name||user.username}</h3><span>@{user.username}</span></div><span className={"staff-pill "+(!user.is_active||user.is_login_locked?"attention":"good")}>{!user.is_active?"Disabled":user.is_login_locked?"Account Locked":"Active"}</span></div>
 <div className="staff-person-tags"><span className="staff-pill neutral">{roleInfo.title}</span><span className={"staff-pill "+(user.authenticator_active===true?"good":user.authenticator_active===false?"attention":"neutral")}>{user.authenticator_active===true?"Authenticator active":user.authenticator_active===false?"Setup required":"Authenticator status unavailable"}</span></div>
 <dl className="staff-person-info"><div><dt>Phone</dt><dd>{user.phone||"Not registered"}</dd></div><div><dt>Store access</dt><dd>{getAccessTypeText(user)} · {getUserBranchNames(user)}</dd></div><div><dt>Joined</dt><dd>{formatDate(user.created_at)}</dd></div><div><dt>Failed password attempts</dt><dd>{Number(user.failed_login_attempts||0)}</dd></div></dl>
 <div className="staff-person-actions">{canRecover?<button type="button" className="staff-button primary" onClick={()=>openSecurityRecovery(user)}>Security recovery</button>:protectedAdmin&&isOriginalSystemAdministrator(currentUser)?<a className="staff-button primary" href="/account-security">My Authenticator</a>:null}<button type="button" className="staff-button secondary" aria-expanded={expanded} onClick={()=>setExpandedStaff(expanded?null:user.id)}>{expanded?"Close actions":"Manage account"}</button></div>
 {expanded&&<div className="staff-expanded"><h4>Account diagnostics</h4><p>{!user.is_active?"Account disabled. Review the reason before restoring access.":user.is_login_locked?"Account locked. The System Administrator can review and unlock it.":user.authenticator_active===false?"No active Authenticator. Staff must complete registered-phone verification and setup.":user.authenticator_active===true?"Authenticator is enrolled. Temporary sign-in limits can still apply.":"Authenticator enrollment could not be checked."}</p>
 {user.security_last_reset_at&&<p>Last security recovery: {formatDate(user.security_last_reset_at)}</p>}
 {canChangeRole&&<div className="staff-role-editor"><label htmlFor={`role-for-user-${user.id}`}>Change Role</label><select id={`role-for-user-${user.id}`} value={nextRole} disabled={isRoleSaving} onChange={event=>setRoleDraftByUser(previous=>({...previous,[user.id]:event.target.value}))}>{Object.entries(roleCards).filter(([role])=>role!=="admin"||isOriginalSystemAdministrator(currentUser)||String(user.role).toLowerCase()==="admin").map(([role,card])=><option key={role} value={role}>{card.title}</option>)}</select><button type="button" className="staff-button secondary" disabled={!roleChanged||isRoleSaving} onClick={()=>changeUserRole(user)}>{isRoleSaving?"Updating…":"Save Role"}</button></div>}
 <div className="staff-management-actions">{canRecover&&<><button type="button" className="staff-button secondary" onClick={()=>openSecurityRecovery(user,"unlock")}>Unlock account</button><button type="button" className="staff-button secondary" onClick={()=>openSecurityRecovery(user,"reenroll")}>Reset Authenticator</button></>}
 {canCurrentUserResetAccounts()&&!protectedAdmin&&passwordlessMode===false&&<button type="button" className="staff-button secondary" onClick={()=>openResetPassword(user)}>Legacy password reset</button>}
 {!protectedAdmin&&<button type="button" className="staff-button secondary" disabled={staffStatusBusy!==null} onClick={()=>toggleUserStatus(user.id)}>{staffStatusBusy===user.id?"Updating…":user.is_active?"Temporarily disable":"Activate account"}</button>}
 {canSecurelyOffboardUser(user)&&<button type="button" className="staff-button danger" disabled={Number(offboardingUserId)===Number(user.id)} onClick={()=>secureOffboardUser(user)}>{Number(offboardingUserId)===Number(user.id)?"Offboarding…":"Secure Offboard"}</button>}</div>
 {protectedAdmin&&<small className="users-protected-note">Protected original administrator. Use personal security settings to replace your Authenticator.</small>}
 {passwordlessMode!==false&&<small className="staff-helper">Passwordless sign-in uses Authenticator recovery. Legacy password reset is hidden when enforcement is active or cannot be verified.</small>}
 </div>}</article>;
 })}</div></section>}
    </div>
  );
}
