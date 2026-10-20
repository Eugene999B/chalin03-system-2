import axiosClient from "../api/axiosClient";
import { earliestUnpaidFinancePeriod, financeDateOnly } from "./financeDisplayDate";

const ACCOUNTS_PATH = "/equipment-catalogue/sales/finance-lifecycle/accounts";
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
  return financeDateOnly(earliestUnpaidFinancePeriod(schedule)?.due_date);
}

export async function enrichFinanceAccountsWithSchedule(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return accounts;
  return Promise.all(accounts.map(async (account) => {
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
  }));
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
    const enriched = await enrichFinanceAccountsWithSchedule(accounts);
    return { ...response, data: { ...response.data, accounts: enriched } };
  });
}

export { nextDueFromSchedule };
installInstallmentFinanceNextDue();
