// The v2 pages' reads (docs/VISION.md §6.7, §6.12.4): the charts' series, stock over time, the
// plant forecast and the schedule. Live, from the API (api/src/session.ts); on a static host,
// from the snapshot npm run web:data writes at the end of the recorded run
// (web/src/data/series.json), loaded only when a page first asks so the first screen stays small.

import { useEffect, useState } from "react";

export interface BatchPoint {
  batchNo: string;
  facility: string;
  product: string;
  productName: string;
  date: string;
  units: number;
  theoreticalUnits: number;
  yieldBp: number;
  wasteBase: number;
  issuedBase: number;
}
export interface SpendMonth {
  month: string;
  facility: string;
  category: string;
  totalUsdc: number;
  pos: number;
}
export interface QcMonth {
  month: string;
  facility: string;
  released: number;
  rejected: number;
}
export interface ReorderWeek {
  week: string;
  facility: string;
  below: number;
}
export interface History {
  production: BatchPoint[];
  spend: { months: SpendMonth[]; committed: SpendMonth[] };
  qc: QcMonth[];
  belowReorder: ReorderWeek[];
}
export interface StockPoint {
  at: string;
  onHandBase: number;
  deltaBase: number;
  kind: string;
  lotCode: string;
}
export interface StockSeries {
  facility: string;
  material: string;
  name: string;
  dimension: string;
  reorderPointBase: number | null;
  points: StockPoint[];
}
export interface MaterialForecast {
  material: string;
  name: string;
  category: string;
  dimension: string;
  horizonDays: number;
  plannedBatches: { batchNo: string; product: string; plannedFor: string; needBase: number }[];
  needBase: number;
  onHandBase: number;
  onOrderBase: number;
  shortfallBase: number;
  reorderPointBase: number;
  recommendQtyBase: number | null;
  needBy: string | null;
  sentence: string;
  short: boolean;
  reorder: boolean;
}
export interface PlantForecast {
  facility: string;
  at: string;
  materials: MaterialForecast[];
}
export interface ScheduledBatch {
  batchNo: string;
  product: string;
  productName: string;
  plannedFor: string;
  units: number;
  draws: {
    material: string;
    name: string;
    dimension: string;
    needBase: number;
    afterBase: number;
  }[];
  short: string[];
  costUsdc: number;
  unpriced: string[];
}
export interface PlantSchedule {
  facility: string;
  from: string;
  to: string;
  batches: ScheduledBatch[];
  costUsdc: number;
  unpriced: string[];
  sentence: string;
}

interface Snapshot {
  at: string;
  history: History;
  stock: Record<string, Record<string, StockSeries>>;
  forecast: Record<string, PlantForecast>;
  schedule: Record<string, PlantSchedule>;
}

let snapshot: Promise<Snapshot> | null = null;
function loadSnapshot(): Promise<Snapshot> {
  snapshot ??= import("./data/series.json").then((m) => m.default as unknown as Snapshot);
  return snapshot;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Where the pages read from: the running API, or the recorded run's snapshot. */
export interface Source {
  live: boolean;
  /** Bumped when the run moves, so live reads refresh. */
  version: number;
}

export function readHistory(source: Source): Promise<History> {
  return source.live ? get<History>("api/history") : loadSnapshot().then((s) => s.history);
}
export function readStock(
  source: Source,
  facility: string,
  material: string,
): Promise<StockSeries | null> {
  return source.live
    ? get<StockSeries>(`api/history/stock?plant=${facility}&material=${material}`)
    : loadSnapshot().then((s) => s.stock[facility]?.[material] ?? null);
}
export function readStockedMaterials(source: Source, facility: string): Promise<string[]> {
  return source.live
    ? get<{ materials: string[] }>(`api/history/stock?plant=${facility}`).then((r) => r.materials)
    : loadSnapshot().then((s) => Object.keys(s.stock[facility] ?? {}).sort());
}
export function readForecast(source: Source, facility: string): Promise<PlantForecast> {
  return source.live
    ? get<PlantForecast>(`api/forecast?plant=${facility}`)
    : loadSnapshot().then(
        (s) => s.forecast[facility] ?? { facility, at: s.at, materials: [] as MaterialForecast[] },
      );
}
export function readSchedule(source: Source, facility: string, days = 28): Promise<PlantSchedule> {
  return source.live
    ? get<PlantSchedule>(`api/schedule?plant=${facility}&days=${days}`)
    : loadSnapshot().then(
        (s) =>
          s.schedule[facility] ?? {
            facility,
            from: s.at.slice(0, 10),
            to: s.at.slice(0, 10),
            batches: [],
            costUsdc: 0,
            unpriced: [],
            sentence: "",
          },
      );
}

/**
 * A read that runs again whenever `key` changes (name the inputs and the run's version in it);
 * the last value stays on screen while the next one loads.
 */
export function useRead<T>(
  read: () => Promise<T>,
  key: string,
): { value: T | null; error: string | null } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `read` uses
  useEffect(() => {
    let stale = false;
    read().then(
      (v) => {
        if (!stale) {
          setValue(v);
          setError(null);
        }
      },
      (e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      stale = true;
    };
  }, [key]);
  return { value, error };
}
