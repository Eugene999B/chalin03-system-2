import axiosClient from "../api/axiosClient";

const ACCOUNTS_PATH = "/equipment-catalogue/sales/finance-lifecycle/accounts";
const TERMINAL = new Set(["paid", "cancelled", "waived", "rescheduled"]);
let installed = false;

function normalizedPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, window.location.origin).pathname.replace(/\/+$/, "").replace(/^\/api(?=\/)/, "");
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

export async function enrichFinanceAccountsWithSchedule(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return accounts;
  const resolved = await Promise.all(
    accounts.map(async (account) => {
      if (!account?.agreement_id) return account;
      try {
        const detail = await axiosClient.get(`${ACCOUNTS_PATH}/${account.agreement_id}`, { __skipFinanceNextDue: true });
        const nextDue = nextDueFromSchedule(detail?.data?.schedule);
        return nextDue
          ? { ...account, next_due_date: nextDue, next_installment_due_date: nextDue }
          : account;
      } catch {
        return account;
      }
    })
  );
  return resolved;
}

export function installInstallmentFinanceNextDue() {
  if (installed || !axiosClient?.interceptors?.response) return;
  installed = true;
  axiosClient.interceptors.response.use((response) => response);
}

export { nextDueFromSchedule };
