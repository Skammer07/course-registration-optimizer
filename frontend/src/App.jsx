import { Suspense, lazy } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider.jsx";
import { PublicOnly, RequireAuth, RequireRole, homeFor } from "./auth/guards.jsx";
import { AppShell } from "./components/layout/AppShell.jsx";
import { buttonClass } from "./components/ui/Button.jsx";
import { EmptyState } from "./components/ui/Misc.jsx";
import { PageSpinner } from "./components/ui/Spinner.jsx";
import { ChangePasswordPage } from "./pages/ChangePasswordPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { CoursesPage } from "./pages/data/CoursesPage.jsx";
import { ImportPage } from "./pages/data/ImportPage.jsx";
import { StudentDetailPage } from "./pages/data/StudentDetailPage.jsx";
import { StudentsPage } from "./pages/data/StudentsPage.jsx";
import { NewRunPage } from "./pages/admin/NewRunPage.jsx";
import { RunsPage } from "./pages/admin/RunsPage.jsx";
import { MyPreferencesPage } from "./pages/student/MyPreferencesPage.jsx";
import { MyResultsPage } from "./pages/student/MyResultsPage.jsx";

// The run page is the only one that draws charts; load that library only when it is opened.
const RunDetailPage = lazy(() => import("./pages/admin/RunDetailPage.jsx").then((m) => ({ default: m.RunDetailPage })));

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user)} replace />;
}

function NotFoundPage() {
  const { user } = useAuth();
  return (
    <EmptyState
      icon="search"
      title="Page not found"
      description="The address may be mistyped, or the page has moved."
      action={<Link to={homeFor(user)} className={buttonClass({ variant: "primary" })}>Go to my page</Link>}
    />
  );
}

/**
 * Route map.
 *   public:   /login
 *   signed in: /change-password, then inside the app shell:
 *     admin + faculty: /runs, /runs/:runId        admin only: /runs/new
 *     student:         /my-results
 */
export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />

        <Route element={<AppShell />}>
          <Route index element={<HomeRedirect />} />

          <Route element={<RequireRole roles={["admin", "faculty"]} />}>
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/data/courses" element={<CoursesPage />} />
            <Route path="/data/students" element={<StudentsPage />} />
            <Route path="/data/students/:id" element={<StudentDetailPage />} />
            <Route
              path="/runs/:runId"
              element={
                <Suspense fallback={<PageSpinner label="Loading run" />}>
                  <RunDetailPage />
                </Suspense>
              }
            />
          </Route>
          <Route element={<RequireRole roles={["admin"]} />}>
            <Route path="/runs/new" element={<NewRunPage />} />
            <Route path="/data/import" element={<ImportPage />} />
          </Route>
          <Route element={<RequireRole roles={["student"]} />}>
            <Route path="/my-results" element={<MyResultsPage />} />
            <Route path="/my-preferences" element={<MyPreferencesPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
