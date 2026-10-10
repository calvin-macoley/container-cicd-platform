import { useId, useState, type FormEvent } from "react";

import { ApiError, createLink, type FieldErrors, type Link } from "./api";
import { CopyButton } from "./CopyButton";

interface Props {
  /** Show the full details of a link (the lookup panel). */
  onInspect: (code: string) => void;
}

export function CreateLinkForm({ onInspect }: Props) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<Link | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const link = await createLink({
        url: url.trim(),
        alias: alias.trim() || undefined,
        // datetime-local has no zone: it is the browser's local time.
        expiresAt: expires ? new Date(expires) : undefined,
      });
      setCreated(link);
      setUrl("");
      setAlias("");
      setExpires("");
    } catch (err) {
      setCreated(null);
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (name: keyof FieldErrors) => ({
    "aria-invalid": fieldErrors[name] ? true : undefined,
    "aria-describedby": fieldErrors[name] ? `${id}-${name}-error` : undefined,
  });
  const fieldError = (name: keyof FieldErrors) =>
    fieldErrors[name] && (
      <p className="field-error" id={`${id}-${name}-error`}>
        {fieldErrors[name]}
      </p>
    );

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Shorten a URL</h2>
      <form onSubmit={submit} noValidate>
        <label htmlFor={`${id}-url`}>Long URL</label>
        <input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          placeholder="https://example.com/a/very/long/path"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          {...field("url")}
        />
        {fieldError("url")}

        <div className="row">
          <div>
            <label htmlFor={`${id}-alias`}>
              Custom alias <span className="optional">optional</span>
            </label>
            <input
              id={`${id}-alias`}
              placeholder="my-link"
              autoCapitalize="off"
              spellCheck={false}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              {...field("alias")}
            />
            {fieldError("alias") ?? <p className="hint">3–32 letters, digits, “_” or “-”.</p>}
          </div>
          <div>
            <label htmlFor={`${id}-expires`}>
              Expires <span className="optional">optional</span>
            </label>
            <input
              id={`${id}-expires`}
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              {...field("expires_at")}
            />
            {fieldError("expires_at")}
          </div>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !url.trim()}>
          {busy ? "Shortening…" : "Shorten"}
        </button>
      </form>

      {created && (
        <div className="result" role="status">
          <p className="result-label">Your short link</p>
          <div className="short-url">
            <a href={created.short_url} target="_blank" rel="noreferrer">
              {created.short_url}
            </a>
            <CopyButton text={created.short_url} />
          </div>
          <p className="muted truncate" title={created.target_url}>
            → {created.target_url}
          </p>
          <button type="button" className="link-button" onClick={() => onInspect(created.code)}>
            View stats
          </button>
        </div>
      )}
    </section>
  );
}
