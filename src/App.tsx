import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { StoreProvider } from "./lib/store";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider, Spinner } from "./components/ui";
import { Layout } from "./components/Layout";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Projects = lazy(() => import("./pages/Projects"));
const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const MyTasks = lazy(() => import("./pages/MyTasks"));
const Workload = lazy(() => import("./pages/Workload"));
const Trials = lazy(() => import("./pages/Trials"));
const Birthdays = lazy(() => import("./pages/Birthdays"));
const Admin = lazy(() => import("./pages/Admin"));
const Account = lazy(() => import("./pages/Account"));

function Gate() {
  const { session, me, loading } = useAuth();
  if (loading) return <Spinner label="Starting" />;
  if (!session || !me) return <Login />;
  if (me.must_change_password) return <SetPassword />;
  return (
    <StoreProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectPage />} />
            <Route path="my-tasks" element={<MyTasks />} />
            <Route path="workload" element={<Workload />} />
            <Route path="trials" element={<Trials />} />
            <Route path="birthdays" element={<Birthdays />} />
            <Route path="admin" element={me.role === "admin" || me.role === "manager" ? <Admin /> : <Navigate to="/" replace />} />
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </StoreProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
