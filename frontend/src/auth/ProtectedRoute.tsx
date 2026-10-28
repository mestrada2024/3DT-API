import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./AuthContext";
import { ChatBubble } from "../components/ChatBubble";

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Outlet />
      <ChatBubble />
    </>
  );
}
