import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { currentUser } from "@/api";
import { Shell } from "@/components/Shell";
import { useTheme } from "@/lib/theme";
import { AdminProvider, AdminRedirect } from "@/pages/admin/context";
import { MailboxesPage } from "@/pages/admin/MailboxesPage";
import { ModulesPage } from "@/pages/admin/ModulesPage";
import { OrgPage } from "@/pages/admin/OrgPage";
import { PeoplePage } from "@/pages/admin/PeoplePage";
import { PoliciesPage } from "@/pages/admin/PoliciesPage";
import { RulesPage } from "@/pages/admin/RulesPage";
import { TenantPage } from "@/pages/admin/TenantPage";
import { ToolsPage } from "@/pages/admin/ToolsPage";
import { TracesPage } from "@/pages/admin/TracesPage";
import { EvalPage } from "@/pages/EvalPage";
import { LoginPage } from "@/pages/Login";
import { QueuePage } from "@/pages/Queue";
import { TicketPage } from "@/pages/TicketDetail";

function Guard() {
  if (!currentUser()) return <Navigate to="/login" replace />;
  return <Shell />;
}

function Toasts() {
  const { theme } = useTheme();
  const mode = theme === "system" ? (document.documentElement.classList.contains("dark") ? "dark" : "light") : theme;
  return (
    <Toaster
      theme={mode}
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "rounded-card border border-line bg-surface text-ink shadow-card",
          title: "text-sm font-medium text-ink",
          description: "text-sm text-muted",
          success: "border-safe bg-safe-bg text-safe",
          warning: "border-caution bg-caution-bg text-caution",
          error: "border-danger bg-danger-bg text-danger",
        },
      }}
    />
  );
}

export function App() {
  return (
    <>
      <Toasts />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Guard />}>
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/tickets/:id" element={<TicketPage />} />
          <Route path="/eval" element={<EvalPage />} />
          <Route path="/admin" element={<AdminProvider />}>
            <Route index element={<AdminRedirect />} />
            <Route path="org" element={<OrgPage />} />
            <Route path="modules" element={<ModulesPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="mailboxes" element={<MailboxesPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="traces" element={<TracesPage />} />
            <Route path="tenant" element={<TenantPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Routes>
    </>
  );
}
