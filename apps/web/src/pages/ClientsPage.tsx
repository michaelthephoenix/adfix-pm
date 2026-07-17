import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type ClientRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

type ClientsResponse = {
  data: ClientRow[];
  meta: { page: number; pageSize: number; sortBy: string; sortOrder: string; total: number };
};

const emptyForm = { name: "", company: "", email: "", phone: "", notes: "" };

export function ClientsPage() {
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const sortBy = searchParams.get("sortBy") ?? "updatedAt";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const pageSize = 25;

  const clientsQuery = useQuery({
    queryKey: ["clients-page", page, sortBy, sortOrder],
    queryFn: () => apiRequest<ClientsResponse>(`/clients?page=${page}&pageSize=${pageSize}&sortBy=${sortBy}&sortOrder=${sortOrder}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken)
  });

  const refreshClients = async () => {
    await queryClient.invalidateQueries({ queryKey: ["clients-page"] });
    await queryClient.invalidateQueries({ queryKey: ["clients-for-project-form"] });
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
  };

  const createClientMutation = useMutation({
    mutationFn: () => apiRequest("/clients", {
      method: "POST",
      accessToken: accessToken ?? undefined,
      body: {
        name: form.name.trim(),
        company: form.company.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null
      }
    }),
    onSuccess: async () => {
      closeEditor();
      await refreshClients();
      ui.success("Client created.");
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Could not create client.";
      setFormError(message);
      ui.error(message);
    }
  });

  const updateClientMutation = useMutation({
    mutationFn: () => apiRequest(`/clients/${editingId}`, {
      method: "PUT",
      accessToken: accessToken ?? undefined,
      body: {
        name: form.name.trim(),
        company: form.company.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null
      }
    }),
    onSuccess: async () => {
      closeEditor();
      await refreshClients();
      ui.success("Client updated.");
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Could not update client.";
      setFormError(message);
      ui.error(message);
    }
  });

  const deleteClientMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/clients/${id}`, { method: "DELETE", accessToken: accessToken ?? undefined }),
    onMutate: (id) => setDeletingClientId(id),
    onSuccess: async () => {
      closeEditor();
      await refreshClients();
      ui.success("Client deleted.");
    },
    onError: () => ui.error("Could not delete client."),
    onSettled: () => setDeletingClientId(null)
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    if (editingId) updateClientMutation.mutate();
    else createClientMutation.mutate();
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setIsEditorOpen(true);
  };

  const openEdit = (client: ClientRow) => {
    setEditingId(client.id);
    setForm({
      name: client.name,
      company: client.company ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      notes: client.notes ?? ""
    });
    setFormError(null);
    setIsEditorOpen(true);
  };

  const handleDelete = async () => {
    if (!editingId) return;
    const shouldDelete = await ui.confirm({
      title: "Delete client",
      message: `Delete “${form.name}”? This cannot be undone.`,
      confirmLabel: "Delete"
    });
    if (shouldDelete) deleteClientMutation.mutate(editingId);
  };

  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next, { replace: true });
  };

  const setSort = (value: string) => {
    const [nextSortBy, nextSortOrder] = value.split(":");
    const next = new URLSearchParams(searchParams);
    next.set("sortBy", nextSortBy);
    next.set("sortOrder", nextSortOrder);
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const isSaving = createClientMutation.isPending || updateClientMutation.isPending;

  return (
    <section>
      <PageHeader
        title="Clients"
        description="Organizations and contacts connected to active work."
        meta={<span>{clientsQuery.data?.meta.total ?? 0}</span>}
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={openCreate}>New client</Button>}
      />

      <div className="list-toolbar">
        <span className="list-toolbar-label">All clients</span>
        <select aria-label="Sort clients" value={`${sortBy}:${sortOrder}`} onChange={(event) => setSort(event.target.value)}>
          <option value="updatedAt:desc">Recently updated</option>
          <option value="name:asc">Name A–Z</option>
          <option value="createdAt:desc">Newest</option>
          <option value="createdAt:asc">Oldest</option>
        </select>
      </div>

      <div className="data-view mobile-card-table clients-data-view">
        {clientsQuery.isLoading ? <LoadingState message="Loading clients…" />
          : clientsQuery.isError ? <ErrorState message="Could not load clients." onRetry={() => void clientsQuery.refetch()} />
          : (clientsQuery.data?.data.length ?? 0) === 0 ? <EmptyState message="Create the first client to start a project." />
          : (
            <table>
              <thead><tr><th>Client</th><th>Contact</th><th>Phone</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {clientsQuery.data?.data.map((client) => (
                  <tr key={client.id}>
                    <td><Link to={`/clients/${client.id}`} className="row-title">{client.name}</Link><span className="row-subtitle">{client.company ?? "Independent"}</span></td>
                    <td>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : <span className="muted">Not provided</span>}</td>
                    <td>{client.phone ?? <span className="muted">—</span>}</td>
                    <td className="row-action"><button type="button" className="ui-icon-button" aria-label={`Edit ${client.name}`} onClick={() => openEdit(client)}><MoreHorizontal size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {(clientsQuery.data?.meta.total ?? 0) > pageSize ? (
        <div className="pagination">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>Previous</Button>
          <span>Page {page}</span>
          <Button size="sm" disabled={(clientsQuery.data?.data.length ?? 0) < pageSize} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      ) : null}

      <Dialog
        open={isEditorOpen}
        onOpenChange={(open) => { if (!open) closeEditor(); else setIsEditorOpen(true); }}
        title={editingId ? "Edit client" : "New client"}
        description={editingId ? "Update the organization and primary contact." : "Add an organization before creating its first project."}
        footer={
          <div className="dialog-footer-split">
            <div>{editingId ? <Button variant="danger" disabled={Boolean(deletingClientId)} onClick={() => void handleDelete()}>Delete</Button> : null}</div>
            <div className="inline-actions">
              <Button onClick={closeEditor}>Cancel</Button>
              <Button variant="primary" type="submit" form="client-form" disabled={isSaving || !form.name.trim()}>{isSaving ? "Saving…" : editingId ? "Save changes" : "Create client"}</Button>
            </div>
          </div>
        }
      >
        <form id="client-form" className="ui-form" onSubmit={onSubmit}>
          <label className="field"><span>Name</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required autoFocus /></label>
          <label className="field"><span>Company</span><input value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} /></label>
          <div className="ui-form-row">
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
            <label className="field"><span>Phone</span><input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></label>
          </div>
          <label className="field"><span>Internal notes</span><textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
          {formError ? <p className="error-text">{formError}</p> : null}
        </form>
      </Dialog>
    </section>
  );
}
