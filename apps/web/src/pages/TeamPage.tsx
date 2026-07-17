import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clipboard, Eye, MailPlus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type StaffUser = {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  last_login_at: string | null;
  created_at: string;
};

type UsersResponse = { data: StaffUser[]; meta: { total: number } };
type Client = { id: string; name: string; company: string | null; email: string | null };
type ClientsResponse = { data: Client[]; meta: { total: number } };
type ClientAccessRecord = {
  id: string;
  kind: "membership" | "invitation";
  client_id: string;
  client_name: string;
  user_name: string | null;
  email: string;
  role: "reviewer" | "viewer";
  status: "active" | "pending" | "revoked" | "expired";
  expires_at: string | null;
  created_at: string;
};

const emptyStaffForm = { name: "", email: "", password: "", isAdmin: false };

export function TeamPage() {
  const { accessToken, user } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const isAdmin = Boolean(user?.isAdmin);
  const [activeView, setActiveView] = useState<"staff" | "clients">("staff");
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteClientId, setInviteClientId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"reviewer" | "viewer">("reviewer");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [processingUserUpdate, setProcessingUserUpdate] = useState<{ userId: string; nextIsActive: boolean } | null>(null);

  const usersQuery = useQuery({
    queryKey: ["team-users"],
    queryFn: () => apiRequest<UsersResponse>("/users?page=1&pageSize=100&sortBy=name&sortOrder=asc", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken)
  });

  const clientsQuery = useQuery({
    queryKey: ["team-client-organizations"],
    queryFn: () => apiRequest<ClientsResponse>("/clients?page=1&pageSize=100&sortBy=name&sortOrder=asc", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken && activeView === "clients")
  });

  const clientAccessQuery = useQuery({
    queryKey: ["team-client-access"],
    queryFn: () => apiRequest<{ data: ClientAccessRecord[] }>("/client-invitations", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken && activeView === "clients")
  });

  const createStaffMutation = useMutation({
    mutationFn: () => apiRequest("/users", {
      method: "POST",
      accessToken: accessToken ?? undefined,
      body: { name: staffForm.name.trim(), email: staffForm.email.trim(), password: staffForm.password, isAdmin: staffForm.isAdmin }
    }),
    onSuccess: async () => {
      setStaffDialogOpen(false);
      setStaffForm(emptyStaffForm);
      setStaffError(null);
      await queryClient.invalidateQueries({ queryKey: ["team-users"] });
      ui.success("Staff account created.");
    },
    onError: (error) => setStaffError(error instanceof ApiError ? error.message : "Could not create staff account.")
  });

  const createInvitationMutation = useMutation({
    mutationFn: () => apiRequest<{ data: { inviteUrl?: string } }>("/client-invitations", {
      method: "POST",
      accessToken: accessToken ?? undefined,
      body: { clientId: inviteClientId, email: inviteEmail.trim(), role: inviteRole }
    }),
    onSuccess: async (result) => {
      setCreatedInviteUrl(result.data.inviteUrl ?? null);
      setInviteError(null);
      await queryClient.invalidateQueries({ queryKey: ["team-client-access"] });
      ui.success("Client invitation created.");
    },
    onError: (error) => setInviteError(error instanceof ApiError ? error.message : "Could not create client invitation.")
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => apiRequest(`/client-invitations/${invitationId}`, { method: "DELETE", accessToken: accessToken ?? undefined }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["team-client-access"] });
      ui.success("Invitation revoked.");
    },
    onError: () => ui.error("Could not revoke invitation.")
  });

  const toggleUserStatusMutation = useMutation({
    onMutate: async (input: { userId: string; isActive: boolean }) => {
      setProcessingUserUpdate({ userId: input.userId, nextIsActive: input.isActive });
      const previous = queryClient.getQueryData<UsersResponse>(["team-users"]);
      if (previous) queryClient.setQueryData<UsersResponse>(["team-users"], { ...previous, data: previous.data.map((row) => row.id === input.userId ? { ...row, is_active: input.isActive } : row) });
      return { previous };
    },
    mutationFn: (input: { userId: string; isActive: boolean }) => apiRequest(`/users/${input.userId}/status`, { method: "PATCH", accessToken: accessToken ?? undefined, body: { isActive: input.isActive } }),
    onSuccess: async (_result, input) => { ui.success(input.isActive ? "User activated." : "User deactivated."); await queryClient.invalidateQueries({ queryKey: ["team-users"] }); },
    onError: (_error, _input, context) => { if (context?.previous) queryClient.setQueryData(["team-users"], context.previous); ui.error("Could not update user status."); },
    onSettled: () => setProcessingUserUpdate(null)
  });

  const closeStaffDialog = () => {
    setStaffDialogOpen(false);
    setStaffForm(emptyStaffForm);
    setStaffError(null);
  };

  const closeInviteDialog = () => {
    setInviteDialogOpen(false);
    setInviteClientId("");
    setInviteEmail("");
    setInviteRole("reviewer");
    setInviteError(null);
    setCreatedInviteUrl(null);
    setCopied(false);
  };

  const copyInvite = async () => {
    if (!createdInviteUrl) return;
    await navigator.clipboard.writeText(createdInviteUrl);
    setCopied(true);
  };

  const staffCount = usersQuery.data?.meta.total ?? 0;
  const clientAccessCount = clientAccessQuery.data?.data.filter((record) => record.status === "active").length ?? 0;

  return (
    <section className="access-management-page">
      <PageHeader
        title="Team & access"
        description="Manage internal staff accounts and the separate client review portal."
        meta={<span>{activeView === "staff" ? staffCount : clientAccessCount}</span>}
        actions={isAdmin ? activeView === "staff"
          ? <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setStaffDialogOpen(true)}>Add team member</Button>
          : <Button variant="primary" icon={<MailPlus size={16} />} onClick={() => setInviteDialogOpen(true)}>Invite client</Button>
          : undefined}
      />

      <div className="access-view-tabs" role="tablist" aria-label="Access type">
        <button type="button" role="tab" aria-selected={activeView === "staff"} className={activeView === "staff" ? "active" : ""} onClick={() => setActiveView("staff")}><Users size={16} /> Internal team <span>{staffCount}</span></button>
        <button type="button" role="tab" aria-selected={activeView === "clients"} className={activeView === "clients" ? "active" : ""} onClick={() => setActiveView("clients")}><ShieldCheck size={16} /> Client access <span>{clientAccessCount}</span></button>
      </div>

      {activeView === "staff" ? (
        <div className="data-view mobile-card-table team-data-view">
          {usersQuery.isLoading ? <LoadingState message="Loading team members..." /> : usersQuery.isError ? <ErrorState message="Could not load team members." onRetry={() => void usersQuery.refetch()} /> : !usersQuery.data?.data.length ? <EmptyState message="Add the first staff account." /> : (
            <table><thead><tr><th>Team member</th><th>Workspace role</th><th>Status</th><th>Last login</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {usersQuery.data.data.map((item) => <tr key={item.id}><td><span className="row-title">{item.name}</span><span className="row-subtitle">{item.email}</span></td><td>{item.is_admin ? "Administrator" : "Member"}</td><td><span className={`status-chip status-${item.is_active ? "active" : "inactive"}`}>{item.is_active ? "Active" : "Inactive"}</span></td><td>{item.last_login_at ? new Date(item.last_login_at).toLocaleString() : "Never"}</td><td className="row-action">{isAdmin ? <Button size="sm" variant={item.is_active ? "ghost" : "secondary"} disabled={Boolean(processingUserUpdate)} onClick={() => toggleUserStatusMutation.mutate({ userId: item.id, isActive: !item.is_active })}>{processingUserUpdate?.userId === item.id ? "Saving..." : item.is_active ? "Deactivate" : "Activate"}</Button> : null}</td></tr>)}
            </tbody></table>
          )}
        </div>
      ) : (
        <div className="client-access-view">
          <div className="client-access-explainer">
            <div><Eye size={18} /><div><strong>Viewer</strong><p>Read-only access to shared projects, deliverables, downloads, and review history.</p></div></div>
            <div><ShieldCheck size={18} /><div><strong>Reviewer</strong><p>The same separate portal, plus approval and change-request comments before Delivery.</p></div></div>
            <p>Clients never see internal tasks, staff notes, budgets, team management, audit logs, or internal activity.</p>
          </div>
          <div className="data-view mobile-card-table client-access-data-view">
            {clientAccessQuery.isLoading ? <LoadingState message="Loading client access..." /> : clientAccessQuery.isError ? <ErrorState message="Could not load client access." onRetry={() => void clientAccessQuery.refetch()} /> : !clientAccessQuery.data?.data.length ? <EmptyState message="Invite a client to the review portal." /> : (
              <table><thead><tr><th>Client user</th><th>Organization</th><th>Portal role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
                {clientAccessQuery.data.data.map((record) => <tr key={`${record.kind}-${record.id}`}><td><span className="row-title">{record.user_name ?? record.email}</span>{record.user_name ? <span className="row-subtitle">{record.email}</span> : null}</td><td>{record.client_name}</td><td>{record.role === "reviewer" ? "Reviewer" : "Viewer · read only"}</td><td><span className={`status-chip status-${record.status}`}>{record.status}</span></td><td className="row-action">{record.kind === "invitation" && record.status === "pending" && isAdmin ? <Button size="sm" variant="ghost" disabled={revokeInvitationMutation.isPending} onClick={() => revokeInvitationMutation.mutate(record.id)}>Revoke</Button> : null}</td></tr>)}
              </tbody></table>
            )}
          </div>
        </div>
      )}

      <Dialog open={staffDialogOpen} onOpenChange={(open) => { if (!open) closeStaffDialog(); else setStaffDialogOpen(true); }} title="Add a team member" description="Create an internal staff account for the Adfix workspace." footer={<div className="inline-actions"><Button variant="ghost" onClick={closeStaffDialog}>Cancel</Button><Button variant="primary" type="submit" form="create-staff-account-form" icon={<UserPlus size={16} />} disabled={!staffForm.name.trim() || !staffForm.email.trim() || staffForm.password.length < 8 || createStaffMutation.isPending}>{createStaffMutation.isPending ? "Creating..." : "Create account"}</Button></div>}>
        <form id="create-staff-account-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); createStaffMutation.mutate(); }}>
          <label className="field"><span>Full name</span><input autoFocus value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Alex Creative" required /></label>
          <label className="field"><span>Work email</span><input type="email" value={staffForm.email} onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))} placeholder="alex@adfix.com" required /></label>
          <label className="field"><span>Initial password</span><input type="password" minLength={8} value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} placeholder="At least 8 characters" required /><small>Share this securely so the team member can sign in.</small></label>
          <label className="field"><span>Workspace role</span><select value={staffForm.isAdmin ? "admin" : "member"} onChange={(event) => setStaffForm((current) => ({ ...current, isAdmin: event.target.value === "admin" }))}><option value="member">Member — project work only</option><option value="admin">Administrator — manage workspace access</option></select></label>
          {staffError ? <p className="error-text">{staffError}</p> : null}
        </form>
      </Dialog>

      <Dialog open={inviteDialogOpen} onOpenChange={(open) => { if (!open) closeInviteDialog(); else setInviteDialogOpen(true); }} title="Invite a client" description="Give a client contact access to the separate review portal." footer={!createdInviteUrl ? <div className="inline-actions"><Button variant="ghost" onClick={closeInviteDialog}>Cancel</Button><Button variant="primary" type="submit" form="create-client-invitation-form" icon={<MailPlus size={16} />} disabled={!inviteClientId || !inviteEmail.trim() || createInvitationMutation.isPending}>{createInvitationMutation.isPending ? "Creating..." : "Create invitation"}</Button></div> : <div className="inline-actions"><Button variant="primary" onClick={closeInviteDialog}>Done</Button></div>}>
        {createdInviteUrl ? <div className="invitation-ready"><div className="invite-icon"><Check size={18} /></div><div><h3>Invitation ready</h3><p className="muted">Copy this secure link and send it to {inviteEmail}. It expires in seven days.</p></div><div className="invite-link-result"><span className="mono-cell">{createdInviteUrl}</span><Button variant="secondary" icon={copied ? <Check size={15} /> : <Clipboard size={15} />} onClick={() => void copyInvite()}>{copied ? "Copied" : "Copy link"}</Button></div></div> : (
          <form id="create-client-invitation-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); createInvitationMutation.mutate(); }}>
            <label className="field"><span>Client organization</span><select autoFocus value={inviteClientId} onChange={(event) => setInviteClientId(event.target.value)} required><option value="">Select client</option>{clientsQuery.data?.data.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            {!clientsQuery.isLoading && !clientsQuery.data?.data.length ? <p className="form-guidance">No client organizations exist yet. <Link to="/clients" onClick={closeInviteDialog}>Create a client record first</Link>.</p> : null}
            <label className="field"><span>Client email</span><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="client@example.com" required /></label>
            <label className="field"><span>Portal access</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "reviewer" | "viewer")}><option value="reviewer">Reviewer — view, comment, approve, or request changes</option><option value="viewer">Viewer — read-only access</option></select></label>
            {inviteError ? <p className="error-text">{inviteError}</p> : null}
          </form>
        )}
      </Dialog>
    </section>
  );
}
