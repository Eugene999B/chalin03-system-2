import {
  useState,
} from "react";
import axiosClient from "../api/axiosClient";
import "../styles/release2Final.css";

function strongPasswordError(
  password
) {
  const value = String(
    password || ""
  );

  if (value.length < 8) {
    return "Use at least 8 characters.";
  }

  if (
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value)
  ) {
    return "Include uppercase and lowercase letters.";
  }

  if (!/\d/.test(value)) {
    return "Include a number.";
  }

  if (
    !/[^A-Za-z0-9]/.test(
      value
    )
  ) {
    return "Include a symbol.";
  }

  return "";
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

export default function OwnerRecoveryPage() {
  const [loginForm, setLoginForm] =
    useState({
      username: "",
      password: "",
    });

  const [resetForm, setResetForm] =
    useState({
      temporary_password: "",
      confirm_password: "",
    });

  const [ownerToken, setOwnerToken] =
    useState("");

  const [events, setEvents] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  async function loadEvents(
    token
  ) {
    const response =
      await axiosClient.get(
        "/release2-final/owner/events",
        {
          headers: {
            "X-Owner-Recovery-Token":
              token,
          },
        }
      );

    setEvents(
      response.data
    );
  }

  async function loginOwner(
    event
  ) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response =
        await axiosClient.post(
          "/release2-final/owner/login",
          loginForm
        );

      const token =
        response.data
          .owner_recovery_token;

      setOwnerToken(token);
      setLoginForm({
        username: "",
        password: "",
      });

      setMessage(
        response.data.message
      );

      await loadEvents(
        token
      );
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "Owner Break-Glass login failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function resetAdmin(
    event
  ) {
    event.preventDefault();
    setError("");
    setMessage("");

    const policyError =
      strongPasswordError(
        resetForm
          .temporary_password
      );

    if (policyError) {
      setError(
        policyError
      );
      return;
    }

    if (
      resetForm
        .temporary_password !==
      resetForm
        .confirm_password
    ) {
      setError(
        "Password confirmation does not match."
      );
      return;
    }

    setLoading(true);

    try {
      const response =
        await axiosClient.post(
          "/release2-final/owner/reset-system-admin",
          resetForm,
          {
            headers: {
              "X-Owner-Recovery-Token":
                ownerToken,
            },
          }
        );

      setMessage(
        response.data.message
      );

      setOwnerToken("");
      setEvents(null);
      setResetForm({
        temporary_password: "",
        confirm_password: "",
      });
    } catch (requestError) {
      setError(
        requestError.response
          ?.data?.message ||
          "System Administrator recovery failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="r2-owner-page">
      <section className="r2-owner-card">
        <header className="r2-owner-header">
          <div className="r2-owner-shield">
            🛡️
          </div>

          <div>
            <p>
              Chalin 03 Company Limited
            </p>

            <h1>
              Owner Break-Glass Recovery
            </h1>

            <span>
              Emergency recovery for the
              original System Administrator.
              This is not an ordinary staff
              login.
            </span>
          </div>
        </header>

        {message ? (
          <div className="r2-alert success">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="r2-alert error">
            {error}
          </div>
        ) : null}

        {!ownerToken ? (
          <form
            className="r2-form"
            onSubmit={loginOwner}
          >
            <label>
              Owner Break-Glass username
              <input
                value={
                  loginForm.username
                }
                onChange={(event) =>
                  setLoginForm(
                    (current) => ({
                      ...current,
                      username:
                        event.target
                          .value,
                    })
                  )
                }
                autoComplete="username"
                required
              />
            </label>

            <label>
              Owner Break-Glass password
              <input
                type="password"
                value={
                  loginForm.password
                }
                onChange={(event) =>
                  setLoginForm(
                    (current) => ({
                      ...current,
                      password:
                        event.target
                          .value,
                    })
                  )
                }
                autoComplete="current-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Opening secure recovery..."
                : "Open Emergency Recovery"}
            </button>
          </form>
        ) : (
          <>
            <div className="r2-alert warning">
              The emergency session is
              temporary. Set a strong
              temporary password and give it
              to the System Administrator
              through a secure channel. The
              password must never be sent by
              SMS.
            </div>

            <form
              className="r2-form"
              onSubmit={resetAdmin}
            >
              <label>
                New temporary password
                <input
                  type="password"
                  minLength={8}
                  value={
                    resetForm
                      .temporary_password
                  }
                  onChange={(event) =>
                    setResetForm(
                      (current) => ({
                        ...current,
                        temporary_password:
                          event.target
                            .value,
                      })
                    )
                  }
                  required
                />
              </label>

              <label>
                Confirm temporary password
                <input
                  type="password"
                  minLength={8}
                  value={
                    resetForm
                      .confirm_password
                  }
                  onChange={(event) =>
                    setResetForm(
                      (current) => ({
                        ...current,
                        confirm_password:
                          event.target
                            .value,
                      })
                    )
                  }
                  required
                />
              </label>

              <button
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Recovering account..."
                  : "Reset Original System Administrator"}
              </button>
            </form>

            <section className="r2-card">
              <h2>
                Serious security evidence
              </h2>

              <p>
                The latest serious events are
                visible for emergency review.
                This does not provide an audit
                bypass.
              </p>

              <div className="r2-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Event</th>
                      <th>Severity</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(
                      events
                        ?.serious_events ||
                      []
                    ).map(
                      (item) => (
                        <tr
                          key={
                            item.id
                          }
                        >
                          <td>
                            {formatDate(
                              item.created_at
                            )}
                          </td>

                          <td>
                            <strong>
                              {
                                item.action
                              }
                            </strong>

                            <small>
                              {
                                item.details
                              }
                            </small>
                          </td>

                          <td>
                            {
                              item.severity
                            }
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}