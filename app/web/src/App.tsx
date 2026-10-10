import { CreateLinkForm } from "./CreateLinkForm";
import { LinkLookupPanel } from "./LinkLookupPanel";
import { useLinkLookup } from "./useLinkLookup";
import { VersionFooter } from "./VersionFooter";

export function App() {
  const lookup = useLinkLookup();

  return (
    <div className="page">
      <header className="header">
        <h1>Shortener</h1>
        <p className="muted">Shorten a URL, check its clicks, or delete it.</p>
      </header>
      <main>
        <CreateLinkForm onInspect={(code) => void lookup.load(code)} />
        <LinkLookupPanel lookup={lookup} />
      </main>
      <VersionFooter />
    </div>
  );
}
