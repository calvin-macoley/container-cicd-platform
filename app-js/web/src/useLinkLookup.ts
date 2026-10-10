/** State for looking up, showing and deleting one link. */

import { useCallback, useRef, useState } from "react";

import { ApiError, deleteLink, getLink, type Link } from "./api";

export type LookupState =
  | { status: "idle" }
  | { status: "loading"; code: string }
  | { status: "found"; link: Link }
  | { status: "missing"; code: string }
  | { status: "deleted"; code: string }
  | { status: "error"; message: string };

export interface LinkLookup {
  state: LookupState;
  load: (code: string) => Promise<void>;
  remove: (code: string) => Promise<void>;
}

const message = (error: unknown): string =>
  error instanceof ApiError ? error.message : "Something went wrong.";

export function useLinkLookup(): LinkLookup {
  const [state, setState] = useState<LookupState>({ status: "idle" });
  // Ignore answers to lookups that a newer one has superseded.
  const latest = useRef(0);

  const load = useCallback(async (code: string) => {
    const ticket = ++latest.current;
    setState({ status: "loading", code });
    try {
      const link = await getLink(code);
      if (ticket === latest.current) setState({ status: "found", link });
    } catch (error) {
      if (ticket !== latest.current) return;
      if (error instanceof ApiError && error.status === 404) setState({ status: "missing", code });
      else setState({ status: "error", message: message(error) });
    }
  }, []);

  const remove = useCallback(async (code: string) => {
    const ticket = ++latest.current;
    try {
      await deleteLink(code);
      if (ticket === latest.current) setState({ status: "deleted", code });
    } catch (error) {
      if (ticket !== latest.current) return;
      if (error instanceof ApiError && error.status === 404) setState({ status: "missing", code });
      else setState({ status: "error", message: message(error) });
    }
  }, []);

  return { state, load, remove };
}
