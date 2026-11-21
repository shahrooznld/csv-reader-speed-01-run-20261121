// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly what csv-reader
// returns for {text, header} — {columns, rows, errors} — but reads the text with
// indexOf-driven slicing instead of one character at a time.
//
// Reading policy (csv-reader's own): a U+FEFF at the very start is dropped; a record
// ends at LF or CRLF and a line left with no characters is no record; outside quotes
// a CR not followed by LF is dropped (stray_cr); a field opening with a quote runs
// to the next quote that is not doubled, "" inside it is one quote and each CRLF or
// lone CR inside it reads as LF; what follows its closing quote, up to the next comma
// or line break, is appended as it stands (quote_junk, when the field ends); a quote
// that never closes is a literal character and the text after it is read again as
// unquoted (unterminated_quote); a quote inside an unquoted field is literal; fields
// stay strings, never trimmed or converted; columns is the first record when header
// is true, else null; rows are padded (short_row, fields: its count) or cut (long_row,
// extra: the cut fields) to the first record's width; each error is {code, line, row}
// in the order met, line the 1-based line its record starts on, counting every LF,
// CRLF and lone CR inside quotes, row its record's index in rows (null for the header).
//
// How it is fast: most lines hold no quote and no stray CR, so a whole line is sliced
// once and split on commas; other fields are sliced between the next comma and the
// next line break found by indexOf, and a quoted field is sliced between its quotes.
// A stray CR or a line break inside quotes only ever falls back to a short walk over
// that one field, never over the whole text.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended (0 comma, 1 line break, 2 end of text),
  // and how many characters were kept after its prefix (for quote_junk).
  let fv = '';
  let fe = 0;
  let fa = 0;

  // Finishes a record: the header takes the width, other records are padded or cut to it.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Reads an unquoted field from pos, with `prefix` already in the value ('' normally,
  // '"' when re-reading after a quote that never closes). The field ends at the next
  // comma, line break or end of text; a CR not followed by LF inside it is dropped
  // (stray_cr) and a CR just before the line break is the CRLF ending, not content.
  function readUnquoted(prefix) {
    const c = text.indexOf(',', pos);
    const n = text.indexOf('\n', pos);
    let end;
    let ended;
    if (c === -1 && n === -1) {
      end = len;
      ended = 2;
    } else if (n === -1 || (c !== -1 && c < n)) {
      end = c;
      ended = 0;
    } else {
      end = n;
      ended = 1;
    }
    let vend = end;
    if (ended === 1 && end > pos && text.charCodeAt(end - 1) === 13) vend = end - 1;
    const v0 = text.slice(pos, vend);
    if (v0.indexOf('\r') === -1) {
      fv = prefix === '' ? v0 : prefix + v0;
      fa = vend - pos;
      pos = ended === 2 ? len : end + 1;
      if (ended === 1) line += 1;
      fe = ended;
      return;
    }
    // Stray CRs inside the field: every one is dropped, each with its own error.
    // (No CR here can be part of a CRLF: any LF after pos would have ended the field.)
    const parts = v0.split('\r');
    const dropped = parts.length - 1;
    for (let i = 0; i < dropped; i++) {
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    }
    const kept = parts.join('');
    fv = prefix === '' ? kept : prefix + kept;
    fa = vend - pos - dropped;
    pos = ended === 2 ? len : end + 1;
    if (ended === 1) line += 1;
    fe = ended;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = pos + 1;
    let value = '';
    let lineDelta = 0;
    let closedAt = -1;
    while (true) {
      const q = text.indexOf('"', i);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it
        // is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      // The content up to this quote: plain when it holds no line break, converted
      // (each CRLF or lone CR one LF) when it does.
      const seg = text.slice(i, q);
      if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
        value += seg;
      } else {
        let out = '';
        let s0 = 0;
        for (let j = 0; j < seg.length; j++) {
          const cc = seg.charCodeAt(j);
          if (cc === 13) {
            out += seg.slice(s0, j) + '\n';
            lineDelta += 1;
            if (j + 1 < seg.length && seg.charCodeAt(j + 1) === 10) j += 1;
            s0 = j + 1;
          } else if (cc === 10) {
            out += seg.slice(s0, j) + '\n';
            lineDelta += 1;
            s0 = j + 1;
          }
        }
        value += out + seg.slice(s0);
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        value += '"';
        i = q + 2;
        continue;
      }
      closedAt = q;
      break;
    }
    line += lineDelta;
    pos = closedAt + 1;
    if (pos >= len) {
      fv = value;
      fe = 2;
      return;
    }
    const ch = text.charCodeAt(pos);
    if (ch === 44) {
      pos += 1;
      fv = value;
      fe = 0;
      return;
    }
    if (ch === 10) {
      pos += 1;
      line += 1;
      fv = value;
      fe = 1;
      return;
    }
    if (ch === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fv = value;
      fe = 1;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma
    // or line break.
    readUnquoted(value);
    if (fa > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (pos < len) {
    const nl = text.indexOf('\n', pos);
    if (nl !== -1) {
      // A whole line, when it holds no quote and no stray CR: slice it once and split.
      const end = nl > pos && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
      if (end === pos) {
        // A line left with no characters is no record.
        pos = nl + 1;
        line += 1;
        continue;
      }
      const lineStr = text.slice(pos, end);
      if (lineStr.indexOf('"') === -1 && lineStr.indexOf('\r') === -1) {
        const fields = lineStr.split(',');
        recordLine = line;
        recordRow = header && columns === null ? null : rows.length;
        pos = nl + 1;
        line += 1;
        finishRecord(fields);
        continue;
      }
    } else {
      // The tail after the last line break, when it holds no quote and no stray CR.
      const tailStr = text.slice(pos);
      if (tailStr.indexOf('"') === -1 && tailStr.indexOf('\r') === -1) {
        const fields = tailStr.split(',');
        recordLine = line;
        recordRow = header && columns === null ? null : rows.length;
        pos = len;
        finishRecord(fields);
        continue;
      }
    }

    // A record holding a quote, a stray CR, or a quoted field spanning lines:
    // read it field by field.
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        readUnquoted('');
      }
      fields.push(fv);
    } while (fe === 0);

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
