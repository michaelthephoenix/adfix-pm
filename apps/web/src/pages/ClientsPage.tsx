import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  meta: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: string;
    total: number;
  };
};

export function ClientsPage() {
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const sortBy = searchParams.get("sortBy") ?? "updatedAt";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const pageSize = 25;

  const clientsQuery = useQuery({
    queryKey: ["clients-page", page, sortBy, sortOrder],
    queryFn: () =>
      apiRequest<ClientsResponse>(
        `/clients?page=${page}&pageSize=${pageSize}&sortBy=${sortBy}&sortOrder=${sortOrder}`,
        {
        accessToken: accessToken ?? undefined
        }
      ),
    enabled: Boolean(accessToken)
  });

  const refreshClients = async () => {
    await queryClient.invalidateQueries({ queryKey: ["clients-page"] });
    await queryClient.invalidateQueries({ queryKey: ["clients-for-project-form"] });
  };

  const createClientMutation = useMutation({
    mutationFn: () =>
      apiRequest("/clients", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          name: name.trim(),
          company: company.trim() ? company.trim() : null,
          email: email.trim() ? email.trim() : null,
          phone: phone.trim() ? phone.trim() : null,
          notes: notes.trim() ? notes.trim() : null
        }
      }),
    onSuccess: async () => {
      setName("");
      setCompany("");
      setEmail("");
      setPhone("");
      setNotes("");
      setEditingId(null);
      setFormError(null);
      await refreshClients();
      ui.success("Client created.");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
        ui.error(error.message);
      } else {
        setFormError("Could not create client.");
        ui.error("Could not create client.");
      }
    }
  });

  const updateClientMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/clients/${editingId}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: {
          name: name.trim(),
          company: company.trim() ? company.trim() : null,
          email: email.trim() ? email.trim() : null,
          phone: phone.trim() ? phone.trim() : null,
          notes: notes.trim() ? notes.trim() : null
        }
      }),
    onSuccess: async () => {
      setName("");
      setCompany("");
      setEmail("");
      setPhone("");
      setNotes("");
      setEditingId(null);
      setFormError(null);
      await refreshClients();
      ui.success("Client updated.");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
        ui.error(error.message);
      } else {
        setFormError("Could not update client.");
        ui.error("Could not update client.");
      }
    }
  });

  const deleteClientMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/clients/${id}`, {
        method: "DELETE",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: async () => {
      await refreshClients();
      ui.success("Client deleted.");
    },
    onError: () => {
      ui.error("Could not delete client.");
    }
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (editingId) {
      updateClientMutation.mutate();
      return;
    }
    createClientMutation.mutate();
  };

  const handleDelete = async (id: string, nameValue: string) => {
    const shouldDelete = await ui.confirm({
      title: "Delete client",
      message: `Delete "${nameValue}"? This cannot be undone.`,
      confirmLabel: "Delete"
    });
    if (!shouldDelete) return;
    deleteClientMutation.mutate(id);
  };

  const setListParam = (key: "page" | "sortBy" | "sortOrder", value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    if (key !== "page") {
      next.set("page", "1");
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <section>
      <div className="section-head">
        <h2>Clients</h2>
        <p className="muted">{clientsQuery.data?.meta.total ?? 0} clients</p>
      </div>

      <form className="card task-create-form" onSubmit={onSubmit}>
        <h3>{editingId ? "Edit client" : "Create client"}</h3>
        <div className="project-form-grid">
          <input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} required />
          <input
            placeholder="Company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
          <input placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <input placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <input placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <button
            className="primary-button"
            type="submit"
            disabled={createClientMutation.isPending || updateClientMutation.isPending}
          >
            {editingId ? "Save" : "Create"}
          </button>
        </div>
        {editingId ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setEditingId(null);
              setName("");
              setCompany("");
              setEmail("");
              setPhone("");
              setNotes("");
            }}
          >
            Cancel edit
          </button>
        ) : null}
        {formError ? <p className="error-text">{formError}</p> : null}
      </form>

      <div className="card tasks-toolbar">
        <select value={sortBy} onChange={(event) => setListParam("sortBy", event.target.value)}>
          <option value="updatedAt">Sort: updatedAt</option>
          <option value="createdAt">Sort: createdAt</option>
          <option value="name">Sort: name</option>
        </select>
        <select value={sortOrder} onChange={(event) => setListParam("sortOrder", event.target.value)}>
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
      </div>

      <div className="card table-wrap">
        {clientsQuery.isLoading ? (
          <LoadingState message="Loading clients..." />
        ) : clientsQuery.isError ? (
          <ErrorState message="Could not load clients." onRetry={() => void clientsQuery.refetch()} />
        ) : (clientsQuery.data?.data.length ?? 0) === 0 ? (
          <EmptyState message="No clients found." />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clientsQuery.data?.data.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link to={`/clients/${client.id}`} className="inline-link">
                        {client.name}
                      </Link>
                    </td>
                    <td>{client.company ?? "-"}</td>
                    <td>{client.email ?? "-"}</td>
                    <td>{client.phone ?? "-"}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            setEditingId(client.id);
                            setName(client.name);
                            setCompany(client.company ?? "");
                            setEmail(client.email ?? "");
                            setPhone(client.phone ?? "");
                            setNotes(client.notes ?? "");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => handleDelete(client.id, client.name)}
                          disabled={deleteClientMutation.isPending}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="inline-actions" style={{ marginTop: "10px" }}>
              <button
                type="button"
                className="ghost-button"
                disabled={page <= 1}
                onClick={() => setListParam("page", String(Math.max(1, page - 1)))}
              >
                Previous
              </button>
              <p className="muted">Page {page}</p>
              <button
                type="button"
                className="ghost-button"
                disabled={(clientsQuery.data?.data.length ?? 0) < pageSize}
                onClick={() => setListParam("page", String(page + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
