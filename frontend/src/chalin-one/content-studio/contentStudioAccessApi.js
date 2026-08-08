import axiosClient from "../../api/axiosClient";

function data(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export async function listContentStudioRoles(options = {}) {
  return data(await axiosClient.get("/content-studio/access/roles", options));
}

export async function listContentStudioAccounts(options = {}) {
  return data(await axiosClient.get("/content-studio/access/accounts", options));
}

export async function createContentStudioAccount(input) {
  return data(await axiosClient.post("/content-studio/access/accounts", input));
}

export async function updateContentStudioAccount(userId, input) {
  return data(await axiosClient.patch(`/content-studio/access/accounts/${userId}`, input));
}

export async function resetContentStudioAccountPassword(userId, temporaryPassword) {
  return data(
    await axiosClient.post(`/content-studio/access/accounts/${userId}/reset-password`, {
      temporary_password: temporaryPassword,
    })
  );
}

export function contentStudioAccessError(error) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    "Content Studio access management could not be completed."
  );
}
