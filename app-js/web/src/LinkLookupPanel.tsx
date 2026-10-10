import { useId, useState, type FormEvent } from "react";

import { extractCode, type Link } from "./api";
import { CopyButton } from "./CopyButton";
import type { LinkLookup } from "./useLinkLookup";

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

function LinkDetails({ link, onDelete }: { link: Link; onDelete: () => void }) {
  return (
    <div className="details">
      <div className="short-url">
        <a href={link.short_url} target="_blank" rel="noreferrer">
          {link.short_url}
        </a>
        <CopyButton text={link.short_url} />
        {link.is_expired && <span className="badge">Expired</span>}
      </div>
      <dl>
        <dt>Target</dt>
        <dd className="truncate" title={link.target_url}>
          <a href={link.target_url} target="_blank" rel="noreferrer">
            {link.target_url}
          </a>
        </dd>
        <dt>Clicks</dt>
        <dd className="number">{link.click_count.toLocaleString()}</dd>
        <dt>Last clicked</dt>
        <dd>{formatDate(link.last_clicked_at)}</dd>
        <dt>Created</dt>
        <dd>{formatDate(link.created_at)}</dd>
        <dt>Expires</dt>
        <dd>{link.expires_at ? formatDate(link.expires_at) : "Never"}</dd>
      </dl>
      <button type="button" className="danger" onClick={onDelete}>
        Delete link
      </button>
    </div>
  );
}

export function LinkLookupPanel({ lookup }: { lookup: LinkLookup }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const { state } = lookup;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = extractCode(query);
    if (code) void lookup.load(code);
  }

  function confirmDelete(link: Link) {
    if (window.confirm(`Delete ${link.short_url}? Visitors will get “not found”.`)) {
      void lookup.remove(link.code);
    }
  }

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Look up a link</h2>
      <form onSubmit={submit} className="inline-form">
        <label htmlFor={`${id}-code`} className="visually-hidden">
          Short code or URL
        </label>
        <input
          id={`${id}-code`}
          placeholder="Code or short URL"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={!extractCode(query) || state.status === "loading"}>
          Look up
        </button>
      </form>

      <div aria-live="polite">
        {state.status === "loading" && <p className="muted">Loading “{state.code}”…</p>}
        {state.status === "missing" && <p className="muted">No link with code “{state.code}”.</p>}
        {state.status === "deleted" && <p className="success">Deleted “{state.code}”.</p>}
        {state.status === "error" && (
          <p className="error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "found" && (
          <LinkDetails link={state.link} onDelete={() => confirmDelete(state.link)} />
        )}
      </div>
    </section>
  );
}
