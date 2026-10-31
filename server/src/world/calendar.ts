// Calendar and demand (docs/UPGRADE_BRIEF.md §2.1.3, §2.1.6): working days, and weekly demand
// per product, shaped by its seasonal profile and trend with seeded weekly noise.

import { PRODUCTS } from "../seed/reference.ts";
import { type PlantParams, PROFILES, WEEKLY_NOISE, type WorldConfig } from "./config.ts";
import { stream } from "./rng.ts";
import type { ProductCode } from "./types.ts";

const DAY_MS = 86_400_000;

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS);
export const weekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
export const at = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;
export const month = (date: string) => date.slice(0, 7);

/** Every date from `from` to `to`, both included. */
export function dates(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface Calendar {
  isWorkingDay(date: string): boolean;
  /** The first working day on or after a date. */
  onOrAfter(date: string): string;
  /** The next working day after a date. */
  after(date: string): string;
}

export function calendar(config: WorldConfig): Calendar {
  const closed = new Set<string>(config.calendar.holidays);
  for (const inc of config.incidents) {
    if (inc.type === "shutdown") for (const d of dates(inc.date, inc.endsAt)) closed.add(d);
  }
  const isWorkingDay = (date: string) => ![0, 6].includes(weekday(date)) && !closed.has(date);
  const onOrAfter = (date: string) => {
    let d = date;
    while (!isWorkingDay(d)) d = addDays(d, 1);
    return d;
  };
  return { isWorkingDay, onOrAfter, after: (date) => onOrAfter(addDays(date, 1)) };
}

/** Units a standard batch is expected to make: its theoretical units at the planning yield. */
export const PLANNING_YIELD = 0.9;

export function productSpec(code: ProductCode) {
  const p = PRODUCTS.find((x) => x.code === code);
  if (!p) throw new Error(`world: no product ${code}`);
  return p;
}

export interface WeeklyDemand {
  /** The Monday the week starts. */
  week: string;
  product: ProductCode;
  units: number;
}

/**
 * Weekly demand from the first Monday on or before `from` to `to`: batches a month at a
 * multiplier of 1, times the month's profile value, times the trend, times the week's noise.
 */
export function demand(config: WorldConfig, plant: PlantParams, from: string, to: string) {
  let monday = from;
  while (weekday(monday) !== 1) monday = addDays(monday, -1);
  const out: WeeklyDemand[] = [];
  for (const p of plant.products) {
    const perBatch = productSpec(p.product).batchTablets * PLANNING_YIELD;
    for (let week = monday; week <= to; week = addDays(week, 7)) {
      // The week's demand follows the month its Thursday falls in.
      const mid = addDays(week, 3);
      const m = Number(mid.slice(5, 7)) - 1;
      const months = daysBetween(config.calendar.start, mid) / 30.44;
      const noise = stream(config.seed, "demand", plant.facility, p.product, week).between(
        1 - WEEKLY_NOISE,
        1 + WEEKLY_NOISE,
      );
      const perWeek = (p.batchesPerMonth * perBatch * 12) / 52;
      const units =
        perWeek * (PROFILES[p.profile][m] ?? 1) * (1 + p.trendPerMonth) ** months * noise;
      out.push({ week, product: p.product, units: Math.round(units) });
    }
  }
  return out;
}

/** Cumulative demand of one product from `from` to the end of `date`, spread evenly over each week. */
export function cumulativeDemand(weeks: readonly WeeklyDemand[], product: ProductCode) {
  const mine = weeks.filter((w) => w.product === product);
  return (from: string, date: string) => {
    let total = 0;
    for (const w of mine) {
      const start = w.week > from ? w.week : from;
      const end = addDays(w.week, 6) < date ? addDays(w.week, 6) : date;
      if (end < start) continue;
      total += (w.units * (daysBetween(start, end) + 1)) / 7;
    }
    return total;
  };
}
