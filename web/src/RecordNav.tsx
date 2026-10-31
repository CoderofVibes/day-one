// Where a click on a number or an id goes (docs/UPGRADE_BRIEF.md §5.1 "every number is
// clickable", §5.8): a record the twin knows (a PO, a lot, a supplier, the escrow) opens in the
// shared inspector as a drawer over the page; anything else opens the page that produced it, its
// table filtered to the record. Mounted once around the pages by each program in App.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inspector } from "./Inspector.tsx";
import { clearPageFilter, KitNavProvider, type RecordTarget, setPageFilter } from "./kit.tsx";
import type { RunData } from "./run.ts";
import type { PageId } from "./shell.tsx";
import { deriveTwinState } from "./twin/model.ts";
import { type InspectorData, inspectObject } from "./twin/objects.ts";

/** The record the twin shows for an id at a step, if it is one of its objects. */
export function resolveRecord(run: RunData, at: number, id: string): InspectorData | undefined {
  return inspectObject(deriveTwinState(run, at), run, at, id);
}

export function RecordNav({
  run,
  at,
  page,
  curtain,
  go,
  children,
}: {
  run: RunData;
  at: number;
  page: PageId;
  curtain: boolean;
  go: (to: { page: PageId }) => void;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState<InspectorData | null>(null);
  // The page a record link is opening: its filter stays; any other arrival starts unfiltered.
  const opening = useRef<PageId | null>(null);
  useEffect(() => {
    if (opening.current !== page) clearPageFilter(page);
    opening.current = null;
    setShown(null);
  }, [page]);
  const openPage = useCallback(
    (to: PageId, filter?: string) => {
      if (filter) setPageFilter(to, filter);
      opening.current = to;
      go({ page: to });
    },
    [go],
  );
  const nav = useMemo(
    () => ({
      open(t: RecordTarget) {
        const data = t.data ?? resolveRecord(run, at, t.id);
        if (data) setShown(data);
        else if (t.page) openPage(t.page, t.filter ?? t.id);
      },
    }),
    [run, at, openPage],
  );
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShown(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);
  return (
    <KitNavProvider value={nav}>
      {children}
      {shown && (
        <div className="record-drawer">
          <button
            type="button"
            className="record-drawer-backdrop"
            aria-label="Close the inspector"
            onClick={() => setShown(null)}
          />
          <Inspector
            data={shown}
            curtain={curtain}
            onClose={() => setShown(null)}
            onOpen={(to) => openPage(to, /\d/.test(shown.id) ? shown.id : undefined)}
          />
        </div>
      )}
    </KitNavProvider>
  );
}
