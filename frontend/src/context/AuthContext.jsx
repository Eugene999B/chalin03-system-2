import { createContext, useContext, useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const AuthContext = createContext(null);

const TOKEN_KEY = "chalin03_token";
const USER_KEY = "chalin03_user";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem(USER_KEY);

    if (!savedUser) {
      return null;
    }

    try {
      return JSON.parse(savedUser);
    } catch {
      localStorage.removeItem(USER_KEY);
      return null;
    }
  });

  const [loading, setLoading] = useState(false);

  function saveSession(newToken, newUser) {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));

    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);

    setToken(null);
    setUser(null);
  }

  async function login(username, password) {
    const response = await axiosClient.post("/auth/login", {
      username,
      password,
    });

    saveSession(response.data.token, response.data.user);

    return response.data;
  }

  async function refreshUser() {
    const savedToken = localStorage.getItem(TOKEN_KEY);

    if (!savedToken) {
      logout();
      return;
    }

    setLoading(true);

    try {
      const response = await axiosClient.get("/auth/me");
      const freshUser = response.data.user;

      localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
      setUser(freshUser);
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      refreshUser();
    }
  }, []);

  const role = String(user?.role || "").toLowerCase();

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        role,
        loading,
        isLoggedIn: Boolean(token && user),
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}