// Talk to Kevin's data (docs/UPGRADE_BRIEF.md §3.2): the suggested questions with their recorded,
// signed answers (web/src/data/ask.json, written by npm run web:data from
// data/replay/ask-llm.json), and, behind the running API, POST /api/ask for any question. The
// shapes mirror agents/kevin/src/ask.ts and api/src/ask.ts.

export interface Citation {
  id: string;
  kind: string;
  title: string;
  page: string;
}

export interface KevinAnswer {
  question: string;
  answer: string;
  answered: boolean;
  citations: Citation[];
  proposal: { text: string; page: string } | null;
  model: { provider: string; model: string; attested: boolean; chatId: string | null };
  cards: string[];
  rejected: string[][];
  /** Present on API answers: replayed from the recording rather than asked now. */
  recorded?: boolean;
}

export interface Check {
  name: string;
  status: string;
  detail: string;
}

export interface RecordedAsk {
  recordedAt: string | null;
  enclave: { model: string; tier: string; fetchedAt: string; checks: Check[] } | null;
  questions: {
    question: string;
    answer: KevinAnswer | null;
    signature: { chatId: string; signer: string | null; checks: Check[] } | null;
  }[];
}

let recorded: Promise<RecordedAsk> | null = null;
export function readRecordedAsk(): Promise<RecordedAsk> {
  recorded ??= import("./data/ask.json").then((m) => m.default as unknown as RecordedAsk);
  return recorded;
}

/** One id per browser tab, so the API's per-session limit counts this visitor's questions. */
function sessionId(): string {
  try {
    let id = sessionStorage.getItem("day-one-ask");
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem("day-one-ask", id);
    }
    return id;
  } catch {
    return "";
  }
}

/** Asks the running API; an error carries the API's own sentence. */
export async function askApi(question: string): Promise<KevinAnswer> {
  const res = await fetch("api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "x-day-one-session": sessionId() },
    body: JSON.stringify({ question }),
  });
  const body = (await res.json().catch(() => ({}))) as KevinAnswer & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Kevin did not answer (${res.status}).`);
  return body;
}

export interface AnswerPart {
  /** Where the part starts in the answer, which also keys it. */
  at: number;
  text: string;
  cite: Citation | null;
}

/** The answer split into text and citation links, in order. */
export function withCitations(text: string, citations: readonly Citation[]): AnswerPart[] {
  const ids = [...citations].sort((a, b) => b.id.length - a.id.length);
  if (!ids.length) return [{ at: 0, text, cite: null }];
  const pattern = new RegExp(
    ids.map((c) => c.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "g",
  );
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ at: last, text: text.slice(last, at), cite: null });
    parts.push({ at, text: m[0], cite: citations.find((c) => c.id === m[0]) ?? null });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ at: last, text: text.slice(last), cite: null });
  return parts;
}
