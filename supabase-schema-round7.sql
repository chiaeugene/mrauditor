-- ─────────────────────────────────────────────────────────────────────────────
-- Round 7 — say who filed a document where.
--
-- Mr Auditor can now read a document and decide which evidence category it
-- belongs in. That is a real convenience, but an auditor must always be able
-- to see the difference between a document THEY filed and one the machine
-- filed, because only the first is a professional judgement. One column.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table evidence_files
  add column if not exists category_source text not null default 'user'
  check (category_source in ('user', 'ai'));

comment on column evidence_files.category_source is
  'user = the auditor chose this category; ai = Mr Auditor read the document and filed it.';
