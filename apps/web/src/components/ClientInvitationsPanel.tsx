import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clipboard, MailPlus, RotateCcw, X } from "lucide-react";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";

type Invitation = {
  id: string; email: string; role: string; expires_at: string; accepted_at: string | null;
  revoked_at: string | null; created_at: string; inviteUrl?: string;
};

export function ClientInvitationsPanel({ clientId }: { clientId: string }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"reviewer" | "viewer">("reviewer");
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["client-invitations", clientId],
    queryFn: () => apiRequest<{ data: Invitation[] }>(`/client-invitations/client/${clientId}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken && clientId)
  });
  const createMutation = useMutation({
    mutationFn: () => apiRequest<{ data: Invitation }>("/client-invitations", { method: "POST", accessToken: accessToken ?? undefined, body: { clientId, email, role } }),
    onSuccess: async (result) => { setLatestUrl(result.data.inviteUrl ?? null); setEmail(""); setError(null); await queryClient.invalidateQueries({ queryKey: ["client-invitations", clientId] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not create invitation.")
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/client-invitations/${id}`, { method: "DELETE", accessToken: accessToken ?? undefined }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["client-invitations", clientId] })
  });
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); createMutation.mutate(); };
  const invitations = query.data?.data ?? [];
  return (
    <section className="card invitations-panel">
      <div className="section-head"><div><p className="eyebrow">Client portal</p><h3>Client invitations</h3><p className="muted">Invite reviewers with a secure seven-day link.</p></div><MailPlus size={24} /></div>
      <form className="invitation-form" onSubmit={submit}>
        <input type="email" placeholder="client@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <select value={role} onChange={(event) => setRole(event.target.value as "reviewer" | "viewer")}><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option></select>
        <button className="primary-button" disabled={createMutation.isPending}>Create invitation</button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
      {latestUrl ? <div className="invite-link-result"><div><strong>Invitation ready</strong><p className="mono-cell">{latestUrl}</p></div><button className="ghost-button button-with-icon" onClick={() => void copy(latestUrl)}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "Copied" : "Copy link"}</button></div> : null}
      {invitations.length ? <div className="invitation-list">{invitations.map((invitation) => {
        const status = invitation.accepted_at ? "accepted" : invitation.revoked_at ? "revoked" : new Date(invitation.expires_at).getTime() < Date.now() ? "expired" : "active";
        return <div className="invitation-row" key={invitation.id}><div><strong>{invitation.email}</strong><p className="muted">{invitation.role} · expires {new Date(invitation.expires_at).toLocaleDateString()}</p></div><span className={`invite-status status-${status}`}>{status}</span>{status === "active" ? <button className="icon-button" aria-label={`Revoke invitation for ${invitation.email}`} onClick={() => revokeMutation.mutate(invitation.id)}><X size={16} /></button> : <RotateCcw size={15} className="muted" />}</div>;
      })}</div> : null}
    </section>
  );
}
