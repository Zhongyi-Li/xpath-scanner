# Context-Aware XPath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate unique, stable XPath candidates from form labels and static non-table container context without using dynamic values or positional indexes.

**Architecture:** Add a small pure helper module for XPath string construction and context-text safety checks. Keep DOM discovery and live XPath counting inside the existing page-evaluation code, then feed all candidates through the existing `selectStableXPath` policy.

**Tech Stack:** TypeScript, Node test runner, Playwright DOM evaluation.

---

### Task 1: Field-label XPath candidates

**Files:**
- Create: `src/xpath-context.ts`
- Modify: `tests/element-semantics.test.ts`

- [ ] Add a failing test asserting that an input with label `仓库名称` receives a label-scoped XPath candidate and that no current input value appears in it.
- [ ] Run `pnpm test:unit` and confirm failure because the helper does not exist.
- [ ] Implement `buildFieldLabelXPathCandidates` using exact normalized label text, the nearest ancestor containing the target control, and hidden-ancestor exclusion.
- [ ] Run `pnpm test:unit` and confirm the new test passes.

### Task 2: Static non-table container context

**Files:**
- Modify: `src/xpath-context.ts`
- Modify: `tests/element-semantics.test.ts`

- [ ] Add failing tests for a static container-title action candidate and rejection of context containing IDs, dates, amounts, or long business text.
- [ ] Run `pnpm test:unit` and confirm the expected failures.
- [ ] Implement `isStableStaticContextText` and `buildContainerContextXPathCandidates` without positional predicates.
- [ ] Run `pnpm test:unit` and confirm the tests pass.

### Task 3: Integrate candidates into live scanning

**Files:**
- Modify: `src/scan-current-page.ts`

- [ ] Pass `fieldLabel` into XPath candidate generation.
- [ ] Discover the nearest non-table semantic container and a short static heading inside it.
- [ ] Insert label and container candidates before generic role/name/text fallbacks and count them with the existing live `xpathCount` function.
- [ ] Preserve generic multi-match output when no candidate becomes unique.
- [ ] Run `pnpm test:unit` and `pnpm exec tsc --noEmit`.

### Task 4: Document and verify

**Files:**
- Modify: `skills/xpath-scan/SKILL.md`

- [ ] Document field-label scoping, non-table list/card context, and the prohibition on dynamic values and positional indexes.
- [ ] Run `pnpm test:unit` and `pnpm exec tsc --noEmit` again as fresh final verification.
- [ ] Inspect changed files and confirm no output columns, sheets, JSON records, or historical scan rows were changed.

