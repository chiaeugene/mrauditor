-- ─────────────────────────────────────────────────────────────────────────────
-- Round 6 — the commission ladder is not the customer's business.
--
-- commission_tiers was readable by every authenticated user, so an audit firm
-- that had just bought Mr Auditor could read that resellers earn 20%, 25% or
-- 30%. No names or amounts leak with it, but a customer who knows there is
-- thirty per cent of margin in the price negotiates differently. The ladder is
-- only ever needed by the platform and by agents, who are the ones it pays.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "tiers read" on commission_tiers;
create policy "tiers read" on commission_tiers for select
  using (my_role() in ('super_admin', 'agent'));
