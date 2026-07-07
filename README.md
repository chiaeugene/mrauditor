# Mr Auditor — Malaysian Statutory Audit Intelligence

Input the company's details and trial balance → Mr Auditor performs the audit mechanics →
a licensed auditor (s.263 CA 2016 approval) reviews the evidence and signs. The tool drafts;
the human signs.

## Run locally

Static site — serve the repo root and open `/mr-auditor/`:

```
python -m http.server 8000   # then http://localhost:8000/mr-auditor/
```

## What's inside

| Screen | What it does |
|---|---|
| Home | Apple-style landing: register a company, firm-wide KPIs, portfolio deadlines, engagement cards |
| Register | 4-step auditor intake wizard (company → directors/contacts → audit profile → attachments) |
| 1 Setup | Particulars, framework, PD 10/2024 audit-exemption checker, statutory clock |
| 2 Trial Balance | Paste from Excel, auto-classification (~35 categories), per-account Mr Auditor analysis |
| 3 Audit Engine | ISA 320 materiality, ISA 520 analytics, ~20 findings with law refs + one-click AJEs, ISA 450 ledger, opinion recommender, manual AJE register |
| 4 Financial Statements | MPERS-format SOPL/SOFP/SOCE/SOCF, live with adjustments |
| 5 Tax | SME 15/17/24% tiers, Sch 3 CA, s.140B deemed interest, CP204 checks |
| 6 Reports | ISA 700 auditor's report (all 5 opinions + MUGC), directors' report, s.251 statements, completion checklist |
| 7 Full Audit Pack | Complete lodgement-order document with auto-numbered notes + placeholder killer |
| 8 Evidence Vault | Per-client files in 11 audit categories (IndexedDB) — view / download |
| 9 Toolkit | Capital allowance schedule, ISA 505 confirmation letters, bank-in reconciliation, lead schedules, roll-forward, JSON export/import |
| Ask Mr Auditor | Ctrl+K — instant account intel: balances, assertions at risk, procedures, findings |

## Backend (Supabase — live)

The app is wired to Supabase project `ycsctxcgdssifzijgavs`:

- **Auth** — email/password (Supabase Auth); the sign-in gate is the app's front door.
- **Engagements** — each client file lives as jsonb in the `engagements` table (schema in
  `supabase-schema.sql`), synced on every save with a per-client debounce.
- **Evidence Vault** — files upload to the private `evidence` Storage bucket with metadata in
  `evidence_files`; view/download via short-lived signed URLs. RLS keys everything off
  `auth.uid()` so each auditor only sees their own clients.

## Ask Mr Auditor AI (Edge Function)

`supabase/functions/ask-mr-auditor/index.ts` proxies questions to the Anthropic API
(`claude-opus-4-8` via the official TypeScript SDK) with a Malaysian-audit system prompt.
The web app sends the question plus a compact JSON snapshot of the active engagement
(figures, materiality, findings, TB, deadlines), so answers are grounded in the actual file.
The API key stays server-side; the function requires a signed-in user's JWT (verify_jwt on).

To deploy or update it:

1. Supabase dashboard → **Edge Functions** → deploy a function named `ask-mr-auditor` with
   the contents of `supabase/functions/ask-mr-auditor/index.ts`
   (or `supabase functions deploy ask-mr-auditor` with the CLI).
2. **Edge Functions → Secrets** → add `ANTHROPIC_API_KEY` = your Anthropic API key.

Until both steps are done, the palette's instant answers still work; the AI button shows a
friendly "not deployed yet" message.

## Deploy

Static site on Render (auto-deploys from `main`): https://mrauditor.onrender.com
