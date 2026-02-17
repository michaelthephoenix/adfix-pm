import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

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
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const scope = "all";

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

      {!canSearch ? (
        <EmptyState message="Enter at least 2 characters to search." />
      ) : searchQuery.isLoading ? (
        <LoadingState message="Searching..." />
      ) : searchQuery.isError ? (
        <ErrorState message="Could not run search." onRetry={() => void searchQuery.refetch()} />
      ) : (
        <div className="tasks-pane">
          <ResultSection title="Projects" items={searchQuery.data?.data.projects ?? []} />
          <ResultSection title="Tasks" items={searchQuery.data?.data.tasks ?? []} />
          <ResultSection title="Files" items={searchQuery.data?.data.files ?? []} />
          <ResultSection title="Clients" items={searchQuery.data?.data.clients ?? []} />
          {(searchQuery.data?.data.projects.length ?? 0) +
            (searchQuery.data?.data.tasks.length ?? 0) +
            (searchQuery.data?.data.files.length ?? 0) +
            (searchQuery.data?.data.clients.length ?? 0) ===
            0 ? (
            <EmptyState message="No results found." />
          ) : null}
        </div>
      )}
    </section>
  );
}
