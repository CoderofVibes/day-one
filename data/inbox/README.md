# data/inbox

Kevin's watched folder (docs/research/24-bigger-phase-scope.md §1). `npm run api` watches
`data/inbox/batch-records/`: a scan dropped there is read with the same pipeline as an upload
(`agents/kevin/src/inbox.ts`), checked against the formula and the ledger, and waits for Ray on
his screen under "Waiting for you". Nothing posts until he confirms.

- `npm run inbox` copies the demo scans in (BR-B-1044, BR-B-1045, BR-B-1046 and the PO-1042
  packing slip, which Kevin sets aside as not a batch record) and prints each one as it lands.
- Kevin reads JPEG files once their size holds still; the same scan dropped twice is one item.
- Replay reads the recorded answers in `data/replay/inbox-llm.json` (BR-B-1045's is the run's
  own, in `demo-llm.json`). A scan with no recorded answer shows as "not read" until a live run.

The folder's contents are not committed (`.gitignore`). All records are fictional.
