import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";

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
    total: number;
  };
};

export function ClientsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["clients-page"],
    queryFn: () =>
      apiRequest<ClientsResponse>("/clients?page=1&pageSize=100&sortBy=updatedAt&sortOrder=desc", {
        accessToken: accessToken ?? undefined
      }),
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
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("Could not create client.");
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
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("Could not update client.");
      }
    }
  });

  const deleteClientMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/clients/${id}`, {
        method: "DELETE",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: refreshClients
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

      <div className="card table-wrap">
        {clientsQuery.isLoading ? (
          <p>Loading clients...</p>
        ) : clientsQuery.isError ? (
          <p>Could not load clients.</p>
        ) : (
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
                        onClick={() => deleteClientMutation.mutate(client.id)}
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
        )}
      </div>
    </section>
  );
}
