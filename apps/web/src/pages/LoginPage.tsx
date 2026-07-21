import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../state/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated } = useAuth();
  const invitationEmail = searchParams.get("email")?.trim() ?? "";
  const requestedReturnTo = searchParams.get("returnTo");
  const passwordChanged = searchParams.get("passwordChanged") === "1";
  const returnTo = requestedReturnTo?.startsWith("/invite/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : null;
  const destination = returnTo ?? "/dashboard";
  const [email, setEmail] = useState(invitationEmail || (import.meta.env.DEV ? "admin@adfix.local" : ""));
  const [password, setPassword] = useState(invitationEmail ? "" : (import.meta.env.DEV ? "ChangeMe123!" : ""));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(destination, { replace: true });
    }
  }, [destination, isAuthenticated, navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate(destination, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Login failed");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={handleSubmit}>
        <div className="auth-brand"><span className="brand-mark">A</span><strong>Adfix</strong></div>
        <div className="auth-heading"><h1>Sign in</h1><p className="muted">Project operations and client reviews.</p></div>
        {passwordChanged ? <p className="success-text" role="status">Password changed. Sign in with your new password.</p> : null}
        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted">Client access is provided through a secure invitation from your project team.</p>
      </form>
    </div>
  );
}
