# Isolated Rescan Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive `rescan --<name>.xlsx` command that exports only the active page to an isolated workbook without reading or changing the formal result and progress files.

**Architecture:** Put command parsing and output-name validation in a small pure module so path safety and case preservation are unit-testable. Reuse the existing page scanner and Excel layout, but route rescan rows directly to a validated, non-existing workbook path instead of the normal JSON merge and progress pipeline.

**Tech Stack:** TypeScript 6, Node.js test runner, ts-node, Playwright CDP, SheetJS (`xlsx`)

---

### Task 1: Parse and validate the rescan target

**Files:**
- Create: `src/rescan-command.ts`
- Create: `tests/rescan-command.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Make the unit-test script discover all unit tests**

Change the script to:

```json
"test:unit": "node --test -r ts-node/register tests/*.test.ts"
```

- [ ] **Step 2: Write failing tests for valid command parsing**

Create tests asserting that `parseInteractiveCommand('rescan --漏扫页面.xlsx')` returns command `rescan` and argument `--漏扫页面.xlsx`, and that `resolveRescanOutputName('--CampaignPage.XLSX')` returns `CampaignPage.XLSX` without lowercasing it.

- [ ] **Step 3: Run the tests and verify RED**

Run: `pnpm test:unit`

Expected: FAIL because `src/rescan-command.ts` does not exist.

- [ ] **Step 4: Implement minimal parsing and validation**

Implement these public APIs:

```ts
export type InteractiveCommand = {
  command: string;
  argument: string;
};

export function parseInteractiveCommand(line: string): InteractiveCommand;
export function resolveRescanOutputName(argument: string): string;
```

`parseInteractiveCommand` trims the line, lowercases only the first token, and preserves the remainder. `resolveRescanOutputName` requires one `--`-prefixed filename with an `.xlsx` extension, rejects `/`, `\\`, `..`, empty names, and `xpath-result.xlsx` case-insensitively, then returns the filename without the `--` prefix.

- [ ] **Step 5: Run the tests and verify GREEN**

Run: `pnpm test:unit`

Expected: all unit tests PASS.

### Task 2: Reject unsafe and reserved output names

**Files:**
- Modify: `tests/rescan-command.test.ts`
- Modify: `src/rescan-command.ts`

- [ ] **Step 1: Write failing table-driven validation tests**

Cover missing argument, `--.xlsx`, non-XLSX extensions, extra whitespace/arguments, `--../漏扫.xlsx`, `--folder/漏扫.xlsx`, `--folder\\漏扫.xlsx`, and `--xpath-result.xlsx`. Each case must throw a user-readable error containing the usage example `rescan --漏扫页面.xlsx` or the reason the formal result name is reserved.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test -r ts-node/register tests/rescan-command.test.ts`

Expected: FAIL on the newly introduced invalid cases.

- [ ] **Step 3: Complete minimal validation**

Add exact checks for a single filename, valid basename, required extension, forbidden traversal/path separators, and the reserved formal output name. Do not create directories or normalize an unsafe path into an accepted one.

- [ ] **Step 4: Run unit tests and verify GREEN**

Run: `pnpm test:unit`

Expected: all unit tests PASS.

### Task 3: Add isolated rescan execution

**Files:**
- Modify: `src/scan-current-page.ts`

- [ ] **Step 1: Generalize Excel writing without changing normal scan behavior**

Change the writer signature to:

```ts
function writeExcel(rows: OutputRow[], outputPath: string = RESULT_XLSX): void
```

Keep the existing `XPath清单` Sheet, seven fixed columns, column widths, and platform normalization, and pass `outputPath` to `XLSX.writeFile`.

- [ ] **Step 2: Add the isolated execution path**

Add `executeRescan(browser, argument)` which:

1. validates the output name and resolves it under `ROOT`;
2. rejects an existing destination before scanning;
3. selects the active page and applies the same forbidden-page/title checks as `scan`;
4. calls `collectRows(page)`;
5. deduplicates only this scan via `mergeRows([], scanResult.rows).merged`;
6. writes only the requested workbook;
7. appends a non-sensitive success line to `xpath-debug.log` and prints the output filename and row count.

The function must not call `readRowsFile`, `writeRowsFile`, or `writeProgress`.

- [ ] **Step 3: Route the interactive command without lowercasing filenames**

Replace whole-line lowercasing with `parseInteractiveCommand(line)`. Keep existing `scan`, `url`, `pages`, `help`, and `exit` behavior, and route `rescan` to `executeRescan(browser, argument)`.

- [ ] **Step 4: Update interactive help**

Add:

```text
rescan --文件名.xlsx  补扫当前激活页面，仅生成独立 Excel，不更新正式结果和进度
```

Keep the correct usage visible when validation fails.

### Task 4: Document and verify the feature

**Files:**
- Modify: `user-manual.md`

- [ ] **Step 1: Document the operator workflow**

Add a “遗漏页面补扫” section explaining:

```text
pnpm scan
url
rescan --漏扫页面.xlsx
```

State that the workbook contains only the active page, is created in the project root, refuses overwrite, and does not modify `xpath-result.xlsx`, `xpath-rows.json`, or `xpath-progress.json`.

- [ ] **Step 2: Run all unit tests**

Run: `pnpm test:unit`

Expected: all tests PASS with no errors.

- [ ] **Step 3: Run TypeScript type checking**

Run: `pnpm exec tsc --noEmit`

Expected: exit code 0 with no diagnostics.

- [ ] **Step 4: Verify the diff and formal data isolation**

Run: `git diff --check`

Expected: exit code 0.

Run `git status --short` and confirm that implementation work did not modify `xpath-result.xlsx`, `xpath-rows.json`, or `xpath-progress.json`. Preserve the pre-existing deletion of `xpath-result.xlsx.tmp.xlsx.inspect.ndjson` without staging or restoring it.

