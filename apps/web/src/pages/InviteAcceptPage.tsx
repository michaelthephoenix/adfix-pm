import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import type { AuthTokens } from "../types";
import { LoadingState } from "../components/States";

type InvitationResponse = {
  data: {
    clientName: string;
    email: string;
    role: string;
    expiresAt: string;
    isValid: boolean;
    accountExists: boolean;
  };
};

export function InviteAcceptPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { user, accessToken, adoptSession, logout } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const invitationQuery = useQuery({
    queryKey: ["client-invitation", token],
    queryFn: () => apiRequest<InvitationResponse>(`/client-invitations/token/${token}`),
    enabled: Boolean(token),
    retry: false
  });

  if (!token) return <Navigate to="/login" replace />;
  if (invitationQuery.isLoading) return <LoadingState message="Checking invitation..." />;
  const invitation = invitationQuery.data?.data;

  const goToInvitedAccountLogin = async () => {
    if (user) await logout();
    const returnTo = `/invite/${token}`;
    navigate(`/login?email=${encodeURIComponent(invitation?.email ?? "")}&returnTo=${encodeURIComponent(returnTo)}`);
  };

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (user) {
        await apiRequest(`/client-invitations/token/${token}/accept-existing`, {
          method: "POST",
          accessToken: accessToken ?? undefined,
          body: {}
        });
      } else {
        const result = await apiRequest<AuthTokens>(`/client-invitations/token/${token}/accept`, {
          method: "POST",
          body: { name, password }
        });
        adoptSession(result);
      }
      navigate("/portal/projects", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not accept invitation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!invitation || invitationQuery.isError) {
    return <main className="invite-wrap"><section className="invite-card"><h1>Invitation unavailable</h1><p>This link is invalid or has expired. Ask your Adfix contact for a new invitation.</p></section></main>;
  }

  const signedInWithInvitedClientAccount = Boolean(
    user?.accountType === "client" && user.email.toLowerCase() === invitation.email.toLowerCase()
  );
  const signedInWithWrongAccount = Boolean(user && !signedInWithInvitedClientAccount);

  return (
    <main className="invite-wrap">
      <section className="invite-card">
        <div className="invite-icon"><ShieldCheck size={28} /></div>
        <p className="eyebrow">Adfix client workspace</p>
        <h1>You’re invited to collaborate</h1>
        <p className="invite-lead">Join <strong>{invitation.clientName}</strong> to review project work and final deliverables.</p>
        <div className="invite-facts">
          <span><CheckCircle2 size={16} /> {invitation.email}</span>
          <span><Clock3 size={16} /> Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
        </div>
        {!invitation.isValid ? <p className="error-text">This invitation is no longer valid.</p> : signedInWithWrongAccount ? (
          <div className="invite-form">
            <p className="error-text" role="alert">
              This invitation was sent to <strong>{invitation.email}</strong>, but you are signed in as <strong>{user?.email}</strong>.
            </p>
            <button className="primary-button" type="button" onClick={() => void goToInvitedAccountLogin()}>
              Sign in with invited email
            </button>
          </div>
        ) : invitation.accountExists && !user ? (
          <div className="invite-form">
            <p>An account already exists for <strong>{invitation.email}</strong>. Sign in to securely accept this invitation.</p>
            <button className="primary-button" type="button" onClick={() => void goToInvitedAccountLogin()}>
              Sign in to accept
            </button>
          </div>
        ) : (
          <form onSubmit={accept} className="invite-form">
            {signedInWithInvitedClientAccount ? <p>Signed in as <strong>{user?.email}</strong></p> : (
              <>
                <label className="field">Your name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                <label className="field">Create password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
              </>
            )}
            {error ? <p className="error-text" role="alert">{error}</p> : null}
            <button className="primary-button" disabled={submitting}>{submitting ? "Joining..." : "Accept invitation"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
