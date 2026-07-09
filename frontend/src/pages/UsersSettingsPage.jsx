import { useEffect, useState } from "react";
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
  if (Array.isArray(data?.branches)) {
    return data.branches;
  }

  if (Array.isArray(data?.stores)) {
    return data.stores;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

function formatBranchLabel(branch) {
  const code = getBranchCode(branch);
  const name = getBranchName(branch);
  const location = getBranchLocation(branch);

  return `${code ? `${code} - ` : ""}${name}${location ? ` (${location})` : ""}`;
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
    debt_reminder_days: 7,
    daily_summary_time: "18:00:00",
    receipt_footer: "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState("");

  const selectedBranchId = Number(
    currentUser?.branch_id || currentUser?.default_branch_id || 0
  );

  function isOriginalSystemAdministrator(user) {
    return (
      Number(user?.id) === SYSTEM_ADMIN_ID &&
      String(user?.username || "").toLowerCase() === SYSTEM_ADMIN_USERNAME &&
      String(user?.role || "").toLowerCase() === "admin"
    );
  }

  function canCurrentUserDeleteAccounts() {
    return isOriginalSystemAdministrator(currentUser);
  }

  function canDeleteThisUser(user) {
    if (!canCurrentUserDeleteAccounts()) {
      return false;
    }

    if (Number(user.id) === Number(currentUser?.id)) {
      return false;
    }

    if (isOriginalSystemAdministrator(user)) {
      return false;
    }

    return true;
  }

  function getCurrentStoreName() {
    return (
      currentUser?.branch_name ||
      currentUser?.branch?.name ||
      settings.branch_name ||
      "Selected Store"
    );
  }

  async function loadBranches() {
    const response = await axiosClient.get("/branches");
    const loadedBranches = normalizeBranches(response.data);

    setBranches(loadedBranches);

    setUserForm((previousForm) => {
      if (previousForm.branch_ids.length > 0) {
        return previousForm;
      }

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

  function openResetPassword(user) {
    setMessage("");
    setError("");

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
    if (user.can_access_all_branches) {
      return "All stores";
    }

    if (Array.isArray(user.branches) && user.branches.length > 0) {
      return user.branches.map((branch) => formatBranchLabel(branch)).join(", ");
    }

    if (user.default_branch_id) {
      const branch = branches.find(
        (item) => Number(getBranchId(item)) === Number(user.default_branch_id)
      );

      return branch ? formatBranchLabel(branch) : `Store ID ${user.default_branch_id}`;
    }

    return "-";
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
    } catch (error) {
      setError(error.response?.data?.message || "Failed to create user.");
    }
  }

  async function toggleUserStatus(userId) {
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.patch(
        `/users/${userId}/toggle-status`
      );

      setMessage(response.data.message);
      loadUsers();
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to change user status."
      );
    }
  }

  async function deleteUserAccount(user) {
    setMessage("");
    setError("");

    if (!canDeleteThisUser(user)) {
      setError(
        "Only the original System Administrator can delete other user accounts."
      );
      return;
    }

    const firstConfirm = window.confirm(
      `Are you sure you want to permanently delete this account?\n\nName: ${user.full_name}\nUsername: ${user.username}\nRole: ${user.role}`
    );

    if (!firstConfirm) {
      return;
    }

    const typedConfirm = window.prompt(
      `Type DELETE ${user.username} to confirm permanent deletion.`
    );

    if (typedConfirm !== `DELETE ${user.username}`) {
      setError("Delete cancelled. Confirmation text did not match.");
      return;
    }

    setDeletingUserId(user.id);

    try {
      const response = await axiosClient.delete(`/users/${user.id}`);

      setMessage(response.data.message || "User account deleted permanently.");
      await loadUsers();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to delete user.");
    } finally {
      setDeletingUserId("");
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

    if (resetPasswordForm.password.length < 6) {
      setError("New password must be at least 6 characters long.");
      return;
    }

    if (resetPasswordForm.password !== resetPasswordForm.confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }

    const confirmed = window.confirm(
      `Reset password for ${resetPasswordForm.fullName}?`
    );

    if (!confirmed) {
      return;
    }

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

  async function saveSettings(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    try {
      const response = await axiosClient.put("/settings", {
        ...settings,
        tax_rate: Number(settings.tax_rate || 0),
        debt_reminder_days: Number(settings.debt_reminder_days || 7),
      });

      setSettings(response.data.settings);
      setMessage(`Settings updated successfully for ${getCurrentStoreName()}.`);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to update settings.");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users & Settings</h1>
          <p>
            Admin controls for staff accounts and selected-store system settings
          </p>
        </div>

        <button onClick={loadPageData}>Refresh</button>
      </div>

      <div
        style={{
          marginBottom: "18px",
          padding: "14px",
          borderRadius: "14px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1e3a8a",
          fontWeight: "800",
        }}
      >
        Current selected store: {getCurrentStoreName()}
        {currentUser?.branch_location ? ` - ${currentUser.branch_location}` : ""}
        <br />
        <small>
          Settings below affect only the selected store. User accounts can be
          given access to one store or all stores.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      {canCurrentUserDeleteAccounts() && (
        <div
          style={{
            marginBottom: "18px",
            padding: "14px",
            borderRadius: "14px",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
            fontWeight: "800",
          }}
        >
          Original System Administrator mode is active. You can permanently
          delete other staff accounts, but you cannot delete your own original
          admin account.
        </div>
      )}

      <div className="two-column users-settings-grid">
        <form className="section-card" onSubmit={createUser}>
          <h2>Create Staff User</h2>

          <label>Full Name</label>
          <input
            name="full_name"
            value={userForm.full_name}
            onChange={handleUserChange}
            placeholder="Example: Kofi Mensah"
          />

          <label>Username</label>
          <input
            name="username"
            value={userForm.username}
            onChange={handleUserChange}
            placeholder="Example: kofi"
          />

          <label>Password</label>
          <input
            name="password"
            type="password"
            value={userForm.password}
            onChange={handleUserChange}
            placeholder="Minimum 6 characters"
          />

          <label>Role</label>
          <select name="role" value={userForm.role} onChange={handleUserChange}>
            <option value="cashier">Cashier</option>
            <option value="auditor">Auditor</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>

          <label>Phone</label>
          <input
            name="phone"
            value={userForm.phone}
            onChange={handleUserChange}
            placeholder="Example: 0240000000"
          />

          <div
            style={{
              marginTop: "12px",
              padding: "12px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontWeight: "800",
              }}
            >
              <input
                type="checkbox"
                name="can_access_all_branches"
                checked={Boolean(
                  userForm.can_access_all_branches || userForm.role === "admin"
                )}
                onChange={handleUserChange}
                disabled={userForm.role === "admin"}
              />
              Allow access to all stores
            </label>

            {userForm.role === "admin" && (
              <small style={{ display: "block", marginTop: "6px" }}>
                Admin users automatically get access to all stores.
              </small>
            )}

            {userForm.role === "auditor" && (
              <small style={{ display: "block", marginTop: "6px" }}>
                Auditor users can only access accounting, audit, reports,
                customer statements and export/report screens.
              </small>
            )}

            {!userForm.can_access_all_branches && userForm.role !== "admin" && (
              <div style={{ marginTop: "10px" }}>
                <label>Store Access</label>

                {branches.length === 0 ? (
                  <p>No stores found.</p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gap: "8px",
                      marginTop: "8px",
                    }}
                  >
                    {branches.map((branch) => {
                      const branchId = getBranchId(branch);

                      return (
                        <label
                          key={branchId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "8px",
                            borderRadius: "10px",
                            background: "#ffffff",
                            border: "1px solid #e5e7eb",
                            fontWeight: "700",
                          }}
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
                          {formatBranchLabel(branch)}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <button type="submit">Create User</button>
        </form>

        <form className="section-card" onSubmit={saveSettings}>
          <h2>Selected Store Settings</h2>

          <label>Store / Branch Name</label>
          <input
            name="branch_name"
            value={settings.branch_name || ""}
            onChange={handleSettingsChange}
            placeholder="Example: Chalin 03 Main Store"
          />

          <label>Business Name</label>
          <input
            name="business_name"
            value={settings.business_name || ""}
            onChange={handleSettingsChange}
          />

          <label>Business Address</label>
          <input
            name="business_address"
            value={settings.business_address || ""}
            onChange={handleSettingsChange}
          />

          <label>Business Phone</label>
          <input
            name="business_phone"
            value={settings.business_phone || ""}
            onChange={handleSettingsChange}
          />

          <label>Owner Phone</label>
          <input
            name="owner_phone"
            value={settings.owner_phone || ""}
            onChange={handleSettingsChange}
          />

          <label>Receipt Prefix</label>
          <input
            name="receipt_prefix"
            value={settings.receipt_prefix || ""}
            onChange={handleSettingsChange}
            placeholder="Example: CHL-MAIN"
          />

          <label>Tax Rate (%)</label>
          <input
            type="number"
            name="tax_rate"
            value={settings.tax_rate || 0}
            onChange={handleSettingsChange}
          />

          <label>Debt Reminder Days</label>
          <input
            type="number"
            name="debt_reminder_days"
            value={settings.debt_reminder_days || 7}
            onChange={handleSettingsChange}
          />

          <label>Daily Summary Time</label>
          <input
            type="time"
            name="daily_summary_time"
            value={String(settings.daily_summary_time || "18:00:00").slice(
              0,
              5
            )}
            onChange={handleSettingsChange}
          />

          <label>Receipt Footer</label>
          <textarea
            name="receipt_footer"
            value={settings.receipt_footer || ""}
            onChange={handleSettingsChange}
          />

          <button type="submit">Save Store Settings</button>
        </form>
      </div>

      {resetPasswordForm.userId && (
        <div
          className="section-card"
          style={{
            border: "2px solid #2563eb",
            marginBottom: "20px",
          }}
        >
          <h2>Reset User Password</h2>

          <p>
            Resetting password for:{" "}
            <strong>{resetPasswordForm.fullName}</strong> (
            {resetPasswordForm.username})
          </p>

          <form onSubmit={resetUserPassword}>
            <label>New Password</label>
            <input
              type="password"
              name="password"
              value={resetPasswordForm.password}
              onChange={handleResetPasswordChange}
              placeholder="Enter new temporary password"
            />

            <label>Confirm New Password</label>
            <input
              type="password"
              name="confirmPassword"
              value={resetPasswordForm.confirmPassword}
              onChange={handleResetPasswordChange}
              placeholder="Confirm new temporary password"
            />

            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                marginTop: "12px",
              }}
            >
              <button type="submit" disabled={resettingPassword}>
                {resettingPassword ? "Resetting..." : "Reset Password"}
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={closeResetPassword}
              >
                Cancel
              </button>
            </div>
          </form>

          <div
            style={{
              marginTop: "14px",
              padding: "12px",
              borderRadius: "10px",
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              color: "#9a3412",
            }}
          >
            After resetting, give the user this temporary password. Tell the
            user to login and use <strong>Change Password</strong> immediately.
          </div>
        </div>
      )}

      <div className="section-card">
        <h2>Staff Users</h2>

        {users.length === 0 ? (
          <p>No users found.</p>
        ) : (
          <div style={{ width: "100%", overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Store Access</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.full_name}</strong>
                    </td>
                    <td>{user.username}</td>
                    <td>{user.role}</td>
                    <td>{getUserBranchNames(user)}</td>
                    <td>{user.phone || "-"}</td>
                    <td>
                      <span
                        className={
                          user.is_active ? "status-active" : "status-disabled"
                        }
                      >
                        {user.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => openResetPassword(user)}
                        >
                          Reset Password
                        </button>

                        <button
                          type="button"
                          className={
                            user.is_active ? "small-danger" : "small-success"
                          }
                          onClick={() => toggleUserStatus(user.id)}
                          disabled={isOriginalSystemAdministrator(user)}
                          title={
                            isOriginalSystemAdministrator(user)
                              ? "Original System Administrator cannot be disabled."
                              : ""
                          }
                        >
                          {user.is_active ? "Disable" : "Activate"}
                        </button>

                        {canDeleteThisUser(user) && (
                          <button
                            type="button"
                            className="small-danger"
                            onClick={() => deleteUserAccount(user)}
                            disabled={Number(deletingUserId) === Number(user.id)}
                            style={{
                              background: "#7f1d1d",
                              color: "#ffffff",
                            }}
                          >
                            {Number(deletingUserId) === Number(user.id)
                              ? "Deleting..."
                              : "Delete Account"}
                          </button>
                        )}
                      </div>

                      {isOriginalSystemAdministrator(user) && (
                        <small
                          style={{
                            display: "block",
                            marginTop: "6px",
                            color: "#64748b",
                            fontWeight: "700",
                          }}
                        >
                          Protected original admin account
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
