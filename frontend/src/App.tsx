import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { User, api, getToken, setToken } from "./api";
import { BrandMark } from "./icons";
import Shell from "./layout/Shell";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ServerPage from "./pages/Server";
import Admin, {
  ActivityLog,
  AdminServers,
  EditUser,
  Locations,
  Nests,
  NewNode,
  NewServer,
  NewUser,
  NodeDetail,
  Nodes,
  Overview as AdminOverview,
  PanelSettings,
  Users as AdminUsers,
} from "./pages/Admin";
import Account from "./pages/Account";
import { Toaster } from "./ui";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [system, setSystem] = useState<any>(null);

  const refreshUser = useCallback(async () => {
    const res = await api.me();
    setUser(res.user);
    return res.user;
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((response) => setUser(response.user))
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setReady(true));
    api.system().then(setSystem).catch(() => undefined);
  }, []);

  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <BrandMark />
        </div>
        <div className="boot-copy">
          <strong>VITESTERTL</strong>
          <span>Preparing your control plane</span>
        </div>
        <div className="boot-progress">
          <i />
        </div>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route
          path="/"
          element={
            user ? (
              <Shell user={user} system={system} onUserChange={setUser} refreshUser={refreshUser} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="server/:id" element={<ServerPage />} />
          <Route path="account" element={<Account />} />
          <Route path="admin" element={user?.role === "admin" ? <Admin /> : <Navigate to="/" replace />}>
            <Route index element={<AdminOverview />} />
            <Route path="servers" element={<AdminServers />} />
            <Route path="servers/new" element={<NewServer />} />
            <Route path="nodes" element={<Nodes />} />
            <Route path="nodes/new" element={<NewNode />} />
            <Route path="nodes/:id" element={<NodeDetail />} />
            <Route path="nests" element={<Nests />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/new" element={<NewUser />} />
            <Route path="users/:id" element={<EditUser />} />
            <Route path="locations" element={<Locations />} />
            <Route path="activity" element={<ActivityLog />} />
            <Route path="settings" element={<PanelSettings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
