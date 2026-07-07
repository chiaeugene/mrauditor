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

## Storage today / Supabase tomorrow

Today everything is browser-local: engagements in `localStorage` (`mr-auditor-v2`), evidence
files in IndexedDB (`mr-auditor-files`). **Do not store real client documents until the
Supabase backend is wired.**

To prepare Supabase:

1. Create a project (Singapore region), then run `supabase-schema.sql` in the SQL editor —
   it creates `engagements` (whole engagement as `jsonb`, matching the app's Toolkit → Export
   JSON format exactly), `evidence_files`, a private `evidence` storage bucket, and RLS so each
   auditor sees only their own clients.
2. Enable email auth (the firm's staff log in; RLS keys off `auth.uid()`).
3. Wiring the app: replace `saveState/loadState` with upserts to `engagements.data`, and the
   vault's IndexedDB calls with Storage uploads + signed URLs. The abstraction points are all in
   `app.js` (`saveState`, `loadState`, `idbPut`, `idbList`, `idbDel`).

Migration path for existing data: Toolkit → Export JSON per engagement → insert into
`engagements.data`.

## Deploy

Static — deploys with the existing Render static site (`render.yaml` at repo root). Live path:
`/mr-auditor/`.
