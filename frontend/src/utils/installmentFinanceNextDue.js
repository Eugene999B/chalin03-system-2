import axiosClient from "../api/axiosClient";

const ACCOUNTS_PATH = "/equipment-catalogue/sales/finance-lifecycle/accounts";
const TERMINAL = new Set(["paid", "cancelled", "waived", "rescheduled"]);
let installed = false;

function normalizedPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, window.location.origin).pathname.replace(/\/+$/, "");
  } catch {
    return raw.split("?")[0].replace(/^\/api(?=\/)/, "").replace(/\/+$/, "");
  }
}

function nextDueFromSchedule(schedule) {
  return [...(Array.isArray(schedule) ? schedule : [])]
    .filter((row) => {
      const status = String(row?.schedule_status || "").toLowerCase();
      return Boolean(row?.due_date) && !TERMINAL.has(status);
    })
    .sort((left, right) => {
      const dateCompare = String(left.due_date).slice(0, 10).localeCompare(String(right.due_date).slice(0, 10));
      if (dateCompare !== 0) return dateCompare;
      return Number(left.sequence_number || 0) - Number(right.sequence_number || 0);
    })[0]?.due_date || null;
}

export function installInstallmentFinanceNextDue() {
  if (installed || !axiosClient?.interceptors?.response) return;
  installed = true;
  axiosClient.interceptors.response.use(async (response) => {
    if (response?.config?.__skipFinanceNextDue || normalizedPath(response?.config?.url) !== ACCOUNTS_PATH) {
      return response;
    }
    const accounts = response?.data?.accounts;
    if (!Array.isArray(accounts) || !accounts.length) return response;

    const work = accounts
      .filter((account) => account?.agreement_id)
      .slice(0, 50)
      .map(async (account) => {
        try {
          const detail = await axiosClient.get(
            `${ACCOUNTS_PATH}/${account.agreement_id}`,
            { __skipFinanceNextDue: true }
          );
          return [String(account.agreement_id), nextDueFromSchedule(detail?.data?.schedule)];
        } catch {
          return [String(account.agreement_id), null];
        }
      });

    const resolved = await Promise.all(work);
    const byAgreement = new Map(resolved.filter(([, date]) => date));
    if (!byAgreement.size) return response;

    response.data = {
      ...response.data,
      accounts: accounts.map((account) => {
        const nextDue = byAgreement.get(String(account.agreement_id));
        return nextDue
          ? { ...account, next_due_date: nextDue, next_installment_due_date: nextDue }
          : account;
      }),
    };
    return response;
  });
}

export { nextDueFromSchedule };
installInstallmentFinanceNextDue();
