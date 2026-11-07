import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider.jsx";
import { PageSpinner } from "../components/ui/Spinner.jsx";
import { EmptyState } from "../components/ui/Misc.jsx";
import { Button, buttonClass } from "../components/ui/Button.jsx";
import { ErrorAlert } from "../components/ui/Alert.jsx";

/** Where each role lands after signing in. */
export const homeFor = (user) => (user?.role === "student" ? "/my-results" : "/runs");

/** Everything behind login. A temporary password must be changed before anything else. */
export function RequireAuth() {
  const { user, loading, error, refresh, signedOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PageSpinner label="Loading" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <ErrorAlert error={error} />
        <Button variant="primary" icon="refresh" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }
  // remember where the visitor was going, unless they just signed out on purpose
  if (!user) return <Navigate to="/login" replace state={signedOut ? undefined : { from: location }} />;
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

/** Only the listed roles; others see a clear "no access" page rather than a blank one. */
export function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) {
    return (
      <EmptyState
        icon="ban"
        title="You don't have access to this page"
        description="Your account's role does not include this area."
        action={
          <Link to={homeFor(user)} className={buttonClass({ variant: "primary" })}>
            Go to my page
          </Link>
        }
      />
    );
  }
  return <Outlet />;
}

/** The sign-in page: signed-in users are sent on to where they belong. */
export function PublicOnly() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner label="Loading" />;
  if (user) {
    // back to the page the user originally asked for, if the route guard sent them here
    const from = location.state?.from;
    const wanted = from?.pathname && from.pathname !== "/login" ? `${from.pathname}${from.search ?? ""}` : null;
    return <Navigate to={user.mustChangePassword ? "/change-password" : (wanted ?? homeFor(user))} replace />;
  }
  return <Outlet />;
}
