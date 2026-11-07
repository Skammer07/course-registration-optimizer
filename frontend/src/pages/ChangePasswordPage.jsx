import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.jsx";
import { homeFor } from "../auth/guards.jsx";
import * as authApi from "../api/auth.js";
import { AuthLayout } from "../components/layout/AuthLayout.jsx";
import { Alert, ErrorAlert } from "../components/ui/Alert.jsx";
import { Button } from "../components/ui/Button.jsx";
import { TextField } from "../components/ui/Fields.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useDocumentTitle } from "../lib/hooks.js";

/** Client-side checks that mirror the API rules, so most mistakes never reach the server. */
export function validatePasswordChange({ current, next, confirm }) {
  const errors = {};
  if (!current) errors.current = "Enter your current password.";
  if (next.length < 8) errors.next = "Use at least 8 characters.";
  else if (next.length > 128) errors.next = "Use at most 128 characters.";
  else if (next === current) errors.next = "Choose a password different from the current one.";
  if (confirm !== next) errors.confirm = "The two passwords do not match.";
  return errors;
}

export function ChangePasswordPage() {
  useDocumentTitle("Change password");
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const forced = user.mustChangePassword;

  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const errors = validatePasswordChange(form);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const show = (key) => (touched ? errors[key] : undefined);

  const onSubmit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(form.current, form.next);
      await refresh();
      toast.success("Password changed", "You are signed in with your new password.");
      navigate(homeFor(user), { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const signOut = () => logout();

  return (
    <AuthLayout
      title={forced ? "Choose your own password" : "Change password"}
      subtitle={user.email}
      footer={
        forced ? (
          <button type="button" onClick={signOut} className="underline underline-offset-2 hover:text-ink">
            Sign out instead
          </button>
        ) : (
          <Link to={homeFor(user)} className="underline underline-offset-2 hover:text-ink">
            Cancel
          </Link>
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {forced ? (
          <Alert tone="info" title="You are using a temporary password">
            Set a password only you know to continue. Use the temporary one you were given as your current password.
          </Alert>
        ) : null}
        <ErrorAlert error={error} />

        <TextField label="Current password" type="password" autoComplete="current-password" value={form.current} onChange={set("current")} error={show("current")} required />
        <TextField label="New password" type="password" autoComplete="new-password" value={form.next} onChange={set("next")} error={show("next")} hint="At least 8 characters." required />
        <TextField label="Repeat new password" type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} error={show("confirm")} required />

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}
