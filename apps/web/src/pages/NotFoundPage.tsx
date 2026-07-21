import { ArrowLeft, Home } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <section className="not-found-page" aria-labelledby="not-found-title">
      <p className="eyebrow">404 · Page not found</p>
      <h1 id="not-found-title">That page is not part of this workspace</h1>
      <p>The link may be outdated, or the item may have been archived or removed.</p>
      <div className="inline-actions">
        <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>Go back</Button>
        <Link className="ui-button ui-button-primary ui-button-md" to="/"><Home size={16} />Workspace home</Link>
      </div>
    </section>
  );
}
