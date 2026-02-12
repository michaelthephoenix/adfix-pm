import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

type SearchItem = {
  id: string;
  type: "project" | "task" | "file" | "client";
  title: string;
  subtitle: string | null;
  projectId: string | null;
  clientId: string | null;
  matchedOn: string;
};

type SearchResponse = {
  data: {
    projects: SearchItem[];
    tasks: SearchItem[];
    files: SearchItem[];
    clients: SearchItem[];
  };
};

const scopes = [
  { value: "all", label: "All" },
  { value: "projects", label: "Projects" },
  { value: "tasks", label: "Tasks" },
  { value: "files", label: "Files" },
  { value: "clients", label: "Clients" }
] as const;

function ResultSection({
  title,
  items
}: {
  title: string;
  items: SearchItem[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="activity-list">
        {items.map((item) => (
          <article key={item.id} className="activity-item">
            <div className="section-head">
              <div>
                {item.projectId ? (
                  <Link className="inline-link" to={`/projects/${item.projectId}`}>
                    {item.title}
                  </Link>
                ) : (
                  <p className="notice-title">{item.title}</p>
                )}
                <p className="muted">{item.subtitle ?? "-"}</p>
              </div>
              <p className="eyebrow">{item.type}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function SearchPage() {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState("demo");
  const [scope, setScope] = useState<(typeof scopes)[number]["value"]>("all");

  const canSearch = query.trim().length >= 2;

  const searchQuery = useQuery({
    queryKey: ["search", query, scope],
    queryFn: () =>
      apiRequest<SearchResponse>(
        `/search?q=${encodeURIComponent(query.trim())}&scope=${scope}&limit=20`,
        {
          accessToken: accessToken ?? undefined
        }
      ),
    enabled: Boolean(accessToken && canSearch)
  });

  return (
    <section>
      <div className="section-head">
        <h2>Search</h2>
      </div>

      <div className="card tasks-toolbar">
        <input
          placeholder="Search projects, tasks, files, clients..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={scope} onChange={(event) => setScope(event.target.value as (typeof scopes)[number]["value"])}>
          {scopes.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {!canSearch ? (
        <div className="state-card">Enter at least 2 characters to search.</div>
      ) : searchQuery.isLoading ? (
        <div className="state-card">Searching...</div>
      ) : searchQuery.isError ? (
        <div className="state-card">Could not run search.</div>
      ) : (
        <div className="tasks-pane">
          <ResultSection title="Projects" items={searchQuery.data?.data.projects ?? []} />
          <ResultSection title="Tasks" items={searchQuery.data?.data.tasks ?? []} />
          <ResultSection title="Files" items={searchQuery.data?.data.files ?? []} />
          <ResultSection title="Clients" items={searchQuery.data?.data.clients ?? []} />
          {scope === "all" &&
          (searchQuery.data?.data.projects.length ?? 0) +
            (searchQuery.data?.data.tasks.length ?? 0) +
            (searchQuery.data?.data.files.length ?? 0) +
            (searchQuery.data?.data.clients.length ?? 0) ===
            0 ? (
            <div className="state-card">No results found.</div>
          ) : null}
        </div>
      )}
    </section>
  );
}
