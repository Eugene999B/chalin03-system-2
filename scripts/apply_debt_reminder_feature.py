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


def patch_manual_sms_limits():
    path = "backend/services/debtReminderService.js"
    source = read(path)
    if "MANUAL_DEBT_SMS_LIMIT_REACHED" in source:
        return

    old = '''    const customer = await getCustomerDebtSummary(
      connection,
      Number(branchId),
      Number(customerId)
    );
    const reminder = manualReminderType(customer, ghanaClock().date);
'''
    new = '''    const customer = await getCustomerDebtSummary(
      connection,
      Number(branchId),
      Number(customerId)
    );
    const frequency = await reminderFrequencyStats(
      connection,
      Number(branchId),
      customer.customer_id
    );
    const limitReason = automaticLimitReason(frequency, current.settings);
    if (limitReason) {
      const descriptions = {
        maximum_7_day_limit: `This customer has reached the saved limit of ${current.settings.max_sms_7_days} debt reminder SMS in 7 days.`,
        maximum_30_day_limit: `This customer has reached the saved limit of ${current.settings.max_sms_30_days} debt reminder SMS in 30 days.`,
        minimum_hours_not_reached: `Wait at least ${current.settings.minimum_hours_between_sms} hours between debt reminder SMS for this customer.`,
      };
      throw appError(
        descriptions[limitReason] || "This reminder is blocked by Debt Reminder Settings.",
        429,
        "MANUAL_DEBT_SMS_LIMIT_REACHED"
      );
    }

    const reminder = manualReminderType(customer, ghanaClock().date);
'''
    source = replace_once(source, old, new, "manual SMS anti-spam limit")
    write(path, source)


def patch_phone_fallback_buttons():
    path = "frontend/src/components/CustomerDebtConsolidationPanel.jsx"
    source = read(path)

    replacements = [
        (
            '''                    disabled={
                      !customer.customer_phone ||
                      sendingReminderCustomerId === Number(customer.customer_id)
                    }
                    title={
                      customer.customer_phone
                        ? "Send one consolidated SMS for this customer account"
                        : "Add a customer phone number before sending SMS"
                    }
''',
            '''                    disabled={
                      sendingReminderCustomerId === Number(customer.customer_id)
                    }
                    title="Send one consolidated SMS for this customer account"
''',
            "customer SMS phone fallback",
        ),
        (
            '''                    disabled={
                      !customer.customer_phone ||
                      openingWhatsAppCustomerId === Number(customer.customer_id)
                    }
                    title={
                      customer.customer_phone
                        ? "Open a prepared consolidated WhatsApp reminder"
                        : "Add a customer phone number before using WhatsApp"
                    }
''',
            '''                    disabled={
                      openingWhatsAppCustomerId === Number(customer.customer_id)
                    }
                    title="Open a prepared consolidated WhatsApp reminder"
''',
            "customer WhatsApp phone fallback",
        ),
        (
            '''                      disabled={
                        !selectedCustomer.customer?.phone ||
                        sendingReminderCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
''',
            '''                      disabled={
                        sendingReminderCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
''',
            "detail SMS phone fallback",
        ),
        (
            '''                      disabled={
                        !selectedCustomer.customer?.phone ||
                        openingWhatsAppCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
''',
            '''                      disabled={
                        openingWhatsAppCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
''',
            "detail WhatsApp phone fallback",
        ),
    ]

    for old, new, label in replacements:
        if old in source:
            source = replace_once(source, old, new, label)

    write(path, source)


def patch_run_result_message():
    path = "frontend/src/components/DebtReminderSettingsPanel.jsx"
    source = read(path)
    old = '''      setMessage(response.data.message || "Debt reminder run completed.");
      await Promise.all([previewToday(), loadHistory()]);
'''
    new = '''      const runMessage =
        response.data.message || "Debt reminder run completed.";
      await Promise.all([previewToday(), loadHistory()]);
      setMessage(runMessage);
'''
    if old in source:
        source = replace_once(source, old, new, "run result message preservation")
    write(path, source)


def patch_contract_test():
    path = "backend/tests/debtReminderAutomation.test.js"
    source = read(path)
    if "MANUAL_DEBT_SMS_LIMIT_REACHED" in source:
        return
    old = '''  assert.match(service, /minimum_hours_between_sms/);
  assert.match(service, /startDebtReminderScheduler/);
'''
    new = '''  assert.match(service, /minimum_hours_between_sms/);
  assert.match(service, /MANUAL_DEBT_SMS_LIMIT_REACHED/);
  assert.match(service, /startDebtReminderScheduler/);
'''
    source = replace_once(source, old, new, "manual SMS limit contract")
    write(path, source)


def main():
    patch_manual_sms_limits()
    patch_phone_fallback_buttons()
    patch_run_result_message()
    patch_contract_test()
    print("Debt reminder refinements applied successfully.")


if __name__ == "__main__":
    main()
