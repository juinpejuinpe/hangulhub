// Ported from the Flask app's parsing.py: .txt .md .csv .tsv directly, and
// .xlsx / .docx / .pdf through libraries that are imported on demand, so the
// initial bundle stays small on a phone.

const MAX_CELL = 2000;
const MAX_ROWS = 20000;

export const SUPPORTED_EXTENSIONS = ["txt", "md", "csv", "tsv", "xlsx", "docx", "pdf"];

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function fileExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return match ? match[1].toLowerCase() : "";
}

export function parseTextFile(name, text) {
  const ext = fileExtension(name);
  if (ext === "csv") return tableFromRows(parseDelimited(text, ","));
  if (ext === "tsv") return tableFromRows(parseDelimited(text, "\t"));
  if (ext === "txt" || ext === "md") return textFromText(text);
  throw new Error(
    `.${ext || "?"} files can't be read from text — upload the file itself instead.`
  );
}

/** Parse an uploaded File of any supported type. */
export async function parseFile(file) {
  const ext = fileExtension(file.name);
  if (ext === "xlsx" || ext === "xlsm") return parseXlsx(await file.arrayBuffer());
  if (ext === "xls") throw new Error("Old .xls files aren't supported — save as .xlsx first.");
  if (ext === "docx") return parseDocx(await file.arrayBuffer());
  if (ext === "pdf") return parsePdf(new Uint8Array(await file.arrayBuffer()));
  if (["txt", "md", "csv", "tsv"].includes(ext)) return parseTextFile(file.name, await file.text());
  throw new Error(
    `Unsupported file type .${ext || "?"}. Supported: ${SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(" ")}`
  );
}

export async function parseXlsx(arrayBuffer) {
  const imported = await import("xlsx");
  const XLSX = imported.default || imported;
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("That workbook has no sheets.");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const nonEmpty = rows.filter((row) => row.some((cell) => String(cell).trim()));
  return tableFromRows(nonEmpty.slice(0, MAX_ROWS));
}

export async function parseDocx(arrayBuffer) {
  const imported = await import("mammoth/mammoth.browser");
  const mammoth = imported.default || imported;
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return textFromText(value);
}

export async function parsePdf(bytes) {
  const pdfjs = await loadPdfjs();
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let line = "";
    const lines = [];
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else if (item.str && !item.str.endsWith(" ")) {
        line += " ";
      }
    }
    if (line.trim()) lines.push(line);
    const text = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    if (text) pageTexts.push(text);
  }

  const text = pageTexts.join("\n\n");
  if (!text.trim()) {
    throw new Error(
      "No extractable text in this PDF — it's probably a scan of a printed page. " +
        "Run it through OCR (or use a digital copy) and try again."
    );
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { kind: "text", text, lines: lines.slice(0, MAX_ROWS), pages: pageTexts.length };
}

export function textFromText(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { kind: "text", text: lines.join("\n"), lines: lines.slice(0, MAX_ROWS) };
}

export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
    if (rows.length >= MAX_ROWS) break;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((value) => String(value).trim()));
}

function looksNumeric(value) {
  const cleaned = String(value).replace(/,/g, "").trim();
  return cleaned !== "" && !Number.isNaN(Number(cleaned));
}

const HEADER_HINTS =
  /word|meaning|korean|english|hangul|translation|reading|pron|definition|term|level|뜻|단어|의미|발음|해석|번역/i;
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;

/**
 * Decide whether row 1 is a header. The Flask app used "first row differs from
 * the second" alone, which mis-reads a headerless Korean list
 * (`학교,school`) as column names — so an explicit hint list and a
 * "both rows contain Hangul" check are added here.
 */
function looksLikeHeader(first, second) {
  if (first.some((cell) => HEADER_HINTS.test(String(cell)))) return true;
  const firstHangul = first.some((cell) => HANGUL.test(String(cell)));
  const secondHangul = second.some((cell) => HANGUL.test(String(cell)));
  if (firstHangul && secondHangul) return false;
  return true;
}

export function tableFromRows(rawRows) {
  if (!rawRows.length) {
    return { kind: "table", headers: [], rows: [], note: "Empty file." };
  }
  const truncated = rawRows.map((row) => row.map((cell) => cleanText(cell).slice(0, MAX_CELL)));
  const width = Math.max(...truncated.map((row) => row.length));
  const rows = truncated.map((row) => [...row, ...Array(width - row.length).fill("")]);
  const first = rows[0];
  const hasHeader =
    first.some((cell) => String(cell).trim()) &&
    !first.every(looksNumeric) &&
    rows.length > 1 &&
    rows[0].some((cell, i) => String(cell).trim() !== String(rows[1][i]).trim()) &&
    looksLikeHeader(first, rows[1]);

  const headers = hasHeader
    ? first.map((cell, i) => String(cell).trim() || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const dictRows = dataRows
    .map((row) => {
      const out = {};
      headers.forEach((header, i) => {
        out[header] = row[i] ?? "";
      });
      return out;
    })
    .filter((row) => headers.some((header) => String(row[header]).trim()));

  return { kind: "table", headers, rows: dictRows, headerRow: hasHeader };
}

export function rowsToPairs(content, frontColumn, backColumns) {
  const headers = content.headers || [];
  const pairs = [];
  for (const row of content.rows || []) {
    const front = cleanText(row[frontColumn]);
    if (!front) continue;
    const back = backColumns
      .filter((column) => headers.includes(column))
      .map((column) => cleanText(row[column]))
      .filter(Boolean)
      .join("\n");
    pairs.push([front, back]);
  }
  return pairs;
}

export function textToPairs(content) {
  const pairs = [];
  const delimiters = /\t|\s{2,}| \| | [-=] |::?|: /;
  const hangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
  const latin = /[A-Za-z]/;

  for (const line of content.lines || []) {
    if (!line) continue;
    const parts = line.split(delimiters).map((part) => part.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      pairs.push([parts[0], parts.slice(1).join(" ")]);
      continue;
    }
    // "학교 school" → split at the first Latin letter after Hangul.
    const firstHangul = line.search(hangul);
    if (firstHangul >= 0) {
      let boundary = -1;
      for (let i = firstHangul + 1; i < line.length; i += 1) {
        if (latin.test(line[i])) {
          boundary = i;
          break;
        }
      }
      if (boundary > 0) {
        const front = line.slice(0, boundary).trim();
        const back = line.slice(boundary).trim();
        if (front && back) pairs.push([front, back]);
      }
    }
  }
  return pairs;
}

export function pairsFromPreview(content) {
  return textToPairs(content).slice(0, 5);
}
