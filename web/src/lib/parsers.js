// Ported from the Flask app's parsing.py. Phase 1 handles the formats that need
// no third-party libraries: .txt .md .csv .tsv plus pasted text.

const MAX_CELL = 2000;
const MAX_ROWS = 20000;

export const SUPPORTED_EXTENSIONS = ["txt", "md", "csv", "tsv"];

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
    `.${ext || "?"} files aren't supported in the web app yet. Use .txt, .md, .csv or .tsv for now.`
  );
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
