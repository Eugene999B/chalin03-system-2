from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative, content):
    (ROOT / relative).write_text(content, encoding="utf-8")


def replace_once(content, old, new, label):
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return content.replace(old, new, 1)


def patch_server():
    path = "backend/server.js"
    source = read(path)

    if 'const debtReminderRoutes = require("./routes/debtReminderRoutes");' not in source:
        source = replace_once(
            source,
            'const customerDebtConsolidationRoutes = require("./routes/customerDebtConsolidationRoutes");\n',
            'const customerDebtConsolidationRoutes = require("./routes/customerDebtConsolidationRoutes");\n'
            'const debtReminderRoutes = require("./routes/debtReminderRoutes");\n',
            "server debt reminder route import",
        )

    if 'startDebtReminderScheduler' not in source:
        source = replace_once(
            source,
            'const { startInstallmentReminderScheduler } = require("./services/installmentReminderService");\n',
            'const { startInstallmentReminderScheduler } = require("./services/installmentReminderService");\n'
            'const { startDebtReminderScheduler } = require("./services/debtReminderService");\n',
            "server scheduler import",
        )

    if '"/api/debt-reminders"' not in source:
        source = replace_once(
            source,
            '      "/api/debt-customers",\n',
            '      "/api/debt-customers",\n      "/api/debt-reminders",\n',
            "server API route listing",
        )

    mount = 'app.use("/api/debt-reminders", requireAuth, sparePartsBoundary, debtReminderRoutes);'
    if mount not in source:
        source = replace_once(
            source,
            'app.use("/api/debt-customers", requireAuth, sparePartsBoundary, customerDebtConsolidationRoutes);\n',
            'app.use("/api/debt-customers", requireAuth, sparePartsBoundary, customerDebtConsolidationRoutes);\n'
            f'{mount}\n',
            "server debt reminder route mount",
        )

    if '      startDebtReminderScheduler();' not in source:
        source = replace_once(
            source,
            '      startInstallmentReminderScheduler();\n',
            '      startInstallmentReminderScheduler();\n      startDebtReminderScheduler();\n',
            "server scheduler startup",
        )

    write(path, source)


def patch_customer_component():
    path = "frontend/src/components/CustomerDebtConsolidationPanel.jsx"
    source = read(path)

    if 'import DebtReminderSettingsPanel from "./DebtReminderSettingsPanel";' not in source:
        source = replace_once(
            source,
            'import CustomerDebtPrintPanel from "./CustomerDebtPrintPanel";\n',
            'import CustomerDebtPrintPanel from "./CustomerDebtPrintPanel";\n'
            'import DebtReminderSettingsPanel from "./DebtReminderSettingsPanel";\n',
            "customer component settings import",
        )

    state_anchor = '''  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
'''
    state_insert = '''  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sendingReminderCustomerId, setSendingReminderCustomerId] = useState(null);
  const [openingWhatsAppCustomerId, setOpeningWhatsAppCustomerId] = useState(null);
'''
    if "sendingReminderCustomerId" not in source:
        source = replace_once(
            source,
            state_anchor,
            state_insert,
            "customer reminder state",
        )

    permission_anchor = '''  const canMerge = ["admin", "manager"].includes(
    String(userRole || "").toLowerCase()
  );
'''
    permission_insert = '''  const canMerge = ["admin", "manager"].includes(
    String(userRole || "").toLowerCase()
  );
  const canManageReminders = canMerge;
'''
    if "const canManageReminders" not in source:
        source = replace_once(
            source,
            permission_anchor,
            permission_insert,
            "customer reminder permission",
        )

    functions_anchor = '''  function handleRecordPayment(debt) {
    if (typeof onRecordPayment === "function") {
      onRecordPayment(debt);
    }
    closeCustomerDetail();
  }
'''
    functions_insert = '''  async function sendCustomerReminderSms(customerId) {
    setMessage("");
    setError("");

    if (!canManageReminders) {
      setError("Only an administrator or manager can send debt reminders.");
      return;
    }

    setSendingReminderCustomerId(Number(customerId));
    try {
      const response = await axiosClient.post(
        `/debt-reminders/customer/${customerId}/sms`
      );
      setMessage(
        response.data.message || "Customer debt reminder SMS submitted successfully."
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not send the customer debt reminder SMS."
      );
    } finally {
      setSendingReminderCustomerId(null);
    }
  }

  async function openCustomerReminderWhatsApp(customerId) {
    setMessage("");
    setError("");

    if (!canManageReminders) {
      setError("Only an administrator or manager can prepare debt reminders.");
      return;
    }

    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setOpeningWhatsAppCustomerId(Number(customerId));

    try {
      const response = await axiosClient.get(
        `/debt-reminders/customer/${customerId}/message`
      );
      const data = response.data || {};

      if (!data.channels?.whatsapp_enabled) {
        throw new Error(
          "WhatsApp reminders are disabled in Debt Reminder Settings."
        );
      }

      const digits = String(data.recipient_phone || "").replace(/\\D/g, "");
      if (!digits) {
        throw new Error("This customer does not have a valid Ghana phone number.");
      }

      const url = `https://wa.me/${digits}?text=${encodeURIComponent(
        data.message || ""
      )}`;

      if (popup) {
        popup.location.href = url;
      } else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) {
          throw new Error("Popup blocked. Allow popups and try WhatsApp again.");
        }
      }
    } catch (requestError) {
      if (popup && !popup.closed) popup.close();
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Could not prepare the WhatsApp debt reminder."
      );
    } finally {
      setOpeningWhatsAppCustomerId(null);
    }
  }

  function handleRecordPayment(debt) {
    if (typeof onRecordPayment === "function") {
      onRecordPayment(debt);
    }
    closeCustomerDetail();
  }
'''
    if "async function sendCustomerReminderSms" not in source:
        source = replace_once(
            source,
            functions_anchor,
            functions_insert,
            "customer reminder functions",
        )

    settings_anchor = '''      {Number(unlinked?.debt_count || 0) > 0 ? (
'''
    settings_insert = '''      <DebtReminderSettingsPanel
        userRole={userRole}
        currentStoreCode={currentStoreCode}
        currentStoreName={currentStoreName}
      />

      {Number(unlinked?.debt_count || 0) > 0 ? (
'''
    if "<DebtReminderSettingsPanel" not in source:
        source = replace_once(
            source,
            settings_anchor,
            settings_insert,
            "customer reminder settings render",
        )

    old_card_action = '''            <button
              type="button"
              onClick={() => openCustomer(customer.customer_id)}
            >
              Open Full Debt Breakdown
            </button>
'''
    new_card_action = '''            <div className="customer-debt-card-actions">
              <button
                type="button"
                onClick={() => openCustomer(customer.customer_id)}
              >
                Open Full Debt Breakdown
              </button>

              {canManageReminders ? (
                <>
                  <button
                    type="button"
                    className="secondary-button customer-debt-reminder-button"
                    onClick={() => sendCustomerReminderSms(customer.customer_id)}
                    disabled={
                      !customer.customer_phone ||
                      sendingReminderCustomerId === Number(customer.customer_id)
                    }
                    title={
                      customer.customer_phone
                        ? "Send one consolidated SMS for this customer account"
                        : "Add a customer phone number before sending SMS"
                    }
                  >
                    {sendingReminderCustomerId === Number(customer.customer_id)
                      ? "Sending SMS..."
                      : "Send SMS Reminder"}
                  </button>
                  <button
                    type="button"
                    className="customer-debt-whatsapp-button"
                    onClick={() =>
                      openCustomerReminderWhatsApp(customer.customer_id)
                    }
                    disabled={
                      !customer.customer_phone ||
                      openingWhatsAppCustomerId === Number(customer.customer_id)
                    }
                    title={
                      customer.customer_phone
                        ? "Open a prepared consolidated WhatsApp reminder"
                        : "Add a customer phone number before using WhatsApp"
                    }
                  >
                    {openingWhatsAppCustomerId === Number(customer.customer_id)
                      ? "Opening WhatsApp..."
                      : "WhatsApp Reminder"}
                  </button>
                </>
              ) : null}
            </div>
'''
    if "customer-debt-card-actions" not in source:
        source = replace_once(
            source,
            old_card_action,
            new_card_action,
            "customer card reminder actions",
        )

    detail_anchor = '''              <CustomerDebtPrintPanel
'''
    detail_insert = '''              {canManageReminders ? (
                <div className="customer-debt-detail-reminder-actions">
                  <div>
                    <strong>Customer Follow-Up</strong>
                    <span>
                      Send one consolidated reminder for this customer’s complete
                      outstanding account.
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="secondary-button customer-debt-reminder-button"
                      onClick={() =>
                        sendCustomerReminderSms(selectedCustomer.customer?.id)
                      }
                      disabled={
                        !selectedCustomer.customer?.phone ||
                        sendingReminderCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
                    >
                      {sendingReminderCustomerId ===
                      Number(selectedCustomer.customer?.id)
                        ? "Sending SMS..."
                        : "Send SMS Reminder"}
                    </button>
                    <button
                      type="button"
                      className="customer-debt-whatsapp-button"
                      onClick={() =>
                        openCustomerReminderWhatsApp(selectedCustomer.customer?.id)
                      }
                      disabled={
                        !selectedCustomer.customer?.phone ||
                        openingWhatsAppCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
                    >
                      {openingWhatsAppCustomerId ===
                      Number(selectedCustomer.customer?.id)
                        ? "Opening WhatsApp..."
                        : "WhatsApp Reminder"}
                    </button>
                  </div>
                </div>
              ) : null}

              <CustomerDebtPrintPanel
'''
    if "customer-debt-detail-reminder-actions" not in source:
        source = replace_once(
            source,
            detail_anchor,
            detail_insert,
            "customer detail reminder actions",
        )

    write(path, source)


def patch_customer_css():
    path = "frontend/src/styles/customerDebtConsolidation.css"
    source = read(path)
    marker = "/* Customer-level SMS and WhatsApp reminder actions. */"
    if marker in source:
        return

    addition = r'''

/* Customer-level SMS and WhatsApp reminder actions. */
.customer-debt-card-actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.customer-debt-consolidation-card > .customer-debt-card-actions {
  margin-top: auto;
  padding-top: 14px;
}

.customer-debt-card-actions button {
  width: auto;
  min-height: 40px;
  margin: 0;
  padding: 9px 13px;
  font-size: 0.76rem;
}

.customer-debt-whatsapp-button {
  background: #15803d !important;
  color: #ffffff !important;
}

.customer-debt-reminder-button {
  border-color: #c8d7e4 !important;
  background: #ffffff !important;
  color: #123a5a !important;
}

.customer-debt-detail-reminder-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 16px 0;
  padding: 14px;
  border: 1px solid #d9e4ed;
  border-radius: 16px;
  background: linear-gradient(135deg, #f7fbfe, #ffffff);
}

.customer-debt-detail-reminder-actions > div:first-child {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.customer-debt-detail-reminder-actions > div:first-child strong {
  color: #102a43;
}

.customer-debt-detail-reminder-actions > div:first-child span {
  color: #64748b;
  font-size: 0.76rem;
  line-height: 1.45;
}

.customer-debt-detail-reminder-actions > div:last-child {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 900px) {
  .customer-debt-card-actions {
    justify-content: stretch;
  }

  .customer-debt-card-actions button {
    flex: 1 1 160px;
  }
}

@media (max-width: 720px) {
  .customer-debt-card-actions,
  .customer-debt-detail-reminder-actions,
  .customer-debt-detail-reminder-actions > div:last-child {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }

  .customer-debt-card-actions button,
  .customer-debt-detail-reminder-actions button {
    width: 100%;
  }
}
'''
    write(path, source.rstrip() + addition + "\n")


def patch_service_worker_and_tests():
    sw_path = "frontend/public/sw.js"
    sw = read(sw_path)
    old_cache = "chalin03-debt-dashboard-source-v14"
    new_cache = "chalin03-debt-reminder-automation-v15"
    if new_cache not in sw:
        if old_cache not in sw:
            raise RuntimeError("service worker cache anchor is missing")
        sw = sw.replace(old_cache, new_cache, 1)
        write(sw_path, sw)

    tests_dir = ROOT / "backend" / "tests"
    for test_file in tests_dir.glob("*.test.js"):
        content = test_file.read_text(encoding="utf-8")
        if old_cache in content:
            test_file.write_text(content.replace(old_cache, new_cache), encoding="utf-8")


def main():
    patch_server()
    patch_customer_component()
    patch_customer_css()
    patch_service_worker_and_tests()
    print("Debt reminder automation integration patch applied successfully.")


if __name__ == "__main__":
    main()
