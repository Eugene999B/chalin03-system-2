import {
  useEffect,
  useMemo,
  useState,
} from "react";
import axiosClient from "../api/axiosClient";
import {
  useAuth,
} from "../context/AuthContext";
import ExpandedWorkerProfilePage from "./ExpandedWorkerProfilePage";
import "../styles/release2Final.css";

const today = new Date()
  .toISOString()
  .slice(0, 10);

const monthStart =
  `${today.slice(0, 7)}-01`;

function formatNumber(value) {
  return Number(
    value || 0
  ).toLocaleString(
    "en-GH"
  );
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(
    value
  );

  return Number.isNaN(
    date.getTime()
  )
    ? String(value)
    : date.toLocaleString(
        "en-GB"
      );
}

function humanizeCode(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function workspaceLabel(value) {
  const code = String(value || "").toLowerCase();

  if (code === "spare_parts") return "Spare Parts";
  if (code === "mining") return "Mining Operations";
  if (code === "equipment_hire") return "Equipment Hire";

  return humanizeCode(value);
}

function sessionStatus(item) {
  if (!item?.revoked_at) {
    return {
      code: "active",
      label: "Active",
      tone: "success",
    };
  }

  const reason = String(item.revocation_reason || "revoked");

  if (reason === "replaced_by_new_login") {
    return {
      code: reason,
      label: "Replaced by new login",
      tone: "warning",
    };
  }

  if (reason === "logout") {
    return {
      code: reason,
      label: "Logged out",
      tone: "neutral",
    };
  }

  return {
    code: reason,
    label: humanizeCode(reason),
    tone: "danger",
  };
}

function filenameFromHeaders(
  headers
) {
  const disposition =
    headers?.[
      "content-disposition"
    ] || "";

  const match =
    disposition.match(
      /filename="?([^";]+)"?/i
    );

  return (
    match?.[1] ||
    `chalin03-professional-backup-${Date.now()}.json`
  );
}

function Metric({
  label,
  value,
  note,
}) {
  return (
    <article className="r2-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Alert({
  type,
  children,
}) {
  return (
    <div
      className={`r2-alert ${type}`}
    >
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

  async function unlock(
    event
  ) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response =
        await axiosClient.post(
          "/release2-final/security/unlock",
          {
            password,
          }
        );

      setPassword("");

      onToken({
        value:
          response.data
            .protected_action_token,
        expiresAt:
          Date.now() +
          Number(
            response.data
              .expires_in_minutes ||
              10
          ) *
            60 *
            1000,
      });
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Protected Action Unlock failed."
      );
    } finally {
      setLoading(false);
    }
  }

  const active =
    token?.value &&
    token.expiresAt >
      Date.now();

  return (
    <section className="r2-card">
      <h2>
        Protected Action Unlock
      </h2>

      <p>
        Sensitive actions require your
        current password. No OTP is used.
        The server creates a short security
        window.
      </p>

      {active ? (
        <Alert type="success">
          Protected actions are unlocked
          for this page session.
        </Alert>
      ) : (
        <form
          className="r2-inline-form"
          onSubmit={unlock}
        >
          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(
                event.target.value
              )
            }
            placeholder="Current password"
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Unlocking..."
              : "Unlock Protected Actions"}
          </button>
        </form>
      )}

      {error ? (
        <Alert type="error">
          {error}
        </Alert>
      ) : null}
    </section>
  );
}

function SecurityCentre() {
  const {
    user,
  } = useAuth();

  const [data, setData] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [token, setToken] =
    useState(null);

  const [ownerForm, setOwnerForm] =
    useState({
      username: "",
      phone: "",
      password: "",
      confirm_password: "",
    });

  const [
    mfaEnrollment,
    setMfaEnrollment,
  ] = useState(null);

  const [mfaCode, setMfaCode] =
    useState("");

  const [
    recoveryCodes,
    setRecoveryCodes,
  ] = useState([]);

  const originalAdmin =
    Number(user?.id) === 1 &&
    String(
      user?.username || ""
    ).toLowerCase() ===
      "admin" &&
    String(
      user?.role || ""
    ).toLowerCase() ===
      "admin";

  function protectedTokenReady() {
    return Boolean(
      token?.value &&
        token.expiresAt >
          Date.now()
    );
  }

  function requireProtectedToken(
    actionDescription
  ) {
    if (
      protectedTokenReady()
    ) {
      return true;
    }

    setError(
      "Unlock protected actions before " +
        actionDescription +
        "."
    );

    return false;
  }

  async function load() {
    setLoading(true);
    setError("");

    try {
      const [
        overviewResponse,
        ownerResponse,
        historyResponse,
      ] = await Promise.all([
        axiosClient.get(
          "/release2-final/security/overview"
        ),
        axiosClient.get(
          "/release2-final/security/owner-readiness"
        ),
        axiosClient.get(
          "/release2-final/security/owner-login-history"
        ),
      ]);

      setData({
        ...overviewResponse.data,
        break_glass:
          ownerResponse.data
            .owner ||
          overviewResponse.data
            .break_glass,
        owner_security_readiness:
          ownerResponse.data
            .readiness,
        owner_login_history:
          historyResponse.data
            .login_history ||
          [],
      });
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Security Centre could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function verifyLedger() {
    setMessage("");
    setError("");

    try {
      const response =
        await axiosClient.get(
          "/release2-final/security/ledger/verify"
        );

      setMessage(
        response.data
          .verification
          .reason
      );

      await load();
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.verification
          ?.reason ||
        requestError.response
          ?.data?.message ||
        "Privileged ledger verification failed."
      );
    }
  }

  async function setupOwner(
    event
  ) {
    event.preventDefault();
    setError("");
    setMessage("");
    setRecoveryCodes([]);

    if (
      !requireProtectedToken(
        "configuring Owner Break-Glass"
      )
    ) {
      return;
    }

    if (
      ownerForm.password !==
      ownerForm
        .confirm_password
    ) {
      setError(
        "Owner password confirmation does not match."
      );
      return;
    }

    try {
      const response =
        await axiosClient.post(
          "/release2-final/security/break-glass/setup",
          ownerForm,
          {
            headers: {
              "X-Protected-Action-Token":
                token.value,
            },
          }
        );

      setMessage(
        response.data.message
      );

      setOwnerForm({
        username: "",
        phone: "",
        password: "",
        confirm_password: "",
      });

      setMfaEnrollment(null);
      setMfaCode("");

      await load();
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
        "Owner Break-Glass configuration failed."
      );
    }
  }

  async function startOwnerMfa() {
    setError("");
    setMessage("");
    setRecoveryCodes([]);

    if (
      !requireProtectedToken(
        "starting Owner MFA enrolment"
      )
    ) {
      return;
    }

    try {
      const response =
        await axiosClient.post(
          "/release2-final/security/break-glass/mfa/start",
          {},
          {
            headers: {
              "X-Protected-Action-Token":
                token.value,
            },
          }
        );

      setMfaEnrollment({
        token:
          response.data
            .enrollment_token,
        manualSecret:
          response.data
            .manual_secret,
        otpAuthUri:
          response.data
            .otpauth_uri,
        ownerUsername:
          response.data
            .owner_username,
        expiresInMinutes:
          response.data
            .expires_in_minutes,
      });

      setMfaCode("");

      setMessage(
        response.data.message
      );
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
        "Owner MFA enrolment could not be started."
      );
    }
  }

  async function confirmOwnerMfa(
    event
  ) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (
      !requireProtectedToken(
        "confirming Owner MFA"
      )
    ) {
      return;
    }

    if (
      !mfaEnrollment?.token
    ) {
      setError(
        "Start Owner MFA enrolment first."
      );
      return;
    }

    if (
      !/^\d{6}$/.test(
        mfaCode
      )
    ) {
      setError(
        "Enter the current 6-digit authenticator code."
      );
      return;
    }

    try {
      const response =
        await axiosClient.post(
          "/release2-final/security/break-glass/mfa/confirm",
          {
            enrollment_token:
              mfaEnrollment.token,
            mfa_code:
              mfaCode,
          },
          {
            headers: {
              "X-Protected-Action-Token":
                token.value,
            },
          }
        );

      setRecoveryCodes(
        response.data
          .recovery_codes ||
        []
      );

      setMfaEnrollment(null);
      setMfaCode("");

      setMessage(
        response.data.message
      );

      await load();
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
        "Owner MFA confirmation failed."
      );
    }
  }

  async function rotateRecoveryCodes() {
    setError("");
    setMessage("");

    if (
      !requireProtectedToken(
        "rotating recovery codes"
      )
    ) {
      return;
    }

    const approved =
      window.confirm(
        "Generate new Owner recovery codes? All previous unused codes will become invalid."
      );

    if (!approved) {
      return;
    }

    try {
      const response =
        await axiosClient.post(
          "/release2-final/security/break-glass/recovery-codes/rotate",
          {},
          {
            headers: {
              "X-Protected-Action-Token":
                token.value,
            },
          }
        );

      setRecoveryCodes(
        response.data
          .recovery_codes ||
        []
      );

      setMessage(
        response.data.message
      );

      await load();
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
        "Recovery-code rotation failed."
      );
    }
  }

  function downloadRecoveryCodes() {
    if (!recoveryCodes.length) {
      return;
    }

    const content = [
      "CHALIN 03 OWNER BREAK-GLASS RECOVERY CODES",
      "Store securely outside the ordinary system.",
      "Each code works only once.",
      "",
      ...recoveryCodes,
    ].join("\n");

    const blob =
      new Blob(
        [content],
        {
          type:
            "text/plain;charset=utf-8",
        }
      );

    const url =
      window.URL
        .createObjectURL(
          blob
        );

    const link =
      document.createElement(
        "a"
      );

    link.href = url;
    link.download =
      "chalin03-owner-recovery-codes.txt";

    document.body.appendChild(
      link
    );

    link.click();
    link.remove();

    window.URL
      .revokeObjectURL(
        url
      );
  }

  if (loading) {
    return (
      <div className="r2-loading">
        Loading Security Centre...
      </div>
    );
  }

  const readiness =
    data
      ?.owner_security_readiness;

  const owner =
    data?.break_glass;

  return (
    <div className="r2-page">
      <header className="r2-hero">
        <p>
          Group Security
        </p>

        <h1>
          Security Centre
        </h1>

        <span>
          Sessions, account locks,
          Owner MFA, recovery evidence,
          security SMS and tamper-evident
          privileged actions.
        </span>
      </header>

      {error ? (
        <Alert type="error">
          {error}
        </Alert>
      ) : null}

      {message ? (
        <Alert type="success">
          {message}
        </Alert>
      ) : null}

      <div className="r2-metric-grid">
        <Metric
          label="Active sessions"
          value={formatNumber(
            data?.sessions
              ?.active_sessions
          )}
          note="Current server-side sessions"
        />

        <Metric
          label="Locked accounts"
          value={formatNumber(
            data?.accounts
              ?.locked_accounts
          )}
          note="Require approved recovery"
        />

        <Metric
          label="OTP recoveries"
          value={formatNumber(
            data?.recovery
              ?.completed_otp_recoveries
          )}
          note="Completed SMS recovery"
        />

        <Metric
          label="Failed security SMS"
          value={formatNumber(
            data?.security_sms
              ?.failed_security_sms
          )}
          note="Delivery needs review"
        />

        <Metric
          label="Privileged events"
          value={formatNumber(
            data
              ?.privileged_ledger
              ?.checked_events
          )}
          note={
            data
              ?.privileged_ledger
              ?.valid
              ? "Ledger chain intact"
              : "Ledger verification failed"
          }
        />

        <Metric
          label="Owner protection"
          value={
            readiness?.label ||
            "Not configured"
          }
          note={
            readiness?.detail ||
            "Separate owner emergency recovery"
          }
        />

        <Metric
          label="Unused recovery codes"
          value={formatNumber(
            readiness
              ?.unused_recovery_codes
          )}
          note="One-time emergency codes"
        />
      </div>

      <ProtectedUnlock
        token={token}
        onToken={setToken}
      />

      {originalAdmin ? (
        <>
          <section className="r2-card">
            <h2>
              Owner Break-Glass Setup
            </h2>

            <p>
              Configure a separate owner
              credential. Rotating the
              credential disables its previous
              MFA setup and invalidates previous
              recovery codes.
            </p>

            <form
              className="r2-form-grid"
              onSubmit={setupOwner}
            >
              <label>
                Separate owner username
                <input
                  value={
                    ownerForm.username
                  }
                  onChange={(event) =>
                    setOwnerForm(
                      (current) => ({
                        ...current,
                        username:
                          event.target
                            .value,
                      })
                    )
                  }
                  required
                />
              </label>

              <label>
                Owner recovery phone
                <input
                  value={
                    ownerForm.phone
                  }
                  onChange={(event) =>
                    setOwnerForm(
                      (current) => ({
                        ...current,
                        phone:
                          event.target
                            .value,
                      })
                    )
                  }
                  required
                />
              </label>

              <label>
                Owner password
                <input
                  type="password"
                  minLength={8}
                  value={
                    ownerForm.password
                  }
                  onChange={(event) =>
                    setOwnerForm(
                      (current) => ({
                        ...current,
                        password:
                          event.target
                            .value,
                      })
                    )
                  }
                  autoComplete="new-password"
                  required
                />
              </label>

              <label>
                Confirm owner password
                <input
                  type="password"
                  minLength={8}
                  value={
                    ownerForm
                      .confirm_password
                  }
                  onChange={(event) =>
                    setOwnerForm(
                      (current) => ({
                        ...current,
                        confirm_password:
                          event.target
                            .value,
                      })
                    )
                  }
                  autoComplete="new-password"
                  required
                />
              </label>

              <button type="submit">
                Configure / Rotate Break-Glass
              </button>
            </form>

            <small>
              Emergency page:
              /owner-recovery. It is
              intentionally absent from
              ordinary staff navigation.
            </small>
          </section>

          <section className="r2-card">
            <div className="r2-card-heading">
              <div>
                <h2>
                  Authenticator MFA Enrollment
                </h2>

                <p>
                  Owner emergency login requires
                  the owner password and either
                  a current authenticator code
                  or one unused recovery code.
                </p>
              </div>
            </div>

            <Alert
              type={
                readiness
                  ?.fully_protected
                  ? "success"
                  : "warning"
              }
            >
              {readiness?.detail ||
                "Configure Owner Break-Glass first."}
            </Alert>

            {owner?.id ? (
              <div
                className="r2-inline-form"
                style={{
                  marginTop: "14px",
                }}
              >
                <button
                  type="button"
                  onClick={startOwnerMfa}
                >
                  {owner?.mfa_enabled
                    ? "Restart Authenticator Enrollment"
                    : "Start Authenticator Enrollment"}
                </button>

                {owner?.mfa_enabled ? (
                  <button
                    type="button"
                    onClick={
                      rotateRecoveryCodes
                    }
                  >
                    Rotate Recovery Codes
                  </button>
                ) : null}
              </div>
            ) : (
              <Alert type="warning">
                Configure the separate Owner
                Break-Glass account first.
              </Alert>
            )}

            {mfaEnrollment ? (
              <div
                className="r2-card"
                style={{
                  marginTop: "16px",
                }}
              >
                <h3>
                  Add account to authenticator
                </h3>

                <p>
                  Add this account in Google
                  Authenticator, Microsoft
                  Authenticator, Authy or another
                  standards-compatible TOTP app.
                  This enrolment expires in{" "}
                  {
                    mfaEnrollment
                      .expiresInMinutes
                  }{" "}
                  minutes.
                </p>

                <label>
                  Account
                  <input
                    readOnly
                    value={
                      mfaEnrollment
                        .ownerUsername ||
                      ""
                    }
                  />
                </label>

                <label>
                  Manual setup secret
                  <input
                    readOnly
                    value={
                      mfaEnrollment
                        .manualSecret ||
                      ""
                    }
                    style={{
                      fontFamily:
                        "monospace",
                    }}
                  />
                </label>

                <label>
                  Authenticator setup URI
                  <textarea
                    readOnly
                    rows={4}
                    value={
                      mfaEnrollment
                        .otpAuthUri ||
                      ""
                    }
                    style={{
                      width: "100%",
                      fontFamily:
                        "monospace",
                    }}
                  />
                </label>

                <form
                  className="r2-inline-form"
                  onSubmit={
                    confirmOwnerMfa
                  }
                >
                  <input
                    value={mfaCode}
                    onChange={(event) =>
                      setMfaCode(
                        event.target
                          .value
                          .replace(
                            /\D/g,
                            ""
                          )
                          .slice(0, 6)
                      )
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="Current 6-digit code"
                    maxLength={6}
                    required
                  />

                  <button type="submit">
                    Confirm and Enable MFA
                  </button>
                </form>
              </div>
            ) : null}

            {recoveryCodes.length ? (
              <div
                className="r2-card"
                style={{
                  marginTop: "16px",
                }}
              >
                <h3>
                  Save Recovery Codes Now
                </h3>

                <Alert type="warning">
                  These one-time codes will not
                  be displayed again after this
                  page is closed. Store them
                  securely outside the ordinary
                  system.
                </Alert>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "8px",
                    margin:
                      "14px 0",
                  }}
                >
                  {recoveryCodes.map(
                    (code) => (
                      <code
                        key={code}
                        style={{
                          padding:
                            "10px",
                          border:
                            "1px solid rgba(127, 127, 127, 0.35)",
                          borderRadius:
                            "8px",
                          textAlign:
                            "center",
                        }}
                      >
                        {code}
                      </code>
                    )
                  )}
                </div>

                <button
                  type="button"
                  onClick={
                    downloadRecoveryCodes
                  }
                >
                  Download Recovery Codes
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <section className="r2-card">
        <div className="r2-card-heading">
          <div>
            <h2>
              Privileged Action Ledger
            </h2>

            <p>
              Each event is linked to the
              previous SHA-256 event hash.
            </p>
          </div>

          <button
            type="button"
            onClick={verifyLedger}
          >
            Verify Ledger Chain
          </button>
        </div>

        <div className="r2-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Outcome</th>
                <th>Hash</th>
              </tr>
            </thead>

            <tbody>
              {(
                data
                  ?.recent_privileged_actions ||
                []
              ).map(
                (item) => (
                  <tr key={item.id}>
                    <td>
                      {formatDate(
                        item.created_at
                      )}
                    </td>

                    <td>
                      {
                        item.action_code
                      }
                    </td>

                    <td>
                      {item.outcome}
                    </td>

                    <td className="r2-hash">
                      {
                        item.event_hash
                      }
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="r2-card">
        <h2>
          Owner Login History
        </h2>

        <p>
          Dedicated emergency-login evidence,
          including outcome, factor method,
          network address and device information.
          Passwords and codes are never recorded.
        </p>

        <div className="r2-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Username attempted</th>
                <th>Outcome</th>
                <th>Second factor</th>
                <th>Reason</th>
                <th>Device evidence</th>
              </tr>
            </thead>

            <tbody>
              {(
                data
                  ?.owner_login_history ||
                []
              ).map(
                (item) => (
                  <tr key={item.id}>
                    <td>
                      {formatDate(
                        item.created_at
                      )}
                    </td>

                    <td>
                      {item
                        .username_attempted ||
                        "-"}
                    </td>

                    <td>
                      {item.outcome}
                    </td>

                    <td>
                      {item
                        .mfa_method ||
                        "-"}
                    </td>

                    <td>
                      {item
                        .failure_reason ||
                        "-"}
                    </td>

                    <td>
                      <small>
                        {item
                          .ip_address ||
                          "-"}
                        <br />
                        {item
                          .user_agent ||
                          "-"}
                      </small>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="r2-card r2-session-card">
        <div className="r2-card-heading">
          <div>
            <h2>Recent Sessions</h2>
            <p>
              Human-readable device, login method and location evidence. Precise
              coordinates appear only when the user allowed browser location
              access.
            </p>
          </div>

          <span className="r2-session-count">
            {(data?.recent_sessions || []).length} recent
          </span>
        </div>

        <div className="r2-table-wrap r2-session-table-wrap">
          <table className="r2-session-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Workspace & login</th>
                <th>Session time</th>
                <th>Status</th>
                <th>Device</th>
                <th>Location</th>
                <th>Network</th>
              </tr>
            </thead>

            <tbody>
              {(data?.recent_sessions || []).map((item) => {
                const status = sessionStatus(item);

                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.full_name || item.username}</strong>
                      <small>@{item.username}</small>
                    </td>

                    <td>
                      <strong>{workspaceLabel(item.workspace_code)}</strong>
                      <small>
                        {humanizeCode(item.login_method || "username")} login
                      </small>
                    </td>

                    <td>
                      <strong>{formatDate(item.created_at)}</strong>
                      <small>Last seen {formatDate(item.last_seen_at)}</small>
                    </td>

                    <td>
                      <span className={`r2-session-status is-${status.tone}`}>
                        {status.label}
                      </span>
                    </td>

                    <td className="r2-session-device">
                      <strong>{item.device_summary || "Unknown device"}</strong>
                      <small>
                        {item.os_summary || "Unknown OS"} ·{" "}
                        {item.browser_summary || "Unknown browser"}
                      </small>
                      <small>
                        {item.screen_summary
                          ? `Screen ${item.screen_summary}`
                          : "Screen not reported"}
                        {item.pwa_mode ? " · Installed app" : " · Web browser"}
                      </small>
                    </td>

                    <td className="r2-session-location">
                      <strong>{item.location_summary || "Not available"}</strong>
                      <small>
                        {humanizeCode(item.location_source || "network_only")}
                      </small>
                      {item.precise_location?.map_url ? (
                        <a
                          href={item.precise_location.map_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open exact point on map
                        </a>
                      ) : null}
                    </td>

                    <td>
                      <strong>{item.ip_address || "Not reported"}</strong>
                      <small>
                        {item.network_country
                          ? `Country ${item.network_country}`
                          : "Country unavailable"}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(data?.recent_sessions || []).length === 0 ? (
          <div className="r2-session-empty">No session evidence is available.</div>
        ) : null}
      </section>

      <section className="r2-card">
        <h2>
          Recent Security Events
        </h2>

        <div className="r2-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Event</th>
                <th>Severity</th>
              </tr>
            </thead>

            <tbody>
              {(
                data
                  ?.recent_security_events ||
                []
              ).map(
                (item) => (
                  <tr key={item.id}>
                    <td>
                      {formatDate(
                        item.created_at
                      )}
                    </td>

                    <td>
                      {item.full_name ||
                        item.username ||
                        "System"}
                    </td>

                    <td>
                      <strong>
                        {item.action}
                      </strong>

                      <small>
                        {item.details}
                      </small>
                    </td>

                    <td>
                      {item.severity}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ProfessionalBackups() {
  const [token, setToken] =
    useState(null);

  const [history, setHistory] =
    useState([]);

  const [filters, setFilters] =
    useState({
      scope: "full_system",
      category: "all",
      from: "",
      to: "",
    });

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const [verification, setVerification] =
    useState(null);

  async function loadHistory() {
    try {
      const response =
        await axiosClient.get(
          "/release2-final/backups/history"
        );

      setHistory(
        response.data.backups ||
          []
      );
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Backup history could not be loaded."
      );
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function download() {
    setMessage("");
    setError("");

    if (
      !token?.value ||
      token.expiresAt <=
        Date.now()
    ) {
      setError(
        "Unlock protected actions before creating a professional backup."
      );
      return;
    }

    if (
      Boolean(filters.from) !==
      Boolean(filters.to)
    ) {
      setError(
        "Choose both date fields or leave both empty."
      );
      return;
    }

    setLoading(true);

    try {
      const response =
        await axiosClient.get(
          "/release2-final/backups/download",
          {
            params: filters,
            responseType:
              "blob",
            headers: {
              "X-Protected-Action-Token":
                token.value,
            },
          }
        );

      const url =
        window.URL.createObjectURL(
          response.data
        );

      const link =
        document.createElement(
          "a"
        );

      link.href = url;
      link.download =
        filenameFromHeaders(
          response.headers
        );

      document.body.appendChild(
        link
      );

      link.click();
      link.remove();

      window.URL.revokeObjectURL(
        url
      );

      setMessage(
        "Professional backup created and downloaded. Keep it private and verify it before relying on it."
      );

      await loadHistory();
    } catch (requestError) {
      let backendMessage = "";

      try {
        if (
          requestError.response
            ?.data instanceof Blob
        ) {
          const text =
            await requestError.response.data.text();

          backendMessage =
            JSON.parse(text)
              .message;
        }
      } catch {
        backendMessage = "";
      }

      setError(
        backendMessage ||
          requestError.response
            ?.data?.message ||
          "Professional backup failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyFile(
    event
  ) {
    const file =
      event.target.files?.[0];

    setVerification(null);
    setError("");
    setMessage("");

    if (!file) return;

    try {
      const backup =
        JSON.parse(
          await file.text()
        );

      const response =
        await axiosClient.post(
          "/release2-final/backups/verify",
          {
            backup,
          }
        );

      setVerification(
        response.data
          .verification
      );

      setMessage(
        "Backup verification completed successfully."
      );

      await loadHistory();
    } catch (requestError) {
      setVerification(
        requestError.response
          ?.data?.verification ||
          null
      );

      setError(
        requestError.response
          ?.data?.message ||
          "Backup verification failed."
      );
    } finally {
      event.target.value =
        "";
    }
  }

  return (
    <div className="r2-page">
      <header className="r2-hero">
        <p>
          Release 2C
        </p>

        <h1>
          Professional Backup Centre
        </h1>

        <span>
          Full-system and module packages
          with manifests, schema version,
          record counts and SHA-256
          verification.
        </span>
      </header>

      {error ? (
        <Alert type="error">
          {error}
        </Alert>
      ) : null}

      {message ? (
        <Alert type="success">
          {message}
        </Alert>
      ) : null}

      <Alert type="warning">
        Release 2 Final does not perform an
        automatic selective production
        restore or merge. Backup packages are
        created and verified only.
      </Alert>

      <ProtectedUnlock
        token={token}
        onToken={setToken}
      />

      <section className="r2-card">
        <h2>
          Create Professional Backup
        </h2>

        <div className="r2-form-grid">
          <label>
            Scope
            <select
              value={
                filters.scope
              }
              onChange={(event) =>
                setFilters(
                  (current) => ({
                    ...current,
                    scope:
                      event.target
                        .value,
                  })
                )
              }
            >
              <option value="full_system">
                Full System
              </option>

              <option value="spare_parts">
                Spare Parts
              </option>

              <option value="mining">
                Mining Operations
              </option>

              <option value="equipment_hire">
                Equipment Hire
              </option>

              <option value="shared_fleet">
                Shared Fleet
              </option>
            </select>
          </label>

          <label>
            Category
            <select
              value={
                filters.category
              }
              onChange={(event) =>
                setFilters(
                  (current) => ({
                    ...current,
                    category:
                      event.target
                        .value,
                  })
                )
              }
            >
              <option value="all">
                All Categories
              </option>

              <option value="operations">
                Operations
              </option>

              <option value="financial">
                Financial
              </option>

              <option value="security">
                Security
              </option>

              <option value="workforce">
                Workforce
              </option>
            </select>
          </label>

          <label>
            Date from — optional
            <input
              type="date"
              value={
                filters.from
              }
              onChange={(event) =>
                setFilters(
                  (current) => ({
                    ...current,
                    from:
                      event.target
                        .value,
                  })
                )
              }
            />
          </label>

          <label>
            Date to — optional
            <input
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters(
                  (current) => ({
                    ...current,
                    to:
                      event.target
                        .value,
                  })
                )
              }
            />
          </label>
        </div>

        <button
          type="button"
          onClick={download}
          disabled={loading}
        >
          {loading
            ? "Building Verified Package..."
            : "Create & Download Backup"}
        </button>
      </section>

      <section className="r2-card">
        <h2>
          Verify Existing Package
        </h2>

        <p>
          Select a Chalin 03 professional
          backup JSON file. Every table
          checksum and the complete package
          checksum will be recalculated.
        </p>

        <input
          type="file"
          accept=".json,application/json"
          onChange={verifyFile}
        />

        {verification ? (
          <pre className="r2-code">
            {JSON.stringify(
              verification,
              null,
              2
            )}
          </pre>
        ) : null}
      </section>

      <section className="r2-card">
        <h2>
          Backup History
        </h2>

        <div className="r2-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Scope</th>
                <th>Category</th>
                <th>Tables</th>
                <th>Records</th>
                <th>Status</th>
                <th>Verification</th>
              </tr>
            </thead>

            <tbody>
              {history.map(
                (item) => (
                  <tr
                    key={item.id}
                  >
                    <td>
                      {formatDate(
                        item.created_at
                      )}
                    </td>

                    <td>
                      {
                        item.scope_code
                      }
                    </td>

                    <td>
                      {
                        item.category_code
                      }
                    </td>

                    <td>
                      {formatNumber(
                        item.included_table_count
                      )}
                    </td>

                    <td>
                      {formatNumber(
                        item.total_record_count
                      )}
                    </td>

                    <td>
                      {item.status}
                    </td>

                    <td>
                      {
                        item.verification_status
                      }
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const emptyWorkerForm = {
  employee_number: "",
  user_id: "",
  full_name: "",
  phone: "",
  email: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  job_title: "",
  department: "",
  employment_type: "permanent",
  employment_start_date:
    today,
  notes: "",
};

function WorkerManagement() {
  const auth = useAuth();

  const canManage =
    auth.hasPermission(
      "workers.manage"
    );

  const canManageDocuments =
    auth.hasPermission(
      "workers.documents.manage"
    );

  const canDeactivate =
    auth.hasPermission(
      "workers.deactivate"
    );

  const [workers, setWorkers] =
    useState([]);

  const [selectedId, setSelectedId] =
    useState(null);

  const [detail, setDetail] =
    useState(null);

  const [search, setSearch] =
    useState("");

  const [workerForm, setWorkerForm] =
    useState(
      emptyWorkerForm
    );

  const [assignmentForm, setAssignmentForm] =
    useState({
      workspace_code:
        "spare_parts",
      role_code: "",
      context_type: "",
      context_id: "",
      context_label: "",
      assignment_start:
        today,
      notes: "",
    });

  const [documentForm, setDocumentForm] =
    useState({
      document_type:
        "identity",
      title: "",
      document_number: "",
      private_storage_key:
        "",
      checksum_sha256: "",
      issued_date: "",
      expiry_date: "",
    });

  const [licenseForm, setLicenseForm] =
    useState({
      license_type: "",
      license_number: "",
      issuing_authority: "",
      issued_date: "",
      expiry_date: "",
      private_storage_key:
        "",
      checksum_sha256: "",
    });

  const [propertyForm, setPropertyForm] =
    useState({
      property_type: "",
      property_code: "",
      description: "",
      issued_at: today,
      expected_return_date:
        "",
      condition_issued: "",
    });

  const [statusForm, setStatusForm] =
    useState({
      status: "inactive",
      reason: "",
    });

  const [token, setToken] =
    useState(null);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  async function loadWorkers() {
    setError("");

    try {
      const response =
        await axiosClient.get(
          "/release2-final/workers",
          {
            params: {
              search,
            },
          }
        );

      setWorkers(
        response.data.workers ||
          []
      );
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Worker profiles could not be loaded."
      );
    }
  }

  async function loadDetail(
    id
  ) {
    if (!id) {
      setDetail(null);
      return;
    }

    try {
      const response =
        await axiosClient.get(
          `/release2-final/workers/${id}`
        );

      setDetail(
        response.data.worker
      );

      setSelectedId(
        Number(id)
      );
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Worker detail could not be loaded."
      );
    }
  }

  useEffect(() => {
    loadWorkers();
  }, []);

  async function createWorker(
    event
  ) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const response =
        await axiosClient.post(
          "/release2-final/workers",
          {
            ...workerForm,
            user_id:
              workerForm.user_id ||
              null,
          }
        );

      setMessage(
        response.data.message
      );

      setWorkerForm(
        emptyWorkerForm
      );

      await loadWorkers();

      await loadDetail(
        response.data.worker
          .profile.id
      );
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Worker profile could not be created."
      );
    }
  }

  async function addRecord(
    endpoint,
    payload,
    reset
  ) {
    if (!selectedId) {
      setError(
        "Select a worker first."
      );
      return;
    }

    setError("");
    setMessage("");

    try {
      const response =
        await axiosClient.post(
          `/release2-final/workers/${selectedId}/${endpoint}`,
          payload
        );

      setMessage(
        response.data.message
      );

      reset();

      await loadDetail(
        selectedId
      );

      await loadWorkers();
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Worker record could not be saved."
      );
    }
  }

  async function changeStatus(
    event
  ) {
    event.preventDefault();

    if (
      !token?.value ||
      token.expiresAt <=
        Date.now()
    ) {
      setError(
        "Unlock protected actions before changing worker status."
      );
      return;
    }

    try {
      const response =
        await axiosClient.post(
          `/release2-final/workers/${selectedId}/status`,
          statusForm,
          {
            headers: {
              "X-Protected-Action-Token":
                token.value,
            },
          }
        );

      setMessage(
        response.data.message
      );

      setStatusForm({
        status: "inactive",
        reason: "",
      });

      await loadDetail(
        selectedId
      );

      await loadWorkers();
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Worker status could not be changed."
      );
    }
  }

  const selected =
    detail?.profile;

  return (
    <div className="r2-page">
      <header className="r2-hero">
        <p>
          Release 2D
        </p>

        <h1>
          Worker Profile Foundation
        </h1>

        <span>
          Central identity, assignments,
          licences, private documents,
          company property and preserved
          employment history.
        </span>
      </header>

      {error ? (
        <Alert type="error">
          {error}
        </Alert>
      ) : null}

      {message ? (
        <Alert type="success">
          {message}
        </Alert>
      ) : null}

      <div className="r2-worker-shell">
        <aside className="r2-worker-list">
          <div className="r2-inline-form">
            <input
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Search workers"
            />

            <button
              type="button"
              onClick={loadWorkers}
            >
              Search
            </button>
          </div>

          {workers.map(
            (worker) => (
              <button
                type="button"
                key={worker.id}
                className={
                  Number(
                    selectedId
                  ) ===
                  Number(
                    worker.id
                  )
                    ? "r2-worker-button active"
                    : "r2-worker-button"
                }
                onClick={() =>
                  loadDetail(
                    worker.id
                  )
                }
              >
                <strong>
                  {
                    worker.employee_number
                  }
                </strong>

                <span>
                  {worker.full_name}
                </span>

                <small>
                  {worker.job_title ||
                    "No title"}{" "}
                  ·{" "}
                  {
                    worker.employment_status
                  }
                </small>
              </button>
            )
          )}
        </aside>

        <div className="r2-worker-main">
          {canManage ? (
            <section className="r2-card">
              <h2>
                Create Worker Profile
              </h2>

              <form
                className="r2-form-grid"
                onSubmit={createWorker}
              >
                {[
                  [
                    "employee_number",
                    "Employee number",
                  ],
                  [
                    "full_name",
                    "Full name",
                  ],
                  [
                    "phone",
                    "Phone",
                  ],
                  [
                    "email",
                    "Email",
                  ],
                  [
                    "job_title",
                    "Job title",
                  ],
                  [
                    "department",
                    "Department",
                  ],
                  [
                    "emergency_contact_name",
                    "Emergency contact",
                  ],
                  [
                    "emergency_contact_phone",
                    "Emergency phone",
                  ],
                  [
                    "user_id",
                    "Linked user ID — optional",
                  ],
                ].map(
                  ([
                    key,
                    label,
                  ]) => (
                    <label
                      key={key}
                    >
                      {label}
                      <input
                        value={
                          workerForm[
                            key
                          ]
                        }
                        onChange={(
                          event
                        ) =>
                          setWorkerForm(
                            (
                              current
                            ) => ({
                              ...current,
                              [key]:
                                event
                                  .target
                                  .value,
                            })
                          )
                        }
                        required={[
                          "employee_number",
                          "full_name",
                        ].includes(
                          key
                        )}
                      />
                    </label>
                  )
                )}

                <label>
                  Employment type
                  <select
                    value={
                      workerForm.employment_type
                    }
                    onChange={(event) =>
                      setWorkerForm(
                        (current) => ({
                          ...current,
                          employment_type:
                            event.target
                              .value,
                        })
                      )
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
                  </select>
                </label>

                <label>
                  Start date
                  <input
                    type="date"
                    value={
                      workerForm.employment_start_date
                    }
                    onChange={(event) =>
                      setWorkerForm(
                        (current) => ({
                          ...current,
                          employment_start_date:
                            event.target
                              .value,
                        })
                      )
                    }
                  />
                </label>

                <button type="submit">
                  Create Worker
                </button>
              </form>
            </section>
          ) : null}

          {!selected ? (
            <section className="r2-card">
              Select a worker to review the
              full profile.
            </section>
          ) : (
            <>
              <section className="r2-card">
                <div className="r2-card-heading">
                  <div>
                    <p>
                      {
                        selected.employee_number
                      }
                    </p>
                    <h2>
                      {
                        selected.full_name
                      }
                    </h2>
                    <span>
                      {selected.job_title ||
                        "No job title"}{" "}
                      ·{" "}
                      {
                        selected.employment_status
                      }
                    </span>
                  </div>

                  <div>
                    <strong>
                      Linked account:
                    </strong>{" "}
                    {selected.username ||
                      "None"}
                  </div>
                </div>

                <div className="r2-detail-grid">
                  <div>
                    <span>
                      Department
                    </span>
                    <strong>
                      {selected.department ||
                        "-"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Phone
                    </span>
                    <strong>
                      {selected.phone ||
                        "-"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Emergency contact
                    </span>
                    <strong>
                      {selected.emergency_contact_name ||
                        "-"}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Supervisor
                    </span>
                    <strong>
                      {selected.supervisor_name ||
                        "-"}
                    </strong>
                  </div>
                </div>
              </section>

              {canDeactivate ? (
                <>
                  <ProtectedUnlock
                    token={token}
                    onToken={
                      setToken
                    }
                  />

                  <section className="r2-card">
                    <h2>
                      Worker Status and Access
                    </h2>

                    <form
                      className="r2-form-grid"
                      onSubmit={
                        changeStatus
                      }
                    >
                      <label>
                        New status
                        <select
                          value={
                            statusForm.status
                          }
                          onChange={(
                            event
                          ) =>
                            setStatusForm(
                              (
                                current
                              ) => ({
                                ...current,
                                status:
                                  event
                                    .target
                                    .value,
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
                      </label>

                      <label>
                        Reason
                        <textarea
                          value={
                            statusForm.reason
                          }
                          onChange={(
                            event
                          ) =>
                            setStatusForm(
                              (
                                current
                              ) => ({
                                ...current,
                                reason:
                                  event
                                    .target
                                    .value,
                              })
                            )
                          }
                          required
                        />
                      </label>

                      <button type="submit">
                        Save Status
                      </button>
                    </form>

                    <small>
                      Deactivation preserves
                      history, ends active
                      assignments and revokes
                      linked sessions and
                      workspace access.
                      Reactivation does not
                      automatically restore
                      access.
                    </small>
                  </section>
                </>
              ) : null}

              {canManage ? (
                <section className="r2-card">
                  <h2>
                    Add Assignment
                  </h2>

                  <form
                    className="r2-form-grid"
                    onSubmit={(
                      event
                    ) => {
                      event.preventDefault();

                      addRecord(
                        "assignments",
                        assignmentForm,
                        () =>
                          setAssignmentForm(
                            {
                              workspace_code:
                                "spare_parts",
                              role_code:
                                "",
                              context_type:
                                "",
                              context_id:
                                "",
                              context_label:
                                "",
                              assignment_start:
                                today,
                              notes: "",
                            }
                          )
                      );
                    }}
                  >
                    <label>
                      Workspace
                      <select
                        value={
                          assignmentForm.workspace_code
                        }
                        onChange={(
                          event
                        ) =>
                          setAssignmentForm(
                            (
                              current
                            ) => ({
                              ...current,
                              workspace_code:
                                event
                                  .target
                                  .value,
                            })
                          )
                        }
                      >
                        <option value="spare_parts">
                          Spare Parts
                        </option>
                        <option value="mining">
                          Mining
                        </option>
                        <option value="equipment_hire">
                          Equipment Hire
                        </option>
                        <option value="fleet">
                          Shared Fleet
                        </option>
                      </select>
                    </label>

                    {[
                      [
                        "role_code",
                        "Role",
                      ],
                      [
                        "context_type",
                        "Context type",
                      ],
                      [
                        "context_id",
                        "Context ID",
                      ],
                      [
                        "context_label",
                        "Context label",
                      ],
                    ].map(
                      ([
                        key,
                        label,
                      ]) => (
                        <label
                          key={key}
                        >
                          {label}
                          <input
                            value={
                              assignmentForm[
                                key
                              ]
                            }
                            onChange={(
                              event
                            ) =>
                              setAssignmentForm(
                                (
                                  current
                                ) => ({
                                  ...current,
                                  [key]:
                                    event
                                      .target
                                      .value,
                                })
                              )
                            }
                          />
                        </label>
                      )
                    )}

                    <label>
                      Start date
                      <input
                        type="date"
                        value={
                          assignmentForm.assignment_start
                        }
                        onChange={(
                          event
                        ) =>
                          setAssignmentForm(
                            (
                              current
                            ) => ({
                              ...current,
                              assignment_start:
                                event
                                  .target
                                  .value,
                            })
                          )
                        }
                      />
                    </label>

                    <button type="submit">
                      Add Assignment
                    </button>
                  </form>
                </section>
              ) : null}

              {canManageDocuments ? (
                <>
                  <section className="r2-card">
                    <h2>
                      Private Document Metadata
                    </h2>

                    <form
                      className="r2-form-grid"
                      onSubmit={(
                        event
                      ) => {
                        event.preventDefault();

                        addRecord(
                          "documents",
                          documentForm,
                          () =>
                            setDocumentForm(
                              {
                                document_type:
                                  "identity",
                                title: "",
                                document_number:
                                  "",
                                private_storage_key:
                                  "",
                                checksum_sha256:
                                  "",
                                issued_date:
                                  "",
                                expiry_date:
                                  "",
                              }
                            )
                        );
                      }}
                    >
                      {Object.keys(
                        documentForm
                      ).map(
                        (key) => (
                          <label
                            key={key}
                          >
                            {key.replaceAll(
                              "_",
                              " "
                            )}
                            <input
                              type={
                                key.includes(
                                  "date"
                                )
                                  ? "date"
                                  : "text"
                              }
                              value={
                                documentForm[
                                  key
                                ]
                              }
                              onChange={(
                                event
                              ) =>
                                setDocumentForm(
                                  (
                                    current
                                  ) => ({
                                    ...current,
                                    [key]:
                                      event
                                        .target
                                        .value,
                                  })
                                )
                              }
                              required={[
                                "title",
                                "private_storage_key",
                                "checksum_sha256",
                              ].includes(
                                key
                              )}
                            />
                          </label>
                        )
                      )}

                      <button type="submit">
                        Record Document
                      </button>
                    </form>

                    <small>
                      Store only a private
                      storage reference and
                      SHA-256 checksum here.
                      Do not use a public URL
                      or database file blob.
                    </small>
                  </section>

                  <section className="r2-card">
                    <h2>
                      Licence
                    </h2>

                    <form
                      className="r2-form-grid"
                      onSubmit={(
                        event
                      ) => {
                        event.preventDefault();

                        addRecord(
                          "licenses",
                          licenseForm,
                          () =>
                            setLicenseForm(
                              {
                                license_type:
                                  "",
                                license_number:
                                  "",
                                issuing_authority:
                                  "",
                                issued_date:
                                  "",
                                expiry_date:
                                  "",
                                private_storage_key:
                                  "",
                                checksum_sha256:
                                  "",
                              }
                            )
                        );
                      }}
                    >
                      {Object.keys(
                        licenseForm
                      ).map(
                        (key) => (
                          <label
                            key={key}
                          >
                            {key.replaceAll(
                              "_",
                              " "
                            )}
                            <input
                              type={
                                key.includes(
                                  "date"
                                )
                                  ? "date"
                                  : "text"
                              }
                              value={
                                licenseForm[
                                  key
                                ]
                              }
                              onChange={(
                                event
                              ) =>
                                setLicenseForm(
                                  (
                                    current
                                  ) => ({
                                    ...current,
                                    [key]:
                                      event
                                        .target
                                        .value,
                                  })
                                )
                              }
                              required={
                                key ===
                                "license_type"
                              }
                            />
                          </label>
                        )
                      )}

                      <button type="submit">
                        Record Licence
                      </button>
                    </form>
                  </section>
                </>
              ) : null}

              {canManage ? (
                <section className="r2-card">
                  <h2>
                    Company Property
                  </h2>

                  <form
                    className="r2-form-grid"
                    onSubmit={(
                      event
                    ) => {
                      event.preventDefault();

                      addRecord(
                        "property",
                        propertyForm,
                        () =>
                          setPropertyForm(
                            {
                              property_type:
                                "",
                              property_code:
                                "",
                              description:
                                "",
                              issued_at:
                                today,
                              expected_return_date:
                                "",
                              condition_issued:
                                "",
                            }
                          )
                      );
                    }}
                  >
                    {Object.keys(
                      propertyForm
                    ).map(
                      (key) => (
                        <label
                          key={key}
                        >
                          {key.replaceAll(
                            "_",
                            " "
                          )}
                          <input
                            type={
                              key.includes(
                                "date"
                              ) ||
                              key ===
                                "issued_at"
                                ? "date"
                                : "text"
                            }
                            value={
                              propertyForm[
                                key
                              ]
                            }
                            onChange={(
                              event
                            ) =>
                              setPropertyForm(
                                (
                                  current
                                ) => ({
                                  ...current,
                                  [key]:
                                    event
                                      .target
                                      .value,
                                })
                              )
                            }
                            required={
                              key ===
                              "description"
                            }
                          />
                        </label>
                      )
                    )}

                    <button type="submit">
                      Assign Property
                    </button>
                  </form>
                </section>
              ) : null}

              {[
                [
                  "Assignments",
                  detail.assignments,
                ],
                [
                  "Documents",
                  detail.documents,
                ],
                [
                  "Licences",
                  detail.licenses,
                ],
                [
                  "Company Property",
                  detail.property,
                ],
                [
                  "Status History",
                  detail.status_history,
                ],
              ].map(
                ([
                  title,
                  records,
                ]) => (
                  <section
                    className="r2-card"
                    key={title}
                  >
                    <h2>
                      {title}
                    </h2>

                    {!records?.length ? (
                      <p>
                        No records.
                      </p>
                    ) : (
                      <pre className="r2-code">
                        {JSON.stringify(
                          records,
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </section>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ExecutiveOperations() {
  const [summary, setSummary] =
    useState(null);

  const [error, setError] =
    useState("");

  useEffect(() => {
    axiosClient
      .get(
        "/release2-final/executive/summary"
      )
      .then((response) =>
        setSummary(
          response.data
            .summary
        )
      )
      .catch((requestError) =>
        setError(
          requestError.response
            ?.data?.message ||
            "Executive security, backup and workforce control could not be loaded."
        )
      );
  }, []);

  const assignments =
    useMemo(
      () =>
        summary?.assignments ||
        [],
      [summary]
    );

  if (!summary && !error) {
    return (
      <div className="r2-loading">
        Loading executive controls...
      </div>
    );
  }

  return (
    <div className="r2-page">
      <header className="r2-hero">
        <p>
          Release 2E
        </p>

        <h1>
          Executive Security, Backup &
          Workforce Control
        </h1>

        <span>
          Read-only group oversight for
          serious security events, backup
          readiness, worker status,
          assignments and expiry risks.
        </span>
      </header>

      {error ? (
        <Alert type="error">
          {error}
        </Alert>
      ) : null}

      <div className="r2-metric-grid">
        <Metric
          label="Active workers"
          value={formatNumber(
            summary?.workforce
              ?.active_workers
          )}
          note="Current workforce"
        />

        <Metric
          label="Locked accounts"
          value={formatNumber(
            summary?.security
              ?.locked_accounts
          )}
          note="Security recovery needed"
        />

        <Metric
          label="Active sessions"
          value={formatNumber(
            summary?.security
              ?.active_sessions
          )}
          note="Server-side sessions"
        />

        <Metric
          label="Unverified backups"
          value={formatNumber(
            summary?.backups
              ?.unverified_backups
          )}
          note="Verification outstanding"
        />

        <Metric
          label="Expiring documents"
          value={formatNumber(
            summary?.expiry
              ?.expiring_documents
          )}
          note="Within 30 days"
        />

        <Metric
          label="Expiring licences"
          value={formatNumber(
            summary?.expiry
              ?.expiring_licenses
          )}
          note="Within 30 days"
        />
      </div>

      <section className="r2-card">
        <h2>
          Role and Profile Mismatches
        </h2>

        <div className="r2-detail-grid">
          {Object.entries(
            summary?.mismatches ||
              {}
          ).map(
            ([key, value]) => (
              <div key={key}>
                <span>
                  {key.replaceAll(
                    "_",
                    " "
                  )}
                </span>

                <strong>
                  {formatNumber(
                    value
                  )}
                </strong>
              </div>
            )
          )}
        </div>
      </section>

      <section className="r2-card">
        <h2>
          Worker Assignments by Workspace
        </h2>

        <div className="r2-detail-grid">
          {assignments.map(
            (item) => (
              <div
                key={
                  item.workspace_code
                }
              >
                <span>
                  {
                    item.workspace_code
                  }
                </span>

                <strong>
                  {formatNumber(
                    item.assignment_count
                  )}
                </strong>
              </div>
            )
          )}
        </div>
      </section>

      <section className="r2-card">
        <h2>
          Backup Oversight
        </h2>

        <div className="r2-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Verification</th>
                <th>Records</th>
              </tr>
            </thead>

            <tbody>
              {(
                summary
                  ?.recent_backups ||
                []
              ).map(
                (item) => (
                  <tr
                    key={item.id}
                  >
                    <td>
                      {formatDate(
                        item.created_at
                      )}
                    </td>

                    <td>
                      {
                        item.scope_code
                      }
                    </td>

                    <td>
                      {item.status}
                    </td>

                    <td>
                      {
                        item.verification_status
                      }
                    </td>

                    <td>
                      {formatNumber(
                        item.total_record_count
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="r2-card">
        <h2>
          Expiring Worker Evidence
        </h2>

        <div className="r2-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Worker</th>
                <th>Type</th>
                <th>Item</th>
                <th>Expiry</th>
              </tr>
            </thead>

            <tbody>
              {(
                summary
                  ?.expiring_worker_items ||
                []
              ).map(
                (item) => (
                  <tr
                    key={`${item.item_type}-${item.id}`}
                  >
                    <td>
                      {
                        item.employee_number
                      }{" "}
                      —{" "}
                      {item.full_name}
                    </td>

                    <td>
                      {
                        item.item_type
                      }
                    </td>

                    <td>
                      {
                        item.item_name
                      }
                    </td>

                    <td>
                      {formatDate(
                        item.expiry_date
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="r2-card">
        <h2>
          Serious Security Events
        </h2>

        <div className="r2-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Event</th>
                <th>Severity</th>
              </tr>
            </thead>

            <tbody>
              {(
                summary
                  ?.recent_security_events ||
                []
              ).map(
                (item) => (
                  <tr
                    key={item.id}
                  >
                    <td>
                      {formatDate(
                        item.created_at
                      )}
                    </td>

                    <td>
                      {item.full_name ||
                        item.username ||
                        "System"}
                    </td>

                    <td>
                      <strong>
                        {item.action}
                      </strong>

                      <small>
                        {item.details}
                      </small>
                    </td>

                    <td>
                      {item.severity}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function Release2FinalControlPage({
  mode,
}) {
  if (mode === "security") {
    return <SecurityCentre />;
  }

  if (mode === "backups") {
    return <ProfessionalBackups />;
  }

  if (mode === "workers") {
    return <ExpandedWorkerProfilePage />;
  }

  if (mode === "executive") {
    return <ExecutiveOperations />;
  }

  return (
    <div className="r2-page">
      Unknown Release 2 Final control.
    </div>
  );
}