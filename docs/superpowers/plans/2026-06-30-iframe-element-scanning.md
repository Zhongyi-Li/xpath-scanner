# iframe Element Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include visible business iframe controls in each interactive scan and emit a usable frame-plus-XPath locator.

**Architecture:** Extract pure frame-locator and frame-URL rules into `src/frame-locator.ts`. Refactor the existing DOM snapshot callback so it can run against both the main `Page` and child `Frame` objects, while page hierarchy remains sourced from the main document. Child-frame rows receive their parent-frame XPath chain before normal merge and persistence.

**Tech Stack:** TypeScript, Playwright CDP, Node test runner, SheetJS.

---

### Task 1: Frame locator rules

**Files:**
- Create: `src/frame-locator.ts`
- Modify: `tests/element-semantics.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving that a child XPath becomes `frame=<iframe XPath> >>> xpath=<child XPath>`, nested frame chains remain ordered, and forbidden frame URLs are rejected.

- [ ] **Step 2: Verify RED**

Run `pnpm test:unit`; expect failure because `src/frame-locator.ts` does not exist.

- [ ] **Step 3: Implement minimal pure helpers**

Export `formatFramedXPath(frameXPaths, elementXPath)` and `isForbiddenFrameUrl(url, forbiddenParts)` with whitespace normalization and case-insensitive URL matching.

- [ ] **Step 4: Verify GREEN**

Run `pnpm test:unit`; expect all tests to pass.

### Task 2: Scan visible child frames

**Files:**
- Modify: `src/scan-current-page.ts`

- [ ] **Step 1: Generalize snapshot collection**

Move the existing `evaluate` body into a helper accepting `Page | Frame`; allow hierarchy collection to be disabled for child frames.

- [ ] **Step 2: Resolve visible iframe ancestry**

For each child frame, inspect `frame.frameElement()`, reject hidden frame elements, generate a stable iframe XPath from `name`, `title`, or `src`, and recursively build the parent-frame XPath chain.

- [ ] **Step 3: Collect and merge frame rows**

Scan the main frame first, then each eligible child frame. Inherit the main hierarchy, prefix child locators with `formatFramedXPath`, skip forbidden or detached frames, and log per-frame failures without aborting the page scan.

- [ ] **Step 4: Verify static checks**

Run `pnpm test:unit` and `pnpm exec tsc --noEmit`; expect zero failures.

### Task 3: Real-page regression verification

**Files:**
- Verify: `xpath-result.xlsx`, `xpath-rows.json`, `xpath-progress.json`

- [ ] **Step 1: Inspect the current logged-in page without clicking**

Connect with `chromium.connectOverCDP`, confirm the selected page is not forbidden, and compare main-frame and business-frame candidate counts.

- [ ] **Step 2: Run a temporary scan**

Execute the scanner against temporary output paths or an isolated temporary working directory, issue `scan`, and verify iframe fields such as order number and complaint number appear with the `我被投诉` hierarchy and framed locator.

- [ ] **Step 3: Validate workbook contract**

Confirm the workbook has exactly one `XPath清单` sheet and exactly the fixed seven columns.
