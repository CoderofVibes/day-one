// What the vision model returns for a batch-record page (research 14, "Output schema"). The model
// transcribes; our code converts units and does the arithmetic. Written as plain JSON Schema that
// fits both Anthropic structured outputs and NEAR AI's strict json_schema: every property
// required, no min/max, and no nullable types. Anthropic refuses a schema with more than 16
// union-typed parameters (bake-off, Oct 28), so an absent value is "" rather than null.

export type Legibility = "clear" | "unclear" | "illegible";

/** A value exactly as written on the page; "" when blank or illegible. */
export interface Read {
  raw: string;
  legibility: Legibility;
}

export interface ExtractedLine {
  line_no: number;
  material_name: Read;
  material_code: Read;
  internal_lot: Read;
  supplier_lot: Read;
  target_qty: Read;
  actual_qty: Read;
  unit: Read;
  correction: { present: boolean; struck_value: string; initials: string };
  weighed_by: Read;
  verified_by: Read;
}

export interface BatchRecordExtraction {
  document_type: "batch_record" | "other";
  batch_number: Read;
  product_code: Read;
  product_name: Read;
  batch_size: Read;
  manufacture_date: Read;
  facility: Read;
  materials: ExtractedLine[];
  theoretical_yield: Read;
  actual_yield: Read;
  yield_percent: Read;
  waste_qty: Read;
  waste_unit: Read;
  signatures: {
    role: "production" | "qa_review" | "other";
    name: string;
    date: string;
  }[];
  margin_notes: { text: string; legibility: Legibility }[];
}

const string = { type: "string" };

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const read = object({
  raw: string,
  legibility: { type: "string", enum: ["clear", "unclear", "illegible"] },
});

const line = object({
  line_no: { type: "integer" },
  material_name: read,
  material_code: read,
  internal_lot: read,
  supplier_lot: read,
  target_qty: read,
  actual_qty: read,
  unit: read,
  correction: object({
    present: { type: "boolean" },
    struck_value: string,
    initials: string,
  }),
  weighed_by: read,
  verified_by: read,
});

export const BATCH_RECORD_SCHEMA = {
  name: "batch_record_extraction",
  schema: object({
    document_type: { type: "string", enum: ["batch_record", "other"] },
    batch_number: read,
    product_code: read,
    product_name: read,
    batch_size: read,
    manufacture_date: read,
    facility: read,
    materials: { type: "array", items: line },
    theoretical_yield: read,
    actual_yield: read,
    yield_percent: read,
    waste_qty: read,
    waste_unit: read,
    signatures: {
      type: "array",
      items: object({
        role: { type: "string", enum: ["production", "qa_review", "other"] },
        name: string,
        date: string,
      }),
    },
    margin_notes: {
      type: "array",
      items: object({
        text: { type: "string" },
        legibility: { type: "string", enum: ["clear", "unclear", "illegible"] },
      }),
    },
  }),
};

export const EXTRACTION_SYSTEM = `You transcribe scanned manufacturing batch records into JSON.
Rules:
- Transcribe exactly what is written. Never convert units, never compute totals, never fix values.
- Quantities: copy the digits, commas and decimal point as written (e.g. "625,115" or "412.350").
- If a value is struck through and replaced, put the replacement in actual_qty.raw and fill
  correction with the struck value and the initials beside it.
- legibility: "clear" if you can read it with certainty, "unclear" if you are not sure,
  "illegible" if you cannot read it. Use "illegible" with raw "" rather than guessing.
- A blank or absent value is "" (never null).
- One materials row per table row, in page order; a material may repeat across lots.
- Notes written in the margin go in margin_notes.`;

export const EXTRACTION_PROMPT = "Transcribe this batch record page.";
