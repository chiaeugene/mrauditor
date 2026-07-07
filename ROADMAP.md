# Mr Auditor — Upgrade Roadmap

Source: first practitioner review (07.07.2026) — a licensed auditor walked through his real
Excel audit file against the app. Verdict: very impressed with the engine; the gap is that a
real audit file has a **working-paper spine** between the trial balance and the financial
statements, plus planning/testing papers, that the app currently jumps over.

**Positioning confirmed by the meeting:** many firms' technical strength is thin. Mr Auditor
is the technical backbone that lets an average firm produce a practice-review-proof file —
kill the mundane hours, keep the auditor for professional judgment.

The chain a real file follows, and the target architecture:

```
Evidence (vault) ─┐
                  ├─► Working Paper per area ─► FS line ─► AFS ─► Note (auto-linked)
Trial balance ────┘         (A/B/C… refs)
```

Everything below is ordered by adoption impact — what makes a practising auditor switch.

---

## Phase A — The Working Paper spine (structural, highest priority)

The auditor's file is one Excel workbook: a tab per area (PPE, receivables, bank, payables…),
each tab totals into the balance sheet, the balance sheet wires into the AFS, every line
carries a note reference. Mirror that.

- **A1 · First-class Working Papers.** Promote the Toolkit "lead schedules" into a numbered
  workflow step. One WP per FS area with the standard file referencing (A = PPE, B = receivables,
  C = bank/cash, D = inventories … or configurable). Each WP shows: GL accounts + balances from
  the TB, PY comparatives and movements, tie-out to the FS line (must agree to the sen),
  linked evidence from the vault, testing status, a conclusion box, preparer/reviewer sign-off.
- **A2 · Cross-referencing everywhere.** FS lines display their WP ref; WPs display their FS
  destination and note number; the Full Audit Pack notes already cross-reference — complete the
  loop so a reviewer can trace any figure `TB → WP → FS → Note` in two clicks.
- **A3 · AI note identification.** The auditor's explicit wish: "AI does the notes instead of a
  human identifying them." Build a disclosure checklist engine (MPERS-driven): scan the TB +
  intake for triggers (related parties, borrowings, contingencies, events after period end…),
  list which notes the file *must* contain, mark which are auto-drafted vs need input, and let
  the AI draft the unusual ones.

## Phase B — Planning papers (ISA 320 / 315 documentation)

- **B1 · Materiality questionnaire.** Replace the bare benchmark dropdown with the tick-box
  interview the auditor showed: Is the entity profit-oriented and stable? Owner-managed?
  Loss-making or break-even? Asset-heavy? Users mainly bank/lenders? → the answers select the
  benchmark + percentage AND generate the written rationale. Output: a printable Materiality WP
  (practice reviewers specifically look for documented benchmark reasoning).
- **B2 · Risk assessment & scoping paper.** Auto-classify every TB balance **above / below PM**
  (his exact words). Above PM = significant account → full testing; below = analytical/minimal.
  Combine with the findings engine's risk signals into a per-area risk rating (H/M/L) and a
  documented audit approach. Output: the ISA 315 risk assessment memo, printable.
- **B3 · Analytical review as a standalone WP.** The ratio table already exists in the Audit
  Engine; give it the paper treatment — expectations, actual, variance, explanation column the
  auditor fills, conclusion. (Key ratio analysis was a distinct paper in his file.)

## Phase C — Testing & sampling

- **C1 · Sampling calculator.** Per area: population (from TB or pasted ledger), key items ≥ PM
  auto-selected for 100% testing, residual sample size computed (coverage method + a MUS-style
  option), random selection with a documented seed. Standard formulas — the thing juniors get
  wrong and partners re-check.
- **C2 · Testing working papers.** Vouching templates per area: the selected sample listed,
  columns for evidence sighted / agreed / exception, exceptions flow automatically into the
  findings list and the ISA 450 misstatement ledger. Testing status rolls up to the WP (A1).

## Phase D — The AI professional layer (the USP)

The auditor's framing: the solution's USP is that it can *observe the account, list the risks,
and give recommendations* — and help the firm argue its positions.

- **D1 · AI risk memo.** One click: generate the engagement-level risk assessment narrative
  from the TB, intake, and findings — the auditor edits rather than writes.
- **D2 · AI disclosure/note drafting.** The AI half of A3.
- **D3 · "Defend the file."** His "negotiation, discussion, argument" wish. For each significant
  judgment (going concern, impairment, revenue recognition, director balances): an AI position
  paper — the argument for the treatment, the challenges MIA practice review or LHDN would
  raise, and the prepared rebuttals. Plus a devil's-advocate mode in Ask Mr Auditor that
  cross-examines the file like a reviewer. Nobody else in the market does this.

## Phase E — Platform & polish (existing backlog)

- xlsx/CSV file import for the TB (paste already works)
- MBRS/XBRL export so the pack drops into SSM's mTool
- Malay-language reports
- Real page numbers in the Full Audit Pack contents
- Firm/multi-user accounts (partner + staff roles, review queues)

---

### Suggested build order

1. **B1 + B2** (materiality questionnaire, scoping paper) — small, high credibility, reuses the
   existing engine; instantly recognisable to any auditor.
2. **A1 + A2** (WP spine with cross-refs) — the structural core; biggest single feature.
3. **C1** (sampling calculator) — self-contained, high perceived value.
4. **D3** (defend the file) — the demo-wow differentiator, builds on the existing AI function.
5. **A3/D2, C2** — then the rest of E as adoption demands.
