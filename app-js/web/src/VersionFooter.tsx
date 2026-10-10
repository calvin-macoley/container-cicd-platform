import { useEffect, useState } from "react";

import { getVersion, type Version } from "./api";

/** Shows which build is serving this page (handy when checking a canary). */
export function VersionFooter() {
  const [version, setVersion] = useState<Version | null>(null);

  useEffect(() => {
    let active = true;
    getVersion()
      .then((v) => active && setVersion(v))
      .catch(() => undefined); // purely informational
    return () => {
      active = false;
    };
  }, []);

  return (
    <footer className="footer">
      {version && (
        <span>
          v{version.version} · <code>{version.git_sha.slice(0, 7)}</code> · {version.environment}
        </span>
      )}
    </footer>
  );
}
