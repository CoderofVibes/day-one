// A small XLSX reader and writer for the import wizard, so a plant's spreadsheet comes in with no
// third-party parser. Reading covers what a hand-kept workbook holds: sheets in workbook order,
// shared and inline strings, numbers and booleans as typed. Formulas are read as their cached
// value; styles, merged cells and dates-as-serials are not interpreted (a date typed as text
// stays text). Writing produces plain inline-string and number cells, enough for the fixtures.

import { crc32, inflateRawSync } from "node:zlib";

export type Cell = string | number | null;
export interface Sheet {
  name: string;
  /** Row-major cells; rows and columns keep their position, so blank rows stay blank. */
  rows: Cell[][];
}

// --- zip ---------------------------------------------------------------------------------

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: signature 0x06054b50, searched from the end (comment ≤ 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("xlsx: bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`xlsx: unsupported compression ${method} for ${name}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function zip(entries: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    // Fixed DOS time (1980-01-01) so the same rows always give the same bytes.
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(0, 8); // stored
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0x21, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += head.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// --- xml ---------------------------------------------------------------------------------

const xmlDecode = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (_, e: string) => {
    const named: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
    if (named[e]) return named[e];
    return String.fromCodePoint(
      e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
    );
  });

const xmlEncode = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The text of every <t> inside a string item, joined (rich text runs included). */
const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1] ?? "")).join("");

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** "C12" → column index 2. */
function columnOf(ref: string) {
  let col = 0;
  for (const ch of ref.replace(/\d+$/, "")) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col - 1;
}

function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function parseSheet(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const r = Number(attr(row[1] ?? row[3] ?? "", "r") ?? rows.length + 1) - 1;
    const cells: Cell[] = [];
    let next = 0;
    for (const c of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = c[1] ?? "";
      const body = c[2] ?? "";
      const ref = attr(tag, "r");
      const col = ref ? columnOf(ref) : next;
      next = col + 1;
      const type = attr(tag, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === "inlineStr") value = textOf(body);
      else if (type === "s") value = shared[Number(v)] ?? null;
      else if (type === "str" || type === "e") value = v === undefined ? null : xmlDecode(v);
      else if (type === "b") value = v === undefined ? null : v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = Number(v);
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }
  return rows;
}

/** Every sheet of an .xlsx file, in workbook order. */
export function readXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString("utf8");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("xlsx: no xl/workbook.xml");
  const sharedXml = text("xl/sharedStrings.xml") ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1] ?? ""));
  const rels = new Map(
    [...(text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b([^>]*)\/?>/g)].map(
      (m) => [attr(m[1] ?? "", "Id"), attr(m[1] ?? "", "Target")],
    ),
  );
  return [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
    const tag = m[1] ?? "";
    const target = rels.get(attr(tag, "r:id")) ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = text(path);
    if (!xml) throw new Error(`xlsx: missing ${path}`);
    return { name: xmlDecode(attr(tag, "name") ?? ""), rows: parseSheet(xml, shared) };
  });
}

/** A minimal workbook with the given sheets; the same sheets always give the same bytes. */
export function writeXlsx(sheets: Sheet[]): Buffer {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const sheetXml = (rows: Cell[][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><sheetData>${rows
      .map((cells, r) => {
        const body = cells
          .map((v, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            if (v === null || v === "") return "";
            if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEncode(v)}</t></is></c>`;
          })
          .join("");
        return body ? `<row r="${r + 1}">${body}</row>` : "";
      })
      .join("")}</sheetData></worksheet>`;
  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} xmlns:r="${rel}"><sheets>${sheets
        .map((s, i) => `<sheet name="${xmlEncode(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ],
    ...sheets.map((s, i): [string, string] => [
      `xl/worksheets/sheet${i + 1}.xml`,
      sheetXml(s.rows),
    ]),
  ]);
}

/** A CSV file as one sheet (RFC 4180 quoting); numbers stay text, like a typed cell. */
export function readCsv(text: string, name = "Sheet1"): Sheet {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field === "" ? null : field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field === "" ? null : field);
      rows.push(row.every((c) => c === null) ? [] : row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field === "" ? null : field);
    rows.push(row);
  }
  return { name, rows };
}
