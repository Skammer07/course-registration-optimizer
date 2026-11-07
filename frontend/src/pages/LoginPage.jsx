import { useState } from "react";
import { useAuth } from "../auth/AuthProvider.jsx";
import { AuthLayout } from "../components/layout/AuthLayout.jsx";
import { Alert, ErrorAlert } from "../components/ui/Alert.jsx";
import { Button } from "../components/ui/Button.jsx";
import { TextField } from "../components/ui/Fields.jsx";
import { useDocumentTitle } from "../lib/hooks.js";

/** Sign in. Where the user lands afterwards is decided by <PublicOnly> once the session exists. */
export function LoginPage() {
  useDocumentTitle("Sign in");
  const { login, sessionExpired } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Use the account your administrator created for you.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {sessionExpired ? (
          <Alert tone="warning" title="Your session ended">
            For your security you are signed out after a while. Please sign in again.
          </Alert>
        ) : null}

        {error?.status === 401 ? (
          <Alert tone="critical" title="Sign-in failed">
            {error.message}
          </Alert>
        ) : (
          <ErrorAlert error={error} />
        )}

        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <div>
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="mt-1.5 text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            {showPassword ? "Hide password" : "Show password"}
          </button>
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
