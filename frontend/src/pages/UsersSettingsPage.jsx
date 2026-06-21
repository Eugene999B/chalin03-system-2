import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const emptyUserForm = {
  full_name: "",
  username: "",
  password: "",
  role: "cashier",
  phone: "",
};

export default function UsersSettingsPage() {
  const [users, setUsers] = useState([]);
  const [userForm, setUserForm] = useState(emptyUserForm);

  const [settings, setSettings] = useState({
    business_name: "",
    business_address: "",
    business_phone: "",
    owner_phone: "",
    tax_rate: 0,
    debt_reminder_days: 7,
    daily_summary_time: "18:00:00",
    receipt_footer: "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadUsers() {
    const response = await axiosClient.get("/users");
    setUsers(response.data.users || []);
  }

  async function loadSettings() {
    const response = await axiosClient.get("/settings");
    setSettings(response.data.settings);
  }

  async function loadPageData() {
    setError("");

    try {
      await Promise.all([loadUsers(), loadSettings()]);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load users and settings. Make sure you are logged in as admin."
      );
    }
  }

  useEffect(() => {
    loadPageData();
  }, []);

  function handleUserChange(event) {
    setUserForm({
      ...userForm,
      [event.target.name]: event.target.value,
    });
  }

  function handleSettingsChange(event) {
    setSettings({
      ...settings,
      [event.target.name]: event.target.value,
    });
  }

  async function createUser(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    try {
      await axiosClient.post("/users", userForm);

      setMessage("User created successfully.");
      setUserForm(emptyUserForm);
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
      setMessage("Settings updated successfully.");
    } catch (error) {
      setError(error.response?.data?.message || "Failed to update settings.");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users & Settings</h1>
          <p>Admin controls for staff accounts and system settings</p>
        </div>

        <button onClick={loadPageData}>Refresh</button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

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

          <button type="submit">Create User</button>
        </form>

        <form className="section-card" onSubmit={saveSettings}>
          <h2>System Settings</h2>

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

          <button type="submit">Save Settings</button>
        </form>
      </div>

      <div className="section-card">
        <h2>Staff Users</h2>

        {users.length === 0 ? (
          <p>No users found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Username</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Status</th>
                <th></th>
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
                    <button
                      type="button"
                      className={
                        user.is_active ? "small-danger" : "small-success"
                      }
                      onClick={() => toggleUserStatus(user.id)}
                    >
                      {user.is_active ? "Disable" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}