import { useState } from "react";
import { qty } from "./charts.tsx";
import journey from "./data/journey.json";
import { runFacts } from "./desk.ts";
import type { RunData } from "./run.ts";
import type { MaterialForecast } from "./series.ts";

const example = (
  journey as unknown as {
    availabilityExample?: Record<"unknown" | "late" | "onTime", MaterialForecast>;
  }
).availabilityExample;

export function BatchHandoff({
  run,
  at,
  showExample = true,
}: {
  run: RunData;
  at: number;
  showExample?: boolean;
}) {
  const { stock, forecast, material } = runFacts(run, at);
  if (!stock || at > 7) return null;
  return (
    <section className="batch-handoff card-v2" aria-label="From batch record to purchasing">
      <h2>From batch record to purchasing</h2>
      <dl>
        <div>
          <dt>Inventory after Ray confirms</dt>
          <dd>
            {material ?? "Ascorbic acid"} on hand falls from {stock.before} to {stock.after}.
          </dd>
        </div>
        {forecast && (
          <div>
            <dt>Kevin checks upcoming production</dt>
            <dd>
              The plan needs about {forecast.needKg}. Kevin finds a shortage of about{" "}
              {forecast.shortKg} and recommends ordering {forecast.orderKg}.
            </dd>
          </div>
        )}
      </dl>
      {forecast && showExample && <AvailabilityExample />}
    </section>
  );
}

function AvailabilityExample() {
  const [choice, setChoice] = useState<"unknown" | "late" | "onTime">("late");
  if (!example) return null;
  const forecast = example[choice];
  const order = forecast.incoming?.find((s) => s.ref === "PO-1042");
  const short = forecast.firstShort;
  return (
    <details className="batch-availability">
      <summary>What if the shipment misses the batch?</summary>
      <p>
        Compare three usable-date estimates for the same funded order. These are planning scenarios.
      </p>
      <label>
        PO-1042 usable date{" "}
        <select
          value={choice}
          onChange={(event) => {
            const selected = event.target.value;
            if (selected === "unknown" || selected === "late" || selected === "onTime")
              setChoice(selected);
          }}
        >
          <option value="unknown">Unknown</option>
          <option value="late">After the first batch</option>
          <option value="onTime">By the first batch</option>
        </select>
      </label>
      <div aria-live="polite">
        {order && (
          <p>
            {qty(order.qtyBase, forecast.dimension)} on order ·{" "}
            {order.expectedUsableOn ?? "date unknown"}
          </p>
        )}
        {short ? (
          <p>
            <b>{short.batchNo} is at risk.</b> It needs {qty(short.qtyBase, forecast.dimension)}{" "}
            more by {short.date}. Check with receiving or QC before buying again.
          </p>
        ) : (
          <p>
            <b>Scheduled supply covers both batches.</b> The estimate includes any time needed for
            QC.
          </p>
        )}
      </div>
    </details>
  );
}
