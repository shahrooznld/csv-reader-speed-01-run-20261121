# Fast CSV reader

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/shahrooznld/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/shahrooznld/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0: it answers exactly as csv-reader does on
every input — including its broken-row policy (stray CRs, unterminated quotes,
quote junk, short and long rows, quoted fields spanning lines) — but reads the
text with `indexOf`-driven slicing instead of one character at a time.

Entry for the [make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## Layout

- `solve.js` — the reader: `run({text, header})` returns `{columns, rows, errors}`.
  Dependency-free ES module, no build step.
- `main.ts` — the program the harness runs: reads `/input/cases.json`, answers
  each case with `run`, writes `/output/answers.json`.

## How it is fast

- Lines holding no quote and no stray CR are sliced once and split on commas.
- Other fields are sliced between the next comma and the next line break found
  by `indexOf`; quoted fields are sliced between their quotes.
- A stray CR or a line break inside quotes only ever falls back to a short walk
  over that one field, never over the whole text.
- No regular expressions, no per-character string building on the common path.
