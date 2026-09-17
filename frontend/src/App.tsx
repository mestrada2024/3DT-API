import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RootRoute } from "./auth/RootRoute";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { SimsAdmin } from "./pages/SimsAdmin";
import { TrackersAdmin } from "./pages/TrackersAdmin";
import { UnitsAdmin } from "./pages/UnitsAdmin";
import { CompaniesAdmin } from "./pages/CompaniesAdmin";
import { UsersAdmin } from "./pages/UsersAdmin";
import { MessagingAdmin } from "./pages/MessagingAdmin";
import { TripsView } from "./pages/TripsView";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/admin/vehiculos" element={<UnitsAdmin />} />
          <Route path="/admin/trackers" element={<TrackersAdmin />} />
          <Route path="/admin/sims" element={<SimsAdmin />} />
          <Route path="/admin/empresas" element={<CompaniesAdmin />} />
          <Route path="/trips/:unitId" element={<TripsView />} />

          <Route element={<RootRoute />}>
            <Route path="/admin/usuarios" element={<UsersAdmin />} />
            <Route path="/admin/mensajeria" element={<MessagingAdmin />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
