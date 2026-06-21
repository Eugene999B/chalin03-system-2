import axios from "axios";

const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  timeout: 30000,
});

axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("chalin03_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const statusCode = error.response?.status;

    if (statusCode === 401) {
      localStorage.removeItem("chalin03_token");
      localStorage.removeItem("chalin03_user");

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

export default axiosClient;