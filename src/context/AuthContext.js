import { useContext, useState, createContext, useEffect, useRef } from 'react';
import { jwtDecode } from 'jwt-decode';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [accessToken, setAccessToken] = useState(""); // keep it "" not null
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshIntervalID = useRef(null);
  const refreshingRef = useRef(false);

  const login = (token) => {
    setAccessToken(token || "");
    setUser(token ? jwtDecode(token) : null);
  };

  const logout = async () => {
    try {
      await fetch(`/api/logout`, {
        method: 'POST',
        headers: {
          'authorization': accessToken ? `Bearer ${accessToken}` : ''
        },
        credentials: 'include'
      });
    } catch (err) {
      console.log("Could not Logout! Error: ", err);
    } finally {
      if (refreshIntervalID.current) {
        clearInterval(refreshIntervalID.current);
        refreshIntervalID.current = null;
      }
      setAccessToken("");
      setUser(null);
    }
  };

  const refreshAccessToken = async () => {
    if (refreshingRef.current) return null;
    refreshingRef.current = true;

    try {
      const res = await fetch(`/api/refresh`, {
        method: 'GET',
        credentials: 'include'
      });

      // If refresh cookie expired/invalid, backend should return 401/403
      if (!res.ok) {
        return null;
      }

      const data = await res.json();

      if (data?.accessToken) {
        login(data.accessToken);
        return data.accessToken;
      }

      return null;
    } catch (err) {
      console.error("Failed to refresh token", err);
      return null;
    } finally {
      refreshingRef.current = false;
    }
  };

  // ✅ On first load: ALWAYS attempt refresh before removing loading state
  useEffect(() => {
    (async () => {
      const token = await refreshAccessToken();
      // token may be null if user is logged out / refresh cookie expired
      setLoading(false);
    })();
  }, []);

  // ✅ Setup refresh interval when token exists
  useEffect(() => {
    if (refreshIntervalID.current) {
      clearInterval(refreshIntervalID.current);
      refreshIntervalID.current = null;
    }

    if (accessToken) {
      refreshIntervalID.current = setInterval(() => {
        refreshAccessToken();
      }, 9 * 60 * 1000);
    }

    return () => {
      if (refreshIntervalID.current) {
        clearInterval(refreshIntervalID.current);
        refreshIntervalID.current = null;
      }
    };
  }, [accessToken]);

  return (
    <AuthContext.Provider value={{ accessToken, loading, user, login, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);