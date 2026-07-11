/* ============================================================
   Mr Auditor — Malaysian Statutory Audit Intelligence
   Single-page engine: TB classification → audit checks → FS →
   tax computation → signable reports.
   Regulatory basis: Companies Act 2016 (Act 777), PD 10/2024,
   MPERS/MFRS, ISA (Malaysian Approved Standards on Auditing),
   Income Tax Act 1967. Draft engine only — a licensed auditor
   (s.263 approval) must review evidence and sign.
   ============================================================ */

'use strict';

/* ---------------- Supabase ---------------- */
/* The anon key is meant to be public (row-level security enforces access) —
   safe to commit, same as documented in Supabase's own quickstart. */
const SUPABASE_URL = 'https://ycsctxcgdssifzijgavs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljc2N0eGNnZHNzaWZ6aWpnYXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjA5NzYsImV4cCI6MjA5ODk5Njk3Nn0.L4pz_nPE1UFyCg9V4MOIWvgEAt2zShZvftZ8JuKd4yM';
let sb = null, authUser = null;
let _vaultN = 0;   // cached vault file count for the active engagement (refreshed in updateTop)

/* ---------------- state ---------------- */
const BLANK = () => ({
  setup: { name:'', regno:'', incdate:'', fye:'', activity:'', framework:'MPERS',
           capital:'', employees:'', firstaudit:'no', foreign:'no', address:'', secretary:'', secno:'' },
  directors: [],
  tb: [],                 // {id, name, cat, dr, cr, py}
  adjustments: [],        // {id, findingId, desc, entries:[{cat,label,amt}]}  amt: +dr / -cr
  findingStatus: {},      // findingId -> 'adjusted' | 'noted'
  audit: { benchmark:'revenue', pm:'0.75' },
  tax: { entertain:'', fines:'', donations:'', otherAdd:'', exemptInc:'', ca:'', bc:'', losses:'', cp204:'' },
  sign: { firm:'', af:'', partner:'', approval:'', place:'', date:'', opinion:'unmodified',
          goingconcern:false, otherinfo:true },
  notes: {},              // note-detail inputs that kill the FS-notes placeholders
  intake: {},             // registration-wizard audit profile
  caAssets: [],           // capital allowance schedule rows
  bankin: {},             // bank-in reconciliation inputs
  bankmatch: null,        // parsed bank-statement lines {srcName, rows:[{date,desc,dr,cr,cls}]}
  archive: null,          // ISA 230 file archival {state:'final'|'reopened', finalisedBy, finalisedAt, events:[]}
  plan: {},               // planning-paper answers: materiality questionnaire, risk notes, checklists
  wpSign: {},             // per-working-paper sign-off { ref: {prep, prepDate, rev, revDate, concl} }
  samples: {},            // per-area sampling & testing { ref: {pop, keyAmt, risk, rows:[...]} }
  defence: [],            // AI position papers [{topic, title, text, ts}]
  repTab: 'auditor'
});
/* real UUIDs so engagement/file ids are valid Postgres uuid values once synced to Supabase */
const nid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,7));

/* Multi-client: DB holds every engagement; S always points at the active one. */
let DB = { ver:2, activeId:null, clients:[] };
let S = BLANK();
function newClient(label) {
  const c = Object.assign(BLANK(), { id:nid(), created: Date.now() });
  if (label) c.setup.name = label;
  DB.clients.push(c);
  switchClient(c.id);
  return c;
}
function switchClient(id) {
  const c = DB.clients.find(x => x.id === id);
  if (!c) return;
  DB.activeId = id; S = c;
  saveState();
}
function activeClient(){ return DB.clients.find(c => c.id === DB.activeId); }

/* ---------------- utils ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(/[,\s]/g,'')); return isFinite(n) ? n : 0; };
const fmt = (n, dash) => {
  if (n === null || n === undefined || (dash && Math.abs(n) < 0.005)) return '–';
  const r = Math.round(n);
  const s = Math.abs(r).toLocaleString('en-MY');
  return r < 0 ? '(' + s + ')' : s;
};
const fmtRM = n => 'RM ' + fmt(n);
const pct = (n, d=1) => isFinite(n) ? n.toFixed(d) + '%' : '–';
const toast = m => { const t = $('toast'); t.textContent = m; t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.add('hidden'), 2600); };
const dISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dMY = iso => { if(!iso) return '—'; const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('en-MY', {day:'numeric', month:'long', year:'numeric'}); };
const addMonths = (iso, m) => { const d = new Date(iso+'T00:00:00'); const day = d.getDate();
  d.setMonth(d.getMonth()+m); if (d.getDate() !== day) d.setDate(0); return dISO(d); };
const addDays = (iso, n) => { const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); return dISO(d); };
const daysTo = iso => Math.ceil((new Date(iso+'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* count a KPI element up from 0 to its already-rendered value (skips if reduced motion) */
function countUp(el, duration = 650) {
  const end = el.textContent;
  const m = end.match(/-?[\d,]+(\.\d+)?/);
  if (!m || reducedMotion()) return;
  const prefix = end.slice(0, m.index), suffix = end.slice(m.index + m[0].length);
  const target = parseFloat(m[0].replace(/,/g,''));
  if (!isFinite(target)) return;
  const t0 = performance.now();
  el.textContent = prefix + '0' + suffix;
  requestAnimationFrame(function frame(t) {
    const p = Math.min((t - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.round(target * eased);
    el.textContent = prefix + val.toLocaleString('en-MY') + suffix;
    if (p < 1) requestAnimationFrame(frame); else el.textContent = end;
  });
}
function animateKpis(containerId) {
  document.querySelectorAll(`#${containerId} .kpi-val`).forEach(el => countUp(el));
}
/* stagger a container's freshly-rendered children in on load */
function staggerChildren(containerId, stepMs = 40) {
  const box = $(containerId); if (!box) return;
  [...box.children].forEach((el, i) => {
    el.classList.add('stagger-in');
    el.style.animationDelay = `${i * stepMs}ms`;
  });
}
/* small icon + guidance empty state, for vault categories / findings / client lists */
function emptyState(icon, title, sub = '') {
  return `<div class="flex flex-col items-center justify-center text-center py-8 gap-2">
    <div class="w-11 h-11 rounded-full bg-paper flex items-center justify-center text-mut">${icon}</div>
    <div class="text-[13px] font-medium">${title}</div>
    ${sub ? `<div class="text-[12px] text-mut max-w-xs">${sub}</div>` : ''}
  </div>`;
}
const ICON_FOLDER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const ICON_DOC = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>';

/* ---------------- chart of categories ---------------- */
/* side: +1 normal debit, -1 normal credit. bal() returns natural-sign balance. */
const CATS = [
  ['REV','Revenue','pl',-1], ['COS','Cost of sales','pl',1], ['OTHINC','Other income','pl',-1],
  ['ADMIN','Administrative expenses','pl',1], ['SELL','Selling & distribution','pl',1],
  ['DEPR','Depreciation & amortisation','pl',1], ['FIN','Finance costs','pl',1], ['TAXEXP','Taxation','pl',1],
  ['PPE','Property, plant & equipment — cost','bs',1], ['ACCDEP','Accumulated depreciation','bs',-1],
  ['INTANG','Intangible assets','bs',1], ['INVEST','Investments','bs',1],
  ['INV','Inventories','bs',1], ['TR','Trade receivables','bs',1],
  ['OR','Other receivables, deposits & prepayments','bs',1],
  ['DIRADV','Amount owing by directors','bs',1], ['RPTREC','Amount owing by related parties','bs',1],
  ['FD','Fixed deposits with licensed banks','bs',1], ['CASH','Cash and bank balances','bs',1],
  ['TP','Trade payables','bs',-1], ['OP','Other payables & accruals','bs',-1],
  ['DIROWE','Amount owing to directors','bs',-1], ['RPTPAY','Amount owing to related parties','bs',-1],
  ['OD','Bank overdraft','bs',-1], ['BORR','Bank borrowings','bs',-1], ['HP','Hire purchase payables','bs',-1],
  ['TAXPAY','Current tax payable','bs',-1], ['DEFTAX','Deferred tax liability','bs',-1],
  ['SC','Share capital','bs',-1], ['RE','Retained earnings b/f','bs',-1], ['DIV','Dividends declared','bs',1],
  ['SUSP','Suspense / unclassified','bs',1]
];
const CAT = Object.fromEntries(CATS.map(c => [c[0], {code:c[0], label:c[1], kind:c[2], side:c[3]}]));
const catOptions = sel =>
  CATS.map(c => `<option value="${c[0]}" ${sel===c[0]?'selected':''}>${c[1]}</option>`).join('');

/* keyword classifier — first match wins; director/related resolved by balance side */
const RULES = [
  [/suspense|contra\b|unknown|rounding/i,'SUSP'],
  [/rental income|interest (income|received)|gain on disposal|other income|commission received|management fee income|govern.*grant|subsid(y|i)/i,'OTHINC'],
  [/interest (expense|paid|on)|finance (cost|charge)|loan interest|(hire purchase|hp|bank) interest|interest charge/i,'FIN'],
  [/fixed deposit|\bfd\b/i,'FD'],
  [/overdraft|\bod\b/i,'OD'],
  [/accumulated dep|acc\.? dep|accum dep/i,'ACCDEP'],
  [/depreciation|amortisation|amortization/i,'DEPR'],
  [/hire purchase|h\/p|hp (payable|creditor|liab)/i,'HP'],
  [/term loan|bank loan|borrowing|loan payable|financing-i|financing i\b/i,'BORR'],
  [/deferred tax/i,'DEFTAX'],
  [/tax (payable|provision)|provision for tax|cp204 payable/i,'TAXPAY'],
  [/tax(ation)? (expense|charge)|income tax\b|^tax(ation)?\s*$/i,'TAXEXP'],
  [/share capital|paid[- ]?up|ordinary shares/i,'SC'],
  [/retained (earning|profit)|accumulated (loss|profit)|unappropriated/i,'RE'],
  [/dividend/i,'DIV'],
  // remuneration/fees are P&L — must outrank the director-balance rule below
  [/remuneration|director.{0,10}fee/i,'ADMIN'],
  [/director/i,'DIR*'],                      // resolved by side
  [/holding|subsidiar|associate|related (co|part)|inter-?co|sister co/i,'RPT*'],
  [/goodwill|intangible|software|trademark|patent|development cost/i,'INTANG'],
  [/investment/i,'INVEST'],
  [/^(?!.*(inventor|stock))(?=.*(driver|tyre|tayar))/i,'COS'],  // vehicle-direct costs — but never a stock/inventory line
  [/upkeep|repair|maintenance|road tax|petrol|diesel|toll|parking/i,'ADMIN'],
  [/rent(al)? (of|expense|paid)|^rent\b|office rent|rent — |quit rent|assessment/i,'ADMIN'],
  [/motor vehicle|plant|machiner|equipment|furniture|fitting|renovation|computer(?!.*(expense|repair))|land|building|premises|signboard|air.?cond/i,'PPE'],
  [/inventor|stock(?! ?broker)|closing stock|finished goods|raw material|work.?in.?progress/i,'INV'],
  [/trade receivable|trade debtor|debtors?\b|account receivable/i,'TR'],
  [/prepaym|deposit|sundry (receivable|debtor)|other receivable|staff advance|gst|sst (receivable|refund)/i,'OR'],
  [/petty cash|cash (in hand|at bank|and bank)|bank balance|\bcash\b|maybank|cimb|public bank|rhb|hong leong|ambank|uob|ocbc|bank islam|affin|alliance/i,'CASH'],
  [/trade payable|trade creditor|creditors?\b|account payable/i,'TP'],
  [/accrual|accrued|other payable|sundry creditor|epf payable|socso payable|eis payable|pcb|salary payable|(sst|service tax|sales tax).{0,8}payable|deposit received/i,'OP'],
  [/^sales\b|sales revenue|^revenue|turnover|jualan|service (income|revenue|fee)|contract revenue|project income|(transport|haulage|freight|forwarding|trucking|logistic|courier|charter|delivery|rental of (lorr|truck|vehicle))[^,]{0,30}(income|revenue)|(income|revenue) from (transport|haulage|freight|deliver)/i,'REV'],
  [/purchase|cost of (sale|good)|direct (labour|labor|wage|cost)|subcontract|carriage inward|freight inward|opening stock|production/i,'COS'],
  [/advertis|marketing|promotion|commission paid|delivery|carriage outward|freight outward|exhibition/i,'SELL'],
  [/salar|wages|bonus|gaji|epf|kwsp|socso|perkeso|\beis\b|allowance|staff|medical/i,'ADMIN'],
  [/rent(al)?\b|utilit|electric|water|telephone|internet|insurance|professional|audit fee|secretarial|accounting fee|travel|printing|stationer|postage|courier|license|licence|bank charge|general expense|office|donation|entertainment|fine|penalt|foreign exchange|forex|bad debt|training|subscription/i,'ADMIN'],
];
function classify(name, drAmt, crAmt) {
  for (const [re, cat] of RULES) {
    if (re.test(name)) {
      if (cat === 'DIR*') return crAmt > drAmt ? 'DIROWE' : 'DIRADV';
      if (cat === 'RPT*') return crAmt > drAmt ? 'RPTPAY' : 'RPTREC';
      return cat;
    }
  }
  // fallback: expenses if debit, payables if credit — flagged low-confidence by SUSP-adjacent styling.
  // Safety net: an unmatched CREDIT balance whose name says income/revenue must
  // never be guessed as a liability — that flips the whole P&L.
  if (crAmt > drAmt && /income|revenue|sales|takings|billings/i.test(name)) return 'REV';
  return drAmt >= crAmt ? 'ADMIN' : 'OP';
}

/* ---------------- aggregation / FS model ---------------- */
/* Adjustment sign convention: entries carry amt as +debit / −credit in RAW dr/cr space;
   converted to natural sign per category at aggregation. */
function model(py = false) {
  // raw (dr-positive) balances per category
  const raw = {}; CATS.forEach(c => raw[c[0]] = 0);
  if (py) { for (const r of S.tb) raw[r.cat] += num(r.py) * CAT[r.cat].side; }
  else {
    for (const r of S.tb) raw[r.cat] += num(r.dr) - num(r.cr);
    for (const a of S.adjustments) for (const e of a.entries) raw[e.cat] += e.amt;
  }
  const nat = {}; CATS.forEach(c => nat[c[0]] = raw[c[0]] * CAT[c[0]].side);
  const m = { raw, nat };
  m.revenue = nat.REV; m.cos = nat.COS; m.gp = m.revenue - m.cos;
  m.othinc = nat.OTHINC;
  m.opex = nat.ADMIN + nat.SELL + nat.DEPR;
  m.fin = nat.FIN;
  m.pbt = m.gp + m.othinc - m.opex - m.fin;
  m.taxexp = nat.TAXEXP;
  m.pat = m.pbt - m.taxexp;
  m.ppeNet = nat.PPE - nat.ACCDEP;
  m.nca = m.ppeNet + nat.INTANG + nat.INVEST;
  m.ca = nat.INV + nat.TR + nat.OR + nat.DIRADV + nat.RPTREC + nat.FD + nat.CASH;
  m.totalAssets = m.nca + m.ca + Math.max(nat.SUSP, 0);
  m.clSimple = nat.TP + nat.OP + nat.DIROWE + nat.RPTPAY + nat.OD + nat.TAXPAY;
  m.ncl = nat.BORR + nat.HP + nat.DEFTAX;
  m.totalLiab = m.clSimple + m.ncl + Math.min(nat.SUSP, 0);
  m.reClose = nat.RE + m.pat - nat.DIV;
  m.equity = nat.SC + m.reClose;
  m.balGap = m.totalAssets - m.totalLiab - m.equity;
  m.netCurrent = m.ca - m.clSimple;
  return m;
}
function tbTotals() {
  let dr = 0, cr = 0;
  for (const r of S.tb) { dr += num(r.dr); cr += num(r.cr); }
  return { dr, cr, diff: dr - cr };
}
const hasPY = () => S.tb.some(r => num(r.py) !== 0);

/* ---------------- materiality ---------------- */
function materiality() {
  const m = model();
  const benches = {
    revenue: { label:'1% of revenue', base:Math.abs(m.revenue), rate:.01 },
    pbt: { label:'5% of profit before tax', base:Math.abs(m.pbt), rate:.05 },
    assets: { label:'1.5% of total assets', base:Math.abs(m.totalAssets), rate:.015 }
  };
  const b = benches[S.audit.benchmark] || benches.revenue;
  const overall = Math.max(Math.round(b.base * b.rate), 1000);
  const pm = Math.round(overall * parseFloat(S.audit.pm || .75));
  return { overall, pm, trivial: Math.round(overall * .05), label: b.label, benches, m };
}

/* ---------------- findings engine ---------------- */
function buildFindings() {
  const F = [];
  const t = tbTotals();
  const m = model();
  const mp = hasPY() ? model(true) : null;
  const mat = materiality();
  const push = (id, sev, area, title, law, detail, fix, adj, misstate) =>
    F.push({ id, sev, area, title, law, detail, fix, adj, misstate: misstate || 0 });

  if (!S.tb.length) return F;

  // 1 — TB balance
  if (Math.abs(t.diff) > 0.5)
    push('tb-unbalanced','blocker','Books','Trial balance does not balance',
      'ISA 500 — sufficient appropriate evidence',
      `Debits ${fmtRM(t.dr)} vs credits ${fmtRM(t.cr)} — difference ${fmtRM(t.diff)}. Incomplete records are the #1 reason Malaysian SME audits stall; the auditor cannot form an opinion on unbalanced books.`,
      'Trace the difference to missing entries (commonly: unreconciled bank, missing opening balances, one-sided journals). If records cannot be completed, the audit heads towards a disclaimer of opinion.');

  // 2 — suspense
  const susp = m.raw.SUSP;
  if (Math.abs(susp) > 0.5)
    push('suspense', Math.abs(susp) > mat.pm ? 'high':'medium','Books','Suspense / unclassified balances on the TB',
      'ISA 500 / MIA practice review hot spot',
      `Suspense balance of ${fmtRM(Math.abs(susp))} sits on the books${Math.abs(susp)>mat.pm?' — above performance materiality':''}. Practice reviewers repeatedly cite uncleared suspense as evidence of weak records.`,
      'Obtain breakdown from the bookkeeper and reclassify every item. Unresolved amounts above the trivial threshold must go to the misstatement ledger.',
      null, Math.abs(susp));

  // 3 — directors' advances
  if (m.nat.DIRADV > 0.5) {
    const deemed = Math.round(m.nat.DIRADV * 0.0295); // ~average lending rate proxy for s.140B illustration
    push('dir-adv','high','Related parties',`Amounts owing by directors — ${fmtRM(m.nat.DIRADV)}`,
      's.224/225 CA 2016 · s.140B ITA 1967 · MPERS s.33',
      `Loans/advances to directors of a private company are only lawful in limited cases (s.224 CA 2016); breach exposes directors to a fine and the amount remains repayable. LHDN also deems interest income to the company on loans to directors funded from internal funds (s.140B — illustratively ±${fmtRM(deemed)}/yr at ALR). Full related-party disclosure is mandatory.`,
      'Obtain a signed confirmation + repayment plan from the director. Disclose under MPERS s.33. Add deemed s.140B interest to the tax computation. If recoverability is doubtful, impair.',
      null, 0);
  }

  // 4 — no depreciation but PPE exists
  if (m.nat.PPE > 0.5 && m.nat.DEPR < 0.5) {
    const est = Math.round((m.nat.PPE - m.nat.ACCDEP) * 0.15);
    push('no-depr','high','PPE','PPE on the books but no depreciation charged',
      'MPERS s.17 / MFRS 116',
      `Cost ${fmtRM(m.nat.PPE)} with no depreciation expense in the year. Understates expenses and overstates profit — a classic incomplete-records symptom. Estimated charge at a blended 15%: ±${fmtRM(est)}.`,
      'Recompute depreciation from the fixed asset register (or rebuild the register — common rates: buildings 2%, plant 10–20%, motor vehicles 20%, office equipment 10–20%, computers 33%). Post the adjustment.',
      { desc:'Provide estimated depreciation for the year',
        entries:[ {cat:'DEPR', label:'Depreciation charge', amt: est},
                  {cat:'ACCDEP', label:'Accumulated depreciation', amt: -est} ] },
      est);
  }

  // 5 — acc dep exceeds cost
  if (m.nat.ACCDEP > m.nat.PPE + 0.5 && m.nat.PPE > 0)
    push('accdep-exceeds','medium','PPE','Accumulated depreciation exceeds cost',
      'MPERS s.17',
      `Accumulated depreciation ${fmtRM(m.nat.ACCDEP)} > cost ${fmtRM(m.nat.PPE)}. Usually a disposal never removed from the register, or depreciation run past useful life.`,
      'Reconcile the fixed asset register to the GL; strip out disposed assets (cost and accumulated depreciation) and recompute any gain/loss on disposal.');

  // 6 — negative cash
  const negBanks = S.tb.filter(r => r.cat === 'CASH' && (num(r.cr) - num(r.dr)) > 0.5);
  if (negBanks.length) {
    const amt = negBanks.reduce((s,r) => s + num(r.cr) - num(r.dr), 0);
    push('neg-cash','medium','Cash & bank','Bank account in credit (negative cash)',
      'MPERS s.4 presentation · ISA 330',
      `${negBanks.map(r=>esc(r.name)).join(', ')} carries a credit balance of ${fmtRM(amt)}. Either an unreconciled bank (cheques recorded but not issued / cut-off) or an overdraft misclassified as an asset.`,
      'Obtain the bank statement + reconciliation. If genuinely overdrawn, reclassify to bank overdraft under current liabilities and check the facility letter for security/covenants.',
      { desc:'Reclassify credit bank balance to bank overdraft',
        entries:[ {cat:'CASH', label:'Cash and bank balances', amt: amt},
                  {cat:'OD', label:'Bank overdraft', amt: -amt} ] },
      0);
  }

  // 7 — going concern: negative equity
  if (m.equity < -0.5)
    push('neg-equity','high','Going concern','Shareholders’ funds are negative',
      'ISA 570 (Revised) · s.466 CA 2016 exposure',
      `Total equity is ${fmtRM(m.equity)} (share capital ${fmtRM(m.nat.SC)}, closing retained earnings ${fmtRM(m.reClose)}). The company is balance-sheet insolvent — a primary going-concern indicator and a red flag for creditors.`,
      'Obtain directors’ cash-flow forecast (≥12 months from report date), letters of financial support from directors/shareholders (with evidence of their capacity to support), and consider a Material Uncertainty Related to Going Concern paragraph.');
  else if (m.netCurrent < -0.5)
    push('net-cl','medium','Going concern','Net current liabilities position',
      'ISA 570 (Revised)',
      `Current liabilities exceed current assets by ${fmtRM(-m.netCurrent)}. Assess whether the company can meet obligations as they fall due.`,
      'Review post-year-end cash flows, unused facilities and director support. Document the going-concern assessment; consider MUGC disclosure if material uncertainty remains.');

  // 8 — dividend while accumulated losses
  if (m.nat.DIV > 0.5 && m.reClose < 0)
    push('illegal-div','high','Equity','Dividend declared despite accumulated losses',
      's.131–132 CA 2016 (solvency test)',
      `Dividends of ${fmtRM(m.nat.DIV)} were declared while closing retained earnings are ${fmtRM(m.reClose)}. Distributions may only be made out of available profits and subject to the directors’ solvency test — directors face personal liability for improper distributions.`,
      'Confirm distributable reserves at declaration date. If improper, the dividend may need to be clawed back or reclassified as an amount owing by directors/shareholders.');

  // 9 — receivable days
  if (m.revenue > 0 && m.nat.TR > 0) {
    const days = m.nat.TR / m.revenue * 365;
    if (days > 120)
      push('rec-days', days > 240 ? 'high':'medium','Receivables',`Trade receivables at ${Math.round(days)} days of revenue`,
        'MPERS s.11 impairment · ISA 540',
        `Receivables ${fmtRM(m.nat.TR)} against revenue ${fmtRM(m.revenue)} → ${Math.round(days)} days (healthy Malaysian SME trading terms run 30–90 days). Slow collections signal impairment risk or fictitious/uncollectible sales.`,
        'Obtain aged listing; circularise major balances (ISA 505); test post-year-end receipts; propose specific impairment for stale balances (>120 days with no receipts).');
  }

  // 10 — inventory days
  if (m.cos > 0 && m.nat.INV > 0) {
    const days = m.nat.INV / m.cos * 365;
    if (days > 180)
      push('inv-days','medium','Inventories',`Inventories at ${Math.round(days)} days of cost of sales`,
        'MPERS s.13 (lower of cost & NRV) · ISA 501',
        `Inventories ${fmtRM(m.nat.INV)} represent ${Math.round(days)} days of consumption. Slow-moving or obsolete stock may need writing down to net realisable value.`,
        'Attend/perform stock count procedures, test NRV on slow movers against post-year-end selling prices, and challenge the costing basis.');
  }

  // 11 — GP margin
  if (m.revenue > 0) {
    const gpPct = m.gp / m.revenue * 100;
    if (gpPct < 0)
      push('neg-gp','high','Revenue & costs',`Negative gross margin (${pct(gpPct)})`,
        'ISA 520 · ISA 240 (fraud risk)',
        'Selling below cost across a full year is commercially unusual. Typical causes: unrecorded revenue (cash sales kept off-book), purchases cut-off errors, or stock not counted.',
        'Perform revenue completeness work: bank-in analysis vs recorded sales, e-Invois/SST reconciliations, margin-by-month analysis. Verify closing stock existence and cut-off.');
    else if (mp && mp.revenue > 0) {
      const swing = gpPct - (mp.gp / mp.revenue * 100);
      if (Math.abs(swing) > 10)
        push('gp-swing','medium','Revenue & costs',`Gross margin moved ${swing>0?'+':''}${pct(swing)} vs prior year`,
          'ISA 520 analytical procedures',
          `GP margin ${pct(gpPct)} vs ${pct(mp.gp/mp.revenue*100)} last year. Swings above ±10 points need a documented business explanation before sign-off.`,
          'Corroborate management’s explanation (price changes, product mix, forex) with supplier invoices and price lists. Reviewers cite unexplained analytics as a top documentation deficiency.');
    }
  }

  // 12 — related party balances disclosure
  if (m.nat.RPTREC > 0.5 || m.nat.RPTPAY > 0.5 || m.nat.DIROWE > 0.5)
    push('rpt-disc','low','Related parties','Related-party balances require disclosure',
      'MPERS s.33 / MFRS 124',
      `Balances: owing by related parties ${fmtRM(m.nat.RPTREC)}, owing to related parties ${fmtRM(m.nat.RPTPAY)}, owing to directors ${fmtRM(m.nat.DIROWE)}. Terms (interest, security, repayment) must be disclosed; amounts owing to directors are usually the SME lifeline and often undocumented.`,
      'Obtain confirmations for each balance; document nature of relationship and terms; ensure the FS note discloses them. Non-trade, unsecured, interest-free, repayable on demand is the standard wording — confirm it is true.');

  // 13 — borrowings but no finance cost / vice versa
  if ((m.nat.BORR + m.nat.HP + m.nat.OD) > 0.5 && m.fin < 0.5)
    push('no-interest','medium','Borrowings','Borrowings exist but no finance cost recorded',
      'MPERS s.11/s.25',
      `Borrowings total ${fmtRM(m.nat.BORR + m.nat.HP + m.nat.OD)} yet finance costs are ${fmtRM(m.fin)}. Interest is likely unrecorded (understating expenses) or the loan balances are stale.`,
      'Obtain bank facility statements and HP schedules; recompute interest; post the accrual. Also verify balances via bank confirmation (ISA 505).');
  if (m.fin > 0.5 && (m.nat.BORR + m.nat.HP + m.nat.OD) < 0.5)
    push('interest-no-loan','low','Borrowings','Finance costs without any recorded borrowings',
      'Completeness of liabilities',
      `Finance costs ${fmtRM(m.fin)} but no loan balances on the TB — a liability may be missing (completeness assertion) or a director-financed loan is off-book.`,
      'Trace the interest payments through the bank statements to the lender; record the missing facility.');

  // 14 — FD without interest income
  if (m.nat.FD > 0.5 && m.othinc < 0.5)
    push('fd-no-int','low','Cash & bank','Fixed deposits without interest income',
      'Completeness of income',
      `FDs of ${fmtRM(m.nat.FD)} but no interest income recorded. Either income is unrecorded or the FD no longer exists (pledged/uplifted).`,
      'Confirm FD certificates and lien status with the bank; recompute and record interest income.');

  // 15 — salaries but no EPF/SOCSO
  const salRows = S.tb.filter(r => /salar|wages|bonus|gaji/i.test(r.name));
  const statRows = S.tb.filter(r => /epf|kwsp|socso|perkeso|eis/i.test(r.name));
  if (salRows.length && !statRows.length) {
    const sal = salRows.reduce((s,r)=> s + num(r.dr) - num(r.cr), 0);
    if (sal > 0.5)
      push('no-epf','medium','Payroll','Salaries recorded but no EPF/SOCSO/EIS anywhere on the TB',
        'EPF Act 1991 · Employees’ Social Security Act 1969',
        `Salaries ${fmtRM(sal)} with no statutory contribution accounts. Either contributions are unpaid (statutory breach + accrual missing) or wages are being paid outside payroll.`,
        'Obtain Borang A (KWSP) and Borang 8A (PERKESO) submissions; reconcile to payroll; accrue any arrears including late-payment dividends/interest.');
  }

  // 16 — SST registration threshold
  if (m.revenue > 500000 && !S.tb.some(r => /sst|sales tax|service tax/i.test(r.name)))
    push('sst','info','Indirect tax','Revenue above RM500k — confirm SST registration position',
      'Sales Tax Act / Service Tax Act 2018',
      `Revenue ${fmtRM(m.revenue)} exceeds the general RM500,000 service-tax registration threshold, but no SST accounts appear on the TB. Liability for unregistered periods (plus penalties) would be a provision/contingency.`,
      'Confirm whether the company’s activities are taxable services or taxable goods manufacture; check MySST registration status; provide for exposure if late.');

  // 17 — e-invoicing phase
  if (m.revenue > 0) {
    const einv = m.revenue > 5000000 ? 'already mandatory (phase by turnover, from 2024–Jul 2025)' :
                 m.revenue > 1000000 ? 'mandatory from 1 January 2026' :
                 m.revenue > 500000 ? 'mandatory from 1 July 2026' : 'currently exempt (≤ RM500k)';
    push('einvoice','info','Compliance',`MyInvois e-invoicing: ${einv}`,
      'LHDN e-Invoice guideline',
      `Based on annual revenue of ${fmtRM(m.revenue)}, this client's e-invoicing obligation is: ${einv}. Post-implementation, LHDN's e-Invois data makes unrecorded-revenue detection near-automatic — books must reconcile to MyInvois submissions.`,
      'Advise the client on onboarding (MyInvois portal or API); for the audit, reconcile reported revenue to e-Invois data where already live.');
  }

  // 18 — audit exemption cross-check
  const ex = exemptionAssess();
  if (ex && ex.qualifies)
    push('exemption','info','Engagement','Client may qualify for audit exemption',
      'SSM Practice Directive 10/2024',
      ex.summary + ' Even if exempt, members holding ≥5% can still require an audit, and unaudited FS + directors’ certificate must still be lodged via MBRS.',
      'Discuss with the shareholders whether they still want an audit (banks financing the company usually do). Document the engagement-acceptance decision.');

  // 19 — misclassification fallback count
  const weak = S.tb.filter(r => r.autoWeak).length;
  if (weak)
    push('weak-class','low','Books',`${weak} account(s) classified by fallback only`,
      'Presentation & disclosure assertions',
      'These lines did not match any known account pattern and were defaulted to admin expenses / other payables. Misclassification distorts the FS and every ratio.',
      'Review each flagged row on the Trial Balance screen and set the right classification manually.');

  // 20 — first audit opening balances
  if (S.setup.firstaudit === 'yes')
    push('opening','medium','Engagement','First audit — opening balances unverified',
      'ISA 510',
      'For an initial engagement the auditor must obtain evidence that opening balances do not contain material misstatements — often via the predecessor’s working papers or substantive work on openings.',
      'If prior year was unaudited/exempt, extend procedures to opening stock, receivables and payables; scope limitation here commonly drives a qualified opinion on comparability.');

  // 21 — profitable year but no tax charge booked
  if (m.pbt > 1000 && m.nat.TAXEXP < 0.5) {
    const tc = taxComputeCore();
    if (tc.tax > mat.trivial)
      push('no-tax','high','Taxation','Profitable year but no taxation charge in the accounts',
        'MPERS s.29 · ITA 1967',
        `Profit before tax is ${fmtRM(m.pbt)} yet the TB carries no taxation charge — the FS would show profit after tax equal to PBT. Based on the tax computation (step 7: SME tiers, capital allowances ${fmtRM(tc.T('ca'))}, add-backs ${fmtRM(tc.addbacks)}), the charge should be ±${fmtRM(tc.tax)}. No reviewing partner signs a profitable FS with a nil tax line.`,
        'Agree the tax computation inputs on the Tax screen (capital allowances, disallowables), then post the provision. The one-click adjustment below books the charge from that same computation.',
        { desc:'Provide for current-year taxation per the tax computation',
          entries:[ {cat:'TAXEXP', label:'Taxation', amt: tc.tax},
                    {cat:'TAXPAY', label:'Current tax payable', amt: -tc.tax} ] },
        tc.tax);
  }

  // 22 — prior-year comparatives don't articulate
  if (mp && Math.abs(mp.balGap) > 1)
    push('py-gap', Math.abs(mp.balGap) > mat.overall ? 'high' : 'medium','Books','Prior-year comparatives do not articulate',
      'ISA 510 · ISA 710',
      `The prior-year column's balance sheet is out by ${fmtRM(mp.balGap)} (assets − liabilities − equity). The comparative column of the FS will not balance, and opening balances cannot be relied on until it does.`,
      'Re-agree every prior-year figure to the signed prior-year FS (enter each balance as a positive number as presented there; accumulated losses as a negative retained-earnings figure). If the prior year was unaudited, extend ISA 510 opening-balance procedures.');

  const sevRank = { blocker:0, high:1, medium:2, low:3, info:4 };
  F.sort((a,b) => sevRank[a.sev] - sevRank[b.sev]);
  return F;
}

/* ---------------- exemption assessment ---------------- */
function exemptionAssess() {
  const fye = S.setup.fye; if (!fye) return null;
  const m = model();
  const fyStartYear = new Date(addDays(addMonths(fye, -12), 1) + 'T00:00:00').getFullYear();
  let th;
  if (fyStartYear <= 2024) th = null;
  else if (fyStartYear === 2025) th = { rev:1000000, assets:1000000, emp:10, phase:'Phase 1 (FY commencing 2025)' };
  else if (fyStartYear === 2026) th = { rev:2000000, assets:2000000, emp:20, phase:'Phase 2 (FY commencing 2026)' };
  else th = { rev:3000000, assets:3000000, emp:30, phase:'Phase 3 (FY commencing 2027 onwards)' };
  if (!th) return { qualifies:false, pre2025:true, summary:'FY commenced before 2025 — old regime (dormant / zero-revenue / threshold-qualified ≤ RM100k) applies.' };
  const emp = num(S.setup.employees);
  const tests = [
    { name:'Annual revenue', val:m.revenue, lim:th.rev, ok:m.revenue <= th.rev, fmt:fmtRM },
    { name:'Total assets', val:m.totalAssets, lim:th.assets, ok:m.totalAssets <= th.assets, fmt:fmtRM },
    { name:'Employees', val:emp, lim:th.emp, ok:emp <= th.emp, fmt:v=>String(v) }
  ];
  const met = tests.filter(t => t.ok).length;
  const qualifies = met >= 2;
  return { th, tests, met, qualifies,
    summary:`${th.phase}: meets ${met} of 3 criteria (need 2, in this and the two preceding financial years).` };
}

/* ---------------- misstatement / opinion ---------------- */
function evaluate() {
  const mat = materiality();
  const findings = buildFindings();
  const open = findings.filter(f => !S.findingStatus[f.id]);
  const uncorrected = open.filter(f => f.misstate > mat.trivial);
  const totalMis = uncorrected.reduce((s,f) => s + f.misstate, 0);
  const t = tbTotals();
  const gc = open.some(f => f.id === 'neg-equity') ||
             (open.some(f => f.id === 'net-cl') && open.some(f => f.id==='rec-days' || f.id==='no-interest'));
  let opinion = 'unmodified', why = 'No uncorrected misstatements above materiality and no unresolved scope limitations.';
  if (Math.abs(t.diff) > 0.5) { opinion = 'disclaimer';
    why = 'The trial balance does not balance — sufficient appropriate audit evidence cannot be obtained (pervasive scope limitation).'; }
  else if (totalMis > mat.overall && new Set(uncorrected.map(f=>f.area)).size >= 3) { opinion = 'adverse';
    why = `Uncorrected misstatements of ${fmtRM(totalMis)} are material AND pervasive — they cut across ${new Set(uncorrected.map(f=>f.area)).size} areas of the financial statements (vs materiality of ${fmtRM(mat.overall)}).`; }
  else if (totalMis > mat.overall) { opinion = 'qualified-mis';
    why = `Uncorrected misstatements of ${fmtRM(totalMis)} exceed overall materiality of ${fmtRM(mat.overall)} but are confined to identifiable areas — qualify, or post the proposed adjustments to clear them.`; }
  else if (S.setup.firstaudit === 'yes' && !S.findingStatus['opening']) { opinion = 'qualified-scope';
    why = 'Opening balances of this initial engagement remain unverified (ISA 510) — qualify unless sufficient work on openings is completed.'; }
  return { mat, findings, open, uncorrected, totalMis, gc, opinion, why };
}
const OPINION_LABEL = { unmodified:'Unmodified (clean)', 'qualified-mis':'Qualified — misstatement',
  'qualified-scope':'Qualified — scope limitation', adverse:'Adverse', disclaimer:'Disclaimer of opinion' };

/* ---------------- deadlines ---------------- */
function deadlines() {
  const out = [];
  const fye = S.setup.fye, inc = S.setup.incdate;
  if (fye) {
    const circ = addMonths(fye, 6);
    out.push({ label:'Circulate audited FS to members', law:'s.257–258 CA 2016', date:circ });
    out.push({ label:'Lodge FS with SSM via MBRS', law:'s.259(1)(a) — 30 days after circulation', date:addDays(circ, 30) });
    out.push({ label:'Form e-C to LHDN', law:'s.77A ITA — 7 months after FYE (+1 mth e-filing grace)', date:addMonths(fye, 7) });
    const nextStart = addDays(fye, 1);
    out.push({ label:'CP204 estimate for next YA', law:'s.107C — 30 days before basis period', date:addDays(nextStart, -30), noPast:true });
  }
  if (S.sign && S.sign.date && !isArchived())
    out.push({ label:'Assemble & finalise the audit file', law:'ISA 230 — 60 days after report date', date:addDays(S.sign.date, 60) });
  if (inc) {
    const now = new Date();
    const anniv = new Date(inc + 'T00:00:00'); anniv.setFullYear(now.getFullYear());
    if (anniv < now) anniv.setFullYear(now.getFullYear() + 1);
    out.push({ label:'Annual return (anniversary + 30 days)', law:'s.68 CA 2016', date:addDays(dISO(anniv), 30) });
  }
  return out.map(d => ({ ...d, days: daysTo(d.date) }));
}
function deadlineChip(days) {
  if (days < 0) return `<span class="pill pill-risk">${Math.abs(days)}d overdue</span>`;
  if (days <= 30) return `<span class="pill pill-warn">${days}d left</span>`;
  return `<span class="pill pill-ok">${days}d left</span>`;
}
function deadlinesHTML() {
  const ds = deadlines();
  if (!ds.length) return '<div class="text-mut text-[13px]">Set the financial year end on Engagement Setup to activate the statutory clock.</div>';
  return ds.map(d => `
    <div class="flex items-center gap-3 py-1.5 border-b border-line/60 last:border-0">
      <div class="min-w-0 flex-1">
        <div class="font-medium truncate">${d.label}</div>
        <div class="text-[11px] text-mut">${d.law} · ${dMY(d.date)}</div>
      </div>${deadlineChip(d.days)}
    </div>`).join('');
}

/* ============================================================
   RENDERERS
   ============================================================ */

/* ---------- navigation ---------- */
const TITLES = { home:'Mr Auditor', register:'Register a company', dashboard:'Dashboard', setup:'Engagement Setup', tb:'Trial Balance',
  audit:'Audit Engine', wps:'Audit File — Working Papers', fs:'Financial Statements', tax:'Tax Computation',
  reports:'Reports & Sign-off', pack:'Full Audit Pack', vault:'Evidence Vault', toolkit:'Auditor Toolkit',
  defence:'Defence & Positions', ref:'Regulatory Compass', queries:'Queries, PBC & Audit Trail',
  compliance:'Compliance & Data' };
let current = 'dashboard';
function show(scr) {
  current = scr;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('scr-' + scr).classList.add('active');
  document.querySelectorAll('#sidenav .navlink, #mobile-nav .navlink').forEach(n =>
    n.classList.toggle('active', n.dataset.scr === scr));
  $('top-title').textContent = TITLES[scr];
  closeNav();
  render(scr);
}
function toggleNav(){ const n=$('mobile-nav'), o=$('nav-overlay');
  const open = n.classList.contains('-translate-x-full');
  n.classList.toggle('-translate-x-full', !open); o.classList.toggle('hidden', !open); }
function closeNav(){ $('mobile-nav').classList.add('-translate-x-full'); $('nav-overlay').classList.add('hidden'); }

function render(scr = current) {
  updateTop();
  ({ home:renderHome, register:renderRegister, dashboard:renderDashboard, setup:renderSetup, tb:renderTB, audit:renderAudit,
     wps:renderWps, fs:renderFS, tax:renderTax, reports:renderReports, pack:renderPack, vault:renderVault,
     toolkit:renderToolkit, defence:renderDefence, ref:renderRef, queries:renderQueriesScreen,
     compliance:renderCompliance }[scr])();
}
function updateTop() {
  $('top-sub').textContent = S.setup.name
    ? `${S.setup.name} · FYE ${dMY(S.setup.fye)} · ${S.setup.framework}` : 'New engagement — set up the client';
  document.querySelectorAll('#nav-client-count').forEach(el => el.textContent = DB.clients.length);
  vaultCount().then(n => { _vaultN = n;
    document.querySelectorAll('#nav-vault-count').forEach(el => el.textContent = n); }).catch(()=>{});
  const st = $('top-status');
  if (isArchived()) { st.className='pill pill-info'; st.textContent='Archived (read-only)'; return; }
  if (!S.tb.length) { st.className='pill pill-mut'; st.textContent='Not started'; return; }
  const ev = evaluate();
  const blockers = ev.open.filter(f=>f.sev==='blocker').length;
  const highs = ev.open.filter(f=>f.sev==='high').length;
  if (blockers) { st.className='pill pill-risk'; st.textContent=`${blockers} blocker`; }
  else if (highs) { st.className='pill pill-warn'; st.textContent=`${highs} high findings`; }
  else { st.className='pill pill-ok'; st.textContent='Ready for partner review'; }
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const has = S.tb.length > 0;
  const ev = has ? evaluate() : null;
  const m = has ? ev.mat.m : null;
  const kpi = (lbl, val, sub, tone='') => `
    <div class="card card-pad">
      <div class="kpi-lbl">${lbl}</div>
      <div class="kpi-val ${tone}">${val}</div>
      <div class="text-[12px] text-mut mt-0.5">${sub}</div>
    </div>`;
  $('dash-kpis').innerHTML = has ? [
    kpi('Revenue', fmtRM(m.revenue), hasPY()? 'PY ' + fmtRM(model(true).revenue) : 'current year'),
    kpi('Profit before tax', fmtRM(m.pbt), `net margin ${m.revenue? pct(m.pbt/m.revenue*100):'–'}`, m.pbt<0?'text-risk':''),
    kpi('Total assets', fmtRM(m.totalAssets), `equity ${fmtRM(m.equity)}`, m.equity<0?'text-risk':''),
    kpi('Materiality', fmtRM(ev.mat.overall), `${ev.mat.label} · PM ${fmtRM(ev.mat.pm)}`)
  ].join('') : [
    kpi('Revenue','–','load a trial balance'), kpi('Profit before tax','–',''),
    kpi('Total assets','–',''), kpi('Materiality','–','')
  ].join('');
  animateKpis('dash-kpis');

  // pipeline — mirrors how a real engagement runs: setup → evidence → numbers → audit → outputs
  const t = tbTotals();
  const steps = [
    { n:1, lbl:'Engagement set up', done: !!(S.setup.name && S.setup.fye), scr:'setup',
      sub: S.setup.name ? `${S.setup.name} · ${S.setup.framework}` : 'company particulars, framework, exemption check' },
    { n:2, lbl:'Evidence collected in the vault', done: _vaultN > 0, scr:'vault',
      sub: _vaultN > 0 ? `${_vaultN} file(s) filed` : 'bank statements, prior-year FS, SSM records — the documents the audit rests on' },
    { n:3, lbl:'Trial balance imported & balanced', done: has && Math.abs(t.diff)<=0.5, scr:'tb',
      sub: has ? `${S.tb.length} accounts · ${Math.abs(t.diff)<=0.5?'balanced':'OUT OF BALANCE ' + fmtRM(t.diff)}` : 'paste from Excel / accounting system' },
    { n:4, lbl:'Audit engine run — findings cleared', done: has && ev.open.filter(f=>['blocker','high'].includes(f.sev)).length===0, scr:'audit',
      sub: has ? `${ev.open.length} open finding(s), ${S.adjustments.length} adjustment(s) posted` : 'materiality, analytics, smart checks' },
    { n:5, lbl:'Audit file — planning & working papers', done: !!(S.plan.mat && S.plan.mat.applied) && Object.keys(S.wpSign).length >= 3, scr:'wps',
      sub: S.plan.mat && S.plan.mat.applied ? `materiality documented · ${Object.keys(S.wpSign).length} paper(s) signed` : 'materiality questionnaire, risk & scoping, lead schedules' },
    { n:6, lbl:'Financial statements generated', done: has && Math.abs(model().balGap)<=1, scr:'fs',
      sub: has ? (Math.abs(model().balGap)<=1 ? 'SOFP articulates' : `SOFP gap ${fmtRM(model().balGap)}`) : 'MPERS-format FS' },
    { n:7, lbl:'Tax computation prepared', done: has && (num(S.tax.ca)>0 || num(S.tax.cp204)>0 || S.tax._touched), scr:'tax',
      sub:'SME tiers 15% / 17% / 24% · Sch 3 capital allowances' },
    { n:8, lbl:'Reports ready for licensed auditor', done: !!(S.sign.partner && S.sign.firm), scr:'reports',
      sub: S.sign.partner ? `${S.sign.partner}, ${S.sign.firm}` : 'auditor’s report, directors’ report, statutory declaration' }
  ];
  const doneCt = steps.filter(s=>s.done).length;
  const nextStep = steps.find(s => !s.done);
  $('dash-pipeline-pct').textContent = Math.round(doneCt/steps.length*100) + '%';
  $('dash-pipeline').innerHTML = steps.map(s => `
    <div class="flex items-start gap-3 cursor-pointer group ${nextStep === s ? 'bg-indigosoft/60 -mx-2 px-2 py-1.5 rounded-xl' : ''}" onclick="show('${s.scr}')">
      <div class="step-dot ${s.done?'bg-okbg text-ok':'bg-indigosoft text-indigo'}">
        ${s.done ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : s.n}
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-[13.5px] group-hover:text-indigo">${s.lbl}
          ${nextStep === s ? '<span class="pill pill-info ml-1.5">next step</span>' : ''}</div>
        <div class="text-[12px] text-mut truncate">${s.sub}</div>
      </div>
    </div>`).join('');

  $('dash-deadlines').innerHTML = deadlinesHTML();

  $('dash-findings').innerHTML = !has ? '<div class="text-mut text-[13px]">Run the audit engine to surface findings.</div>' :
    (ev.open.slice(0,5).map(f => `
      <div class="sevrow sev-${f.sev} pl-3 py-1.5 cursor-pointer hover:bg-paper rounded-r-lg" onclick="show('audit')">
        <div class="flex items-center gap-2">
          <span class="pill ${f.sev==='blocker'||f.sev==='high'?'pill-risk':f.sev==='medium'?'pill-warn':'pill-info'}">${f.sev}</span>
          <span class="font-medium text-[13px] truncate">${f.title}</span>
        </div>
      </div>`).join('') || '<div class="pill pill-ok">All findings cleared</div>');

  $('dash-opinion').innerHTML = !has ? '<div class="text-mut text-[13px]">Awaiting data.</div>' : opinionCard(ev);
}
function opinionCard(ev) {
  const tone = ev.opinion==='unmodified' ? ['pill-ok','#15803D'] :
    ev.opinion.startsWith('qualified') ? ['pill-warn','#B45309'] : ['pill-risk','#B91C1C'];
  return `
    <div class="flex items-center gap-3 mb-2">
      <span class="pill ${tone[0]} !text-[13px] !px-3 !py-1">${OPINION_LABEL[ev.opinion]}</span>
      ${ev.gc ? '<span class="pill pill-warn">+ Going-concern uncertainty</span>' : ''}
    </div>
    <p class="text-[13px] text-mut leading-relaxed">${ev.why}</p>
    <div class="mt-3 text-[12px] text-mut">Uncorrected misstatements <span class="mono font-semibold" style="color:${tone[1]}">${fmtRM(ev.totalMis)}</span> vs materiality <span class="mono font-semibold">${fmtRM(ev.mat.overall)}</span></div>
    <div class="h-2 rounded-full bg-paper mt-2 overflow-hidden">
      <div class="h-full rounded-full" style="width:${Math.min(ev.totalMis/ev.mat.overall*100,100)}%;background:${tone[1]}"></div>
    </div>`;
}

/* ---------- setup ---------- */
function renderSetup() {
  const s = S.setup;
  const set = (id,v) => { const el=$(id); if (el && el.value !== (v??'')) el.value = v ?? ''; };
  set('f-name',s.name); set('f-regno',s.regno); set('f-incdate',s.incdate); set('f-fye',s.fye);
  set('f-activity',s.activity); set('f-framework',s.framework); set('f-capital',s.capital);
  set('f-employees',s.employees); set('f-firstaudit',s.firstaudit); set('f-foreign',s.foreign); set('f-address',s.address);
  set('f-secretary',s.secretary); set('f-secno',s.secno);
  renderTeam().catch(()=>{});

  $('directors-list').innerHTML = S.directors.map((d,i) => `
    <div class="flex gap-2 items-center">
      <input class="field !w-auto flex-1" value="${esc(d.name)}" placeholder="Director name"
        onchange="S.directors[${i}].name=this.value; saveState()">
      <input class="field mono !w-44" value="${esc(d.ic)}" placeholder="NRIC"
        onchange="S.directors[${i}].ic=this.value; saveState()">
      <input class="field mono !w-36" value="${esc(d.shares || '')}" placeholder="Shares held" title="Ordinary shares held per the register of directors' shareholdings (s.59 CA 2016) — feeds the Directors' Report"
        onchange="S.directors[${i}].shares=this.value; saveState()">
      <button class="btn btn-ghost !px-2" onclick="S.directors.splice(${i},1); renderSetup(); saveState()" aria-label="Remove">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`).join('') || '<div class="text-[13px] text-mut">No directors yet — add at least one.</div>';

  const ex = exemptionAssess();
  $('exemption-box').innerHTML = !ex ? '<div class="text-[13px] text-mut">Set FYE first.</div>' :
    ex.pre2025 ? `<div class="text-[13px]">${ex.summary}</div>` : `
    <div class="space-y-2 text-[13px]">
      ${ex.tests.map(t => `
        <div class="flex items-center justify-between gap-2">
          <span>${t.name} <span class="text-mut">(≤ ${t.fmt(t.lim)})</span></span>
          <span class="pill ${t.ok?'pill-ok':'pill-risk'}">${t.fmt(t.val)}</span>
        </div>`).join('')}
      <div class="pt-2 border-t border-line flex items-center gap-2">
        <span class="pill ${ex.qualifies?'pill-ok':'pill-mut'} !text-[12px]">${ex.qualifies?'May qualify for exemption':'Audit required'}</span>
      </div>
      <p class="text-[12px] text-mut">${ex.summary} Not available to: exempt private companies filing the s.260 certificate, subsidiaries of public companies, foreign companies. Members holding ≥5% may still demand an audit.</p>
    </div>`;
  $('setup-deadlines').innerHTML = deadlinesHTML();
}
function onSetupChange() {
  if (guardArchived()) { renderSetup(); return; }
  const g = id => $(id).value;
  S.setup = { name:g('f-name'), regno:g('f-regno'), incdate:g('f-incdate'), fye:g('f-fye'),
    activity:g('f-activity'), framework:g('f-framework'), capital:g('f-capital'),
    employees:g('f-employees'), firstaudit:g('f-firstaudit'), foreign:g('f-foreign'), address:g('f-address'),
    secretary:g('f-secretary'), secno:g('f-secno') };
  updateTop();
  const ex = exemptionAssess();
  const box = $('exemption-box'); if (box) renderSetup();
  saveState();
}
function addDirector(){ S.directors.push({name:'', ic:''}); renderSetup(); }

/* ---------- trial balance ---------- */
function renderTB() {
  const t = tbTotals();
  $('tb-balance-banner').innerHTML = !S.tb.length ? '' : Math.abs(t.diff) <= 0.5
    ? `<div class="p-2.5 rounded-lg bg-okbg text-ok text-[13px] font-medium flex items-center gap-2">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        Balanced — debits ${fmtRM(t.dr)} = credits ${fmtRM(t.cr)}</div>`
    : `<div class="p-2.5 rounded-lg bg-riskbg text-risk text-[13px] font-medium">Out of balance by ${fmtRM(t.diff)} — debits ${fmtRM(t.dr)} vs credits ${fmtRM(t.cr)}. The audit cannot conclude on unbalanced books.</div>`;

  $('tb-body').innerHTML = S.tb.map((r,i) => `
    <tr>
      <td><input class="field !py-1.5 !text-[13px] ${r.autoWeak?'!border-warn':''}" value="${esc(r.name)}"
        onchange="tbEdit(${i},'name',this.value)" title="${r.autoWeak?'Auto-classification was a fallback — verify':''}"></td>
      <td><select class="field !py-1.5 !text-[12px]" onchange="tbEdit(${i},'cat',this.value)">${catOptions(r.cat)}</select></td>
      <td class="num"><input class="field mono !py-1.5 !text-[13px] !text-right !w-28" value="${r.dr?fmt(num(r.dr)):''}" onchange="tbEdit(${i},'dr',this.value)"></td>
      <td class="num"><input class="field mono !py-1.5 !text-[13px] !text-right !w-28" value="${r.cr?fmt(num(r.cr)):''}" onchange="tbEdit(${i},'cr',this.value)"></td>
      <td class="num"><input class="field mono !py-1.5 !text-[13px] !text-right !w-28" value="${r.py?fmt(num(r.py)):''}" onchange="tbEdit(${i},'py',this.value)" placeholder="–"></td>
      <td class="!whitespace-nowrap"><button class="btn btn-ghost !px-1.5 !py-1" onclick="askAccount('${r.id}')" aria-label="Mr Auditor analysis" title="Mr Auditor analysis">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#3B49C9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      </button><button class="btn btn-ghost !px-1.5 !py-1" onclick="S.tb.splice(${i},1); renderTB(); saveState()" aria-label="Delete row">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
      </button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-mut py-8">No accounts yet — paste a TB on the right, or load the demo from the top bar.</td></tr>';

  $('tb-totals').innerHTML = S.tb.length ? `
    <td class="!py-2">Totals — ${S.tb.length} accounts</td><td></td>
    <td class="num mono">${fmt(t.dr)}</td><td class="num mono">${fmt(t.cr)}</td><td></td><td></td>` : '';

  const weak = S.tb.filter(r => r.autoWeak).length;
  const byKind = { pl:0, bs:0 };
  S.tb.forEach(r => byKind[CAT[r.cat].kind]++);
  $('tb-class-health').innerHTML = !S.tb.length ? '<div class="text-mut">Nothing imported yet.</div>' : `
    <div class="flex justify-between"><span>Profit &amp; loss accounts</span><span class="mono font-semibold">${byKind.pl}</span></div>
    <div class="flex justify-between"><span>Balance sheet accounts</span><span class="mono font-semibold">${byKind.bs}</span></div>
    <div class="flex justify-between"><span>Fallback classifications to review</span>
      <span class="pill ${weak?'pill-warn':'pill-ok'}">${weak}</span></div>
    <div class="flex justify-between"><span>Adjustments posted</span><span class="mono font-semibold">${S.adjustments.length}</span></div>
    <p class="text-[12px] text-mut pt-1">Rows with an amber border were classified by fallback — set them manually so the FS and every ratio stay honest.</p>`;
}
function tbEdit(i, k, v) {
  if (k === 'dr' || k === 'cr' || k === 'py') S.tb[i][k] = num(v) || '';
  else S.tb[i][k] = v;
  if (k === 'name') { const r = S.tb[i]; r.cat = classify(r.name, num(r.dr), num(r.cr));
    r.autoWeak = !RULES.some(([re]) => re.test(r.name)); }
  if (k === 'cat') S.tb[i].autoWeak = false;
  renderTB(); saveState();
}
function addTbRow(){ if (guardArchived()) return; S.tb.push({id:nid(), name:'', cat:'ADMIN', dr:'', cr:'', py:'', autoWeak:false}); renderTB(); }
function clearTb(){ if (guardArchived()) return;
  if (!S.tb.length || confirm('Remove all trial balance rows and posted adjustments?'))
  { S.tb = []; S.adjustments = []; S.findingStatus = {}; renderTB(); saveState(); } }

/* Shared TB import core: takes an array of cell-arrays [name, n1, n2, n3] */
function importRows(rowArrays) {
  if (guardArchived()) return 0;
  let added = 0, skipped = 0;
  for (const parts of rowArrays) {
    if (!parts || parts.length < 2) { skipped++; continue; }
    const name = String(parts[0] ?? '').trim();
    if (!name || /^(account|description|particulars|debit|dr\b)/i.test(name) && parts.length <= 2) { skipped++; continue; }
    const nums = parts.slice(1).map(num);
    let dr = 0, cr = 0, py = '';
    if (parts.length === 2 || (nums[1] === 0 && nums[2] === 0 && parts.length === 2)) {
      const v = nums[0]; if (v >= 0) dr = v; else cr = -v;
    } else { dr = nums[0] || 0; cr = nums[1] || 0; py = nums[2] || ''; }
    if (!dr && !cr && !py) { skipped++; continue; }
    if (/total/i.test(name)) { skipped++; continue; }
    const cat = classify(name, dr, cr);
    const weak = !RULES.some(([re]) => re.test(name));
    S.tb.push({ id:nid(), name, cat, dr: dr||'', cr: cr||'', py, autoWeak: weak });
    added++;
  }
  $('paste-result').innerHTML = `<span class="pill pill-ok">${added} imported</span> ${skipped?`<span class="pill pill-mut ml-1">${skipped} skipped</span>`:''}`;
  renderTB(); saveState();
  toast(`${added} accounts imported and classified`);
  if (added) logActivity('Imported trial balance', `${added} account(s) imported, ${skipped} row(s) skipped`);
  return added;
}
function importPaste() {
  const raw = $('tb-paste').value.trim();
  if (!raw) { toast('Nothing to import'); return; }
  const rowArrays = raw.split(/\r?\n/).filter(l => l.trim()).map(line =>
    line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(p => p.replace(/^"|"$/g,'').trim()));
  importRows(rowArrays);
}
function importXlsx(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  if (typeof XLSX === 'undefined') { toast('Spreadsheet reader failed to load — paste instead'); return; }
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const wb = XLSX.read(rd.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rowArrays = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
        .filter(r => r.some(c => String(c).trim() !== ''));
      if (!rowArrays.length) { toast('No rows found in that file'); return; }
      importRows(rowArrays);
    } catch (e) { toast('Could not read that file: ' + e.message); }
  };
  rd.readAsArrayBuffer(f);
}

/* ---------- audit engine ---------- */
function runEngine(announce) {
  S.audit.benchmark = $('mat-benchmark').value;
  S.audit.pm = $('mat-pm').value;
  saveState(); renderAudit();
  if (announce) toast('Audit engine re-run');
}
function renderAudit() {
  $('mat-benchmark').value = S.audit.benchmark; $('mat-pm').value = S.audit.pm;
  if (!S.tb.length) {
    $('audit-mat-cards').innerHTML = '<div class="card card-pad lg:col-span-3 text-mut text-[13px]">Import a trial balance first (step 2) — the engine computes materiality, analytics and findings from it automatically.</div>';
    $('ratio-body').innerHTML = ''; $('misstate-box').innerHTML=''; $('findings-list').innerHTML=''; $('findings-count').textContent='0 findings';
    renderAje();
    return;
  }
  const ev = evaluate();
  const mat = ev.mat;
  $('audit-mat-cards').innerHTML = `
    <div class="card card-pad"><div class="kpi-lbl">Overall materiality</div>
      <div class="kpi-val">${fmtRM(mat.overall)}</div><div class="text-[12px] text-mut mt-0.5">${mat.label}</div></div>
    <div class="card card-pad"><div class="kpi-lbl">Performance materiality</div>
      <div class="kpi-val">${fmtRM(mat.pm)}</div><div class="text-[12px] text-mut mt-0.5">${Math.round(parseFloat(S.audit.pm)*100)}% of overall (ISA 320.11)</div></div>
    <div class="card card-pad"><div class="kpi-lbl">Clearly trivial threshold</div>
      <div class="kpi-val">${fmtRM(mat.trivial)}</div><div class="text-[12px] text-mut mt-0.5">5% — below this, misstatements need not accumulate (ISA 450)</div></div>`;

  // ratios
  const m = ev.mat.m, mp = hasPY() ? model(true) : null;
  const rows = [];
  const ratio = (label, cur, py, read, tone) => rows.push({label, cur, py, read, tone});
  const gp = m.revenue ? m.gp/m.revenue*100 : NaN;
  ratio('Gross margin', pct(gp), mp && mp.revenue ? pct(mp.gp/mp.revenue*100) : '–',
    gp < 0 ? 'Selling below cost — investigate' : gp < 10 ? 'Thin margin' : 'Reasonable', gp < 0 ? 'risk' : gp < 10 ? 'warn':'ok');
  const np = m.revenue ? m.pbt/m.revenue*100 : NaN;
  ratio('PBT margin', pct(np), mp && mp.revenue ? pct(mp.pbt/mp.revenue*100) : '–',
    np < 0 ? 'Loss-making' : 'Profitable', np < 0 ? 'risk':'ok');
  const cr = m.clSimple ? m.ca/m.clSimple : NaN;
  ratio('Current ratio', isFinite(cr)?cr.toFixed(2)+'×':'–', mp && mp.clSimple ? (mp.ca/mp.clSimple).toFixed(2)+'×':'–',
    cr < 1 ? 'Net current liabilities — going concern lens' : cr < 1.2 ? 'Tight liquidity' : 'Comfortable', cr<1?'risk':cr<1.2?'warn':'ok');
  const rd = m.revenue ? m.nat.TR/m.revenue*365 : NaN;
  ratio('Receivable days', isFinite(rd)?Math.round(rd)+'d':'–', mp && mp.revenue ? Math.round(mp.nat.TR/mp.revenue*365)+'d':'–',
    rd > 120 ? 'Collections stretched — impairment work' : 'Within trade norms', rd>120?'warn':'ok');
  const pd = m.cos ? m.nat.TP/m.cos*365 : NaN;
  ratio('Payable days', isFinite(pd)?Math.round(pd)+'d':'–', mp && mp.cos ? Math.round(mp.nat.TP/mp.cos*365)+'d':'–',
    pd > 120 ? 'Suppliers stretched — liquidity signal' : 'Normal', pd>120?'warn':'ok');
  const idays = m.cos ? m.nat.INV/m.cos*365 : NaN;
  if (m.nat.INV) ratio('Inventory days', isFinite(idays)?Math.round(idays)+'d':'–', mp&&mp.cos?Math.round(mp.nat.INV/mp.cos*365)+'d':'–',
    idays > 180 ? 'Slow-moving — NRV testing' : 'Turning over', idays>180?'warn':'ok');
  const debt = m.nat.BORR + m.nat.HP + m.nat.OD;
  const gear = m.equity > 0 ? debt/m.equity : NaN;
  ratio('Gearing (debt ÷ equity)', isFinite(gear)?gear.toFixed(2)+'×': m.equity<=0&&debt>0?'∞':'–',
    mp && mp.equity>0 ? ((mp.nat.BORR+mp.nat.HP+mp.nat.OD)/mp.equity).toFixed(2)+'×':'–',
    !isFinite(gear)&&debt>0 ? 'Negative equity with debt' : gear>2?'Highly geared':'Acceptable', (!isFinite(gear)&&debt>0)||gear>2?'warn':'ok');
  const cover = m.fin ? m.pbt/m.fin + 1 : NaN;
  if (debt>0) ratio('Interest cover', isFinite(cover)?cover.toFixed(1)+'×':'–','–',
    cover < 2 ? 'Weak debt service' : 'Serviceable', cover<2?'warn':'ok');
  $('ratio-body').innerHTML = rows.map(r => `
    <tr><td class="font-medium">${r.label}</td><td class="num">${r.cur}</td><td class="num text-mut">${r.py}</td>
    <td><span class="pill pill-${r.tone==='risk'?'risk':r.tone==='warn'?'warn':'ok'}">${r.read}</span></td></tr>`).join('');

  // misstatement box
  const tone = ev.totalMis > mat.overall ? 'risk' : ev.totalMis > mat.pm ? 'warn' : 'ok';
  $('misstate-box').innerHTML = `
    <div class="flex items-end gap-6 mb-3">
      <div><div class="kpi-lbl">Uncorrected misstatements</div>
        <div class="kpi-val ${tone==='risk'?'text-risk':tone==='warn'?'text-warn':'text-ok'}">${fmtRM(ev.totalMis)}</div></div>
      <div><div class="kpi-lbl">vs materiality</div><div class="kpi-val">${fmtRM(mat.overall)}</div></div>
    </div>
    <div class="h-2.5 rounded-full bg-paper overflow-hidden mb-3">
      <div class="h-full" style="width:${Math.min(ev.totalMis/mat.overall*100,100)}%;background:${tone==='risk'?'#B91C1C':tone==='warn'?'#B45309':'#15803D'}"></div>
    </div>
    ${ev.uncorrected.length ? `<table class="tbl"><thead><tr><th>Item</th><th class="num">Effect (RM)</th></tr></thead><tbody>
      ${ev.uncorrected.map(f=>`<tr><td>${f.title}</td><td class="num">${fmt(f.misstate)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="text-[13px] text-mut">No quantified uncorrected misstatements above the trivial threshold. Post adjustments from the findings below, or mark items as noted, and this ledger updates live.</div>'}
    <div class="mt-4 p-3 rounded-xl bg-indigosoft">
      <div class="text-[12px] font-semibold text-indigo uppercase tracking-wide mb-1">Mr Auditor recommends</div>
      <div class="flex items-center gap-2 flex-wrap">${opinionCard(ev)}</div>
    </div>`;

  // findings
  $('findings-count').textContent = `${ev.open.length} open · ${ev.findings.length - ev.open.length} resolved`;
  $('findings-list').innerHTML = ev.findings.map(f => {
    const st = S.findingStatus[f.id];
    const sevPill = f.sev==='blocker'?'pill-risk':f.sev==='high'?'pill-risk':f.sev==='medium'?'pill-warn':f.sev==='low'?'pill-info':'pill-mut';
    return `
    <div class="sevrow sev-${f.sev} border border-line rounded-xl p-3.5 ${st?'opacity-60':''}">
      <div class="flex items-start gap-2 flex-wrap">
        <span class="pill ${sevPill}">${f.sev}</span>
        <span class="pill pill-mut">${f.area}</span>
        <div class="font-semibold text-[13.5px] w-full sm:w-auto sm:flex-1">${f.title}</div>
        ${st ? `<span class="pill pill-ok">${st==='adjusted'?'Adjustment posted':'Noted / accepted'}</span>` : ''}
      </div>
      <div class="text-[12px] text-indigo font-medium mt-1.5">${f.law}</div>
      <p class="text-[13px] text-mut mt-1 leading-relaxed">${f.detail}</p>
      <p class="text-[13px] mt-1.5"><span class="font-semibold">How to fix:</span> ${f.fix}</p>
      ${!st ? `<div class="flex gap-2 mt-2.5 flex-wrap">
        ${f.adj ? `<button class="btn btn-mint !py-1.5 !text-[12.5px]" onclick="postAdj('${f.id}')">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Post adjustment (${f.adj.entries.map(e=>`${e.amt>0?'Dr':'Cr'} ${CAT[e.cat].label} ${fmt(Math.abs(e.amt))}`).join(' / ')})</button>` : ''}
        <button class="btn btn-ghost !py-1.5 !text-[12.5px]" onclick="noteFinding('${f.id}')">Mark as noted / addressed</button>
      </div>` : `<div class="mt-2"><button class="btn btn-ghost !py-1 !text-[12px]" onclick="reopenFinding('${f.id}')">Reopen</button></div>`}
    </div>`;
  }).join('') || emptyState(ICON_CHECK, 'No findings', 'Either the books are immaculate, or the trial balance is still empty — import one on step 2.');
  staggerChildren('findings-list', 35);
  renderAje();
}
function postAdj(fid) {
  if (guardArchived()) return;
  const f = buildFindings().find(x => x.id === fid);
  if (!f || !f.adj) return;
  S.adjustments.push({ id:nid(), findingId:fid, desc:f.adj.desc, entries:f.adj.entries });
  S.findingStatus[fid] = 'adjusted';
  saveState(); renderAudit(); updateTop();
  toast('Adjustment posted — FS updated');
  logActivity('Posted adjustment', `${f.title}: ${f.adj.desc}`);
}
function noteFinding(fid){ if (guardArchived()) return;
  const f = buildFindings().find(x=>x.id===fid); S.findingStatus[fid]='noted'; saveState(); renderAudit(); updateTop();
  logActivity('Marked finding as noted', f ? f.title : fid); }
function reopenFinding(fid){ if (guardArchived()) return;
  const f = buildFindings().find(x=>x.id===fid); delete S.findingStatus[fid];
  S.adjustments = S.adjustments.filter(a => a.findingId !== fid);
  saveState(); renderAudit(); updateTop();
  logActivity('Reopened finding', f ? f.title : fid); }

/* ---------- financial statements ---------- */
function fsLine(label, val, opts={}) {
  return `<tr class="${opts.total?'fs-total':opts.line?'fs-line':''}">
    <td class="${opts.indent?'pl-5':''}">${label}</td>
    <td class="num" style="width:120px">${fmt(val, true)}</td>
    ${hasPY() ? `<td class="num text-mut" style="width:120px">${opts.py!==undefined?fmt(opts.py,true):'–'}</td>` : ''}</tr>`;
}
function renderFS() {
  if (!S.tb.length) { $('fs-render').innerHTML = '<div class="text-mut text-[13px]">Import a trial balance first.</div>'; return; }
  const m = model(), p = hasPY() ? model(true) : null;
  const cy = S.setup.fye ? new Date(S.setup.fye).getFullYear() : '';
  const head3 = hasPY() ? `<tr><th></th><th class="num text-[11px] text-mut">${cy}<br>RM</th><th class="num text-[11px] text-mut">${cy-1}<br>RM</th></tr>` :
    `<tr><th></th><th class="num text-[11px] text-mut">${cy}<br>RM</th></tr>`;
  const g = (k) => m.nat[k], gp2 = k => p ? p.nat[k] : undefined;

  let html = `
    <div class="text-center mb-2">
      <div class="font-bold text-[16px]">${esc(S.setup.name) || 'Company name'}</div>
      <div class="text-[12px] text-mut">(Registration No. ${esc(S.setup.regno)||'—'}) · Incorporated in Malaysia</div>
    </div>
    ${S.adjustments.length ? `<div class="no-print p-2.5 rounded-lg bg-indigosoft text-[12.5px] mb-3">Includes ${S.adjustments.length} audit adjustment(s): ${S.adjustments.map(a=>esc(a.desc)).join('; ')}.</div>`:''}
    ${Math.abs(m.balGap) > 1 ? `<div class="p-2.5 rounded-lg bg-riskbg text-risk text-[12.5px] mb-3 no-print">Statement of financial position is out by ${fmtRM(m.balGap)} — fix TB classification/balancing first.</div>`:''}

    <h3>Statement of profit or loss and other comprehensive income for the financial year ended ${dMY(S.setup.fye)}</h3>
    <table>${head3}
      ${fsLine('Revenue', m.revenue, {py: p?.revenue})}
      ${fsLine('Cost of sales', -m.cos, {py: p? -p.cos : undefined})}
      ${fsLine('Gross profit', m.gp, {line:1, py: p?.gp})}
      ${fsLine('Other income', m.othinc, {py: p?.othinc})}
      ${fsLine('Administrative and other operating expenses', -(m.nat.ADMIN + m.nat.SELL), {py: p? -(p.nat.ADMIN+p.nat.SELL):undefined})}
      ${fsLine('Depreciation and amortisation', -g('DEPR'), {py: p? -gp2('DEPR'):undefined})}
      ${fsLine('Finance costs', -m.fin, {py: p? -p.fin:undefined})}
      ${fsLine('Profit / (loss) before taxation', m.pbt, {line:1, py: p?.pbt})}
      ${fsLine('Taxation', -m.taxexp, {py: p? -p.taxexp:undefined})}
      ${fsLine('Profit / (loss) for the financial year', m.pat, {total:1, py: p?.pat})}
    </table>

    <h3>Statement of financial position as at ${dMY(S.setup.fye)}</h3>
    <table>${head3}
      <tr><td class="font-semibold pt-2">Non-current assets</td><td></td>${p?'<td></td>':''}</tr>
      ${fsLine('Property, plant and equipment', m.ppeNet, {indent:1, py: p? p.ppeNet:undefined})}
      ${g('INTANG') ? fsLine('Intangible assets', g('INTANG'), {indent:1, py: gp2('INTANG')}) : ''}
      ${g('INVEST') ? fsLine('Investments', g('INVEST'), {indent:1, py: gp2('INVEST')}) : ''}
      ${fsLine('', m.nca, {line:1, py: p? p.nca:undefined})}
      <tr><td class="font-semibold pt-2">Current assets</td><td></td>${p?'<td></td>':''}</tr>
      ${g('INV') ? fsLine('Inventories', g('INV'), {indent:1, py: gp2('INV')}) : ''}
      ${fsLine('Trade receivables', g('TR'), {indent:1, py: gp2('TR')})}
      ${fsLine('Other receivables, deposits and prepayments', g('OR'), {indent:1, py: gp2('OR')})}
      ${g('DIRADV') ? fsLine('Amount owing by directors', g('DIRADV'), {indent:1, py: gp2('DIRADV')}) : ''}
      ${g('RPTREC') ? fsLine('Amount owing by related parties', g('RPTREC'), {indent:1, py: gp2('RPTREC')}) : ''}
      ${g('FD') ? fsLine('Fixed deposits with licensed banks', g('FD'), {indent:1, py: gp2('FD')}) : ''}
      ${fsLine('Cash and bank balances', g('CASH'), {indent:1, py: gp2('CASH')})}
      ${g('SUSP') > 0 ? fsLine('Suspense (unresolved)', g('SUSP'), {indent:1}) : ''}
      ${fsLine('', m.ca + Math.max(g('SUSP'),0), {line:1, py: p? p.ca:undefined})}
      ${fsLine('Total assets', m.totalAssets, {total:1, py: p? p.totalAssets:undefined})}

      <tr><td class="font-semibold pt-3">Equity</td><td></td>${p?'<td></td>':''}</tr>
      ${fsLine('Share capital', g('SC'), {indent:1, py: gp2('SC')})}
      ${fsLine('Retained earnings / (accumulated losses)', m.reClose, {indent:1, py: p? p.reClose:undefined})}
      ${fsLine('Total equity', m.equity, {line:1, py: p? p.equity:undefined})}
      <tr><td class="font-semibold pt-2">Non-current liabilities</td><td></td>${p?'<td></td>':''}</tr>
      ${g('BORR') ? fsLine('Bank borrowings', g('BORR'), {indent:1, py: gp2('BORR')}) : ''}
      ${g('HP') ? fsLine('Hire purchase payables', g('HP'), {indent:1, py: gp2('HP')}) : ''}
      ${g('DEFTAX') ? fsLine('Deferred tax liability', g('DEFTAX'), {indent:1, py: gp2('DEFTAX')}) : ''}
      <tr><td class="font-semibold pt-2">Current liabilities</td><td></td>${p?'<td></td>':''}</tr>
      ${fsLine('Trade payables', g('TP'), {indent:1, py: gp2('TP')})}
      ${fsLine('Other payables and accruals', g('OP'), {indent:1, py: gp2('OP')})}
      ${g('DIROWE') ? fsLine('Amount owing to directors', g('DIROWE'), {indent:1, py: gp2('DIROWE')}) : ''}
      ${g('RPTPAY') ? fsLine('Amount owing to related parties', g('RPTPAY'), {indent:1, py: gp2('RPTPAY')}) : ''}
      ${g('OD') ? fsLine('Bank overdraft', g('OD'), {indent:1, py: gp2('OD')}) : ''}
      ${g('TAXPAY') ? fsLine('Current tax payable', g('TAXPAY'), {indent:1, py: gp2('TAXPAY')}) : ''}
      ${g('SUSP') < 0 ? fsLine('Suspense (unresolved)', -g('SUSP'), {indent:1}) : ''}
      ${fsLine('Total equity and liabilities', m.equity + m.totalLiab, {total:1, py: p? p.equity + p.totalLiab:undefined})}
    </table>

    <h3>Statement of changes in equity</h3>
    <table>
      <tr><th></th><th class="num text-[11px] text-mut">Share capital<br>RM</th><th class="num text-[11px] text-mut">Retained earnings<br>RM</th><th class="num text-[11px] text-mut">Total<br>RM</th></tr>
      <tr class="fs-line"><td>At beginning of year</td><td class="num">${fmt(g('SC'))}</td><td class="num">${fmt(g('RE'))}</td><td class="num">${fmt(g('SC')+g('RE'))}</td></tr>
      <tr><td>Profit / (loss) for the year</td><td class="num">–</td><td class="num">${fmt(m.pat)}</td><td class="num">${fmt(m.pat)}</td></tr>
      ${g('DIV') ? `<tr><td>Dividends declared</td><td class="num">–</td><td class="num">${fmt(-g('DIV'))}</td><td class="num">${fmt(-g('DIV'))}</td></tr>` : ''}
      <tr class="fs-total"><td>At end of year</td><td class="num">${fmt(g('SC'))}</td><td class="num">${fmt(m.reClose)}</td><td class="num">${fmt(m.equity)}</td></tr>
    </table>

    <h3>Statement of cash flows (indirect method${p ? '' : ' — requires prior-year balances for movements; shown as current-position summary'})</h3>
    ${p ? cashflowHTML(m, p) : `<p class="text-[12.5px] text-mut">Add prior-year figures on the Trial Balance screen to generate the full statement of cash flows.</p>`}

    <h3>Selected notes (auto-drafted)</h3>
    <p class="text-[12.5px]"><strong>Basis of preparation.</strong> The financial statements have been prepared in accordance with the ${S.setup.framework === 'MPERS' ? 'Malaysian Private Entities Reporting Standard (MPERS)' : 'Malaysian Financial Reporting Standards (MFRS)'} and the requirements of the Companies Act 2016 in Malaysia.</p>
    ${(g('DIRADV')||g('DIROWE')||g('RPTREC')||g('RPTPAY')) ? `<p class="text-[12.5px]"><strong>Related party balances.</strong> Amounts owing by/(to) directors and related parties are non-trade in nature, unsecured, interest-free and repayable on demand <em>(confirm — see audit finding)</em>.</p>` : ''}
    <p class="text-[12.5px]"><strong>Employee information.</strong> ${esc(S.setup.employees)||'—'} employees as at year end.</p>`;
  $('fs-render').innerHTML = html;
}
function cashflowHTML(m, p) {
  const dep = m.nat.DEPR;
  const dWC = k => -( (m.nat[k]||0) - (p.nat[k]||0) );  // asset increase = outflow
  const dWCl = k => ( (m.nat[k]||0) - (p.nat[k]||0) );  // liability increase = inflow
  const ops = m.pbt + dep + m.fin
    + dWC('INV') + dWC('TR') + dWC('OR') + dWC('DIRADV') + dWC('RPTREC') + dWC('SUSP')
    + dWCl('TP') + dWCl('OP') + dWCl('DIROWE') + dWCl('RPTPAY');
  const taxPaid = -(p.nat.TAXPAY + m.taxexp - m.nat.TAXPAY);
  const capex = -((m.nat.PPE - p.nat.PPE));
  const invFlow = capex - (m.nat.INTANG - p.nat.INTANG) - (m.nat.INVEST - p.nat.INVEST) - (m.nat.FD - p.nat.FD);
  const finFlow = (m.nat.BORR - p.nat.BORR) + (m.nat.HP - p.nat.HP) - m.fin - m.nat.DIV + (m.nat.SC - p.nat.SC);
  const net = ops + taxPaid + invFlow + finFlow;
  const openCash = p.nat.CASH - p.nat.OD, closeCash = m.nat.CASH - m.nat.OD;
  const gap = closeCash - openCash - net;
  // single-column line helper: the cash flow reports CY movements only
  const cl = (label, val, opts={}) => `<tr class="${opts.total?'fs-total':opts.line?'fs-line':''}">
    <td class="${opts.indent?'pl-5':''}">${label}</td><td class="num" style="width:120px">${fmt(val, true)}</td></tr>`;
  return `<table>
    ${cl('Profit / (loss) before taxation', m.pbt)}
    ${cl('Depreciation and amortisation', dep, {indent:1})}
    ${cl('Finance costs', m.fin, {indent:1})}
    ${cl('Changes in working capital', ops - m.pbt - dep - m.fin, {indent:1})}
    ${cl('Cash from / (used in) operations', ops, {line:1})}
    ${cl('Tax paid', taxPaid, {indent:1})}
    ${cl('Net cash — investing activities', invFlow)}
    ${cl('Net cash — financing activities (incl. interest paid)', finFlow)}
    ${cl('Net movement in cash and cash equivalents', net, {line:1})}
    ${cl('Cash and cash equivalents at beginning (net of overdrafts)', openCash)}
    ${cl('Cash and cash equivalents at end (net of overdrafts)', closeCash, {total:1})}
    ${Math.abs(gap) > 1 ? cl('Unreconciled movement (check share issues / disposals / opening balances)', gap) : ''}
  </table>`;
}

/* ---------- tax ---------- */
function smeEligible() {
  const cap = num(S.setup.capital);
  const m = model();
  const gross = m.revenue + m.othinc;
  return { cap, gross, ok: cap > 0 && cap <= 2500000 && gross <= 50000000 && S.setup.foreign !== 'yes',
    reasons: [
      { t:`Paid-up capital ≤ RM2.5m`, ok: cap>0 && cap <= 2500000, v: fmtRM(cap) },
      { t:`Gross business income ≤ RM50m`, ok: gross <= 50000000, v: fmtRM(gross) },
      { t:`≤ 20% foreign/corporate shareholding`, ok: S.setup.foreign !== 'yes', v: S.setup.foreign==='yes'?'Exceeded':'OK' }
    ]};
}
/* Shared tax-charge computation — used by the Tax screen AND the findings
   engine (the "profitable year but no tax charge" finding books its
   provision from this same math, so the two can never disagree). */
function taxComputeCore() {
  const m = model();
  const sme = smeEligible();
  const T = k => num(S.tax[k]);
  const dep = m.nat.DEPR;
  const dirAdvDeemed = m.nat.DIRADV > 0 ? Math.round(m.nat.DIRADV * 0.0295) : 0;
  const addbacks = dep + T('entertain') + T('fines') + T('donations') + T('otherAdd') + T('bc') + dirAdvDeemed;
  const adjusted = m.pbt + addbacks - T('exemptInc');
  const afterCA = Math.max(adjusted - T('ca'), 0);
  const ci = Math.max(afterCA - T('losses'), 0);
  let tax = 0; const bands = [];
  if (sme.ok) {
    const b1 = Math.min(ci, 150000), b2 = Math.min(Math.max(ci-150000,0), 450000), b3 = Math.max(ci-600000, 0);
    if (b1) bands.push(['First RM150,000 @ 15%', b1*.15]);
    if (b2) bands.push(['Next RM450,000 @ 17%', b2*.17]);
    if (b3) bands.push(['Balance @ 24%', b3*.24]);
    tax = b1*.15 + b2*.17 + b3*.24;
  } else { bands.push(['Chargeable income @ 24%', ci*.24]); tax = ci*.24; }
  tax = Math.round(tax);
  return { m, sme, T, dep, dirAdvDeemed, addbacks, adjusted, afterCA, ci, bands, tax };
}
function renderTax() {
  const m = model();
  $('tax-ya').textContent = S.setup.fye ? new Date(S.setup.fye).getFullYear() : '—';
  // bind inputs
  const map = { 'tax-entertain':'entertain','tax-fines':'fines','tax-donations':'donations','tax-other-add':'otherAdd',
    'tax-exempt-inc':'exemptInc','tax-ca':'ca','tax-losses':'losses','tax-cp204':'cp204' };
  for (const [id,k] of Object.entries(map)) { const el = $(id); if (document.activeElement !== el) el.value = S.tax[k]; }

  const sme = smeEligible();
  $('tax-sme-box').innerHTML = `
    <div class="font-semibold text-indigo mb-1.5">SME preferential rate check (para 2A, Sch 1 ITA)</div>
    ${sme.reasons.map(r => `<div class="flex justify-between items-center py-0.5">
      <span>${r.t}</span><span class="pill ${r.ok?'pill-ok':'pill-risk'}">${r.v}</span></div>`).join('')}
    <div class="mt-1.5 font-semibold">${sme.ok
      ? 'Eligible — 15% on first RM150k, 17% on next RM450k, 24% on the balance.'
      : 'Not eligible — flat 24% on all chargeable income.'}</div>`;

  if (!S.tb.length) { $('tax-comp').innerHTML = '<div class="text-mut text-[13px]">Import a trial balance first.</div>'; return; }
  const { T, dep, dirAdvDeemed, adjusted, afterCA, ci, bands, tax } = taxComputeCore();
  const cp204 = T('cp204');
  const bal = tax - cp204;
  const underEst = cp204 > 0 && tax > 0 && (tax - cp204) / tax > 0.30;

  const row = (l, v, opt={}) => `<tr class="${opt.total?'fs-total':opt.line?'fs-line':''}"><td class="${opt.indent?'pl-5':''}">${l}</td><td class="num" style="width:130px">${fmt(v,true)}</td></tr>`;
  $('tax-comp').innerHTML = `
    <table class="fs-doc" style="width:100%">
      ${row('Profit / (loss) before taxation per accounts', m.pbt)}
      <tr><td class="font-semibold pt-2" colspan="2">Add: non-deductible</td></tr>
      ${row('Depreciation (book)', dep, {indent:1})}
      ${T('entertain') ? row('Entertainment — 50% disallowed (s.39(1)(l))', T('entertain'), {indent:1}) : ''}
      ${T('fines') ? row('Fines and penalties', T('fines'), {indent:1}) : ''}
      ${T('donations') ? row('Unapproved donations', T('donations'), {indent:1}) : ''}
      ${T('otherAdd') ? row('Other add-backs', T('otherAdd'), {indent:1}) : ''}
      ${T('bc') ? row('Balancing charge on disposals (per CA statement)', T('bc'), {indent:1}) : ''}
      ${dirAdvDeemed ? row('Deemed interest on loans to directors (s.140B, indicative)', dirAdvDeemed, {indent:1}) : ''}
      <tr><td class="font-semibold pt-2" colspan="2">Less:</td></tr>
      ${T('exemptInc') ? row('Non-taxable / exempt income', -T('exemptInc'), {indent:1}) : ''}
      ${row('Adjusted income', adjusted, {line:1})}
      ${row('Less: capital allowances (Sch 3 — per CA statement)', -T('ca'), {indent:1})}
      ${row('Statutory income', afterCA, {line:1})}
      ${T('losses') ? row('Less: unabsorbed losses b/f (10-YA carry-forward limit)', -T('losses'), {indent:1}) : ''}
      ${row('Chargeable income', ci, {line:1})}
      ${bands.map(b => row(b[0], b[1], {indent:1})).join('')}
      ${row('Tax charge for YA', tax, {total:1})}
      ${cp204 ? row('Less: CP204 instalments paid', -cp204) : ''}
      ${cp204 ? row(bal >= 0 ? 'Balance payable with Form C (CP207)' : 'Tax overpaid — refundable', bal, {line:1}) : ''}
    </table>
    ${underEst ? `<div class="mt-3 p-2.5 rounded-lg bg-warnbg text-warn text-[12.5px] font-medium">CP204 underestimation: actual tax exceeds the estimate by more than 30% — the excess over the 30% buffer attracts a 10% penalty under s.107C(10). Consider CP204 revisions (6th/9th month) next year.</div>` : ''}
    ${S.caAssets.length ? caStatementHTML() : `<div class="mt-3 p-2.5 rounded-lg bg-indigosoft text-[12.5px]">
      <strong>No Capital Allowance Statement yet.</strong> The CA figure above needs its supporting schedule (per-asset TWDV, IA/AA, balancing charges) — build it in
      <button class="text-indigo font-medium hover:underline" onclick="show('toolkit'); tkTab='ca'; renderToolkit()">Toolkit → Capital allowances</button> and apply it here.</div>`}
    <div class="mt-3 text-[12px] text-mut">Capital allowance quick rates (IA/AA): heavy machinery 20/20 · general plant 20/14 · office equipment &amp; furniture 20/10 · computers &amp; ICT 20/20 (accelerated options exist) · motor vehicles 20/20 (non-commercial QE capped at RM50k–RM100k).</div>`;
}
document.addEventListener('input', e => {
  if (e.target.classList && e.target.classList.contains('tax-in')) {
    const map = { 'tax-entertain':'entertain','tax-fines':'fines','tax-donations':'donations','tax-other-add':'otherAdd',
      'tax-exempt-inc':'exemptInc','tax-ca':'ca','tax-losses':'losses','tax-cp204':'cp204' };
    S.tax[map[e.target.id]] = e.target.value; S.tax._touched = true;
    clearTimeout(window._taxT); window._taxT = setTimeout(()=>{ renderTax(); saveState(); }, 500);
  }
});

/* ---------- reports ---------- */
function bindSign() {
  const g = id => $(id);
  S.sign.firm = g('s-firm').value; S.sign.af = g('s-af').value; S.sign.partner = g('s-partner').value;
  S.sign.approval = g('s-approval').value; S.sign.place = g('s-place').value; S.sign.date = g('s-date').value;
  S.sign.opinion = g('s-opinion').value; S.sign.goingconcern = g('s-goingconcern').checked;
  S.sign.otherinfo = g('s-otherinfo').checked;
}
document.addEventListener('change', e => {
  if (e.target.classList && e.target.classList.contains('rep-in')) { bindSign(); saveState(); renderReportDoc(); }
  if (e.target.classList && e.target.classList.contains('note-in')) {
    const NMAP = { 'n-termsGiven':'termsGiven','n-termsRecd':'termsRecd','n-deprRates':'deprRates','n-fdRate':'fdRate',
      'n-borrSec':'borrSec','n-borrRate':'borrRate','n-hpCurrent':'hpCurrent','n-auditFee':'auditFee','n-dirRem':'dirRem' };
    if (!S.notes) S.notes = {};
    S.notes[NMAP[e.target.id]] = e.target.value.trim();
    saveState(); renderPack();
  }
});
document.addEventListener('click', e => {
  const b = e.target.closest('.rep-tab'); if (!b) return;
  S.repTab = b.dataset.rep;
  document.querySelectorAll('.rep-tab').forEach(x => { x.classList.toggle('btn-pri', x===b); x.classList.toggle('btn-ghost', x!==b); });
  renderReportDoc();
});
function renderReports() {
  const s = S.sign;
  const set = (id,v) => { const el=$(id); if (el.type==='checkbox') el.checked = !!v; else if (el.value !== (v??'')) el.value = v ?? ''; };
  set('s-firm',s.firm); set('s-af',s.af); set('s-partner',s.partner); set('s-approval',s.approval);
  set('s-place',s.place); set('s-date',s.date); set('s-opinion',s.opinion);
  set('s-goingconcern',s.goingconcern); set('s-otherinfo',s.otherinfo);
  document.querySelectorAll('.rep-in').forEach(el => el.disabled = isArchived());
  renderArchiveBox();
  const ev = S.tb.length ? evaluate() : null;
  $('opinion-reco').innerHTML = ev ? `
    <div class="text-[12px] text-mut mb-1">Engine recommendation:</div>
    <div class="flex items-center gap-2 flex-wrap mb-1">
      <span class="pill ${ev.opinion==='unmodified'?'pill-ok':ev.opinion.startsWith('qualified')?'pill-warn':'pill-risk'}">${OPINION_LABEL[ev.opinion]}</span>
      ${ev.gc ? '<span class="pill pill-warn">MUGC suggested</span>':''}
      <button class="btn btn-ghost !py-1 !text-[12px]" onclick="applyReco()">Apply</button>
    </div>` : '<div class="text-[12px] text-mut mb-2">Load a TB for a recommendation.</div>';
  document.querySelectorAll('.rep-tab').forEach(x => { x.classList.toggle('btn-pri', x.dataset.rep===S.repTab); x.classList.toggle('btn-ghost', x.dataset.rep!==S.repTab); });
  renderReportDoc();
}
function applyReco() {
  const ev = evaluate(); S.sign.opinion = ev.opinion; S.sign.goingconcern = ev.gc;
  saveState(); renderReports();
}
function sigBlockAuditor() {
  const s = S.sign;
  return `
  <div class="mt-10 grid grid-cols-2 gap-10" style="max-width:36rem">
    <div>
      <div style="border-top:1px solid #0B1437; padding-top:.4rem">
        <strong>${esc(s.firm) || '[Audit firm]'}</strong><br>${esc(s.af) || '[AF number]'}<br>Chartered Accountants
      </div>
    </div>
    <div>
      <div style="border-top:1px solid #0B1437; padding-top:.4rem">
        <strong>${esc(s.partner) || '[Engagement partner]'}</strong><br>${esc(s.approval) || '[Approval no.]'}<br>Chartered Accountant
      </div>
    </div>
  </div>
  <p class="mt-6">${esc(s.place) || '[Place]'}<br>Date: ${s.date ? dMY(s.date) : '[Date]'}</p>`;
}
function repCtx() {
  return {
    name: esc(S.setup.name) || '[Company name]',
    reg: esc(S.setup.regno) || '[Registration no.]',
    fye: dMY(S.setup.fye),
    fw: S.setup.framework === 'MPERS' ? 'Malaysian Private Entities Reporting Standard' : 'Malaysian Financial Reporting Standards',
    ev: S.tb.length ? evaluate() : null,
    op: S.sign.opinion
  };
}
function renderReportDoc() {
  $('rep-render').innerHTML = ({ auditor:repAuditorHTML, directors:repDirectorsHTML,
    statement:repStatementHTML, statdec:repStatDecHTML, checklist:repChecklistHTML }[S.repTab] || repAuditorHTML)();
}
function repAuditorHTML() {
  const { name, reg, fye, fw, ev, op } = repCtx();
    const qualBasis = ev && ev.uncorrected.length
      ? `As described below, ${ev.uncorrected.map(f=>f.title.toLowerCase()).join('; ')} — with an aggregate effect of ${fmtRM(ev.totalMis)} on the financial statements.`
      : '[Describe the matter(s) giving rise to the modification, quantifying the effects where practicable.]';
    const opPara = {
      unmodified: `In our opinion, the accompanying financial statements give a true and fair view of the financial position of the Company as at ${fye}, and of its financial performance and its cash flows for the financial year then ended in accordance with the ${fw} and the requirements of the Companies Act 2016 in Malaysia.`,
      'qualified-mis': `In our opinion, except for the effects of the matter described in the Basis for Qualified Opinion section of our report, the accompanying financial statements give a true and fair view of the financial position of the Company as at ${fye}, and of its financial performance and its cash flows for the financial year then ended in accordance with the ${fw} and the requirements of the Companies Act 2016 in Malaysia.`,
      'qualified-scope': `In our opinion, except for the possible effects of the matter described in the Basis for Qualified Opinion section of our report, the accompanying financial statements give a true and fair view of the financial position of the Company as at ${fye}, and of its financial performance and its cash flows for the financial year then ended in accordance with the ${fw} and the requirements of the Companies Act 2016 in Malaysia.`,
      adverse: `In our opinion, because of the significance of the matter discussed in the Basis for Adverse Opinion section of our report, the accompanying financial statements do not give a true and fair view of the financial position of the Company as at ${fye}, and of its financial performance and its cash flows for the financial year then ended in accordance with the ${fw} and the requirements of the Companies Act 2016 in Malaysia.`,
      disclaimer: `We do not express an opinion on the accompanying financial statements of the Company. Because of the significance of the matter described in the Basis for Disclaimer of Opinion section of our report, we have not been able to obtain sufficient appropriate audit evidence to provide a basis for an audit opinion on these financial statements.`
    }[op];
    const opTitle = { unmodified:'Opinion', 'qualified-mis':'Qualified Opinion', 'qualified-scope':'Qualified Opinion',
      adverse:'Adverse Opinion', disclaimer:'Disclaimer of Opinion' }[op];
    const basisTitle = op==='unmodified' ? 'Basis for Opinion' : `Basis for ${opTitle}`;
    return `
      <h2 class="text-center">INDEPENDENT AUDITORS' REPORT<br>TO THE MEMBERS OF ${name.toUpperCase()}<br><span class="text-[12px] font-normal">(Registration No. ${reg}) (Incorporated in Malaysia)</span></h2>
      <h3>Report on the Audit of the Financial Statements</h3>
      <h3>${opTitle}</h3>
      <p>We have audited the financial statements of ${name}, which comprise the statement of financial position as at ${fye}, and the statement of profit or loss and other comprehensive income, statement of changes in equity and statement of cash flows for the financial year then ended, and notes to the financial statements, including material accounting policy information.</p>
      <p>${opPara}</p>
      <h3>${basisTitle}</h3>
      ${op!=='unmodified' ? `<p>${qualBasis}</p>` : ''}
      ${op!=='disclaimer' ? `<p>We conducted our audit in accordance with approved standards on auditing in Malaysia and International Standards on Auditing. Our responsibilities under those standards are further described in the Auditors' Responsibilities for the Audit of the Financial Statements section of our report. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our ${op==='unmodified'?'':'qualified/adverse '}opinion.</p>` : ''}
      <p>We are independent of the Company in accordance with the By-Laws (on Professional Ethics, Conduct and Practice) of the Malaysian Institute of Accountants ("By-Laws") and the International Ethics Standards Board for Accountants' International Code of Ethics for Professional Accountants (including International Independence Standards) ("IESBA Code"), and we have fulfilled our other ethical responsibilities in accordance with the By-Laws and the IESBA Code.</p>
      ${S.sign.goingconcern ? `
      <h3>Material Uncertainty Related to Going Concern</h3>
      <p>We draw attention to the financial statements, which ${ev && ev.mat.m.equity < 0 ? `indicate that the Company's total liabilities exceeded its total assets by ${fmtRM(-ev.mat.m.equity)} as at ${fye}` : 'describe conditions indicating material uncertainty over going concern'}. These events or conditions indicate that a material uncertainty exists that may cast significant doubt on the Company's ability to continue as a going concern. Our opinion is not modified in respect of this matter.</p>` : ''}
      ${S.sign.otherinfo ? `
      <h3>Information Other than the Financial Statements and Auditors' Report Thereon</h3>
      <p>The directors of the Company are responsible for the other information. The other information comprises the Directors' Report but does not include the financial statements of the Company and our auditors' report thereon. Our opinion on the financial statements does not cover the other information and we do not express any form of assurance conclusion thereon.</p>` : ''}
      <h3>Responsibilities of the Directors for the Financial Statements</h3>
      <p>The directors of the Company are responsible for the preparation of financial statements of the Company that give a true and fair view in accordance with the ${fw} and the requirements of the Companies Act 2016 in Malaysia. The directors are also responsible for such internal control as the directors determine is necessary to enable the preparation of financial statements of the Company that are free from material misstatement, whether due to fraud or error.</p>
      <p>In preparing the financial statements of the Company, the directors are responsible for assessing the Company's ability to continue as a going concern, disclosing, as applicable, matters related to going concern and using the going concern basis of accounting unless the directors either intend to liquidate the Company or to cease operations, or have no realistic alternative but to do so.</p>
      <h3>Auditors' Responsibilities for the Audit of the Financial Statements</h3>
      <p>Our objectives are to obtain reasonable assurance about whether the financial statements of the Company as a whole are free from material misstatement, whether due to fraud or error, and to issue an auditors' report that includes our opinion. Reasonable assurance is a high level of assurance, but is not a guarantee that an audit conducted in accordance with approved standards on auditing in Malaysia and International Standards on Auditing will always detect a material misstatement when it exists.</p>
      <p>As part of an audit, we exercise professional judgement and maintain professional scepticism throughout the audit. We also: identify and assess the risks of material misstatement; obtain an understanding of internal control relevant to the audit; evaluate the appropriateness of accounting policies used; conclude on the appropriateness of the directors' use of the going concern basis of accounting; and evaluate the overall presentation, structure and content of the financial statements.</p>
      <h3>Report on Other Legal and Regulatory Requirements</h3>
      <p>In accordance with the requirements of the Companies Act 2016 in Malaysia, we also report that in our opinion the accounting and other records and the registers required by the Act to be kept by the Company have been properly kept in accordance with the provisions of the Act.</p>
      <h3>Other Matters</h3>
      <p>This report is made solely to the members of the Company, as a body, in accordance with Section 266 of the Companies Act 2016 in Malaysia and for no other purpose. We do not assume responsibility to any other person for the content of this report.</p>
      ${sigBlockAuditor()}`;
}
function repDirectorsHTML() {
  const { name, reg, fye } = repCtx();
    const m = S.tb.length ? model() : null;
    return `
      <h2 class="text-center">${name.toUpperCase()}<br><span class="text-[12px] font-normal">(Registration No. ${reg}) (Incorporated in Malaysia)</span></h2>
      <h3 class="text-center">DIRECTORS' REPORT</h3>
      <p>The directors hereby present their report together with the audited financial statements of the Company for the financial year ended ${fye}.</p>
      <h3>Principal activities</h3>
      <p>The principal activity of the Company is ${esc(S.setup.activity) || '[principal activity]'}. There have been no significant changes in the nature of this activity during the financial year.</p>
      <h3>Financial results</h3>
      <table style="max-width:22rem"><tr><td></td><td class="num text-[11px] text-mut">RM</td></tr>
      <tr class="fs-total"><td>${m && m.pat < 0 ? 'Loss' : 'Profit'} for the financial year</td><td class="num">${m ? fmt(m.pat) : '—'}</td></tr></table>
      <h3>Reserves and provisions</h3>
      <p>There were no material transfers to or from reserves or provisions during the financial year other than as disclosed in the financial statements.</p>
      <h3>Dividends</h3>
      <p>${m && m.nat.DIV > 0 ? `Dividends of ${fmtRM(m.nat.DIV)} were declared and paid during the financial year.` : 'No dividend was paid or declared by the Company since the end of the previous financial year. The directors do not recommend any dividend for the current financial year.'}</p>
      <h3>Directors</h3>
      <p>The directors in office since the beginning of the financial year to the date of this report are:</p>
      ${S.directors.length ? '<p>' + S.directors.map(d => esc(d.name).toUpperCase()).join('<br>') + '</p>' : '<p>[Directors’ names]</p>'}
      <h3>Directors' interests</h3>
      ${S.directors.some(d => num(d.shares) > 0) ? `
      <p>According to the register of directors' shareholdings kept under section 59 of the Companies Act 2016, the interests of directors in office at the end of the financial year in shares of the Company were as follows:</p>
      <table class="fs-doc" style="width:70%">
        <tr><td></td><td class="num font-semibold">Number of ordinary shares</td></tr>
        ${S.directors.filter(d => num(d.shares) > 0).map(d => `<tr><td>${esc(d.name).toUpperCase()}</td><td class="num">${fmt(num(d.shares))}</td></tr>`).join('')}
      </table>
      <p>None of the other directors in office at the end of the financial year had any interest in shares of the Company during the financial year.</p>`
      : `<p>According to the register of directors' shareholdings, the interests of directors in office at the end of the financial year in shares of the Company are as disclosed therein. [Complete from the register — s.59 CA 2016, or enter each director's shareholding on the Engagement Setup screen.]</p>`}
      <h3>Directors' benefits</h3>
      <p>Since the end of the previous financial year, no director has received or become entitled to receive any benefit (other than a benefit included in the aggregate amount of remuneration received or due and receivable by directors as disclosed in the financial statements) by reason of a contract made by the Company with the director or with a firm of which the director is a member, or with a company in which the director has a substantial financial interest.</p>
      <h3>Other statutory information</h3>
      <p>Before the financial statements were made out, the directors took reasonable steps to ascertain that proper action had been taken in relation to the writing off of bad debts and the making of allowance for doubtful debts, and to ensure that current assets are shown in the accounting records at values expected to be realised in the ordinary course of business.</p>
      <p>At the date of this report, the directors are not aware of any circumstances which would render the amounts written off or allowed inadequate to any substantial extent, or the values of current assets misleading, or which have arisen which render adherence to the existing method of valuation of assets or liabilities misleading or inappropriate.</p>
      <h3>Auditors</h3>
      <p>The auditors, ${esc(S.sign.firm) || '[audit firm]'}, have expressed their willingness to continue in office.</p>
      <p>Signed on behalf of the Board in accordance with a resolution of the directors:</p>
      <div class="mt-10 grid grid-cols-2 gap-10" style="max-width:36rem">
        <div style="border-top:1px solid #0B1437; padding-top:.4rem"><strong>${esc(S.directors[0]?.name) || '[Director 1]'}</strong><br>Director</div>
        <div style="border-top:1px solid #0B1437; padding-top:.4rem"><strong>${esc(S.directors[1]?.name) || (S.directors.length===1 ? '' : '[Director 2]')}</strong><br>${S.directors.length===1?'':'Director'}</div>
      </div>
      <p class="mt-6">${esc(S.sign.place) || '[Place]'}<br>Date: ${S.sign.date ? dMY(S.sign.date) : '[Date]'}</p>`;
}
function repStatementHTML() {
  const { name, reg, fye, fw } = repCtx();
    const sole = S.directors.length === 1;
    const who = sole ? `I, ${esc(S.directors[0].name)}, being the sole director`
      : `We, ${esc(S.directors[0]?.name) || '[Director 1]'} and ${esc(S.directors[1]?.name) || '[Director 2]'}, being two of the directors`;
    return `
      <h2 class="text-center">${name.toUpperCase()}<br><span class="text-[12px] font-normal">(Registration No. ${reg}) (Incorporated in Malaysia)</span></h2>
      <h3 class="text-center">STATEMENT BY DIRECTORS<br><span class="font-normal text-[12px]">Pursuant to Section 251(2) of the Companies Act 2016</span></h3>
      <p>${who} of ${name}, do hereby state that, in the opinion of the director${sole?'':'s'}, the accompanying financial statements are drawn up in accordance with the ${fw} and the requirements of the Companies Act 2016 in Malaysia so as to give a true and fair view of the financial position of the Company as at ${fye} and of its financial performance and cash flows for the financial year then ended.</p>
      <p>Signed on behalf of the Board in accordance with a resolution of the directors:</p>
      <div class="mt-10 grid grid-cols-2 gap-10" style="max-width:36rem">
        <div style="border-top:1px solid #0B1437; padding-top:.4rem"><strong>${esc(S.directors[0]?.name) || '[Director 1]'}</strong><br>Director</div>
        ${sole ? '<div></div>' : `<div style="border-top:1px solid #0B1437; padding-top:.4rem"><strong>${esc(S.directors[1]?.name) || '[Director 2]'}</strong><br>Director</div>`}
      </div>
      <p class="mt-6">${esc(S.sign.place) || '[Place]'}<br>Date: ${S.sign.date ? dMY(S.sign.date) : '[Date]'}</p>`;
}
function repStatDecHTML() {
  const { name, reg } = repCtx();
    return `
      <h2 class="text-center">${name.toUpperCase()}<br><span class="text-[12px] font-normal">(Registration No. ${reg}) (Incorporated in Malaysia)</span></h2>
      <h3 class="text-center">STATUTORY DECLARATION<br><span class="font-normal text-[12px]">Pursuant to Section 251(1)(b) of the Companies Act 2016</span></h3>
      <p>I, ${esc(S.directors[0]?.name) || '[Name]'}${S.directors[0]?.ic ? ' (NRIC No. ' + esc(S.directors[0].ic) + ')' : ''}, being the ${S.directors.length ? 'director' : 'officer'} primarily responsible for the financial management of ${name}, do solemnly and sincerely declare that the accompanying financial statements are, to the best of my knowledge and belief, correct, and I make this solemn declaration conscientiously believing the declaration to be true, and by virtue of the provisions of the Statutory Declarations Act 1960.</p>
      <p>Subscribed and solemnly declared by the abovenamed at ${esc(S.sign.place) || '[Place]'} on ${S.sign.date ? dMY(S.sign.date) : '[Date]'}.</p>
      <div class="mt-10 grid grid-cols-2 gap-10" style="max-width:36rem">
        <div style="border-top:1px solid #0B1437; padding-top:.4rem">Before me,<br><br><strong>Commissioner for Oaths</strong></div>
        <div style="border-top:1px solid #0B1437; padding-top:.4rem"><strong>${esc(S.directors[0]?.name) || '[Name]'}</strong></div>
      </div>`;
}
function repChecklistHTML() {
  const { name } = repCtx();
    const ev2 = S.tb.length ? evaluate() : null;
    const items = [
      ['Engagement letter signed (ISA 210) and independence confirmed (MIA By-Laws)', 'Before fieldwork'],
      ['ISQM 1 engagement acceptance/continuance documented', 'Firm-level — reviewers’ top finding'],
      ['Understanding of entity & risk assessment documented (ISA 315 R2019)', 'Tailored, not a generic checklist'],
      ['Materiality memo — benchmark rationale documented (ISA 320)', ev2 ? `Set: ${fmtRM(ev2.mat.overall)} (${ev2.mat.label})` : 'Pending'],
      ['Bank confirmations sent and received (ISA 505)', 'All banks incl. facilities & liens'],
      ['Receivables circularisation / alternative procedures', 'Post-year-end receipts testing'],
      ['Inventory count attendance or roll-back procedures (ISA 501)', 'If inventories material'],
      ['Related party & director balances confirmed and disclosed (MPERS s.33)', ev2 && (ev2.mat.m.nat.DIRADV>0||ev2.mat.m.nat.DIROWE>0) ? 'Balances exist — confirm terms' : 'Check'],
      ['Going concern assessment ≥12 months documented (ISA 570)', ev2 && ev2.gc ? 'INDICATORS PRESENT — obtain support letters' : 'Standard'],
      ['Subsequent events review to report date (ISA 560)', 'Minutes, post-YE bank, new litigation'],
      ['Management representation letter dated same day as report (ISA 580)', 'Signed by directors'],
      ['Journal entry testing for management override (ISA 240)', 'Mandatory — no exceptions'],
      ['Uncorrected misstatements evaluated & communicated (ISA 450)', ev2 ? `${fmtRM(ev2.totalMis)} vs ${fmtRM(ev2.mat.overall)}` : 'Pending'],
      ['Partner review evidenced BEFORE report signing', 'MIA practice review: must be timely & documented'],
      ['Financial statements agree to final TB; casting & cross-referencing checked', ''],
      ['Audit file assembled and archived within 60 days (ISQM 1 / ISA 230)', 'Statutory archive discipline'],
    ];
    return `
      <h2>Audit completion checklist — ${name}</h2>
      <p class="text-mut text-[12.5px]">The working-paper trail practice reviewers expect. Mr Auditor drafts the numbers; this list is the evidence the signing auditor must have on file.</p>
      <table class="tbl mt-3">
        <thead><tr><th style="width:55%">Procedure</th><th>Note</th><th style="width:70px">Done</th></tr></thead>
        <tbody>${items.map((it,i) => `
          <tr><td>${it[0]}</td><td class="text-mut text-[12px]">${it[1]}</td>
          <td><input type="checkbox" ${S['chk'+i]?'checked':''} onchange="S['chk${i}']=this.checked; saveState()"></td></tr>`).join('')}
        </tbody></table>`;
}

/* ---------- full audit pack ---------- */
/* Sum TB rows matching a regex (CY natural-sign for the rows' own dr-cr, PY magnitude). */
function sumRows(re) {
  let cy = 0, py = 0;
  for (const r of S.tb) if (re.test(r.name)) { cy += num(r.dr) - num(r.cr); py += num(r.py); }
  return { cy, py };
}
function packHeader(name, reg) {
  return `<div class="text-center mb-4"><div class="font-bold">${name.toUpperCase()}</div>
    <div class="text-[11px] text-mut">(Registration No. ${reg}) (Incorporated in Malaysia)</div></div>`;
}
/* Build the notes pack: returns { map: cat→note number, html } */
function buildNotes() {
  const { name, reg, fye, fw } = repCtx();
  const m = model(), p = hasPY() ? model(true) : null;
  const g = k => m.nat[k], gp = k => p ? p.nat[k] : 0;
  let n = 3; // 1 general, 2 basis, 3 policies
  let ph = 0; // unresolved placeholders
  const N = S.notes || {};
  const nv = (val, fallback) => val ? esc(val) : (ph++, fallback);
  const map = {}; const blocks = [];
  const two = (cy, py) => `<td class="num" style="width:110px">${fmt(cy,true)}</td>${p?`<td class="num text-mut" style="width:110px">${fmt(py,true)}</td>`:''}`;
  const noteHead = p ? `<tr><th></th><th class="num text-[10px] text-mut">${new Date(S.setup.fye).getFullYear()}<br>RM</th><th class="num text-[10px] text-mut">${new Date(S.setup.fye).getFullYear()-1}<br>RM</th></tr>` : '';
  const add = (cats, title, body) => { n++; (Array.isArray(cats)?cats:[cats]).forEach(c => map[c]=n);
    blocks.push(`<h3>${n}. ${title}</h3>${body}`); };

  // PPE movement
  if (g('PPE')) {
    const costBf = p ? gp('PPE') : g('PPE'); const addns = Math.max(g('PPE') - costBf, 0);
    const disp = Math.min(g('PPE') - costBf, 0);
    const depBf = p ? gp('ACCDEP') : Math.max(g('ACCDEP') - m.nat.DEPR, 0);
    const charge = m.nat.DEPR || (g('ACCDEP') - depBf);
    add('PPE','Property, plant and equipment', `
      <table class="fs-doc">
        <tr><td class="font-semibold">Cost</td><td class="num" style="width:110px"></td></tr>
        <tr><td class="pl-4">At beginning of year</td><td class="num">${fmt(costBf)}</td></tr>
        ${addns ? `<tr><td class="pl-4">Additions</td><td class="num">${fmt(addns)}</td></tr>`:''}
        ${disp ? `<tr><td class="pl-4">Disposals</td><td class="num">${fmt(disp)}</td></tr>`:''}
        <tr class="fs-line"><td class="pl-4">At end of year</td><td class="num">${fmt(g('PPE'))}</td></tr>
        <tr><td class="font-semibold pt-2">Accumulated depreciation</td><td></td></tr>
        <tr><td class="pl-4">At beginning of year</td><td class="num">${fmt(depBf)}</td></tr>
        <tr><td class="pl-4">Charge for the year</td><td class="num">${fmt(charge)}</td></tr>
        <tr class="fs-line"><td class="pl-4">At end of year</td><td class="num">${fmt(g('ACCDEP'))}</td></tr>
        <tr class="fs-total"><td>Net book value</td><td class="num">${fmt(m.ppeNet)}</td></tr>
      </table>
      <p class="text-[12px] text-mut">Depreciation is provided on a straight-line basis over the estimated useful lives of the assets at the following principal annual rates: ${nv(N.deprRates,'[insert rates per class from the fixed asset register]')}.</p>`);
  }
  if (g('INTANG')) add('INTANG','Intangible assets', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Carrying amount</td>${two(g('INTANG'), gp('INTANG'))}</tr></table>`);
  if (g('INVEST')) add('INVEST','Investments', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>At cost</td>${two(g('INVEST'), gp('INVEST'))}</tr></table>`);
  if (g('INV')) add('INV','Inventories', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>At cost / net realisable value</td>${two(g('INV'), gp('INV'))}</tr></table>
    <p class="text-[12px] text-mut">Inventories are stated at the lower of cost (first-in, first-out) and net realisable value.</p>`);
  if (g('TR')) add('TR','Trade receivables', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Trade receivables</td>${two(g('TR'), gp('TR'))}</tr></table>
    <p class="text-[12px] text-mut">The Company's normal trade credit terms granted to customers range from ${nv(N.termsGiven,'[30 to 90 days]')}. Receivables are recognised at transaction price less impairment for amounts assessed as uncollectible.</p>`);
  if (g('OR')) add('OR','Other receivables, deposits and prepayments', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Other receivables, deposits and prepayments</td>${two(g('OR'), gp('OR'))}</tr></table>`);
  if (g('DIRADV')) add('DIRADV','Amount owing by directors', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Amount owing by directors</td>${two(g('DIRADV'), gp('DIRADV'))}</tr></table>
    <p class="text-[12px] text-mut">The amount owing is non-trade in nature, unsecured, interest-free and repayable on demand. <em>[Confirm terms — see s.224/225 CA 2016 and s.140B ITA considerations.]</em></p>`);
  if (g('RPTREC')) add('RPTREC','Amount owing by related parties', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Amount owing by related parties</td>${two(g('RPTREC'), gp('RPTREC'))}</tr></table>
    <p class="text-[12px] text-mut">Non-trade, unsecured, interest-free and repayable on demand.</p>`);
  if (g('FD')) add('FD','Fixed deposits with licensed banks', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Fixed deposits with licensed banks</td>${two(g('FD'), gp('FD'))}</tr></table>
    <p class="text-[12px] text-mut">The fixed deposits earn interest at ${nv(N.fdRate,'[x.xx]%')} per annum. [Confirm maturity and any lien/pledge via the bank confirmation.]</p>`);
  add('CASH','Cash and bank balances', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Cash and bank balances</td>${two(g('CASH'), gp('CASH'))}</tr></table>
    ${g('OD') ? `<p class="text-[12px] text-mut">For the purpose of the statement of cash flows, cash and cash equivalents comprise cash and bank balances net of bank overdrafts of ${fmtRM(g('OD'))}.</p>`:''}`);
  add('SC','Share capital', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Issued and fully paid ordinary shares</td>${two(g('SC'), gp('SC') || g('SC'))}</tr></table>
    <p class="text-[12px] text-mut">Under the Companies Act 2016, shares have no par value. The holders of ordinary shares are entitled to receive dividends as declared and are entitled to one vote per share.</p>`);
  if (g('TP')) add('TP','Trade payables', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Trade payables</td>${two(g('TP'), gp('TP'))}</tr></table>
    <p class="text-[12px] text-mut">The normal trade credit terms granted to the Company range from ${nv(N.termsRecd,'[30 to 90 days]')}.</p>`);
  if (g('OP')) add('OP','Other payables and accruals', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Other payables and accruals</td>${two(g('OP'), gp('OP'))}</tr></table>`);
  if (g('DIROWE')) add('DIROWE','Amount owing to directors', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Amount owing to directors</td>${two(g('DIROWE'), gp('DIROWE'))}</tr></table>
    <p class="text-[12px] text-mut">Non-trade in nature, unsecured, interest-free and repayable on demand.</p>`);
  if (g('RPTPAY')) add('RPTPAY','Amount owing to related parties', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Amount owing to related parties</td>${two(g('RPTPAY'), gp('RPTPAY'))}</tr></table>`);
  if (g('BORR') || g('OD')) add(['BORR','OD'],'Bank borrowings', `<table class="fs-doc">${noteHead}
    ${g('OD')?`<tr><td>Bank overdraft (secured)</td>${two(g('OD'), gp('OD'))}</tr>`:''}
    ${g('BORR')?`<tr><td>Term loans (secured)</td>${two(g('BORR'), gp('BORR'))}</tr>`:''}
    <tr class="fs-total"><td>Total</td>${two(g('BORR')+g('OD'), gp('BORR')+gp('OD'))}</tr></table>
    <p class="text-[12px] text-mut">The borrowings are secured by ${nv(N.borrSec,'[state security — e.g. charge over property, directors’ joint and several guarantees]')} and bear interest at ${nv(N.borrRate,'[x.xx]% per annum')}.</p>`);
  if (g('HP')) {
    const hpCur = num(N.hpCurrent);
    add('HP','Hire purchase payables', hpCur ? `<table class="fs-doc">${noteHead}
      <tr><td>Repayable within one year</td>${two(hpCur, 0)}</tr>
      <tr><td>Repayable after one year</td>${two(g('HP')-hpCur, 0)}</tr>
      <tr class="fs-total"><td>Total</td>${two(g('HP'), gp('HP'))}</tr></table>`
    : `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Hire purchase payables</td>${two(g('HP'), gp('HP'))}</tr></table>
    <p class="text-[12px] text-mut">${nv('','[Split the minimum payments between amounts repayable within one year and later than one year per the HP schedules.]')}</p>`);
  }
  if (g('DEFTAX')) add('DEFTAX','Deferred tax liability', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>Deferred tax liability</td>${two(g('DEFTAX'), gp('DEFTAX'))}</tr></table>`);
  // revenue
  add('REV','Revenue', `<table class="fs-doc">${noteHead}<tr class="fs-total"><td>${esc(S.setup.activity) ? 'Revenue from ' + esc(S.setup.activity) : 'Revenue from contracts with customers'}</td>${two(m.revenue, p?p.revenue:0)}</tr></table>`);
  // PBT disclosures
  const audFee = sumRows(/audit fee/i), dirRem = sumRows(/director.*(remuneration|fee|salar)|remuneration.*director/i),
        rentExp = sumRows(/rent(al)? (of|expense|paid)|^rent\b/i), staff = sumRows(/salar|wages|bonus|gaji/i),
        epf = sumRows(/epf|kwsp/i), socso = sumRows(/socso|perkeso|\beis\b/i);
  add('TAXEXP2','Profit before taxation', `
    <p class="text-[12px]">Profit before taxation is arrived at after charging / (crediting):</p>
    <table class="fs-doc">${noteHead}
      ${audFee.cy?`<tr><td>Auditors' remuneration</td>${two(audFee.cy, audFee.py)}</tr>`
        : num(N.auditFee)?`<tr><td>Auditors' remuneration</td>${two(num(N.auditFee), 0)}</tr>`
        : `<tr><td>Auditors' remuneration ${nv('','[insert — should also be accrued]')}</td><td class="num"></td></tr>`}
      <tr><td>Depreciation of property, plant and equipment</td>${two(m.nat.DEPR, p?p.nat.DEPR:0)}</tr>
      ${dirRem.cy?`<tr><td>Directors' remuneration</td>${two(dirRem.cy, dirRem.py)}</tr>`
        : num(N.dirRem)?`<tr><td>Directors' remuneration</td>${two(num(N.dirRem), 0)}</tr>`:''}
      ${rentExp.cy?`<tr><td>Rental of premises</td>${two(rentExp.cy, rentExp.py)}</tr>`:''}
      ${m.fin?`<tr><td>Interest expense</td>${two(m.fin, p?p.fin:0)}</tr>`:''}
      ${m.othinc?`<tr><td>Other income</td>${two(-m.othinc, p?-p.othinc:0)}</tr>`:''}
    </table>`);
  // taxation note with reconciliation
  const statTax = Math.round(m.pbt * 0.24);
  add('TAXEXP','Taxation', `<table class="fs-doc">${noteHead}
      <tr class="fs-total"><td>Current year taxation</td>${two(m.taxexp, p?p.taxexp:0)}</tr></table>
    <p class="text-[12px]">Reconciliation of tax expense to accounting profit:</p>
    <table class="fs-doc">
      <tr><td>Profit before taxation</td><td class="num" style="width:110px">${fmt(m.pbt)}</td></tr>
      <tr class="fs-line"><td>Taxation at statutory rate of 24%</td><td class="num">${fmt(statTax)}</td></tr>
      <tr><td>Effect of SME preferential rates / non-deductible expenses / capital allowances (net)</td><td class="num">${fmt(m.taxexp - statTax)}</td></tr>
      <tr class="fs-total"><td>Tax expense for the year</td><td class="num">${fmt(m.taxexp)}</td></tr>
    </table>`);
  // staff costs
  if (staff.cy) add('STAFF','Employee benefits expense', `<table class="fs-doc">${noteHead}
      <tr><td>Salaries, wages and bonuses</td>${two(staff.cy, staff.py)}</tr>
      ${epf.cy?`<tr><td>Defined contribution plan (EPF)</td>${two(epf.cy, epf.py)}</tr>`:''}
      ${socso.cy?`<tr><td>SOCSO and EIS</td>${two(socso.cy, socso.py)}</tr>`:''}
      <tr class="fs-total"><td>Total</td>${two(staff.cy+epf.cy+socso.cy, staff.py+epf.py+socso.py)}</tr></table>
    <p class="text-[12px] text-mut">The Company had ${esc(S.setup.employees)||'[ ]'} employees at the end of the financial year.</p>`);
  // related party transactions
  const kmp = dirRem.cy || num(N.dirRem);
  if (m.nat.DIRADV || m.nat.DIROWE || m.nat.RPTREC || m.nat.RPTPAY || kmp)
    add('RPTX','Related party disclosures', `
      <p class="text-[12px]">The Company's related parties include its directors and companies in which the directors have substantial interests. Significant related party balances are disclosed in the respective notes. ${kmp?`Key management personnel compensation (directors' remuneration) for the year was ${fmtRM(kmp)}.`:''}</p>`);
  // financial instruments + events
  add('FIRISK','Financial instruments and risk management', `
    <p class="text-[12px]">The Company's financial instruments comprise receivables, payables, borrowings, deposits and cash. The main risks are credit risk (managed through credit evaluation and monitoring of receivable ageing), liquidity risk (managed through cash-flow planning and available banking facilities) and interest-rate risk on floating-rate borrowings. The directors review these exposures on an ongoing basis.</p>`);
  add('EVENTS','Events after the reporting period', `
    <p class="text-[12px]">There were no material events subsequent to the end of the reporting period that require disclosure or adjustment to the financial statements. <em>[Confirm through the ISA 560 subsequent-events review up to the date of the auditors' report.]</em></p>`);

  const gcNote = evaluate && S.tb.length && evaluate().gc;
  const html = `
    <h3>1. General information</h3>
    <p class="text-[12px]">The Company is a private limited liability company, incorporated and domiciled in Malaysia. The registered office is ${esc(S.setup.address)||'[registered office address]'}. The principal activity of the Company is ${esc(S.setup.activity)||'[principal activity]'}. The financial statements were authorised for issue by the Board of Directors on ${S.sign.date?dMY(S.sign.date):'[date]'}.</p>
    <h3>2. Basis of preparation</h3>
    <p class="text-[12px]">The financial statements have been prepared in accordance with the ${fw} and the requirements of the Companies Act 2016 in Malaysia, under the historical cost convention. The financial statements are presented in Ringgit Malaysia (RM), which is the Company's functional currency.${gcNote ? ' The financial statements have been prepared on a going-concern basis, the appropriateness of which depends on [describe — e.g. continuing financial support from the directors]; see the material uncertainty described in the auditors’ report.' : ''}</p>
    <h3>3. Material accounting policies</h3>
    <p class="text-[12px]"><strong>Revenue</strong> — recognised when the significant risks and rewards of ownership have transferred to the buyer (goods) or by reference to the stage of completion (services), at the fair value of consideration received or receivable, net of discounts and taxes.
    <strong>Property, plant and equipment</strong> — stated at cost less accumulated depreciation and impairment losses; depreciated straight-line over useful lives.
    <strong>Inventories</strong> — lower of cost (FIFO) and net realisable value.
    <strong>Financial instruments</strong> — receivables and payables measured at transaction price less impairment / at undiscounted amount payable.
    <strong>Leases</strong> — rentals under operating leases charged to profit or loss on a straight-line basis.
    <strong>Income tax</strong> — current tax at enacted rates; deferred tax on temporary differences where applicable.
    <strong>Employee benefits</strong> — short-term benefits and defined contributions to EPF expensed as incurred.
    <strong>Cash and cash equivalents</strong> — cash, bank balances and deposits with maturities of three months or less, net of bank overdrafts.</p>
    ${blocks.join('')}`;
  return { map, html, ph };
}
function packStatementRows(map) {
  const m = model(), p = hasPY() ? model(true) : null;
  const g = k => m.nat[k], gp = k => p ? p.nat[k] : undefined;
  const noteOf = c => map[c] ? String(map[c]) : '';
  const cy = new Date(S.setup.fye || Date.now()).getFullYear();
  const head = `<tr><th></th><th class="text-center text-[10px] text-mut" style="width:46px">Note</th>
    <th class="num text-[10px] text-mut" style="width:110px">${cy}<br>RM</th>${p?`<th class="num text-[10px] text-mut" style="width:110px">${cy-1}<br>RM</th>`:''}</tr>`;
  const L = (label, val, note, opts={}) => `<tr class="${opts.total?'fs-total':opts.line?'fs-line':''}">
    <td class="${opts.indent?'pl-5':''}">${label}</td><td class="text-center text-[11px]">${note||''}</td>
    <td class="num">${fmt(val,true)}</td>${p?`<td class="num text-mut">${opts.py!==undefined?fmt(opts.py,true):'–'}</td>`:''}</tr>`;
  const sopl = `<table>${head}
    ${L('Revenue', m.revenue, noteOf('REV'), {py:p?.revenue})}
    ${L('Cost of sales', -m.cos, '', {py:p?-p.cos:undefined})}
    ${L('Gross profit', m.gp, '', {line:1, py:p?.gp})}
    ${L('Other income', m.othinc, '', {py:p?.othinc})}
    ${L('Administrative and other operating expenses', -(m.nat.ADMIN+m.nat.SELL+m.nat.DEPR), '', {py:p?-(p.nat.ADMIN+p.nat.SELL+p.nat.DEPR):undefined})}
    ${L('Finance costs', -m.fin, '', {py:p?-p.fin:undefined})}
    ${L('Profit / (loss) before taxation', m.pbt, noteOf('TAXEXP2'), {line:1, py:p?.pbt})}
    ${L('Taxation', -m.taxexp, noteOf('TAXEXP'), {py:p?-p.taxexp:undefined})}
    ${L('Profit / (loss) for the financial year, representing total comprehensive income', m.pat, '', {total:1, py:p?.pat})}
  </table>`;
  const sofp = `<table>${head}
    <tr><td class="font-semibold pt-1">Non-current assets</td><td></td><td></td>${p?'<td></td>':''}</tr>
    ${L('Property, plant and equipment', m.ppeNet, noteOf('PPE'), {indent:1, py:p?.ppeNet})}
    ${g('INTANG')?L('Intangible assets', g('INTANG'), noteOf('INTANG'), {indent:1, py:gp('INTANG')}):''}
    ${g('INVEST')?L('Investments', g('INVEST'), noteOf('INVEST'), {indent:1, py:gp('INVEST')}):''}
    <tr><td class="font-semibold pt-1">Current assets</td><td></td><td></td>${p?'<td></td>':''}</tr>
    ${g('INV')?L('Inventories', g('INV'), noteOf('INV'), {indent:1, py:gp('INV')}):''}
    ${L('Trade receivables', g('TR'), noteOf('TR'), {indent:1, py:gp('TR')})}
    ${L('Other receivables, deposits and prepayments', g('OR'), noteOf('OR'), {indent:1, py:gp('OR')})}
    ${g('DIRADV')?L('Amount owing by directors', g('DIRADV'), noteOf('DIRADV'), {indent:1, py:gp('DIRADV')}):''}
    ${g('RPTREC')?L('Amount owing by related parties', g('RPTREC'), noteOf('RPTREC'), {indent:1, py:gp('RPTREC')}):''}
    ${g('FD')?L('Fixed deposits with licensed banks', g('FD'), noteOf('FD'), {indent:1, py:gp('FD')}):''}
    ${L('Cash and bank balances', g('CASH'), noteOf('CASH'), {indent:1, py:gp('CASH')})}
    ${g('SUSP')>0?L('Suspense (unresolved — clear before signing)', g('SUSP'), '', {indent:1}):''}
    ${L('Total assets', m.totalAssets, '', {total:1, py:p?.totalAssets})}
    <tr><td class="font-semibold pt-2">Equity</td><td></td><td></td>${p?'<td></td>':''}</tr>
    ${L('Share capital', g('SC'), noteOf('SC'), {indent:1, py:gp('SC')})}
    ${L('Retained earnings / (accumulated losses)', m.reClose, '', {indent:1, py:p?.reClose})}
    ${L('Total equity', m.equity, '', {line:1, py:p?.equity})}
    <tr><td class="font-semibold pt-1">Non-current liabilities</td><td></td><td></td>${p?'<td></td>':''}</tr>
    ${g('BORR')?L('Bank borrowings', g('BORR'), noteOf('BORR'), {indent:1, py:gp('BORR')}):''}
    ${g('HP')?L('Hire purchase payables', g('HP'), noteOf('HP'), {indent:1, py:gp('HP')}):''}
    ${g('DEFTAX')?L('Deferred tax liability', g('DEFTAX'), noteOf('DEFTAX'), {indent:1, py:gp('DEFTAX')}):''}
    <tr><td class="font-semibold pt-1">Current liabilities</td><td></td><td></td>${p?'<td></td>':''}</tr>
    ${L('Trade payables', g('TP'), noteOf('TP'), {indent:1, py:gp('TP')})}
    ${L('Other payables and accruals', g('OP'), noteOf('OP'), {indent:1, py:gp('OP')})}
    ${g('DIROWE')?L('Amount owing to directors', g('DIROWE'), noteOf('DIROWE'), {indent:1, py:gp('DIROWE')}):''}
    ${g('RPTPAY')?L('Amount owing to related parties', g('RPTPAY'), noteOf('RPTPAY'), {indent:1, py:gp('RPTPAY')}):''}
    ${g('OD')?L('Bank overdraft', g('OD'), noteOf('OD'), {indent:1, py:gp('OD')}):''}
    ${g('TAXPAY')?L('Current tax payable', g('TAXPAY'), '', {indent:1, py:gp('TAXPAY')}):''}
    ${g('SUSP')<0?L('Suspense (unresolved — clear before signing)', -g('SUSP'), '', {indent:1}):''}
    ${L('Total equity and liabilities', m.equity + m.totalLiab, '', {total:1, py:p?p.equity+p.totalLiab:undefined})}
  </table>`;
  return { sopl, sofp };
}
function renderPack() {
  const el = $('pack-render');
  // hydrate the note-details inputs
  const NMAP = { 'n-termsGiven':'termsGiven','n-termsRecd':'termsRecd','n-deprRates':'deprRates','n-fdRate':'fdRate',
    'n-borrSec':'borrSec','n-borrRate':'borrRate','n-hpCurrent':'hpCurrent','n-auditFee':'auditFee','n-dirRem':'dirRem' };
  for (const [id,k] of Object.entries(NMAP)) { const inp = $(id); if (inp && document.activeElement !== inp) inp.value = (S.notes||{})[k] || ''; }
  if (!S.tb.length) { el.innerHTML = '<div class="text-mut text-[13px]">Import a trial balance (step 2) to generate the full statutory pack.</div>';
    $('ph-count').textContent = '—'; $('ph-count').className = 'pill pill-mut'; return; }
  const { name, reg, fye } = repCtx();
  const m = model(), p = hasPY() ? model(true) : null;
  const notes = buildNotes();
  const phEl = $('ph-count');
  if (notes.ph === 0) { phEl.className = 'pill pill-ok'; phEl.textContent = 'All placeholders resolved'; }
  else { phEl.className = 'pill pill-warn'; phEl.textContent = `${notes.ph} placeholder(s) still bracketed`; }
  const st = packStatementRows(notes.map);
  const hdr = packHeader(name, reg);
  const contents = [
    'Corporate Information',
    'Directors’ Report', 'Statement by Directors', 'Statutory Declaration',
    'Independent Auditors’ Report',
    'Statement of Profit or Loss and Other Comprehensive Income',
    'Statement of Financial Position', 'Statement of Changes in Equity',
    'Statement of Cash Flows', 'Notes to the Financial Statements'
  ];
  // Corporate information — the conventional first inner page of a Malaysian
  // statutory FS: board, secretary, registered office, auditors, bankers.
  const banks = (S.intake.banks || '').split(/[,;]/).map(b => b.trim()).filter(Boolean);
  const corpRow = (label, val) => `<tr><td class="align-top font-semibold" style="width:38%">${label}</td><td>${val}</td></tr>`;
  const corpInfo = `
    <div class="pagebrk">${hdr}
      <h3 class="text-center">CORPORATE INFORMATION</h3>
      <table class="fs-doc" style="max-width:38rem;margin:0 auto">
        ${corpRow('BOARD OF DIRECTORS', S.directors.length ? S.directors.map(d => esc(d.name).toUpperCase()).join('<br>') : '[Directors]')}
        ${corpRow('COMPANY SECRETARY', S.setup.secretary ? esc(S.setup.secretary).toUpperCase() + (S.setup.secno ? '<br><span class="text-[11px] text-mut">(' + esc(S.setup.secno) + ')</span>' : '') : '[Company secretary — enter on Engagement Setup]')}
        ${corpRow('REGISTERED OFFICE', esc(S.setup.address) || '[Registered office address]')}
        ${corpRow('AUDITORS', (esc(S.sign.firm) || '[Audit firm]') + '<br><span class="text-[11px] text-mut">' + (esc(S.sign.af) || '[AF no.]') + ' · Chartered Accountants</span>')}
        ${banks.length ? corpRow('PRINCIPAL BANKERS', banks.map(esc).join('<br>')) : ''}
        ${corpRow('REGISTRATION NO.', reg)}
      </table>
    </div>`;
  el.innerHTML = `
    <!-- cover -->
    <div class="text-center py-16">
      <div class="font-bold text-[20px] mb-1">${name.toUpperCase()}</div>
      <div class="text-[13px] text-mut mb-10">(Registration No. ${reg})<br>(Incorporated in Malaysia)</div>
      <div class="font-semibold text-[15px] tracking-wide">REPORTS AND FINANCIAL STATEMENTS<br>FOR THE FINANCIAL YEAR ENDED ${fye.toUpperCase()}</div>
      <div class="mt-14 text-[12px] text-mut">${esc(S.sign.firm)||'[Audit firm]'}<br>${esc(S.sign.af)||'[AF number]'} · Chartered Accountants</div>
    </div>
    <!-- contents -->
    <div class="pagebrk">${hdr}
      <h3 class="text-center">CONTENTS</h3>
      <table class="fs-doc" style="max-width:34rem;margin:0 auto">
        ${contents.map((c,i)=>`<tr class="fs-line"><td>${c}</td><td class="num text-mut">${i+1}</td></tr>`).join('')}
      </table>
    </div>
    ${corpInfo}
    <div class="pagebrk">${repDirectorsHTML()}</div>
    <div class="pagebrk">${repStatementHTML()}</div>
    <div class="pagebrk">${repStatDecHTML()}</div>
    <div class="pagebrk">${repAuditorHTML()}</div>
    <div class="pagebrk">${hdr}
      <h3 class="text-center">STATEMENT OF PROFIT OR LOSS AND OTHER COMPREHENSIVE INCOME<br><span class="font-normal text-[11px]">FOR THE FINANCIAL YEAR ENDED ${fye.toUpperCase()}</span></h3>
      <div class="fs-doc">${st.sopl}</div>
      <p class="text-[11px] text-mut mt-3">The accompanying notes form an integral part of these financial statements.</p>
    </div>
    <div class="pagebrk">${hdr}
      <h3 class="text-center">STATEMENT OF FINANCIAL POSITION<br><span class="font-normal text-[11px]">AS AT ${fye.toUpperCase()}</span></h3>
      <div class="fs-doc">${st.sofp}</div>
      <p class="text-[11px] text-mut mt-3">The accompanying notes form an integral part of these financial statements.</p>
    </div>
    <div class="pagebrk">${hdr}
      <h3 class="text-center">STATEMENT OF CHANGES IN EQUITY<br><span class="font-normal text-[11px]">FOR THE FINANCIAL YEAR ENDED ${fye.toUpperCase()}</span></h3>
      <div class="fs-doc"><table>
        <tr><th></th><th class="num text-[10px] text-mut">Share capital<br>RM</th><th class="num text-[10px] text-mut">Retained earnings<br>RM</th><th class="num text-[10px] text-mut">Total<br>RM</th></tr>
        <tr class="fs-line"><td>At beginning of year</td><td class="num">${fmt(m.nat.SC)}</td><td class="num">${fmt(m.nat.RE)}</td><td class="num">${fmt(m.nat.SC+m.nat.RE)}</td></tr>
        <tr><td>Total comprehensive income for the year</td><td class="num">–</td><td class="num">${fmt(m.pat)}</td><td class="num">${fmt(m.pat)}</td></tr>
        ${m.nat.DIV?`<tr><td>Dividends declared</td><td class="num">–</td><td class="num">${fmt(-m.nat.DIV)}</td><td class="num">${fmt(-m.nat.DIV)}</td></tr>`:''}
        <tr class="fs-total"><td>At end of year</td><td class="num">${fmt(m.nat.SC)}</td><td class="num">${fmt(m.reClose)}</td><td class="num">${fmt(m.equity)}</td></tr>
      </table></div>
    </div>
    <div class="pagebrk">${hdr}
      <h3 class="text-center">STATEMENT OF CASH FLOWS<br><span class="font-normal text-[11px]">FOR THE FINANCIAL YEAR ENDED ${fye.toUpperCase()}</span></h3>
      <div class="fs-doc">${p ? cashflowHTML(m, p) : '<p class="text-[12px] text-mut">Prior-year balances are required to compile the statement of cash flows — add them on the Trial Balance screen.</p>'}</div>
    </div>
    <div class="pagebrk">${hdr}
      <h3 class="text-center">NOTES TO THE FINANCIAL STATEMENTS<br><span class="font-normal text-[11px]">FOR THE FINANCIAL YEAR ENDED ${fye.toUpperCase()}</span></h3>
      ${notes.html}
    </div>`;
}

/* ---------- AJE register ---------- */
let ajeDraft = [ {cat:'ADMIN', dr:'', cr:''}, {cat:'OP', dr:'', cr:''} ];
function renderAje() {
  $('aje-count').textContent = `${S.adjustments.length} posted`;
  $('aje-list').innerHTML = S.adjustments.map((a,i) => `
    <div class="border border-line rounded-xl p-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="pill ${a.manual?'pill-info':'pill-ok'}">${a.manual?'Manual':'From finding'}</span>
        <span class="font-semibold text-[13px] flex-1">AJE ${i+1} — ${esc(a.desc)}</span>
        <button class="btn btn-ghost !px-2 !py-1" onclick="ajeDelete('${a.id}')" aria-label="Delete journal">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
        </button>
      </div>
      <table class="tbl mt-1.5"><tbody>
        ${a.entries.map(e => `<tr><td class="${e.amt<0?'pl-6':''}">${e.amt>0?'Dr':'Cr'} ${CAT[e.cat].label}</td>
          <td class="num">${e.amt>0?fmt(e.amt):''}</td><td class="num">${e.amt<0?fmt(-e.amt):''}</td></tr>`).join('')}
      </tbody></table>
    </div>`).join('') || '<div class="text-[13px] text-mut">No adjustments posted yet — accept a proposed fix from the findings above, or post a manual journal below.</div>';
  renderAjeDraft();
}
function renderAjeDraft() {
  $('aje-rows').innerHTML = ajeDraft.map((r,i) => `
    <div class="flex gap-2 items-center">
      <select class="field !w-auto flex-1 !py-1.5 !text-[12px]" onchange="ajeUpd(${i},'cat',this.value)">${catOptions(r.cat)}</select>
      <input class="field mono !w-32 !py-1.5 !text-right" placeholder="Debit" value="${r.dr?fmt(num(r.dr)):''}" onchange="ajeUpd(${i},'dr',this.value)">
      <input class="field mono !w-32 !py-1.5 !text-right" placeholder="Credit" value="${r.cr?fmt(num(r.cr)):''}" onchange="ajeUpd(${i},'cr',this.value)">
      <button class="btn btn-ghost !px-2 !py-1" onclick="ajeDraft.splice(${i},1); renderAjeDraft()" aria-label="Remove line">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`).join('');
  const dr = ajeDraft.reduce((s,r)=>s+num(r.dr),0), cr = ajeDraft.reduce((s,r)=>s+num(r.cr),0);
  const bal = $('aje-balance');
  if (!dr && !cr) { bal.textContent=''; }
  else if (Math.abs(dr-cr) < 0.5) { bal.innerHTML = `<span class="text-ok font-semibold">Balanced — ${fmtRM(dr)}</span>`; }
  else { bal.innerHTML = `<span class="text-risk font-semibold">Out by ${fmtRM(dr-cr)}</span>`; }
}
function ajeUpd(i,k,v){ ajeDraft[i][k] = (k==='cat') ? v : (num(v)||''); renderAjeDraft(); }
function ajeAddRow(){ ajeDraft.push({cat:'ADMIN', dr:'', cr:''}); renderAjeDraft(); }
function ajePost() {
  if (guardArchived()) return;
  const desc = $('aje-desc').value.trim();
  const lines = ajeDraft.filter(r => num(r.dr) || num(r.cr));
  const dr = lines.reduce((s,r)=>s+num(r.dr),0), cr = lines.reduce((s,r)=>s+num(r.cr),0);
  if (!desc) { toast('Give the journal a description'); return; }
  if (lines.length < 2) { toast('A journal needs at least two lines'); return; }
  if (Math.abs(dr-cr) > 0.5) { toast(`Journal does not balance — out by ${fmtRM(dr-cr)}`); return; }
  S.adjustments.push({ id:nid(), manual:true, desc,
    entries: lines.map(r => ({ cat:r.cat, label:CAT[r.cat].label, amt: num(r.dr) ? num(r.dr) : -num(r.cr) })) });
  ajeDraft = [ {cat:'ADMIN', dr:'', cr:''}, {cat:'OP', dr:'', cr:''} ];
  $('aje-desc').value = '';
  saveState(); renderAudit(); updateTop();
  toast('Manual journal posted — FS updated');
}
function ajeDelete(id) {
  const a = S.adjustments.find(x => x.id === id);
  S.adjustments = S.adjustments.filter(x => x.id !== id);
  if (a && a.findingId) delete S.findingStatus[a.findingId];
  saveState(); renderAudit(); updateTop();
  toast('Journal removed' + (a && a.findingId ? ' — finding reopened' : ''));
}

/* ---------- clients & engagements ---------- */
function clientStats(c) {
  const keep = S; S = c;                       // evaluate in the client's context
  let st = { rev:0, findings:0, blockers:0, pct:0, opinion:'—' };
  try {
    if (c.tb.length) {
      const ev = evaluate(); const m = ev.mat.m;
      st = { rev:m.revenue, findings:ev.open.length,
        blockers:ev.open.filter(f=>['blocker','high'].includes(f.sev)).length,
        pct: Math.round([!!(c.setup.name && c.setup.fye), Math.abs(tbTotals().diff)<=0.5,
          ev.open.filter(f=>['blocker','high'].includes(f.sev)).length===0,
          Math.abs(m.balGap)<=1, !!(c.sign.partner && c.sign.firm)].filter(Boolean).length / 5 * 100),
        opinion: OPINION_LABEL[ev.opinion] };
    } else st.pct = c.setup.name ? 20 : 0;
  } catch(e) {}
  S = keep;
  return st;
}
function renderClients() {
  $('clients-grid').innerHTML = DB.clients.map(c => {
    const st = clientStats(c);
    const active = c.id === DB.activeId;
    return `
    <div class="card card-pad cursor-pointer hover:border-indigo transition-colors ${active?'!border-indigo ring-1 ring-indigo':''}"
         onclick="switchClient('${c.id}'); show('dashboard'); toast('Switched to ' + (S.setup.name || 'new engagement'))">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="min-w-0">
          <div class="font-bold text-[14.5px] truncate">${esc(c.setup.name) || 'Untitled engagement'}</div>
          <div class="text-[12px] text-mut truncate">${c.setup.regno ? esc(c.setup.regno) + ' · ' : ''}${c.setup.fye ? 'FYE ' + dMY(c.setup.fye) : 'FYE not set'}</div>
        </div>
        ${active ? '<span class="pill pill-info">Active</span>' : ''}
      </div>
      <div class="flex items-center gap-4 text-[12px] text-mut mb-3">
        <span>Revenue <span class="mono font-semibold text-ink">${st.rev ? fmtRM(st.rev) : '–'}</span></span>
        <span>Findings <span class="mono font-semibold ${st.blockers ? 'text-risk':'text-ink'}">${st.findings}</span></span>
      </div>
      <div class="h-1.5 rounded-full bg-paper overflow-hidden mb-2">
        <div class="h-full rounded-full bg-indigo" style="width:${st.pct}%"></div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-mut">${st.pct}% through the file · ${st.opinion}</span>
        <button class="btn btn-ghost !px-2 !py-1" onclick="event.stopPropagation(); deleteClient('${c.id}')" aria-label="Delete engagement">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('') || emptyState(ICON_FOLDER, 'No engagements yet', 'Register a company to start your first audit file.');
  staggerChildren('clients-grid', 45);
}
function newClientPrompt() { regOpen(); }
async function deleteClient(id) {
  const c = DB.clients.find(x => x.id === id);
  if (!confirm(`Delete the engagement "${c?.setup.name || 'Untitled'}" and all its attached evidence? This cannot be undone.`)) return;
  DB.clients = DB.clients.filter(x => x.id !== id);
  if (!DB.clients.length) newClient('');
  if (DB.activeId === id) { DB.activeId = DB.clients[0].id; S = activeClient(); }
  saveState(); render(current); updateTop();
  await cloudDeleteEngagementFiles(id).catch(()=>{});
  await cloudDeleteEngagement(id).catch(()=>{});
}

/* ---------- immutable activity trail (F4) ---------- */
/* Append-only by design: activity_log has no update/delete RLS policy, so
   once written even the owner can't alter or erase a row via the API. */
async function logActivity(action, detail) {
  if (!sb || !authUser || !S || !S.id) return;
  try {
    await sb.from('activity_log').insert({
      engagement_id: S.id, owner: authUser.id,
      actor: authUser.email || authUser.id, action, detail: detail || null,
    });
  } catch (e) { console.error('activity log failed', e); }
}
async function activityList(clientId) {
  if (!sb || !authUser) return [];
  const { data, error } = await sb.from('activity_log').select('*').eq('engagement_id', clientId).order('created_at', { ascending:false }).limit(200);
  return error ? [] : data;
}
function renderActivity(el) {
  el.innerHTML = `<div class="card card-pad"><div class="flex items-center justify-between mb-3">
    <div><div class="font-semibold text-[14px]">Activity trail</div>
    <p class="text-[12.5px] text-mut">Every entry below is permanent — the database grants no update or delete on this table, even to the owner. This is what a practice reviewer means by an audit trail.</p></div></div>
    <div id="activity-rows" class="text-[12.5px]">Loading…</div></div>`;
  activityList(S.id).then(rows => {
    $('activity-rows').innerHTML = rows.length ? rows.map(r => `
      <div class="flex items-start gap-3 py-1.5 border-b border-line/60 last:border-0">
        <span class="mono text-[11px] text-mut flex-none w-36">${new Date(r.created_at).toLocaleString('en-MY',{dateStyle:'medium',timeStyle:'short'})}</span>
        <div class="min-w-0 flex-1"><span class="font-medium">${esc(r.action)}</span>${r.detail ? ` — <span class="text-mut">${esc(r.detail)}</span>` : ''}</div>
        <span class="text-[11px] text-mut flex-none">${esc(r.actor)}</span>
      </div>`).join('') : '<div class="text-mut py-2">Nothing logged yet — the trail fills in as the file is worked.</div>';
  });
}

/* ---------- engagement team & roles (F1) ---------- */
/* The owner invites colleagues by email; RLS opens the engagement to that
   email once its owner has run supabase-schema-round3.sql. Roles gate the
   review-locking behaviour in-app: a working paper signed as reviewed is
   locked, and only a manager/partner can reopen it. */
async function teamList(clientId) {
  if (!sb || !authUser) return [];
  const { data, error } = await sb.from('engagement_members').select('*').eq('engagement_id', clientId).order('created_at');
  return error ? [] : data;
}
function amOwner() { return !S._owner || S._owner === (authUser && authUser.id); }
function myRole() {
  if (amOwner()) return 'partner';
  const me = (S._members || []).find(m => authUser && m.member_email.toLowerCase() === (authUser.email || '').toLowerCase());
  return me ? me.role : 'staff';
}
const ROLE_PILL = { staff:'pill-mut', manager:'pill-info', partner:'pill-ok' };
async function teamAdd() {
  const email = $('team-email').value.trim().toLowerCase();
  const role = $('team-role').value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email address'); return; }
  const { error } = await sb.from('engagement_members').insert({
    engagement_id: S.id, member_email: email, role, added_by: authUser.id });
  if (error) {
    toast(/duplicate/i.test(error.message) ? 'Already on the team' :
      /relation .* does not exist|schema cache/i.test(error.message) ? 'Team tables not set up yet — run supabase-schema-round3.sql' : 'Could not add — ' + error.message);
    return;
  }
  logActivity('Added team member', `${email} as ${role}`);
  $('team-email').value = '';
  renderTeam();
}
async function teamRemove(id, email) {
  if (!confirm(`Remove ${email} from this engagement?`)) return;
  const { error } = await sb.from('engagement_members').delete().eq('id', id);
  if (error) { toast('Could not remove'); return; }
  logActivity('Removed team member', email);
  renderTeam();
}
async function teamSetRole(id, email, role) {
  const { error } = await sb.from('engagement_members').update({ role }).eq('id', id);
  if (error) { toast('Could not change role'); return; }
  logActivity('Changed team role', `${email} → ${role}`);
  renderTeam();
}
async function renderTeam() {
  const box = $('team-box'); if (!box) return;
  const members = await teamList(S.id);
  S._members = members;
  const owner = amOwner();
  box.innerHTML = `
    <div class="flex items-center gap-2 mb-2 text-[12.5px]">
      <span class="pill ${ROLE_PILL[myRole()]}">you: ${owner ? 'owner / partner' : myRole()}</span>
      ${!owner ? '<span class="text-mut">shared with you — the owner manages the team</span>' : ''}
    </div>
    ${members.map(m => `
      <div class="flex items-center gap-2 py-1.5 border-b border-line/60 last:border-0 text-[12.5px]">
        <span class="truncate flex-1">${esc(m.member_email)}</span>
        ${owner ? `<select class="field !py-1 !w-28 !text-[12px]" onchange="teamSetRole('${m.id}','${esc(m.member_email)}',this.value)">
          ${['staff','manager','partner'].map(r => `<option ${m.role===r?'selected':''}>${r}</option>`).join('')}
        </select>
        <button class="btn btn-ghost !px-1.5 !py-1" onclick="teamRemove('${m.id}','${esc(m.member_email)}')" aria-label="Remove">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>` : `<span class="pill ${ROLE_PILL[m.role]}">${m.role}</span>`}
      </div>`).join('') || '<div class="text-[12.5px] text-mut py-1">No team members yet — this file is visible only to you.</div>'}
    ${owner ? `
    <div class="flex flex-wrap gap-2 mt-3">
      <input class="field flex-1 !min-w-[180px]" id="team-email" placeholder="colleague@firm.my" type="email">
      <select class="field !w-28" id="team-role">
        <option value="staff">staff</option><option value="manager">manager</option><option value="partner">partner</option>
      </select>
      <button class="btn btn-pri" onclick="teamAdd()">Invite</button>
    </div>
    <p class="text-[11.5px] text-mut mt-2">They sign in (or sign up) with that email and this engagement appears in their list — staff prepare, managers review and lock papers, partners sign. Every action is logged to the activity trail under the actor's own email.</p>` : ''}`;
}

/* ---------- finalise & archive the audit file (ISA 230) ---------- */
/* Once the report is signed, the partner finalises the file: the whole
   engagement becomes read-only (like a reviewed working paper, but
   file-wide), the assembly date is stamped, and the 7-year retention
   clock starts. Reopening requires a typed reason and is logged to the
   append-only trail — exactly what ISA 230.13-16 asks for. */
function isArchived() { return !!(S.archive && S.archive.state === 'final'); }
let _archToastAt = 0;
function guardArchived() {
  if (!isArchived()) return false;
  if (Date.now() - _archToastAt > 3000) { toast('This file is finalised & archived — reopen it (Reports screen) to make changes'); _archToastAt = Date.now(); }
  return true;
}
async function finaliseFile() {
  if (myRole() !== 'partner') { toast('Only the engagement partner (or file owner) can finalise the file'); return; }
  if (!S.sign.partner || !S.sign.date) { toast('Sign the report first — partner name and report date are required'); return; }
  if (!confirm(`Finalise and archive the audit file for ${S.setup.name}?\n\nThe entire engagement becomes read-only. Reopening requires a documented reason and is logged permanently.`)) return;
  const ev = { type:'finalised', by: authUser ? authUser.email : 'unknown', at: new Date().toISOString() };
  S.archive = { state:'final', finalisedBy: ev.by, finalisedAt: ev.at,
    events: [...(S.archive && S.archive.events || []), ev] };
  await cloudPushEngagement(S);      // direct push — saveState is guarded once archived
  try { localStorage.setItem('mr-auditor-v2', JSON.stringify(DB)); } catch(e) {}
  logActivity('Finalised & archived the audit file', `report dated ${dMY(S.sign.date)}; retain to ${dMY(dISO(addYears7(S.archive.finalisedAt)))}`);
  toast('File finalised & archived');
  render(current); updateTop();
}
function addYears7(iso) { const d = new Date(iso); d.setFullYear(d.getFullYear() + 7); return d; }
async function reopenFile() {
  if (myRole() !== 'partner') { toast('Only the engagement partner (or file owner) can reopen an archived file'); return; }
  const reason = prompt('ISA 230 requires the reason for modifying an assembled file to be documented.\n\nReason for reopening:');
  if (!reason || !reason.trim()) { toast('Reopening cancelled — a reason is required'); return; }
  const ev = { type:'reopened', by: authUser ? authUser.email : 'unknown', at: new Date().toISOString(), reason: reason.trim() };
  S.archive = { ...S.archive, state:'reopened', events: [...(S.archive.events || []), ev] };
  await cloudPushEngagement(S);
  try { localStorage.setItem('mr-auditor-v2', JSON.stringify(DB)); } catch(e) {}
  logActivity('Reopened archived audit file', reason.trim());
  toast('File reopened — remember to re-finalise when done');
  render(current); updateTop();
}
function renderArchiveBox() {
  const box = $('archive-box'); if (!box) return;
  const a = S.archive;
  const signed = !!(S.sign.partner && S.sign.date);
  if (isArchived()) {
    const retainTo = addYears7(a.finalisedAt);
    box.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#1D7A46" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        <span class="font-semibold text-[13.5px] text-ok">File finalised &amp; archived</span>
      </div>
      <div class="text-[12.5px] space-y-1">
        <div>Assembled &amp; finalised by <strong>${esc(a.finalisedBy)}</strong> on ${dMY(dISO(new Date(a.finalisedAt)))}.</div>
        <div>Retain working papers until <strong>${dMY(dISO(retainTo))}</strong> (7 years).</div>
        <div class="text-mut">The engagement is read-only. Every screen still renders and prints — nothing can be changed without reopening.</div>
      </div>
      ${myRole() === 'partner' ? `<button class="btn btn-ghost !py-1.5 !text-[12px] mt-3" onclick="reopenFile()">Reopen file (reason required, logged)</button>` : ''}`;
  } else {
    const assembleBy = signed ? addDays(S.sign.date, 60) : null;
    const daysLeft = assembleBy ? Math.ceil((new Date(assembleBy + 'T00:00:00') - new Date()) / 86400000) : null;
    box.innerHTML = `
      <div class="font-semibold text-[13.5px] mb-1">Finalise &amp; archive (ISA 230)</div>
      <p class="text-[12.5px] text-mut mb-2">${signed
        ? `Report signed ${dMY(S.sign.date)} — assemble and finalise the file by <strong>${dMY(assembleBy)}</strong> (${daysLeft} day${Math.abs(daysLeft)===1?'':'s'} ${daysLeft >= 0 ? 'left' : 'OVERDUE'}, 60-day limit).`
        : 'Available once the partner and report date are entered above — finalising freezes the whole file and starts the 7-year retention clock.'}</p>
      ${a && a.events && a.events.length ? `<div class="text-[11.5px] text-mut mb-2">${a.events.map(e => `${dMY(dISO(new Date(e.at)))} — ${e.type} by ${esc(e.by)}${e.reason ? ': ' + esc(e.reason) : ''}`).join('<br>')}</div>` : ''}
      <button class="btn ${signed ? 'btn-pri' : 'btn-ghost'} !py-1.5" ${signed ? '' : 'disabled'} onclick="finaliseFile()">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        Finalise &amp; archive the file</button>`;
  }
}

/* ---------- Compliance & Data (MIA-friendly pack) ---------- */
/* No approval regime exists for audit software — what MIA reviews is the
   auditor's file and conduct. These three tabs give a firm the documents
   that conversation needs: where the data lives, the client-consent clause
   for the engagement letter, and the ISQM 1 technological-resources memo. */
let cpTab = 'data';
document.addEventListener('click', e => {
  const b = e.target.closest('.cp-tab'); if (!b) return;
  cpTab = b.dataset.cp;
  document.querySelectorAll('.cp-tab').forEach(x => { x.classList.toggle('btn-pri', x===b); x.classList.toggle('btn-ghost', x!==b); });
  renderCompliance();
});
function renderCompliance() {
  document.querySelectorAll('.cp-tab').forEach(x => { x.classList.toggle('btn-pri', x.dataset.cp===cpTab); x.classList.toggle('btn-ghost', x.dataset.cp!==cpTab); });
  const el = $('cp-render');
  if (cpTab === 'data') return cpData(el);
  if (cpTab === 'clause') return cpClause(el);
  if (cpTab === 'isqm') return cpIsqm(el);
}
function cpData(el) {
  el.innerHTML = `
  <div class="card card-pad mb-4">
    <h2 class="font-bold text-[15px] mb-1">Where the audit data lives, and what touches it</h2>
    <p class="text-[12.5px] text-mut mb-4">The facts a firm needs for its confidentiality assessment (MIA By-Laws / IESBA s.114) and PDPA 2010 compliance. Print this page for the ISQM 1 file alongside the tool memo.</p>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div class="font-semibold text-[13.5px] mb-1.5">Storage &amp; access</div>
        <ul class="list-disc pl-5 space-y-1 text-[12.5px]">
          <li>All engagement data and vault documents are stored in a dedicated <strong>Supabase</strong> project (PostgreSQL + object storage), encrypted in transit (TLS) and at rest (AES-256).</li>
          <li>Access requires sign-in; <strong>row-level security enforced by the database</strong> limits every record to the engagement owner and the team members they invite — including the underlying file storage, not just the interface.</li>
          <li>Team roles (staff / manager / partner) gate review-locking; a member can never delete an engagement or take ownership — enforced at database level.</li>
          <li>Every material action is written to an <strong>append-only activity trail</strong>: no user, including the owner, can edit or erase an entry.</li>
          <li>Finalised files are archived read-only (ISA 230); reopening requires a documented reason and is logged.</li>
        </ul>
      </div>
      <div>
        <div class="font-semibold text-[13.5px] mb-1.5">AI processing</div>
        <ul class="list-disc pl-5 space-y-1 text-[12.5px]">
          <li>AI features run <strong>only when the auditor clicks them</strong> (Ask Mr Auditor, document analysis, statement extraction, position papers). Nothing is sent in the background.</li>
          <li>What is sent: a summary of the engagement's figures and, for document analysis, the specific vault documents the auditor selects — over TLS to <strong>Anthropic's API</strong>.</li>
          <li>Per Anthropic's commercial API terms, <strong>API inputs and outputs are not used to train models</strong>.</li>
          <li>The AI's answer is a draft. It is labelled as AI-drafted wherever it lands in a working paper, and the paper's preparer/reviewer sign-off covers it — responsibility stays with the engagement team.</li>
          <li>Anything the AI cannot read (size, file type) is reported explicitly — never silently skipped.</li>
        </ul>
        <div class="font-semibold text-[13.5px] mb-1.5 mt-4">What we don't do</div>
        <ul class="list-disc pl-5 space-y-1 text-[12.5px]">
          <li>No analytics trackers, no advertising SDKs, no resale or secondary use of client data.</li>
          <li>No cross-client data mixing — every engagement is isolated by row-level security.</li>
        </ul>
      </div>
    </div>
    <div class="flex gap-2 mt-4 no-print">
      <button class="btn btn-ghost" onclick="window.print()">Print / PDF for the ISQM 1 file</button>
    </div>
  </div>`;
}
function cpClause(el) {
  const co = S.setup.name || '[Client Sdn Bhd]';
  const firm = S.sign.firm || '[Audit Firm PLT]';
  const clause = `Use of technology and cloud-based tools

In performing our engagement we use professional software, including cloud-hosted audit software and artificial-intelligence-assisted document analysis, to prepare and manage the audit working papers. Information and documents you provide to us may accordingly be processed and stored by carefully selected third-party service providers under conditions of confidentiality and security (encrypted storage and transmission; access restricted to the engagement team). These providers act as data processors only: your information is not used to train artificial-intelligence models, is not disclosed for any other purpose, and remains subject to our duty of confidentiality under the By-Laws (on Professional Ethics, Conduct and Practice) of the Malaysian Institute of Accountants.

For the purposes of the Personal Data Protection Act 2010, you consent to the processing (including processing outside Malaysia by the service providers described above) of personal data contained in the records and documents provided for this engagement, solely for the performance of the engagement. You confirm that you are authorised to provide such personal data of your employees, customers, suppliers and officers for this purpose.

Responsibility for the audit, the audit opinion and all professional judgments remains solely with ${firm}. Technology is used to assist, not replace, the exercise of professional judgment by the engagement team.`;
  el.innerHTML = `
  <div class="card card-pad">
    <h2 class="font-bold text-[15px] mb-1">Engagement letter clause — technology &amp; consent</h2>
    <p class="text-[12.5px] text-mut mb-3">Drop this into the firm's engagement letter for <strong>${esc(co)}</strong>. It covers IESBA s.114 confidentiality safeguards and PDPA 2010 consent for cloud and AI processing. Have the firm's usual legal reviewer glance over it once — then it's boilerplate for every engagement.</p>
    <textarea class="field !text-[12.5px] mono" id="cp-clause-text" rows="16" readonly>${esc(clause)}</textarea>
    <div class="flex gap-2 mt-3 no-print">
      <button class="btn btn-pri" onclick="navigator.clipboard.writeText($('cp-clause-text').value).then(()=>toast('Clause copied to clipboard'))">Copy to clipboard</button>
      <button class="btn btn-ghost" onclick="window.print()">Print / PDF</button>
    </div>
  </div>`;
}
function cpIsqm(el) {
  const firm = S.sign.firm || '[Audit Firm PLT]';
  const today = dMY(dISO(new Date()));
  el.innerHTML = `
  <div class="card card-pad no-print mb-4 flex items-start justify-between gap-3 flex-wrap">
    <div>
      <h2 class="font-bold text-[15px] mb-1">ISQM 1 technological-resources memo</h2>
      <p class="text-[12.5px] text-mut max-w-2xl">ISQM 1 (para 32(f)) expects the firm to obtain and maintain appropriate technological resources — in practice, a memo on file showing the firm evaluated the tool. This one is pre-written; the partner reads it, signs it, files it. Firm name flows from the Reports screen.</p>
    </div>
    <button class="btn btn-pri" onclick="window.print()">Print / PDF</button>
  </div>
  <div class="fs-doc">
    <div class="text-center mb-4">
      <div class="font-bold text-[15px]">${esc(firm)}</div>
      <div class="text-[13px]">Evaluation of technological resources — Mr Auditor (ISQM 1 para 32(f))</div>
      <div class="text-[11.5px] text-mut">Prepared ${today}</div>
    </div>
    <h3>1. Description of the resource</h3>
    <p>Mr Auditor is a cloud-based statutory-audit platform used by the firm for engagement performance on private-company audits: trial balance processing, materiality and risk documentation (ISA 320/315), working papers with preparer/reviewer sign-off and locking, financial statements and notes preparation (MPERS/MFRS), tax computation, statutory reports, and AI-assisted document analysis and drafting.</p>
    <h3>2. How the resource supports quality (relevant ISQM 1 components)</h3>
    <p><strong>Engagement performance:</strong> a single live data model means working-paper totals, financial statements, notes and the tax computation cannot diverge; every figure recomputes from the adjusted trial balance. Working papers lock on review; only a manager or partner can reopen them. <strong>Documentation:</strong> an append-only activity trail records who did what and when; on finalisation the file is archived read-only within the ISA 230 60-day assembly period and retained for 7 years; reopening requires a documented reason. <strong>Confidentiality:</strong> data is encrypted in transit and at rest; database-enforced row-level security restricts each engagement to its team; AI processing occurs only on the engagement team's instruction and the provider does not use the data for model training.</p>
    <h3>3. Limitations and safeguards</h3>
    <p>Outputs of the software, including AI-drafted analyses, position papers and note disclosures, are <strong>drafts</strong>. They are labelled as such where they enter the working papers and are subject to preparation and review sign-off by the engagement team. Professional judgments — materiality, sufficiency of evidence, going concern, and the opinion — are made by the engagement team and the signing partner, not the software. The firm remains responsible for direction, supervision and review (ISA 220) on every engagement.</p>
    <h3>4. Conclusion</h3>
    <p>The firm has evaluated Mr Auditor and concluded that, used with the safeguards above, it is an appropriate technological resource supporting the firm's system of quality management.</p>
    <div class="grid grid-cols-2 gap-8 mt-10">
      <div><div style="border-top:1px solid #0B1437; padding-top:.4rem"><strong>${esc(S.sign.partner) || '[Partner]'}</strong><br>Partner, ${esc(firm)}<br>Date: ____________</div></div>
      <div></div>
    </div>
  </div>`;
}

/* ---------- Query / PBC log (F2) ---------- */
/* One table (`queries`), distinguished by kind: 'pbc' (prepared-by-client
   requests, generated from what's still outstanding in the vault) or
   'query' (ad-hoc points raised during fieldwork). Half of real fieldwork
   is "please provide X" <-> client responds — this is that screen. */
let qtTab = 'pbc';
document.addEventListener('click', e => {
  const b = e.target.closest('.qt-tab'); if (!b) return;
  qtTab = b.dataset.qt;
  document.querySelectorAll('.qt-tab').forEach(x => { x.classList.toggle('btn-pri', x===b); x.classList.toggle('btn-ghost', x!==b); });
  renderQueriesScreen();
});
async function queriesList(kind) {
  if (!sb || !authUser) return [];
  let q = sb.from('queries').select('*').eq('engagement_id', S.id).order('raised_at', { ascending:false });
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  return error ? [] : data;
}
async function queryAdd(kind, question, category, wpRef) {
  if (guardArchived()) return;
  if (!question || !question.trim()) return;
  const prefix = kind === 'pbc' ? 'PBC' : 'Q';
  const existing = await queriesList(kind);
  const ref = `${prefix}-${existing.length + 1}`;
  const { error } = await sb.from('queries').insert({
    engagement_id: S.id, owner: authUser.id, kind, ref, category: category || null, wp_ref: wpRef || null,
    question: question.trim(), status: 'open',
  });
  if (error) { toast('Could not save — check your connection'); return; }
  logActivity(kind === 'pbc' ? 'Raised PBC request' : 'Raised query', `${ref}: ${question.trim().slice(0,80)}`);
  renderQueriesScreen();
}
async function queryRespond(id, ref, response) {
  if (guardArchived()) return;
  if (!response || !response.trim()) return;
  const { error } = await sb.from('queries').update({ response: response.trim(), status: 'answered', responded_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast('Could not save response'); return; }
  logActivity('Response recorded', ref);
  renderQueriesScreen();
}
async function queryClose(id, ref) {
  if (guardArchived()) return;
  const { error } = await sb.from('queries').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id);
  if (error) { toast('Could not close'); return; }
  logActivity('Closed', ref);
  renderQueriesScreen();
}
async function queryReopen(id, ref) {
  if (guardArchived()) return;
  const { error } = await sb.from('queries').update({ status: 'open', closed_at: null }).eq('id', id);
  if (error) return;
  logActivity('Reopened', ref);
  renderQueriesScreen();
}
const QSTATUS_PILL = { open:'pill-warn', answered:'pill-info', closed:'pill-ok' };
function renderQueriesScreen() {
  document.querySelectorAll('.qt-tab').forEach(x => { x.classList.toggle('btn-pri', x.dataset.qt===qtTab); x.classList.toggle('btn-ghost', x.dataset.qt!==qtTab); });
  const el = $('qt-render');
  if (!el) return;
  if (qtTab === 'pbc') return qtPbc(el);
  if (qtTab === 'log') return qtLog(el);
  if (qtTab === 'activity') return renderActivity(el);
}
async function qtPbc(el) {
  el.innerHTML = `<div class="text-mut">Loading…</div>`;
  const [files, pbcs] = await Promise.all([vaultListRows(S.id), queriesList('pbc')]);
  const filedCats = new Set(files.map(f => f.category));
  const outstanding = DOCCATS.filter(c => !filedCats.has(c) && !pbcs.some(p => p.category === c && p.status !== 'closed'));
  const open = pbcs.filter(p => p.status !== 'closed');
  const closed = pbcs.filter(p => p.status === 'closed');
  el.innerHTML = `
    <div class="card card-pad mb-4">
      <div class="font-semibold text-[14px] mb-1">Outstanding — not yet filed in the vault</div>
      <p class="text-[12.5px] text-mut mb-2">Auto-generated from the evidence categories with nothing filed. One click turns any of these into a formal request.</p>
      ${outstanding.length ? outstanding.map(c => `
        <div class="flex items-center justify-between py-1.5 border-b border-line/60 last:border-0">
          <span class="text-[13px]">${esc(c)}</span>
          <button class="btn btn-ghost !py-1 !text-[11.5px]" onclick="queryAdd('pbc','Please provide: ${esc(c).replace(/'/g,"\\'")}','${esc(c).replace(/'/g,"\\'")}')">Request this</button>
        </div>`).join('') : '<div class="text-mut py-1">Nothing outstanding — every evidence category has at least one file, or a request is already open.</div>'}
    </div>
    <div class="card card-pad mb-4">
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold text-[14px]">PBC requests (${open.length} open)</div>
        <button class="btn btn-ghost !py-1.5 !text-[12px] no-print" onclick="window.print()">Print PBC letter</button>
      </div>
      ${open.length ? open.map(p => qtRow(p)).join('') : '<div class="text-mut py-1">No open PBC requests.</div>'}
      ${closed.length ? `<div class="text-[11px] font-semibold uppercase tracking-wider text-mut mt-3 mb-1">Closed</div>${closed.map(p=>qtRow(p)).join('')}` : ''}
    </div>`;
}
function qtRow(p) {
  return `<div class="py-2 border-b border-line/60 last:border-0">
    <div class="flex items-start gap-2">
      <span class="mono text-[11px] text-mut flex-none w-14">${p.ref}</span>
      <div class="min-w-0 flex-1">
        <div class="text-[13px]">${esc(p.question)}</div>
        ${p.response ? `<div class="text-[12px] text-mut mt-0.5"><span class="font-medium">Response:</span> ${esc(p.response)}</div>` : ''}
        ${p.wp_ref ? `<div class="text-[11px] text-mut">raised from WP ${esc(p.wp_ref)}</div>` : ''}
      </div>
      <span class="pill ${QSTATUS_PILL[p.status]} flex-none">${p.status}</span>
    </div>
    ${p.status !== 'closed' ? `<div class="flex items-center gap-2 mt-1.5 pl-16 no-print">
      ${p.status === 'open' ? `<input class="field !py-1 !text-[12px] flex-1" placeholder="Record the client's response…" id="resp-${p.id}">
        <button class="btn btn-ghost !py-1 !text-[11.5px]" onclick="queryRespond('${p.id}','${p.ref}',$('resp-${p.id}').value)">Save response</button>` : ''}
      <button class="btn btn-ghost !py-1 !text-[11.5px]" onclick="queryClose('${p.id}','${p.ref}')">Close</button>
    </div>` : `<div class="pl-16 no-print"><button class="btn btn-ghost !py-1 !text-[11px]" onclick="queryReopen('${p.id}','${p.ref}')">Reopen</button></div>`}
  </div>`;
}
async function qtLog(el) {
  el.innerHTML = `<div class="text-mut">Loading…</div>`;
  const qs = await queriesList('query');
  const open = qs.filter(q => q.status !== 'closed');
  const closed = qs.filter(q => q.status === 'closed');
  el.innerHTML = `
    <div class="card card-pad mb-4">
      <div class="font-semibold text-[14px] mb-2">Raise a query</div>
      <div class="flex flex-wrap gap-2">
        <input class="field flex-1 !min-w-[240px]" id="qlog-new" placeholder="e.g. Please explain the RM45,000 movement in director's advances in March">
        <input class="field !w-28" id="qlog-wpref" placeholder="WP ref (opt.)">
        <button class="btn btn-pri" onclick="queryAdd('query', $('qlog-new').value, null, $('qlog-wpref').value); $('qlog-new').value=''; $('qlog-wpref').value='';">Raise query</button>
      </div>
    </div>
    <div class="card card-pad">
      <div class="font-semibold text-[14px] mb-2">Query log (${open.length} open)</div>
      ${open.length ? open.map(q => qtRow(q)).join('') : '<div class="text-mut py-1">No open queries.</div>'}
      ${closed.length ? `<div class="text-[11px] font-semibold uppercase tracking-wider text-mut mt-3 mb-1">Closed</div>${closed.map(q=>qtRow(q)).join('')}` : ''}
    </div>`;
}

/* ---------- evidence vault (Supabase Storage + evidence_files) ---------- */
const DOCCATS = ['Trial balance & management accounts','Bank statements & confirmations','Sales & receivables evidence',
  'Purchases & payables evidence','Fixed asset register & invoices','Inventory count sheets','Payroll · EPF · SOCSO',
  'SSM & statutory records','Tax — CP204 / Form C / assessments','Agreements & facility letters','Prior-year FS & working papers','Others'];
const sanitizeName = n => n.replace(/[^\w.\-]+/g, '_');
async function vaultListRows(clientId) {
  if (!sb || !authUser) return [];
  const { data, error } = await sb.from('evidence_files').select('*').eq('engagement_id', clientId).order('uploaded_at', { ascending:false });
  return error ? [] : data;
}
async function vaultCount() { return (await vaultListRows(S.id)).length; }
async function vaultUploadOne(file, cat, clientId) {
  if (!sb || !authUser) return false;
  const path = `${authUser.id}/${clientId}/${nid()}-${sanitizeName(file.name)}`;
  // Supabase Storage throws transient 502/503s under bulk uploads (seen when
  // filing a full evidence set in one go) — retry twice with backoff before
  // reporting failure, so an auditor uploading 20 documents doesn't get
  // spurious "Upload failed" toasts.
  let upErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 800 * attempt));
    ({ error: upErr } = await sb.storage.from('evidence').upload(path, file, { contentType: file.type || undefined }));
    if (!upErr) break;
  }
  if (upErr) { console.error('vault upload failed after retries', upErr); return false; }
  const { error: insErr } = await sb.from('evidence_files').insert({
    engagement_id: clientId, owner: authUser.id, category: cat,
    file_name: file.name, mime_type: file.type, size_bytes: file.size, storage_path: path });
  if (insErr) { console.error('vault record failed', insErr);
    await sb.storage.from('evidence').remove([path]).catch(()=>{}); return false; }
  return true;
}
async function vaultUpload(input) {
  if (guardArchived()) { input.value = ''; return; }
  const cat = $('vault-cat').value || 'Others';
  const files = [...input.files]; input.value = '';
  if (!files.length) return;
  let ok = 0;
  for (const f of files) if (await vaultUploadOne(f, cat, S.id)) ok++;
  toast(ok ? `${ok} file(s) filed under ${cat}` : 'Upload failed — check your connection');
  if (ok) logActivity('Filed evidence', `${ok} file(s) under "${cat}"`);
  renderVault(); updateTop();
}
/* ---------- evidence tick-marks (F3) ---------- */
/* "Evidence attached" is not "evidence tested" — a tick-mark is the auditor's
   sighted/agreed/exception mark against one specific document. */
let _ticksCache = {};
let vaultTickOpen = null;
async function ticksListAll(clientId) {
  if (!sb || !authUser) return {};
  const { data, error } = await sb.from('evidence_ticks').select('*').eq('engagement_id', clientId).order('created_at', { ascending:false });
  const map = {};
  if (!error) for (const t of data) (map[t.evidence_file_id] = map[t.evidence_file_id] || []).push(t);
  return map;
}
function vaultTickToggle(fileId) { vaultTickOpen = vaultTickOpen === fileId ? null : fileId; renderVault(); }
async function vaultTickSave(fileId, fileName) {
  if (guardArchived()) return;
  const status = $(`tick-status-${fileId}`).value;
  const initials = $(`tick-initials-${fileId}`).value.trim();
  const note = $(`tick-note-${fileId}`).value.trim();
  if (!initials) { toast('Initials required to tick-mark evidence'); return; }
  const { error } = await sb.from('evidence_ticks').insert({
    evidence_file_id: fileId, engagement_id: S.id, owner: authUser.id,
    status, initials, tick_date: dISO(new Date()), note: note || null,
  });
  if (error) { toast('Could not save tick-mark'); return; }
  logActivity('Tick-marked evidence', `${fileName} — ${status} (${initials})`);
  vaultTickOpen = null;
  renderVault();
}
const TICK_STATUS_PILL = { agreed:'pill-ok', exception:'pill-risk', query:'pill-warn' };
function tickBadges(ticks) {
  if (!ticks || !ticks.length) return '<span class="pill pill-mut !text-[10px]">untested</span>';
  const latest = ticks[0];
  return `<span class="pill ${TICK_STATUS_PILL[latest.status]||'pill-mut'} !text-[10px]" title="${ticks.length} tick-mark(s) — latest by ${esc(latest.initials)} on ${dMY(latest.tick_date)}">${latest.status} · ${esc(latest.initials)}${ticks.length>1?` +${ticks.length-1}`:''}</span>`;
}
async function vaultRow(id) {
  const { data } = await sb.from('evidence_files').select('storage_path,file_name').eq('id', id).single();
  return data;
}
async function vaultView(id) {
  const row = await vaultRow(id); if (!row) return;
  const { data, error } = await sb.storage.from('evidence').createSignedUrl(row.storage_path, 60);
  if (error) { toast('Could not open file'); return; }
  window.open(data.signedUrl, '_blank');
}
async function vaultDownload(id) {
  const row = await vaultRow(id); if (!row) return;
  const { data, error } = await sb.storage.from('evidence').createSignedUrl(row.storage_path, 60, { download: row.file_name });
  if (error) { toast('Could not download file'); return; }
  const a = document.createElement('a'); a.href = data.signedUrl; a.download = row.file_name; a.click();
}
async function vaultDelete(id) {
  if (guardArchived()) return;
  if (!confirm('Remove this file from the vault?')) return;
  const row = await vaultRow(id);
  if (row) await sb.storage.from('evidence').remove([row.storage_path]);
  await sb.from('evidence_files').delete().eq('id', id);
  if (row) logActivity('Removed evidence', row.file_name);
  renderVault(); updateTop();
}
async function cloudDeleteEngagementFiles(id) {
  if (!sb) return;
  const { data } = await sb.from('evidence_files').select('storage_path').eq('engagement_id', id);
  if (data && data.length) await sb.storage.from('evidence').remove(data.map(r => r.storage_path));
}
const fmtSize = b => b > 1048576 ? (b/1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b/1024)) + ' KB';
async function renderVault() {
  $('vault-cat').innerHTML = DOCCATS.map(c => `<option>${c}</option>`).join('');
  const files = await vaultListRows(S.id);
  _ticksCache = await ticksListAll(S.id);
  $('vault-grid').innerHTML = DOCCATS.map(cat => {
    const fs = files.filter(f => f.category === cat);
    return `
    <div class="card card-pad">
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold text-[13.5px]">${cat}</div>
        <div class="flex items-center gap-1.5">
          ${fs.length ? `<button class="btn btn-ghost !px-2 !py-1 !text-[11px]" onclick="vaultAnalyze('${esc(cat).replace(/'/g,"\\'")}')" title="AI reads every document filed in this category in full">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/></svg>
            Analyze with AI</button>` : ''}
          <span class="pill ${fs.length ? 'pill-ok':'pill-mut'}">${fs.length ? fs.length + ' filed' : 'outstanding'}</span>
        </div>
      </div>
      ${fs.map(f => `
        <div class="border-b border-line/60 last:border-0">
          <div class="flex items-center gap-2 py-1.5">
            <svg viewBox="0 0 24 24" width="15" height="15" class="flex-none" fill="none" stroke="#3B49C9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
            <button class="text-[12.5px] font-medium text-indigo hover:underline truncate flex-1 text-left" onclick="vaultView('${f.id}')" title="View ${esc(f.file_name)}">${esc(f.file_name)}</button>
            <span class="text-[11px] text-mut mono flex-none">${fmtSize(f.size_bytes)}</span>
            ${tickBadges(_ticksCache[f.id])}
            <button class="btn btn-ghost !px-1.5 !py-1 flex-none" onclick="vaultTickToggle('${f.id}')" aria-label="Tick-mark" title="Tick-mark this evidence">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </button>
            <button class="btn btn-ghost !px-1.5 !py-1 flex-none" onclick="vaultDownload('${f.id}')" aria-label="Download">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
            </button>
            <button class="btn btn-ghost !px-1.5 !py-1 flex-none" onclick="vaultDelete('${f.id}')" aria-label="Delete">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          ${vaultTickOpen === f.id ? `
          <div class="bg-paper rounded-lg p-2.5 mb-2 flex flex-wrap items-end gap-2">
            <div><label class="fieldlbl">Status</label>
              <select class="field !py-1.5 !text-[12px]" id="tick-status-${f.id}">
                <option value="agreed">Agreed — sighted &amp; agrees to GL</option>
                <option value="exception">Exception</option>
                <option value="query">Query raised</option>
              </select></div>
            <div><label class="fieldlbl">Initials</label><input class="field !py-1.5 !w-20 !text-[12px]" id="tick-initials-${f.id}" maxlength="6"></div>
            <div class="flex-1 min-w-[140px]"><label class="fieldlbl">Note</label><input class="field !py-1.5 !text-[12px]" id="tick-note-${f.id}" placeholder="optional"></div>
            <button class="btn btn-pri !py-1.5 !text-[12px]" onclick="vaultTickSave('${f.id}', '${esc(f.file_name).replace(/'/g,"\\'")}')">Save tick</button>
            ${(_ticksCache[f.id]||[]).length ? `<div class="w-full text-[11px] text-mut mt-1">${(_ticksCache[f.id]||[]).map(t=>`${dMY(t.tick_date)} · ${esc(t.status)} · ${esc(t.initials)}${t.note?` — ${esc(t.note)}`:''}`).join('<br>')}</div>` : ''}
          </div>` : ''}
        </div>`).join('') || `<div class="flex items-center gap-2 py-1 text-mut">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
          <span class="text-[12px]">Nothing filed yet — upload above.</span>
        </div>`}
      <div id="vault-analysis-${cat.replace(/[^\w]/g,'_')}"></div>
    </div>`;
  }).join('');
  staggerChildren('vault-grid', 45);
}
/* ---------- document intelligence: AI reads the actual filed evidence ---------- */
/* Attaches real files (native PDF/image reading via the edge function) rather
   than a filename link — the answer is grounded in what's actually on the
   page, and anything that can't be read is reported back explicitly, never
   silently dropped. */
async function vaultAnalyze(cat) {
  const slot = $('vault-analysis-' + cat.replace(/[^\w]/g,'_'));
  if (!slot) return;
  const files = (await vaultListRows(S.id)).filter(f => f.category === cat);
  if (!files.length) return;
  slot.innerHTML = `<div class="border border-indigo/30 rounded-xl p-3 mt-2 bg-white">
    <div class="flex items-center gap-2"><span class="pill pill-info">Mr Auditor AI</span>
    <span class="text-[12px] text-mut">reading ${files.length} document(s) in full…</span></div></div>`;
  try {
    const result = await aiRequestDocs(
      `Analyze every document filed under "${cat}" for this engagement. Extract the concrete facts an auditor needs: key figures, dates, parties, balances, terms, anomalies, or anything that contradicts the trial balance/context. Be specific and cite which document each fact comes from. End with a short list of follow-up questions or evidence still needed, if any.`,
      files.map(f => f.id));
    slot.innerHTML = `<div class="border border-indigo/30 rounded-xl p-3 mt-2 bg-white">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2"><span class="pill pill-info">Mr Auditor AI</span>
        <span class="text-[11px] text-mut">${result.documentsRead || 0} document(s) read in full</span></div>
        <button class="btn btn-ghost !py-1 !text-[11.5px]" onclick="vaultAnalyzeToWp('${cat.replace(/'/g,"\\'")}', this)">Add to a working paper</button>
      </div>
      ${result.skipped && result.skipped.length ? `<div class="text-[11.5px] text-warn mb-2">Not read: ${result.skipped.map(s=>`${esc(s.name)} (${esc(s.reason)})`).join('; ')}</div>` : ''}
      <div class="text-[13px] leading-relaxed" data-ai-text="${encodeURIComponent(result.answer||'')}">${aiFormat(result.answer || '')}</div>
    </div>`;
  } catch (e) {
    slot.innerHTML = `<div class="border border-line rounded-xl p-3 mt-2 text-[12.5px] text-mut">Could not analyze: ${esc(e.message||'unknown error')}</div>`;
  }
}
function vaultAnalyzeToWp(cat, btn) {
  const box = btn.closest('div.border').querySelector('[data-ai-text]');
  const text = decodeURIComponent(box.dataset.aiText);
  const ref = prompt('Which working paper reference should this be added to? (e.g. C, F, A5)');
  if (!ref) return;
  const existing = wpGet(`plan.notes.${ref}`, '');
  wpSet(`plan.notes.${ref}`, (existing ? existing + '\n\n' : '') + `[AI-drafted document analysis — ${cat}, ${dMY(dISO(new Date()))} — verify against source documents; this paper's sign-off covers the content]\n${text}`);
  toast(`Added to working paper ${ref}`);
}

/* ---------- Ask Mr Auditor — account intelligence ---------- */
/* Per-category auditor knowledge: assertions at risk, standard procedures, the trap. */
const KB = {
  REV:{a:'Occurrence · Completeness · Cut-off',t:'The double risk: overstated to impress the bank, or suppressed to dodge tax. ISA 240 presumes revenue fraud risk.',p:['Reconcile recorded sales to bank-in credits and to SST-02 / MyInvois data','Cut-off: test 2 weeks either side of year end against delivery orders','Margin-by-month analytics — flat margins with lumpy revenue is a red flag']},
  COS:{a:'Occurrence · Cut-off · Classification',t:'Purchases cut-off errors distort margin; personal purchases hide in here.',p:['Match year-end GRNs to supplier invoices (unrecorded liabilities search)','Vouch large/unusual suppliers — related-party purchases must surface','Test opening/closing stock inclusion in the cost build-up']},
  OTHINC:{a:'Occurrence · Classification',t:'Grants, disposals and rental often mis-posted; gains may be capital (not revenue).',p:['Vouch to agreements/receipts','Confirm tax treatment — capital gains vs income']},
  ADMIN:{a:'Occurrence · Classification · Accuracy',t:'The dumping ground. Directors\' personal expenses live here — s.39 ITA disallowables too.',p:['Scan the ledger for round sums, weekend dates, personal-sounding vendors','Extract entertainment, fines, donations for the tax computation','Vouch items above the testing threshold to invoices']},
  SELL:{a:'Occurrence · Accuracy',t:'Commissions may indicate undisclosed related parties or kickbacks.',p:['Vouch commission agreements and recipients','Match freight to sales activity']},
  DEPR:{a:'Accuracy · Valuation',t:'Rates must match policy and useful lives; a sudden change needs justification.',p:['Recompute from the fixed asset register','Compare charge/cost ratio year on year']},
  FIN:{a:'Completeness · Accuracy',t:'Interest proves debt: unrecorded facilities show up as unexplained interest.',p:['Recompute from facility letters and HP schedules','Agree to bank confirmations']},
  TAXEXP:{a:'Accuracy · Valuation',t:'Should tie to the tax computation, not a plug.',p:['Recompute using the Tax screen','Agree prior-year tax to the notice of assessment']},
  PPE:{a:'Existence · Valuation · Rights',t:'Ghost assets and missing registers are endemic in SMEs.',p:['Sight major assets; agree ownership documents (vehicles: registration cards)','Rebuild/verify the fixed asset register; test additions to invoices','Check capitalisation vs repairs policy']},
  ACCDEP:{a:'Accuracy · Valuation',t:'Depreciation past useful life or on disposed assets is common.',p:['Recompute; investigate NBV near zero but assets still in use (useful-life review)']},
  INTANG:{a:'Existence · Valuation',t:'Capitalised development costs rarely meet the recognition criteria in an SME.',p:['Challenge recognition basis','Test amortisation and impairment indicators']},
  INVEST:{a:'Existence · Valuation · Rights',t:'Related-company shares may be impaired if the investee is loss-making.',p:['Confirm holdings (share certs / broker statements)','Review investee FS for impairment']},
  INV:{a:'Existence · Valuation (NRV) · Cut-off',t:'The classic profit lever — closing stock up, profit up. ISA 501 demands count attendance when material.',p:['Attend or roll back the physical count','Test NRV: post-year-end selling prices vs cost on slow movers','Cut-off: last GRN/DO numbers either side of year end']},
  TR:{a:'Existence · Valuation (recoverability)',t:'Stale receivables mean impairment — or sales that never happened.',p:['Circularise major balances (ISA 505); test post-year-end receipts','Age the listing; challenge >90-day balances with no receipts','Look for credit notes issued just after year end (cut-off games)']},
  OR:{a:'Existence · Valuation',t:'Long-outstanding deposits/advances may be irrecoverable or disguised lending.',p:['Vouch deposits to agreements','Confirm recoverability of staff/other advances']},
  DIRADV:{a:'Rights · Valuation · Legality',t:'s.224/225 CA 2016 restricts loans to directors; LHDN deems s.140B interest. The most litigated SME balance.',p:['Signed director confirmation + repayment plan','Check board approval/shareholder ratification','Add deemed interest to the tax computation; assess impairment']},
  RPTREC:{a:'Existence · Valuation · Disclosure',t:'Support depends on the related company\'s ability to pay — check its FS.',p:['Confirm balance with the related party','Review counterparty solvency; disclose terms (MPERS s.33)']},
  FD:{a:'Existence · Rights',t:'FDs are often pledged as security — restricted cash must be disclosed.',p:['Bank confirmation incl. liens/pledges','Recompute interest income']},
  CASH:{a:'Existence · Completeness',t:'Bank reconciliations are the single most revealing SME working paper.',p:['Bank confirmations for ALL accounts (dormant ones hide surprises)','Test reconciling items: stale cheques, unexplained deposits-in-transit','Credit balances → reclassify to overdraft']},
  TP:{a:'Completeness · Cut-off',t:'Understatement risk: search for unrecorded liabilities, not just what\'s booked.',p:['Match post-year-end payments to the year they belong','Reconcile major supplier statements','Review debit balances in payables (misposted or recoverable?)']},
  OP:{a:'Completeness · Accuracy',t:'Missing accruals (bonuses, utilities, audit fee) understate liabilities.',p:['Review recurring expenses for missing year-end accruals','Agree EPF/SOCSO/PCB payables to statutory forms']},
  DIROWE:{a:'Completeness · Disclosure',t:'Usually the SME\'s lifeline financing — undocumented and repayable on demand (a going-concern lever).',p:['Director confirmation of balance and terms','Consider subordination letter if going concern depends on it']},
  RPTPAY:{a:'Completeness · Disclosure',t:'Terms and nature must be disclosed under MPERS s.33.',p:['Confirm with counterparty; check netting is not masking exposures']},
  OD:{a:'Completeness · Rights',t:'Check covenant compliance — breach can make long-term debt repayable now.',p:['Bank confirmation; review facility covenants']},
  BORR:{a:'Completeness · Classification · Disclosure',t:'Current/non-current split and covenant breaches change the whole liquidity picture.',p:['Bank confirmation + facility letters','Split maturities per repayment schedule','Check security disclosures match the charge register (SSM)']},
  HP:{a:'Completeness · Classification',t:'HP interest must unwind properly; the current portion is often missed.',p:['Recompute from HP schedules; split within/after 12 months']},
  TAXPAY:{a:'Completeness · Accuracy',t:'Should reconcile to the tax computation and CP204 payments.',p:['Reconcile: opening + charge − payments = closing','Check for unprovided prior-year assessments']},
  DEFTAX:{a:'Accuracy · Valuation',t:'Usually PPE timing differences; recognise only what is probable.',p:['Recompute from capital allowance vs NBV differences']},
  SC:{a:'Existence · Rights',t:'Must agree to SSM records — share issues need lodgements.',p:['Agree to s.78/s.51 SSM filings and the register of members']},
  RE:{a:'Accuracy',t:'Opening balance must tie to last year\'s closing — a mismatch means unposted prior-year adjustments.',p:['Agree opening RE to the signed prior-year FS']},
  DIV:{a:'Legality · Authorisation',t:'s.131/132 CA 2016: solvency test + available profits, or directors are personally liable.',p:['Sight the directors\' solvency resolution','Confirm distributable reserves at declaration date']},
  SUSP:{a:'All assertions',t:'A suspense balance is unaudited by definition — clear it or qualify.',p:['Obtain the breakdown; reclassify every item','Aggregate any unresolved remainder as a misstatement']},
};
function accountIntel(row) {
  const mat = materiality(); const m = mat.m;
  const cy = (num(row.dr) - num(row.cr)) * CAT[row.cat].side;
  const py = num(row.py);
  const varPct = py ? (cy - py) / Math.abs(py) * 100 : null;
  const matPct = mat.overall ? Math.abs(cy) / mat.overall * 100 : 0;
  const kb = KB[row.cat] || {a:'—', t:'No specific guidance — classify this account correctly first.', p:['Review classification']};
  const related = S.tb.length ? evaluate().open.filter(f => (WP_FINDING_CATS[f.id]||[]).includes(row.cat)) : [];
  return { row, cy, py, varPct, matPct, kb, related, mat };
}
function intelCardHTML(row) {
  const it = accountIntel(row);
  const sig = it.matPct >= 100 ? ['pill-risk','Material — full scope'] : it.matPct >= 50 ? ['pill-warn','Approaching materiality'] :
              it.matPct >= 10 ? ['pill-info','In scope — sample'] : ['pill-mut','Low significance'];
  return `
  <div class="border border-line rounded-xl p-3.5 bg-white">
    <div class="flex items-center gap-2 flex-wrap mb-1">
      <span class="font-bold text-[14px]">${esc(row.name)}</span>
      <span class="pill pill-mut">${CAT[row.cat].label}</span>
      <span class="pill ${sig[0]}">${sig[1]}</span>
    </div>
    <div class="flex items-end gap-5 my-2">
      <div><div class="kpi-lbl">This year</div><div class="mono font-semibold text-[17px]">${fmtRM(it.cy)}</div></div>
      <div><div class="kpi-lbl">Prior year</div><div class="mono text-[15px] text-mut">${it.py ? fmtRM(it.py) : '–'}</div></div>
      ${it.varPct !== null ? `<div><div class="kpi-lbl">Movement</div><div class="mono font-semibold text-[15px] ${Math.abs(it.varPct)>25?'text-warn':''}">${it.varPct>0?'+':''}${it.varPct.toFixed(1)}%</div></div>` : ''}
      <div><div class="kpi-lbl">vs materiality</div><div class="mono text-[15px]">${it.matPct.toFixed(0)}%</div></div>
    </div>
    <div class="text-[12px]"><span class="font-semibold text-indigo">Assertions at risk:</span> ${it.kb.a}</div>
    <p class="text-[12.5px] text-mut mt-1">${it.kb.t}</p>
    <div class="text-[12px] font-semibold mt-2 mb-1">Mr Auditor's procedures:</div>
    <ul class="text-[12.5px] space-y-0.5 list-disc pl-5">${it.kb.p.map(p=>`<li>${p}</li>`).join('')}</ul>
    ${it.related.length ? `<div class="mt-2 pt-2 border-t border-line">
      ${it.related.map(f=>`<div class="flex items-center gap-2 text-[12.5px]"><span class="pill ${f.sev==='high'||f.sev==='blocker'?'pill-risk':f.sev==='medium'?'pill-warn':'pill-info'}">${f.sev}</span> ${f.title}</div>`).join('')}
      <button class="btn btn-ghost !py-1 !text-[12px] mt-1.5" onclick="askClose(); show('audit')">Open in Audit Engine</button></div>` : ''}
  </div>`;
}
const ASK_TOPICS = {
  materiality: () => { if (!S.tb.length) return 'Import a trial balance first.'; const mt = materiality();
    return `Overall materiality <b class="mono">${fmtRM(mt.overall)}</b> (${mt.label}) · performance materiality <b class="mono">${fmtRM(mt.pm)}</b> · clearly trivial <b class="mono">${fmtRM(mt.trivial)}</b>. Benchmarks available: revenue ${fmtRM(Math.round(mt.benches.revenue.base*.01))}, PBT ${fmtRM(Math.round(mt.benches.pbt.base*.05))}, assets ${fmtRM(Math.round(mt.benches.assets.base*.015))}.`; },
  deadline: () => deadlines().map(d => `${d.label}: <b>${dMY(d.date)}</b> (${d.days<0?Math.abs(d.days)+'d overdue':d.days+'d left'})`).join('<br>') || 'Set the FYE first.',
  opinion: () => { if (!S.tb.length) return 'Import a trial balance first.'; const ev = evaluate();
    return `Mr Auditor recommends: <b>${OPINION_LABEL[ev.opinion]}</b>${ev.gc?' + Material Uncertainty (Going Concern)':''}.<br>${ev.why}`; },
  exemption: () => { const ex = exemptionAssess(); return ex ? ex.summary + (ex.qualifies!==undefined ? (ex.qualifies?' — may qualify.':' — audit required.') : '') : 'Set the FYE first.'; },
  tax: () => { if (!S.tb.length) return 'Import a trial balance first.'; const sme = smeEligible();
    return `${sme.ok ? 'SME rates apply: 15% / 17% / 24% tiers.' : 'Flat 24% — SME conditions not met.'} Open the Tax screen for the full computation.`; },
  'going concern': () => { if (!S.tb.length) return 'Import a trial balance first.'; const m = model();
    return `Equity ${fmtRM(m.equity)} · net current ${m.netCurrent>=0?'assets':'liabilities'} ${fmtRM(Math.abs(m.netCurrent))}. ${evaluate().gc ? 'Indicators present — obtain forecasts + support letters, consider MUGC.' : 'No primary indicators from the numbers.'}`; }
};
function askOpen() { $('ask-overlay').classList.remove('hidden'); $('ask-input').value=''; askSearch(); $('ask-input').focus(); }
function askClose() { $('ask-overlay').classList.add('hidden'); }
function askAccount(rowId) { askOpen(); const r = S.tb.find(x => x.id === rowId);
  if (r) { $('ask-input').value = r.name; askSearch(); } }
function askSearch() {
  const q = $('ask-input').value.trim().toLowerCase();
  const box = $('ask-results');
  if (!q) {
    box.innerHTML = `<div class="text-[12.5px] text-mut px-1 py-2">Try an account name (<b>receivables</b>, <b>director</b>, <b>stock</b>), a category, or a topic: ${Object.keys(ASK_TOPICS).map(t=>`<button class="pill pill-info !cursor-pointer mr-1" onclick="$('ask-input').value='${t}';askSearch()">${t}</button>`).join('')}</div>
    ${S.tb.length ? S.tb.slice(0,4).map(intelCardHTML).join('') : ''}`;
    return;
  }
  for (const [topic, fn] of Object.entries(ASK_TOPICS)) {
    if (topic.startsWith(q) || q.includes(topic)) {
      box.innerHTML = `<div class="border border-line rounded-xl p-3.5 bg-indigosoft text-[13px] leading-relaxed">${fn()}</div>` + aiCtaHTML();
      return;
    }
  }
  const hits = S.tb.filter(r => r.name.toLowerCase().includes(q) || CAT[r.cat].label.toLowerCase().includes(q)).slice(0,6);
  box.innerHTML = (hits.length ? hits.map(intelCardHTML).join('')
    : `<div class="text-[13px] text-mut px-1 py-3">No instant match for “${esc(q)}”. Topics: ${Object.keys(ASK_TOPICS).join(', ')}.</div>`)
    + aiCtaHTML();
}
function aiCtaHTML() {
  const q = $('ask-input').value.trim();
  if (q.length < 4) return '';
  return `<button class="btn btn-pri w-full !justify-start gap-2" onclick="askAI()">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>
    Ask Mr Auditor AI: “${esc(q.length > 60 ? q.slice(0,60) + '…' : q)}”
    <span class="ml-auto mono text-[10px] opacity-70">Enter</span>
  </button>`;
}

/* ---------- Ask Mr Auditor AI (Anthropic via Supabase Edge Function) ---------- */
function aiContext() {
  const m = S.tb.length ? model() : null;
  const ev = S.tb.length ? evaluate() : null;
  return {
    company: S.setup,
    directors: S.directors.map(d => d.name),
    keyFigures: m ? { revenue: m.revenue, grossProfit: m.gp, profitBeforeTax: m.pbt,
      totalAssets: m.totalAssets, equity: m.equity, netCurrentAssets: m.netCurrent,
      cash: m.nat.CASH, tradeReceivables: m.nat.TR, tradePayables: m.nat.TP,
      borrowings: m.nat.BORR + m.nat.HP + m.nat.OD, directorsAdvances: m.nat.DIRADV,
      owingToDirectors: m.nat.DIROWE } : null,
    materiality: ev ? { overall: ev.mat.overall, performance: ev.mat.pm, benchmark: ev.mat.label } : null,
    recommendedOpinion: ev ? { opinion: OPINION_LABEL[ev.opinion], why: ev.why, goingConcernFlag: ev.gc } : null,
    openFindings: ev ? ev.open.slice(0, 10).map(f => ({ severity: f.sev, area: f.area, title: f.title, law: f.law })) : [],
    deadlines: deadlines().map(d => ({ what: d.label, due: d.date, daysLeft: d.days })),
    trialBalance: S.tb.slice(0, 80).map(r => ({ account: r.name, class: CAT[r.cat].label,
      balance: Math.round((num(r.dr) - num(r.cr)) * CAT[r.cat].side), priorYear: num(r.py) || undefined })),
    adjustmentsPosted: S.adjustments.map(a => a.desc),
    intake: S.intake,
  };
}
/* Renders the AI's markdown-ish text as HTML. Handles GFM-style tables
   (header row + |---|---| separator) as real <table>s — before this, a
   table the AI wrote came through as literal "|||" because the separator
   row was neither stripped nor converted, just escaped and left on screen. */
function aiFormat(t) {
  const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = String(t ?? '').replace(/\r\n/g, '\n').split('\n');
  const isRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isRow(line) && lines[i + 1] !== undefined && isSep(lines[i + 1])) {
      const head = cells(line);
      let j = i + 2; const rows = [];
      while (j < lines.length && isRow(lines[j])) { rows.push(cells(lines[j])); j++; }
      html += `<table class="tbl my-2"><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      i = j; continue;
    }
    if (/^#{1,3}\s+/.test(line)) { html += `<span class="block font-bold text-[14px] mt-2">${inline(line.replace(/^#{1,3}\s+/, ''))}</span>`; i++; continue; }
    if (/^-{3,}\s*$/.test(line.trim())) { html += '<span class="block border-t border-line my-1"></span>'; i++; continue; }
    if (/^[-*]\s+/.test(line)) { html += `<span class="block pl-3">• ${inline(line.replace(/^[-*]\s+/, ''))}</span>`; i++; continue; }
    html += inline(line) + '<br>'; i++;
  }
  return html.replace(/(<br>){3,}/g, '<br><br>');
}
async function askAI() {
  const q = $('ask-input').value.trim();
  if (q.length < 4) return;
  const box = $('ask-results');
  if (!sb || !authUser) {
    box.insertAdjacentHTML('afterbegin', '<div class="border border-line rounded-xl p-3.5 text-[13px] text-mut">Sign in to use Mr Auditor AI.</div>');
    return;
  }
  const id = 'ai-' + Date.now();
  box.insertAdjacentHTML('afterbegin', `
    <div id="${id}" class="border border-indigo/30 rounded-xl p-3.5 bg-white">
      <div class="flex items-center gap-2">
        <span class="pill pill-info">Mr Auditor AI</span>
        <span class="text-[12.5px] text-mut">reading the engagement file…</span>
      </div>
    </div>`);
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Session expired — sign in again');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ask-mr-auditor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ question: q, context: aiContext() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || (res.status === 404
        ? 'The AI service is not deployed yet — deploy the ask-mr-auditor edge function.'
        : `AI service error (${res.status})`));
    }
    $(id).innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <span class="pill pill-info">Mr Auditor AI</span>
        <span class="text-[11px] text-mut">grounded in this engagement's data</span>
      </div>
      <div class="text-[13px] leading-relaxed">${aiFormat(data.answer || '')}</div>`;
  } catch (e) {
    const msg = /failed to fetch|networkerror/i.test(e.message || '')
      ? 'The AI service is not reachable — the ask-mr-auditor edge function may not be deployed yet.'
      : (e.message || 'Something went wrong — try again.');
    $(id).innerHTML = `
      <div class="flex items-center gap-2 mb-1"><span class="pill pill-warn">Mr Auditor AI</span></div>
      <div class="text-[12.5px] text-mut">${esc(msg)}</div>`;
  }
}

/* ---------- home / landing ---------- */
function renderHome() {
  // firm-wide KPIs
  const real = DB.clients.filter(c => c.setup.name || c.tb.length);
  let dueSoon = 0, openHigh = 0, ready = 0;
  const allDeadlines = [];
  const keep = S;
  for (const c of real) {
    S = c;
    try {
      for (const d of deadlines()) { allDeadlines.push({ ...d, client: c.setup.name || 'Untitled', cid: c.id });
        if (d.days >= 0 && d.days <= 60) dueSoon++; if (d.days < 0) dueSoon++; }
      if (c.tb.length) { const ev = evaluate();
        openHigh += ev.open.filter(f => ['blocker','high'].includes(f.sev)).length;
        if (ev.open.filter(f=>['blocker','high'].includes(f.sev)).length === 0 && c.sign.partner) ready++; }
    } catch(e) {}
  }
  S = keep;
  const kpi = (lbl, val, sub, tone='') => `
    <div class="card card-pad"><div class="kpi-lbl">${lbl}</div>
    <div class="kpi-val ${tone}">${val}</div><div class="text-[12px] text-mut mt-0.5">${sub}</div></div>`;
  $('home-kpis').innerHTML =
    kpi('Engagements', real.length, 'active audit files') +
    kpi('Deadlines ≤ 60 days', dueSoon, 'incl. overdue, all clients', dueSoon ? 'text-warn' : '') +
    kpi('High-risk findings', openHigh, 'open across the portfolio', openHigh ? 'text-risk' : 'text-ok') +
    kpi('Ready for signing', ready, 'cleared + partner named', ready ? 'text-ok' : '');
  animateKpis('home-kpis');

  allDeadlines.sort((a,b) => a.days - b.days);
  $('home-deadlines').innerHTML = allDeadlines.filter(d => d.days <= 90).slice(0, 8).map(d => `
    <div class="flex items-center gap-3 py-1.5 border-b border-line/60 last:border-0 cursor-pointer hover:bg-paper rounded-lg px-1"
         onclick="switchClient('${d.cid}'); show('dashboard')">
      <div class="min-w-0 flex-1">
        <div class="font-medium truncate">${d.label}</div>
        <div class="text-[11px] text-mut truncate">${esc(d.client)} · ${dMY(d.date)}</div>
      </div>${deadlineChip(d.days)}
    </div>`).join('') || '<div class="text-mut">Nothing due in the next 90 days — or no FYE set yet.</div>';

  // attention: worst finding per client
  const attention = [];
  for (const c of real) { S = c;
    try { if (c.tb.length) { const worst = evaluate().open.find(f => ['blocker','high'].includes(f.sev));
      if (worst) attention.push({ client: c.setup.name || 'Untitled', cid: c.id, f: worst }); } } catch(e) {}
  }
  S = keep;
  $('home-attention').innerHTML = attention.slice(0,6).map(a => `
    <div class="sevrow sev-${a.f.sev} pl-3 py-1.5 cursor-pointer hover:bg-paper rounded-r-lg"
         onclick="switchClient('${a.cid}'); show('audit')">
      <div class="font-medium text-[13px] truncate">${a.f.title}</div>
      <div class="text-[11.5px] text-mut truncate">${esc(a.client)}</div>
    </div>`).join('') || '<div class="text-mut">No high-risk findings anywhere. Enjoy it while it lasts.</div>';

  renderClients();
}

/* ---------- registration wizard ---------- */
let regStep = 1;
let regDraft = null;
const REG_ATTACH_CATS = ['Trial balance & management accounts','Prior-year FS & working papers','Bank statements & confirmations',
  'SSM & statutory records','Tax — CP204 / Form C / assessments','Fixed asset register & invoices','Others'];
function regOpen() {
  regStep = 1;
  regDraft = { directors:[{name:'',ic:''},{name:'',ic:''}], files:[] };
  show('register');
}
function renderRegister() {
  if (!regDraft) { regDraft = { directors:[{name:'',ic:''},{name:'',ic:''}], files:[] }; regStep = 1; }
  document.querySelectorAll('.wiz-step').forEach(s => s.classList.toggle('active', +s.dataset.step === regStep));
  document.querySelectorAll('.wiz-dot').forEach((d,i) => d.classList.toggle('on', i < regStep));
  $('wiz-stepinfo').textContent = `Step ${regStep} of 4`;
  $('wiz-back').style.visibility = regStep === 1 ? 'hidden' : 'visible';
  $('wiz-next').textContent = regStep === 4 ? 'Create engagement' : 'Continue';
  if (regStep === 2) regRenderDirectors();
  if (regStep === 4) regRenderAttach();
}
function regRenderDirectors() {
  $('r-directors').innerHTML = regDraft.directors.map((d,i) => `
    <div class="flex gap-2 items-center">
      <input class="field flex-1" value="${esc(d.name)}" placeholder="Director ${i+1} name"
        onchange="regDraft.directors[${i}].name=this.value">
      <input class="field mono !w-44" value="${esc(d.ic)}" placeholder="NRIC"
        onchange="regDraft.directors[${i}].ic=this.value">
      <button class="btn btn-ghost !px-2.5" onclick="regDraft.directors.splice(${i},1); regRenderDirectors()" aria-label="Remove director">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#D70015" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`).join('');
}
function regRenderAttach() {
  $('r-attach').innerHTML = REG_ATTACH_CATS.map((cat,i) => {
    const n = regDraft.files.filter(f => f.cat === cat).length;
    return `
    <div class="flex items-center gap-3 border border-line rounded-xl px-3.5 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="font-medium text-[13.5px]">${cat}</div>
        <div class="text-[11.5px] ${n?'text-ok font-medium':'text-mut'}">${n ? n + ' file(s) attached' : cat.startsWith('Trial')?'the Excel/CSV trial balance from SQL Account, AutoCount, UBS, Xero…':cat.startsWith('Prior')?'e.g. last year’s signed audit report':'optional now, add anytime'}</div>
      </div>
      <label class="btn btn-ghost !py-1.5 cursor-pointer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>
        Choose<input type="file" multiple class="hidden" onchange="regAttach(this, ${i})">
      </label>
    </div>`;
  }).join('');
}
function regAttach(input, catIdx) {
  for (const f of input.files) regDraft.files.push({ cat: REG_ATTACH_CATS[catIdx], file: f });
  input.value = '';
  regRenderAttach();
}
function regAddDirector(){ regDraft.directors.push({name:'',ic:''}); regRenderDirectors(); }
function regBack(){ if (regStep > 1) { regStep--; renderRegister(); } }
async function regNext() {
  if (regStep === 1) {
    // inline validation — the three fields the file cannot exist without
    let ok = true;
    for (const [id, err] of [['r-name','r-name-err'],['r-regno','r-regno-err'],['r-fye','r-fye-err']]) {
      const bad = !$(id).value.trim();
      $(err).classList.toggle('hidden', !bad);
      $(id).style.borderColor = bad ? '#D70015' : '';
      if (bad && ok) { $(id).focus(); ok = false; }
    }
    if (!ok) return;
  }
  if (regStep < 4) { regStep++; renderRegister(); return; }
  // finish: create the engagement from the whole wizard
  const g = id => $(id).value.trim();
  const c = newClient(g('r-name'));
  Object.assign(c.setup, { regno:g('r-regno'), incdate:g('r-incdate'), fye:g('r-fye'), activity:g('r-activity'),
    framework:g('r-framework'), capital:g('r-capital'), employees:g('r-employees'),
    firstaudit:g('r-firstaudit'), foreign:g('r-foreign'), address:g('r-address') });
  c.directors = regDraft.directors.filter(d => d.name.trim());
  c.intake = { finperson:g('r-finperson'), contact:g('r-contact'), email:g('r-email'), phone:g('r-phone'),
    prevauditor:g('r-prevauditor'), software:g('r-software'), banks:g('r-banks'), borrowings:g('r-borrowings'),
    sst:g('r-sst'), einvoice:g('r-einvoice'), bookkeeping:g('r-bookkeeping'), risknotes:g('r-risknotes') };
  saveState();
  let uploaded = 0;
  for (const { cat, file } of regDraft.files) { if (await vaultUploadOne(file, cat, c.id)) uploaded++; }
  // reset wizard fields for next time
  ['r-name','r-regno','r-incdate','r-fye','r-activity','r-address','r-capital','r-employees','r-finperson',
   'r-contact','r-email','r-phone','r-prevauditor','r-software','r-banks','r-risknotes'].forEach(id => $(id).value = '');
  regDraft = null;
  toast(`${c.setup.name} registered${uploaded ? ' · ' + uploaded + ' file(s) filed in the vault' : ''}`);
  show('dashboard');
}

/* ---------- auditor toolkit ---------- */
let tkTab = 'ca';
document.addEventListener('click', e => {
  const b = e.target.closest('.tk-tab'); if (!b) return;
  tkTab = b.dataset.tk;
  document.querySelectorAll('.tk-tab').forEach(x => { x.classList.toggle('btn-pri', x===b); x.classList.toggle('btn-ghost', x!==b); });
  renderToolkit();
});
const CA_CLASSES = [
  ['heavy','Heavy machinery / motor vehicles (commercial)',20,20],
  ['plant','General plant & machinery',20,14],
  ['office','Office equipment & furniture',20,10],
  ['computer','Computers & ICT equipment',20,20],
  ['motor','Motor vehicle (non-commercial — QE capped RM50k/RM100k)',20,20],
  ['building','Industrial building allowance',10,3],
];
function renderToolkit() {
  document.querySelectorAll('.tk-tab').forEach(x => { x.classList.toggle('btn-pri', x.dataset.tk===tkTab); x.classList.toggle('btn-ghost', x.dataset.tk!==tkTab); });
  const el = $('tk-render');
  if (tkTab === 'ca') return tkCA(el);
  if (tkTab === 'confirm') return tkConfirm(el);
  if (tkTab === 'bankin') return tkBankin(el);
  if (tkTab === 'lead') return tkLead(el);
  if (tkTab === 'roll') return tkRoll(el);
  if (tkTab === 'mbrs') return tkMbrs(el);
  if (tkTab === 'formc') return tkFormC(el);
  if (tkTab === 'data') return tkData(el);
}
/* ---------- Form C (e-C) prep sheet (F9) ---------- */
/* LHDN accepts Form C only through MyTax e-Filing — nothing can lodge it for
   you. What eats the tax preparer's time is assembling the numbers. This
   sheet lays out every figure the e-C asks for, straight from the audited,
   adjusted TB and the tax computation, in the order the form asks for them. */
function tkFormC(el) {
  if (!S.tb.length) { el.innerHTML = '<div class="card card-pad text-mut text-[13px]">Import a trial balance first.</div>'; return; }
  const tc = taxComputeCore();
  const m = tc.m;
  const ya = S.setup.fye ? new Date(S.setup.fye).getFullYear() : '—';
  const cp204 = tc.T('cp204');
  const bal = tc.tax - cp204;
  const basisStart = S.setup.fye ? dMY(addDays(addMonths(S.setup.fye, -12), 1)) : '[start]';
  const row = (ref, label, val, opt={}) => `<tr class="${opt.total?'fs-total':opt.line?'fs-line':''}">
    <td class="mono text-[11px] text-mut" style="width:70px">${ref}</td>
    <td class="${opt.indent?'pl-5':''}">${label}</td>
    <td class="num mono" style="width:130px">${typeof val === 'number' ? fmt(val, true) : esc(String(val))}</td></tr>`;
  el.innerHTML = `
  <div class="card card-pad no-print mb-4 flex items-start justify-between gap-3 flex-wrap">
    <div>
      <h2 class="font-bold text-[15px] mb-1">Form C (e-C) preparation sheet — YA ${ya}</h2>
      <p class="text-[12.5px] text-mut max-w-2xl">Every figure below flows live from the adjusted trial balance and the step-7 tax computation. Lodgement itself happens in <strong>MyTax e-Filing</strong> (s.77A: within 7 months of FYE) — this sheet is what you keep on file and key in. Refine the CA, add-backs and losses on the Tax screen first; this sheet follows automatically.</p>
    </div>
    <button class="btn btn-pri" onclick="window.print()">Print / PDF</button>
  </div>
  <div class="fs-doc">
    <div class="text-center mb-4">
      <div class="font-bold text-[16px]">${esc(S.setup.name) || '[Company]'}</div>
      <div class="text-[12.5px]">Form e-C data sheet — Year of Assessment ${ya}</div>
      <div class="text-[11.5px] text-mut">Basis period: ${basisStart} – ${dMY(S.setup.fye)} · prepared from the audited figures</div>
    </div>
    <table class="fs-doc" style="width:100%">
      <tr><td colspan="3" class="font-semibold pt-1">Part: Company particulars</td></tr>
      ${row('—','Company name', S.setup.name || '[name]')}
      ${row('—','Registration no. (SSM)', S.setup.regno || '[regno]')}
      ${row('—','Tax identification no. (TIN)', '[C ____________ — from LHDN records]')}
      ${row('—','Basis period', `${basisStart} – ${dMY(S.setup.fye)}`)}
      ${row('—','SME status (para 2A Sch 1: cap ≤RM2.5m, gross ≤RM50m)', tc.sme.ok ? 'YES — tiered 15/17/24%' : 'NO — flat 24%')}
      <tr><td colspan="3" class="font-semibold pt-3">Part: Statutory income from business</td></tr>
      ${row('C1','Profit/(loss) before taxation per audited FS', m.pbt)}
      ${row('+','Depreciation (book)', tc.dep, {indent:1})}
      ${tc.T('entertain') ? row('+','Entertainment — 50% disallowed (s.39(1)(l))', tc.T('entertain'), {indent:1}) : ''}
      ${tc.T('fines') ? row('+','Fines & penalties', tc.T('fines'), {indent:1}) : ''}
      ${tc.T('donations') ? row('+','Unapproved donations', tc.T('donations'), {indent:1}) : ''}
      ${tc.T('otherAdd') ? row('+','Other add-backs', tc.T('otherAdd'), {indent:1}) : ''}
      ${tc.T('bc') ? row('+','Balancing charge on disposals (per CA statement)', tc.T('bc'), {indent:1}) : ''}
      ${tc.dirAdvDeemed ? row('+','s.140B deemed interest on advances to directors', tc.dirAdvDeemed, {indent:1}) : ''}
      ${tc.T('exemptInc') ? row('−','Non-taxable / exempt income', -tc.T('exemptInc'), {indent:1}) : ''}
      ${row('','Adjusted income', tc.adjusted, {line:1})}
      ${row('−','Capital allowances absorbed (Sch 3 — per CA schedule)', -tc.T('ca'), {indent:1})}
      ${row('','Statutory business income', tc.afterCA, {line:1})}
      ${tc.T('losses') ? row('−','Unabsorbed business losses b/f (s.44(2), 10-YA limit)', -tc.T('losses'), {indent:1}) : ''}
      ${row('','CHARGEABLE INCOME', tc.ci, {total:1})}
      <tr><td colspan="3" class="font-semibold pt-3">Part: Tax computation</td></tr>
      ${tc.bands.map(b => row('', b[0], Math.round(b[1]), {indent:1})).join('')}
      ${row('','TAX CHARGEABLE', tc.tax, {total:1})}
      ${cp204 ? row('−','CP204 instalments paid for YA ' + ya, -cp204, {indent:1}) : ''}
      ${cp204 ? row('', bal >= 0 ? 'Balance of tax payable (due with the return)' : 'Tax overpaid — refund position', bal, {line:1}) : ''}
      <tr><td colspan="3" class="font-semibold pt-3">Part: Declarations & attachments checklist</td></tr>
      ${row('☐','Audited financial statements finalised & signed before filing', S.sign.partner ? 'partner named: ' + S.sign.partner : '[pending sign-off]')}
      ${row('☐','CP204 for the NEXT YA submitted (30 days before basis period)', '[check e-CP204]')}
      ${row('☐','Transfer pricing documentation (if related-party transactions ≥ thresholds)', (m.nat.RPTREC + m.nat.RPTPAY + m.nat.DIRADV + m.nat.DIROWE) > 0 ? 'RPT balances exist — confirm TP position' : 'n/a on the face of the TB')}
      ${row('☐','MyInvois e-invoicing compliance declared where applicable', '')}
      ${row('☐','Filed via MyTax by ' + (S.setup.fye ? dMY(addMonths(S.setup.fye, 7)) : '[FYE + 7 months]'), '')}
    </table>
    <p class="text-[11px] text-mut mt-3">Prepared by Mr Auditor from the adjusted trial balance — verify against the signed tax computation before e-Filing. s.140B deemed interest shown is indicative (average lending rate proxy); use the prescribed rate for the YA.</p>
  </div>`;
}
/* capital allowance schedule */
/* Full Schedule 3 asset computation with tax-written-down-value tracking —
   this is the Capital Allowance Statement (penyata elaun modal) an auditor
   expects to see behind the tax computation, not just a one-line CA figure.
   Disposals produce a balancing allowance (TWDV > proceeds) or balancing
   charge (proceeds > TWDV, capped at allowances previously claimed). */
function caCompute(a) {
  const cls = CA_CLASSES.find(c => c[0] === a.cls) || CA_CLASSES[1];
  let qe = num(a.cost);
  let capped = false;
  if (a.cls === 'motor' && qe > 100000) { qe = 100000; capped = true; }
  const prior = Math.min(num(a.priorClaimed), qe);   // allowances claimed in prior YAs
  const twdvBf = qe - prior;
  if (a.disposed === 'yes') {
    const proceeds = Math.min(num(a.proceeds), qe);  // s.35 Sch 3: proceeds restricted to QE
    const ba = Math.max(twdvBf - proceeds, 0);
    const bc = Math.min(Math.max(proceeds - twdvBf, 0), prior); // BC capped at allowances claimed
    return { qe, capped, twdvBf, ia:0, aa:0, ba, bc, claim: ba, twdvCf: 0, rate: cls, disposed: true };
  }
  const ia = a.isNew === 'yes' ? Math.round(qe * cls[2] / 100) : 0;
  const remaining = Math.max(qe - prior - ia, 0);
  const aa = Math.min(Math.round(qe * cls[3] / 100), remaining);
  const claim = ia + aa;
  return { qe, capped, twdvBf, ia, aa, ba:0, bc:0, claim, twdvCf: Math.max(qe - prior - claim, 0), rate: cls, disposed: false };
}
function caTotals() {
  let claim = 0, bc = 0;
  for (const a of S.caAssets) { const c = caCompute(a); claim += c.claim; bc += c.bc; }
  return { claim, bc };
}
/* The printable statement — shared by the Toolkit tab and the Tax screen,
   so the tax computation always carries its supporting schedule. */
function caStatementHTML() {
  if (!S.caAssets.length) return '';
  const t = caTotals();
  const ya = S.setup.fye ? new Date(S.setup.fye).getFullYear() : '—';
  return `
  <div class="fs-doc mt-4">
    <div class="font-bold text-[14px] mb-1">${esc(S.setup.name) || '[Company]'} — Capital Allowance Statement, YA ${ya} (Schedule 3, ITA 1967)</div>
    <table class="tbl">
      <thead><tr><th>Asset</th><th>Rate (IA/AA)</th><th class="num">QE</th><th class="num">TWDV b/f</th><th class="num">IA</th><th class="num">AA</th><th class="num">BA</th><th class="num">BC</th><th class="num">TWDV c/f</th></tr></thead>
      <tbody>${S.caAssets.map(a => { const c = caCompute(a); return `
        <tr><td>${esc(a.desc) || '[asset]'}${c.disposed ? ' <span class="pill pill-warn !text-[9px]">disposed</span>' : ''}${c.capped ? ' <span class="pill pill-warn !text-[9px]">QE capped</span>' : ''}</td>
        <td class="mono text-[11px]">${c.rate[2]}/${c.rate[3]}%</td>
        <td class="num mono">${fmt(c.qe, true)}</td><td class="num mono">${fmt(c.twdvBf, true)}</td>
        <td class="num mono">${fmt(c.ia, true)}</td><td class="num mono">${fmt(c.aa, true)}</td>
        <td class="num mono">${fmt(c.ba, true)}</td><td class="num mono">${fmt(c.bc, true)}</td>
        <td class="num mono">${fmt(c.twdvCf, true)}</td></tr>`; }).join('')}
      </tbody>
      <tfoot><tr class="font-semibold"><td colspan="4">Total — capital allowances (incl. balancing allowances)</td>
        <td colspan="3" class="num mono">${fmt(t.claim, true)}</td>
        <td class="num mono">${fmt(t.bc, true)}</td><td></td></tr></tfoot>
    </table>
    <p class="text-[11px] text-mut mt-1.5">Balancing charges are added back to adjusted income; allowances (including balancing allowances) are deducted. TWDV carried forward feeds next year's statement via the roll-forward tool.</p>
  </div>`;
}
function tkCA(el) {
  const t = caTotals();
  el.innerHTML = `
  <div class="card card-pad">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
      <h2 class="font-bold text-[15px]">Capital Allowance Statement — Schedule 3, ITA 1967</h2>
      <div class="flex gap-1.5">
        <span class="pill pill-info mono">Allowances ${fmtRM(t.claim)}</span>
        ${t.bc ? `<span class="pill pill-warn mono">Balancing charge ${fmtRM(t.bc)}</span>` : ''}
      </div>
    </div>
    <p class="text-[12.5px] text-mut mb-4">Per-asset with tax written-down value: IA in the year of acquisition, AA until fully claimed, and balancing allowance/charge on disposal (proceeds restricted to QE; BC capped at allowances claimed). Non-commercial vehicles: QE capped at RM100k (RM50k if cost &gt; RM150k — verify). "Claimed b/f" = total IA+AA claimed in prior YAs, from last year's statement.</p>
    <div class="overflow-x-auto"><table class="tbl min-w-[1000px]">
      <thead><tr><th class="w-[20%]">Asset</th><th class="w-[18%]">Class</th><th class="num">Cost (RM)</th><th>New this YA?</th><th class="num">Claimed b/f</th><th>Disposed?</th><th class="num">Proceeds</th><th class="num">TWDV b/f</th><th class="num">IA</th><th class="num">AA</th><th class="num">BA / (BC)</th><th class="num">TWDV c/f</th><th></th></tr></thead>
      <tbody>${S.caAssets.map((a,i) => { const c = caCompute(a); return `
        <tr>
          <td><input class="field !py-1.5 !text-[13px]" value="${esc(a.desc)}" placeholder="e.g. Scania prime mover" onchange="S.caAssets[${i}].desc=this.value; saveState()"></td>
          <td><select class="field !py-1.5 !text-[12px]" onchange="S.caAssets[${i}].cls=this.value; saveState(); renderToolkit()">
            ${CA_CLASSES.map(cl => `<option value="${cl[0]}" ${a.cls===cl[0]?'selected':''}>${cl[1]} (${cl[2]}/${cl[3]})</option>`).join('')}</select></td>
          <td class="num"><input class="field mono !py-1.5 !text-right !w-24" value="${a.cost?fmt(num(a.cost)):''}" onchange="S.caAssets[${i}].cost=this.value; saveState(); renderToolkit()"></td>
          <td><select class="field !py-1.5 !text-[12px] !w-16" onchange="S.caAssets[${i}].isNew=this.value; saveState(); renderToolkit()">
            <option value="no" ${a.isNew!=='yes'?'selected':''}>No</option><option value="yes" ${a.isNew==='yes'?'selected':''}>Yes</option></select></td>
          <td class="num"><input class="field mono !py-1.5 !text-right !w-20" value="${a.priorClaimed?fmt(num(a.priorClaimed)):''}" onchange="S.caAssets[${i}].priorClaimed=this.value; saveState(); renderToolkit()"></td>
          <td><select class="field !py-1.5 !text-[12px] !w-16" onchange="S.caAssets[${i}].disposed=this.value; saveState(); renderToolkit()">
            <option value="no" ${a.disposed!=='yes'?'selected':''}>No</option><option value="yes" ${a.disposed==='yes'?'selected':''}>Yes</option></select></td>
          <td class="num">${a.disposed==='yes' ? `<input class="field mono !py-1.5 !text-right !w-20" value="${a.proceeds?fmt(num(a.proceeds)):''}" onchange="S.caAssets[${i}].proceeds=this.value; saveState(); renderToolkit()">` : ''}</td>
          <td class="num mono">${fmt(c.twdvBf, true)}</td>
          <td class="num mono">${fmt(c.ia, true)}</td>
          <td class="num mono">${fmt(c.aa, true)}</td>
          <td class="num mono">${c.bc ? '(' + fmt(c.bc) + ')' : fmt(c.ba, true)}</td>
          <td class="num mono">${fmt(c.twdvCf, true)}${c.capped?' <span class="pill pill-warn !text-[9px]">capped</span>':''}</td>
          <td><button class="btn btn-ghost !px-1.5 !py-1" onclick="S.caAssets.splice(${i},1); saveState(); renderToolkit()" aria-label="Remove asset">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#D70015" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></td>
        </tr>`; }).join('') || '<tr><td colspan="13" class="text-center text-mut py-6">No assets yet — add from the fixed asset register.</td></tr>'}
      </tbody></table></div>
    <div class="flex flex-wrap gap-2 mt-3 no-print">
      <button class="btn btn-ghost" onclick="S.caAssets.push({id:nid(), desc:'', cls:'plant', cost:'', isNew:'no', priorClaimed:'', disposed:'no', proceeds:''}); saveState(); renderToolkit()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add asset</button>
      <button class="btn btn-pri" onclick="const t=caTotals(); S.tax.ca=String(t.claim); S.tax.bc=String(t.bc); S.tax._touched=true; saveState(); toast('Applied — allowances ' + fmtRM(t.claim) + (t.bc ? ', balancing charge ' + fmtRM(t.bc) : '')); show('tax')">
        Apply to tax computation</button>
      <button class="btn btn-ghost" onclick="window.print()">Print statement</button>
    </div>
    ${caStatementHTML()}
  </div>`;
}
/* confirmation letters */
let tkConfirmSel = { type:'bank', rowId:null };
function tkConfirm(el) {
  const CATS_BY_TYPE = { bank:['CASH','FD','BORR','OD','HP'], receivable:['TR'], director:['DIRADV','DIROWE'] };
  const rows = S.tb.filter(r => CATS_BY_TYPE[tkConfirmSel.type].includes(r.cat));
  const sel = rows.find(r => r.id === tkConfirmSel.rowId) || rows[0];
  const bal = sel ? (num(sel.dr) - num(sel.cr)) * CAT[sel.cat].side : 0;
  const fye = dMY(S.setup.fye);
  const firm = esc(S.sign.firm) || '[Audit firm]';
  const body = !sel ? '<p class="text-mut text-[13px]">No matching accounts on the trial balance for this letter type.</p>' :
    tkConfirmSel.type === 'bank' ? `
      <p>The Manager<br><strong>${esc(sel.name)}</strong><br>[Branch address]</p>
      <p><strong>RE: AUDIT CONFIRMATION — ${esc(S.setup.name).toUpperCase()} (${esc(S.setup.regno)})</strong></p>
      <p>Dear Sir/Madam,</p>
      <p>Our auditors, <strong>${firm}</strong>, are auditing our financial statements. Kindly furnish them directly with the following information relating to our company as at <strong>${fye}</strong>:</p>
      <p>1. Balances of all current, savings, fixed deposit and loan accounts (per our records: ${fmtRM(Math.abs(bal))});<br>
      2. Details of all banking facilities, interest rates and securities pledged;<br>
      3. Any liens, guarantees, contingent liabilities or amounts held as security;<br>
      4. Authorised signatories.</p>
      <p>This authorisation remains in force until revoked in writing. Please send your reply directly to ${firm}.</p>
      <p>Yours faithfully,<br><br><br>_____________________________<br><strong>${esc(S.directors[0]?.name) || '[Authorised signatory]'}</strong><br>Director, ${esc(S.setup.name)}</p>` :
    tkConfirmSel.type === 'receivable' ? `
      <p>[Customer name and address]</p>
      <p><strong>RE: AUDIT CONFIRMATION OF BALANCE — ${esc(S.setup.name).toUpperCase()}</strong></p>
      <p>Dear Sir/Madam,</p>
      <p>In connection with the audit of our financial statements, please confirm directly to our auditors, <strong>${firm}</strong>, the balance owing by you to us as at <strong>${fye}</strong>, which our records show as <strong>${fmtRM(Math.abs(bal))}</strong> (account: ${esc(sel.name)}).</p>
      <p>If the amount does not agree with your records, please provide details of the difference. This request is for confirmation purposes only and is not a demand for payment.</p>
      <p>Yours faithfully,<br><br><br>_____________________________<br><strong>${esc(S.directors[0]?.name) || '[Authorised signatory]'}</strong><br>Director, ${esc(S.setup.name)}</p>` : `
      <p><strong>${esc(S.directors[0]?.name) || '[Director name]'}</strong><br>[Address]</p>
      <p><strong>RE: CONFIRMATION OF AMOUNT ${bal >= 0 ? 'OWING BY YOU TO' : 'OWING TO YOU BY'} ${esc(S.setup.name).toUpperCase()}</strong></p>
      <p>Dear Sir/Madam,</p>
      <p>In connection with the audit of the financial statements of ${esc(S.setup.name)} for the financial year ended <strong>${fye}</strong>, please confirm directly to our auditors, <strong>${firm}</strong>, that the balance ${bal >= 0 ? 'owing by you to the Company' : 'owing by the Company to you'} as at that date was <strong>${fmtRM(Math.abs(bal))}</strong> (${esc(sel.name)}), and that this balance is non-trade in nature, unsecured, interest-free and repayable on demand [amend if terms differ].</p>
      <p>I confirm the above is correct:<br><br><br>_____________________________<br>Name / NRIC / Date</p>`;
  el.innerHTML = `
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div class="card card-pad no-print">
      <h2 class="font-bold text-[15px] mb-3">Confirmation letters (ISA 505)</h2>
      <label class="fieldlbl">Letter type</label>
      <select class="field mb-3" onchange="tkConfirmSel={type:this.value, rowId:null}; renderToolkit()">
        <option value="bank" ${tkConfirmSel.type==='bank'?'selected':''}>Bank confirmation request</option>
        <option value="receivable" ${tkConfirmSel.type==='receivable'?'selected':''}>Trade receivable circularisation</option>
        <option value="director" ${tkConfirmSel.type==='director'?'selected':''}>Director balance confirmation</option>
      </select>
      <label class="fieldlbl">Account</label>
      <select class="field mb-3" onchange="tkConfirmSel.rowId=this.value; renderToolkit()">
        ${rows.map(r => `<option value="${r.id}" ${sel && r.id===sel.id?'selected':''}>${esc(r.name)} — ${fmtRM(Math.abs((num(r.dr)-num(r.cr))*CAT[r.cat].side))}</option>`).join('') || '<option>none available</option>'}
      </select>
      <button class="btn btn-pri w-full" onclick="printSection('tk-letter')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
        Print / PDF letter</button>
      <p class="text-[11.5px] text-mut mt-3">Replies must go directly to the audit firm — never through the client (ISA 505 requirement).</p>
    </div>
    <div class="card card-pad lg:col-span-2 rep-doc" id="tk-letter">
      <p class="text-[12px] text-mut">[On ${esc(S.setup.name) || 'company'} letterhead — ${esc(S.setup.address) || 'registered address'}]</p>
      <p>${dMY(S.sign.date || dISO(new Date()))}</p>
      ${body}
    </div>
  </div>`;
}
/* ---------- bank statement line matcher (F8) + bank-in reconciliation ---------- */
/* Parses a bank statement (CSV/text locally; PDF/photo via the AI document
   reader), classifies every line by rule, reconciles customer receipts
   against recorded revenue, and pushes flagged lines straight into the
   query log. The classification is a starting point the auditor edits —
   the engine never silently decides what a transaction is. */
const BM_CLASSES = ['customer receipt','other credit','supplier payment','payroll','statutory (EPF/SOCSO/LHDN)',
  'financing (loan/HP)','director','rent','fuel/fleet','bank charges','internal transfer','unclassified'];
function bmClassify(desc, isCredit) {
  const d = String(desc || '').toLowerCase();
  const dirNames = S.directors.flatMap(x => (x.name || '').toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (/balance (b\/f|c\/f)|brought forward|carried forward/.test(d)) return null; // not a transaction
  if (/director/.test(d) || dirNames.some(n => d.includes(n))) return 'director';
  if (/epf|kwsp|socso|perkeso|\beis\b|lhdn|pcb\b|cukai|kastam|customs|sst\b/.test(d)) return 'statutory (EPF/SOCSO/LHDN)';
  if (/hire purchase|\bhp\b|instal|term loan|loan (repay|instal)|financ/.test(d)) return 'financing (loan/HP)';
  if (/payroll|salar|gaji|wages|bonus/.test(d)) return 'payroll';
  if (/rental|tenanc|\brent\b/.test(d)) return 'rent';
  if (/petron|shell|petronas|caltex|fleet|diesel|fuel/.test(d)) return 'fuel/fleet';
  if (/transfer to (own|fd)|sweep|fixed deposit placement|to fd\b/.test(d)) return 'internal transfer';
  if (/bank charge|service charge|commission|\bfee\b|interest charge/.test(d)) return 'bank charges';
  if (isCredit) return /ibg cr|inward|receipt|payment (from|recd)|deposit|collection|cr -/.test(d) ? 'customer receipt' : 'customer receipt';
  return 'supplier payment';
}
function bmParseText(text) {
  // header-aware CSV/tab parser; falls back to date+amount line scanning
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let cols = null; const rows = [];
  for (const line of lines) {
    const parts = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(p => p.replace(/^"|"$/g, '').trim());
    const lower = parts.map(p => p.toLowerCase());
    if (!cols && lower.some(p => /^date/.test(p)) && lower.some(p => /debit|credit|amount/.test(p))) {
      cols = { date: lower.findIndex(p => /^date/.test(p)), desc: lower.findIndex(p => /desc|particular|transaction/.test(p)),
        dr: lower.findIndex(p => /debit/.test(p)), cr: lower.findIndex(p => /credit/.test(p)) };
      continue;
    }
    const dateM = line.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
    if (!dateM) continue;
    // statement headers carry dates too ("Period: 01/12/2025 - ...") — never transactions
    if (/account\s*:|period\s*:|statement|page \d/i.test(line)) continue;
    let desc, dr = 0, cr = 0;
    if (cols) {
      desc = parts[cols.desc >= 0 ? cols.desc : 1] || '';
      dr = cols.dr >= 0 ? num(parts[cols.dr]) : 0;
      cr = cols.cr >= 0 ? num(parts[cols.cr]) : 0;
    } else {
      desc = parts.filter(p => !/^\d[\d,.\/]*$/.test(p) && p !== dateM[1]).join(' ');
      const nums = parts.map(num).filter(n => n > 0 && n < 100000000); // account numbers are not amounts
      if (!nums.length) continue;
      cr = nums[0]; // single-amount fallback: treated as credits (bank-in use case)
    }
    if (!dr && !cr) continue;
    const cls = bmClassify(desc, cr > 0);
    if (cls === null) continue;
    rows.push({ date: dateM[1], desc, dr, cr, cls });
  }
  return rows;
}
function bmIsWeekend(dstr) {
  const m = String(dstr).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return false;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  const day = new Date(`${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}T00:00:00`).getDay();
  return day === 0 || day === 6;
}
async function bmLoadVaultFile(id) {
  const rowMeta = (await vaultListRows(S.id)).find(f => f.id === id);
  if (!rowMeta) { toast('File not found'); return; }
  const isText = /\.(csv|txt)$/i.test(rowMeta.file_name) || /^text\//.test(rowMeta.mime_type || '');
  const st = $('bm-status');
  if (st) st.textContent = isText ? 'Parsing…' : 'AI is reading the statement — every line, ±60 seconds…';
  try {
    let rows;
    if (isText) {
      const { data, error } = await sb.storage.from('evidence').download(rowMeta.storage_path);
      if (error) throw new Error('could not download the file');
      rows = bmParseText(await data.text());
    } else {
      const r = await aiRequestDocs(
        'Extract EVERY transaction line from this bank statement as a JSON array and output ONLY the JSON, no commentary: [{"date":"dd/mm/yyyy","desc":"...","dr":0,"cr":0}] where dr is the debit amount and cr the credit amount in plain numbers. Include every line, skip only balance b/f and c/f rows.', [id]);
      const mJson = r.answer.match(/\[[\s\S]*\]/);
      if (!mJson) throw new Error('AI did not return a parseable line listing — open the file and paste the lines instead');
      rows = JSON.parse(mJson[0]).map(x => ({ date: x.date, desc: x.desc, dr: num(x.dr), cr: num(x.cr), cls: bmClassify(x.desc, num(x.cr) > 0) }))
        .filter(x => x.cls !== null && (x.dr || x.cr));
    }
    if (!rows.length) throw new Error('no transaction lines recognised');
    S.bankmatch = { srcName: rowMeta.file_name, rows };
    saveState();
    logActivity('Matched bank statement lines', `${rowMeta.file_name} — ${rows.length} line(s)`);
    renderToolkit();
  } catch (e) {
    const st2 = $('bm-status');
    if (st2) st2.textContent = 'Could not read: ' + (e.message || 'unknown error');
    else toast('Could not read: ' + (e.message || 'unknown error'));
  }
}
function bmPaste() {
  const rows = bmParseText($('bm-paste').value);
  if (!rows.length) { toast('No lines with a date and an amount found'); return; }
  S.bankmatch = { srcName: 'pasted statement', rows };
  saveState(); renderToolkit();
}
function bmSetCls(i, v) { S.bankmatch.rows[i].cls = v; saveState(); renderToolkit(); }
async function bmRaiseQuery(i) {
  const r = S.bankmatch.rows[i];
  await queryAdd('query', `Bank statement (${S.bankmatch.srcName}) ${r.date}: "${r.desc}" ${r.dr ? 'DR ' + fmt(r.dr) : 'CR ' + fmt(r.cr)} — please explain the nature of this transaction and provide supporting documents.`, null, 'C');
  toast('Raised in the query log');
}
function bmPushToTest() {
  const rows = (S.bankmatch || {}).rows || [];
  const credits = rows.reduce((s, r) => s + r.cr, 0);
  const nonSales = rows.filter(r => r.cr && r.cls !== 'customer receipt').reduce((s, r) => s + r.cr, 0);
  S.bankin.credits = String(Math.round(num(S.bankin.credits) + credits));
  S.bankin.nonSales = String(Math.round(num(S.bankin.nonSales) + nonSales));
  saveState(); renderToolkit();
  toast(`Added ${fmtRM(credits)} credits (${fmtRM(nonSales)} non-sales) to the bank-in test`);
}
/* ---------- missing-transaction detector (statement vs cash book) ---------- */
/* The practitioner's headache: the bank statement shows transactions the
   client never recorded, and someone has to find them line by line and key
   the entries back in. Load the client's cash book export next to the parsed
   statement; every statement line with no cash-book match is an unrecorded
   transaction. One click reconstructs the ENTRIES (as an audit adjustment,
   supported by the bank statement itself — proper third-party evidence) and
   prints the reconstruction working paper. The system does not fabricate
   invoices: the missing source documents are requested from the client via
   the query log instead. */
const BM_RECON_CAT = { 'customer receipt':'REV', 'other credit':'OTHINC', 'supplier payment':'ADMIN',
  'payroll':'ADMIN', 'statutory (EPF/SOCSO/LHDN)':'ADMIN', 'financing (loan/HP)':'BORR',
  'rent':'ADMIN', 'fuel/fleet':'COS', 'bank charges':'ADMIN', 'unclassified':'SUSP' };
function bmDateVal(dstr) {
  const m = String(dstr).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return new Date(`${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}T00:00:00`).getTime();
}
async function bmLoadCashbook(src) {
  let rows, name;
  if (src === 'paste') {
    rows = bmParseText($('bm-cb-paste').value); name = 'pasted cash book';
  } else {
    const meta = (await vaultListRows(S.id)).find(f => f.id === src);
    if (!meta) { toast('File not found'); return; }
    const { data, error } = await sb.storage.from('evidence').download(meta.storage_path);
    if (error) { toast('Could not download the file'); return; }
    rows = bmParseText(await data.text()); name = meta.file_name;
  }
  if (!rows.length) { toast('No lines with a date and an amount recognised'); return; }
  S.bankmatch.cb = { name, rows };
  bmReconcile();
  saveState(); renderToolkit();
}
function bmReconcile() {
  const stmt = (S.bankmatch || {}).rows || [];
  const cb = ((S.bankmatch || {}).cb || {}).rows || [];
  const WINDOW = 5 * 86400000;                 // ±5 days
  const used = new Set();
  for (const r of stmt) {
    r.matched = false;
    const amt = r.dr || r.cr, dv = bmDateVal(r.date);
    for (let j = 0; j < cb.length; j++) {
      if (used.has(j)) continue;
      const c = cb[j], cAmt = c.dr || c.cr;
      if (Math.abs(cAmt - amt) > 0.01) continue;
      const cdv = bmDateVal(c.date);
      if (dv && cdv && Math.abs(dv - cdv) > WINDOW) continue;
      r.matched = true; c.matched = true; used.add(j); break;
    }
  }
}
function bmUnmatched() {
  const stmt = ((S.bankmatch || {}).rows || []).filter(r => !r.matched && r.cls !== 'internal transfer');
  const cbRows = (((S.bankmatch || {}).cb || {}).rows || []).filter(c => !c.matched);
  return { stmt, cbRows };
}
function bmReconstruct() {
  if (guardArchived()) return;
  const { stmt } = bmUnmatched();
  if (!stmt.length) { toast('Nothing to reconstruct — every statement line is matched'); return; }
  // one balanced AJE: per-class P&L/BS lines with cash as the balancing leg
  const agg = {};   // cat -> raw amount (+dr / -cr)
  let cashNet = 0;  // raw movement on CASH
  for (const r of stmt) {
    let cat = BM_RECON_CAT[r.cls];
    if (r.cls === 'director') cat = r.cr > 0 ? 'DIROWE' : 'DIRADV';
    if (!cat) continue;
    if (r.cr > 0) { cashNet += r.cr; agg[cat] = (agg[cat] || 0) - r.cr; }   // money in: Dr cash, Cr class
    else          { cashNet -= r.dr; agg[cat] = (agg[cat] || 0) + r.dr; }   // money out: Cr cash, Dr class
  }
  const entries = Object.entries(agg).map(([cat, amt]) => ({ cat, label: CAT[cat].label, amt }));
  entries.push({ cat:'CASH', label:'Cash and bank balances', amt: cashNet });
  S.adjustments.push({ id: nid(), manual: true,
    desc: `Reconstruct ${stmt.length} unrecorded transaction(s) per ${S.bankmatch.srcName} (see reconstruction working paper)`,
    entries });
  logActivity('Reconstructed unrecorded transactions', `${stmt.length} line(s) from ${S.bankmatch.srcName}, net cash ${fmtRM(Math.abs(cashNet))}`);
  saveState(); renderToolkit(); updateTop();
  toast(`${stmt.length} unrecorded transaction(s) posted as one adjustment — FS updated`);
}
async function bmMissingDocsQuery() {
  const { stmt } = bmUnmatched();
  if (!stmt.length) return;
  const list = stmt.map(r => `${r.date} "${r.desc}" ${r.dr ? 'DR ' + fmt(r.dr) : 'CR ' + fmt(r.cr)}`).join('; ');
  await queryAdd('query',
    `Unrecorded transactions found on ${S.bankmatch.srcName} with no entry in the cash book — please provide the source documents (invoices/receipts/vouchers) and explain why they were not recorded: ${list}`,
    null, 'C');
  toast('Query raised for the missing source documents');
}
function bmReconWpHTML() {
  const { stmt } = bmUnmatched();
  if (!stmt.length) return '';
  return `
  <div class="fs-doc mt-3">
    <div class="font-bold text-[14px] mb-1">${esc(S.setup.name)} — Reconstruction of unrecorded transactions (ref C)</div>
    <div class="text-[11.5px] text-mut mb-2">Source: ${esc(S.bankmatch.srcName)} vs ${esc((S.bankmatch.cb||{}).name || 'cash book')} · amount-and-date matching (±5 days). Audit evidence for each entry is the bank statement line itself (third-party document); client source documents requested via the query log.</div>
    <table class="tbl">
      <thead><tr><th>Date</th><th>Statement description</th><th class="num">DR</th><th class="num">CR</th><th>Recorded as</th></tr></thead>
      <tbody>${stmt.map(r => { let cat = BM_RECON_CAT[r.cls]; if (r.cls === 'director') cat = r.cr > 0 ? 'DIROWE' : 'DIRADV';
        return `<tr><td class="mono text-[11px]">${esc(r.date)}</td><td class="text-[12px]">${esc(r.desc)}</td>
        <td class="num mono">${r.dr ? fmt(r.dr) : ''}</td><td class="num mono">${r.cr ? fmt(r.cr) : ''}</td>
        <td class="text-[12px]">${cat ? (r.cr > 0 ? 'Dr Cash / Cr ' : 'Dr ') + CAT[cat].label + (r.cr > 0 ? '' : ' / Cr Cash') : 'excluded'}</td></tr>`; }).join('')}
      </tbody></table>
  </div>`;
}
function tkBankin(el) {
  const m = S.tb.length ? model() : null;
  const b = S.bankin || {};
  const credits = num(b.credits), nonSales = num(b.nonSales);
  const netBankIn = credits - nonSales;
  const recorded = m ? m.revenue + m.othinc : 0;
  const gap = netBankIn - recorded;
  const gapPct = recorded ? gap / recorded * 100 : 0;
  const verdict = !credits ? null : Math.abs(gapPct) <= 5 ? ['pill-ok','Within 5% — reasonable'] :
    Math.abs(gapPct) <= 15 ? ['pill-warn','5–15% gap — obtain explanations'] : ['pill-risk','>15% gap — revenue completeness risk'];
  const bm = S.bankmatch || {};
  const bmRows = bm.rows || [];
  const bmCr = bmRows.reduce((s,r)=>s+r.cr,0), bmDr = bmRows.reduce((s,r)=>s+r.dr,0);
  const byCls = {};
  for (const r of bmRows) byCls[r.cls] = (byCls[r.cls]||0) + r.cr + r.dr;
  const flagged = bmRows.map((r,i)=>({...r,i})).filter(r => r.cls === 'director' || r.cls === 'unclassified' || (bmIsWeekend(r.date) && r.dr > 0));
  bankmatchHTML(el, { m, b, credits, nonSales, netBankIn, recorded, gap, gapPct, verdict, bm, bmRows, bmCr, bmDr, byCls, flagged });
}
async function bankmatchHTML(el, v) {
  let vaultOpts = '', cbOpts = '';
  try {
    const all = await vaultListRows(S.id);
    vaultOpts = all.filter(f => f.category === 'Bank statements & confirmations')
      .map(f => `<option value="${f.id}">${esc(f.file_name)}</option>`).join('');
    // cash book / ledger exports can be filed anywhere — offer every text file
    cbOpts = all.filter(f => /\.(csv|txt)$/i.test(f.file_name))
      .map(f => `<option value="${f.id}">${esc(f.file_name)}</option>`).join('');
  } catch(e) {}
  el.innerHTML = `
  <div class="card card-pad mb-4">
    <h2 class="font-bold text-[15px] mb-1">Bank statement line matcher</h2>
    <p class="text-[12.5px] text-mut mb-3">Pick a statement from the vault (CSV parses instantly; PDF and photos are read line-by-line by the AI) or paste lines. Every transaction is classified — correct any line, push the totals into the bank-in test below, and raise flagged lines as queries with one click.</p>
    <div class="flex flex-wrap items-end gap-2 mb-2 no-print">
      ${vaultOpts ? `<div><label class="fieldlbl">From the evidence vault</label>
        <select class="field !w-72" id="bm-vault">${vaultOpts}</select></div>
      <button class="btn btn-pri" onclick="bmLoadVaultFile($('bm-vault').value)">Read &amp; match</button>` :
      '<span class="text-[12.5px] text-mut">No files under “Bank statements &amp; confirmations” yet — upload to the vault, or paste below.</span>'}
      <span id="bm-status" class="text-[12px] text-mut"></span>
    </div>
    <details class="mb-2"><summary class="text-[12.5px] text-indigo cursor-pointer">…or paste statement lines</summary>
      <textarea class="field mono !text-[12px] mt-2" id="bm-paste" rows="5" placeholder="01/12/2025, IBG CR - CUSTOMER SB, , 48200.00${'\n'}05/12/2025, FLEET CARD SETTLEMENT, 231800.00, "></textarea>
      <button class="btn btn-ghost mt-2" onclick="bmPaste()">Parse pasted lines</button>
    </details>
    ${v.bmRows.length ? `
    <div class="flex flex-wrap gap-2 items-center mb-2">
      <span class="pill pill-info">${esc(v.bm.srcName)} · ${v.bmRows.length} lines</span>
      <span class="pill pill-ok mono">credits ${fmtRM(v.bmCr)}</span>
      <span class="pill pill-mut mono">debits ${fmtRM(v.bmDr)}</span>
      ${v.flagged.length ? `<span class="pill pill-warn">${v.flagged.length} flagged</span>` : ''}
      <button class="btn btn-mint !py-1.5 !text-[12px] ml-auto" onclick="bmPushToTest()">Add credits to the bank-in test ↓</button>
    </div>
    <div style="max-height:340px;overflow-y:auto">
    <table class="tbl"><thead><tr><th>Date</th><th>Description</th><th class="num">DR</th><th class="num">CR</th><th>Classified as</th><th></th></tr></thead>
    <tbody>${v.bmRows.map((r,i) => {
      const flag = r.cls === 'director' || r.cls === 'unclassified' || (bmIsWeekend(r.date) && r.dr > 0);
      return `<tr class="${flag ? 'bg-warnbg/40' : ''}">
        <td class="mono text-[11px]">${esc(r.date)}${bmIsWeekend(r.date) ? ' <span class="pill pill-warn !text-[9px]">w/e</span>' : ''}</td>
        <td class="text-[12px]">${esc(r.desc)}</td>
        <td class="num mono text-[12px]">${r.dr ? fmt(r.dr) : ''}</td>
        <td class="num mono text-[12px]">${r.cr ? fmt(r.cr) : ''}</td>
        <td><select class="field !py-0.5 !text-[11.5px] !w-44" onchange="bmSetCls(${i}, this.value)">
          ${BM_CLASSES.map(c => `<option ${r.cls===c?'selected':''}>${c}</option>`).join('')}</select></td>
        <td>${flag ? `<button class="btn btn-ghost !py-0.5 !px-1.5 !text-[11px]" onclick="bmRaiseQuery(${i})">Raise query</button>` : ''}</td>
      </tr>`; }).join('')}</tbody></table></div>
    <div class="flex flex-wrap gap-1.5 mt-2">${Object.entries(v.byCls).sort((a,b)=>b[1]-a[1]).map(([c,amt]) =>
      `<span class="pill pill-mut !text-[11px] mono">${c}: ${fmtRM(amt)}</span>`).join('')}</div>` : ''}
  </div>
  ${v.bmRows.length ? (() => {
    const cb = (v.bm.cb || {});
    const un = bmUnmatched();
    return `
  <div class="card card-pad mb-4">
    <h2 class="font-bold text-[15px] mb-1">Missing-transaction detector</h2>
    <p class="text-[12.5px] text-mut mb-3">Load the client's <strong>cash book / bank ledger export</strong> (from SQL Account, AutoCount, UBS — any CSV with date and amount columns). Every statement line with no matching entry is an unrecorded transaction — the system reconstructs the entries in one click, supported by the bank statement itself, and requests the missing invoices from the client via the query log. <em>It reconstructs entries, never source documents.</em></p>
    <div class="flex flex-wrap items-end gap-2 mb-2 no-print">
      ${cbOpts ? `<div><label class="fieldlbl">Cash book from the vault</label>
        <select class="field !w-72" id="bm-cb-vault">${cbOpts}</select></div>
      <button class="btn btn-pri" onclick="bmLoadCashbook($('bm-cb-vault').value)">Match against statement</button>` : ''}
    </div>
    <details class="mb-2"><summary class="text-[12.5px] text-indigo cursor-pointer">…or paste cash book lines</summary>
      <textarea class="field mono !text-[12px] mt-2" id="bm-cb-paste" rows="5" placeholder="Date, Description, Debit, Credit — one line per entry"></textarea>
      <button class="btn btn-ghost mt-2" onclick="bmLoadCashbook('paste')">Parse &amp; match</button>
    </details>
    ${cb.rows ? `
    <div class="flex flex-wrap gap-2 items-center mb-2">
      <span class="pill pill-info">${esc(cb.name)} · ${cb.rows.length} entries</span>
      <span class="pill ${un.stmt.length ? 'pill-risk' : 'pill-ok'}">${un.stmt.length ? un.stmt.length + ' in the BANK but NOT in the books' : 'every statement line matched'}</span>
      ${un.cbRows.length ? `<span class="pill pill-warn">${un.cbRows.length} in the books but not on this statement</span>` : ''}
    </div>
    ${un.stmt.length ? `
    <table class="tbl"><thead><tr><th>Date</th><th>Statement line (unrecorded)</th><th class="num">DR</th><th class="num">CR</th><th>Will be recorded as</th></tr></thead>
    <tbody>${un.stmt.map(r => { let cat = BM_RECON_CAT[r.cls]; if (r.cls === 'director') cat = r.cr > 0 ? 'DIROWE' : 'DIRADV';
      return `<tr class="bg-warnbg/40"><td class="mono text-[11px]">${esc(r.date)}</td><td class="text-[12px]">${esc(r.desc)}</td>
      <td class="num mono text-[12px]">${r.dr ? fmt(r.dr) : ''}</td><td class="num mono text-[12px]">${r.cr ? fmt(r.cr) : ''}</td>
      <td class="text-[11.5px]">${cat ? (r.cr > 0 ? 'Dr Cash / Cr ' + CAT[cat].label : 'Dr ' + CAT[cat].label + ' / Cr Cash') : 'excluded (internal)'}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="flex flex-wrap gap-2 mt-3 no-print">
      <button class="btn btn-mint" onclick="bmReconstruct()">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        Reconstruct ${un.stmt.length} entr${un.stmt.length===1?'y':'ies'} (one adjustment)</button>
      <button class="btn btn-ghost" onclick="bmMissingDocsQuery()">Request the missing invoices (query log)</button>
      <button class="btn btn-ghost" onclick="window.print()">Print reconstruction working paper</button>
    </div>
    ${bmReconWpHTML()}` : ''}
    ${un.cbRows.length ? `<details class="mt-3"><summary class="text-[12.5px] text-indigo cursor-pointer">${un.cbRows.length} cash-book entr${un.cbRows.length===1?'y':'ies'} not on this statement (unpresented items / other accounts / errors)</summary>
      <table class="tbl mt-2"><tbody>${un.cbRows.slice(0,30).map(c => `<tr><td class="mono text-[11px]">${esc(c.date)}</td><td class="text-[12px]">${esc(c.desc)}</td><td class="num mono text-[12px]">${fmt(c.dr || c.cr)}</td></tr>`).join('')}</tbody></table></details>` : ''}` : ''}
  </div>`; })() : ''}
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="card card-pad">
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="card card-pad">
      <h2 class="font-bold text-[15px] mb-1">Bank-in vs recorded revenue</h2>
      <p class="text-[12.5px] text-mut mb-4">The 老板 test: total credits into ALL bank accounts should explain recorded revenue. Feed it from the line matcher above, paste the credit column, or enter the year's total.</p>
      <label class="fieldlbl">Paste credit amounts (one per line)</label>
      <textarea class="field mono !text-[12px]" id="bk-paste" rows="6" placeholder="12,500.00&#10;8,340.50&#10;..."></textarea>
      <button class="btn btn-ghost mt-2 mb-4" onclick="const t=$('bk-paste').value.split(/\\n/).map(x=>num(x)).filter(x=>x>0).reduce((s,x)=>s+x,0); S.bankin.credits=String(Math.round(t)); saveState(); renderToolkit()">Sum the paste → total</button>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label class="fieldlbl">Total bank credits for the year (RM)</label><input class="field mono" value="${v.b.credits?fmt(num(v.b.credits)):''}" onchange="S.bankin.credits=this.value; saveState(); renderToolkit()"></div>
        <div><label class="fieldlbl">Less: non-sales credits (transfers, loans, capital)</label><input class="field mono" value="${v.b.nonSales?fmt(num(v.b.nonSales)):''}" onchange="S.bankin.nonSales=this.value; saveState(); renderToolkit()"></div>
      </div>
    </div>
    <div class="card card-pad">
      <h2 class="font-bold text-[15px] mb-3">Verdict</h2>
      ${!v.m ? '<div class="text-mut text-[13px]">Import a trial balance first.</div>' : `
      <table class="fs-doc" style="width:100%">
        <tr><td>Total bank credits</td><td class="num" style="width:130px">${fmt(v.credits, true)}</td></tr>
        <tr><td>Less: non-sales credits</td><td class="num">${fmt(-v.nonSales, true)}</td></tr>
        <tr class="fs-line"><td>Net business bank-in</td><td class="num">${fmt(v.netBankIn, true)}</td></tr>
        <tr><td>Recorded revenue + other income</td><td class="num">${fmt(v.recorded, true)}</td></tr>
        <tr class="fs-total"><td>Gap ${v.credits ? '(' + v.gapPct.toFixed(1) + '%)' : ''}</td><td class="num">${fmt(v.gap, true)}</td></tr>
      </table>
      ${v.verdict ? `<div class="mt-4 flex items-center gap-2"><span class="pill ${v.verdict[0]} !text-[13px] !px-3 !py-1">${v.verdict[1]}</span></div>
      <p class="text-[12.5px] text-mut mt-3">${v.gap > 0 ? 'Bank-in exceeds recorded income — possible unrecorded revenue (or unidentified non-sales credits). Trace the largest unexplained deposits.' : v.gap < 0 ? 'Recorded income exceeds bank-in — cash sales not banked in, receivables uncollected, or revenue overstated. Tie to the receivables movement.' : ''}</p>` : '<p class="text-mut text-[13px] mt-2">Enter the bank credits to get the verdict.</p>'}`}
    </div>
  </div>`;
}
/* lead schedules */
const LEAD_AREAS = {
  'Revenue & income':['REV','OTHINC'], 'Cost of sales':['COS','INV'], 'Operating expenses':['ADMIN','SELL','DEPR'],
  'Receivables':['TR','OR','DIRADV','RPTREC'], 'Cash & bank':['CASH','FD','OD'],
  'Property, plant & equipment':['PPE','ACCDEP'], 'Payables & accruals':['TP','OP','DIROWE','RPTPAY'],
  'Borrowings':['BORR','HP','FIN'], 'Equity & tax':['SC','RE','DIV','TAXEXP','TAXPAY','DEFTAX'],
};
let tkLeadArea = 'Receivables';
function tkLead(el) {
  if (!S.tb.length) { el.innerHTML = '<div class="card card-pad text-mut text-[13px]">Import a trial balance first.</div>'; return; }
  const cats = LEAD_AREAS[tkLeadArea];
  const rows = S.tb.filter(r => cats.includes(r.cat));
  const mat = materiality();
  let tot = 0, totPy = 0;
  const trs = rows.map(r => {
    const cy = (num(r.dr) - num(r.cr)) * CAT[r.cat].side, py = num(r.py);
    tot += cy; totPy += py;
    const mv = py ? (cy-py)/Math.abs(py)*100 : null;
    return `<tr><td>${esc(r.name)}</td><td class="text-[11px] text-mut">${CAT[r.cat].label}</td>
      <td class="num mono">${fmt(cy,true)}</td><td class="num mono text-mut">${fmt(py,true)}</td>
      <td class="num mono ${mv!==null&&Math.abs(mv)>25?'text-warn font-semibold':''}">${mv===null?'–':(mv>0?'+':'')+mv.toFixed(1)+'%'}</td>
      <td class="num mono">${(Math.abs(cy)/mat.overall*100).toFixed(0)}%</td></tr>`;
  }).join('');
  const procs = [...new Set(cats.flatMap(c => (KB[c]||{p:[]}).p))];
  el.innerHTML = `
  <div class="card card-pad no-print mb-4">
    <div class="flex flex-wrap items-end gap-3">
      <div><label class="fieldlbl">Lead schedule area</label>
        <select class="field !w-72" onchange="tkLeadArea=this.value; renderToolkit()">
          ${Object.keys(LEAD_AREAS).map(a => `<option ${a===tkLeadArea?'selected':''}>${a}</option>`).join('')}
        </select></div>
      <button class="btn btn-pri ml-auto" onclick="printSection('tk-leaddoc')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
        Print working paper</button>
    </div>
  </div>
  <div class="card card-pad" id="tk-leaddoc">
    <div class="flex items-start justify-between flex-wrap gap-2">
      <div>
        <div class="font-bold text-[15px]">${esc(S.setup.name)} — Lead schedule: ${tkLeadArea}</div>
        <div class="text-[12px] text-mut">FYE ${dMY(S.setup.fye)} · Materiality ${fmtRM(mat.overall)} · PM ${fmtRM(mat.pm)}</div>
      </div>
      <table class="text-[11px]" style="border-collapse:collapse">
        <tr><td class="border border-line px-3 py-1">Prepared by / date</td><td class="border border-line px-8 py-1"></td></tr>
        <tr><td class="border border-line px-3 py-1">Reviewed by / date</td><td class="border border-line px-8 py-1"></td></tr>
      </table>
    </div>
    <table class="tbl mt-4">
      <thead><tr><th>Account</th><th>Classification</th><th class="num">CY (RM)</th><th class="num">PY (RM)</th><th class="num">Mvmt</th><th class="num">% of mat.</th></tr></thead>
      <tbody>${trs || '<tr><td colspan="6" class="text-center text-mut py-4">No accounts in this area.</td></tr>'}</tbody>
      <tfoot><tr class="font-semibold"><td class="!py-2">Total</td><td></td><td class="num mono">${fmt(tot,true)}</td><td class="num mono">${fmt(totPy,true)}</td><td></td><td></td></tr></tfoot>
    </table>
    <div class="mt-4 text-[12.5px]">
      <div class="font-semibold mb-1">Procedures for this area:</div>
      <ul class="list-disc pl-5 space-y-0.5">${procs.map(p => `<li>${p} <span class="text-mut mono">[&nbsp;&nbsp;]</span></li>`).join('')}</ul>
    </div>
    <div class="mt-3 text-[12px] text-mut">Evidence on file: see Evidence Vault. Conclusion: ______________________________________________</div>
  </div>`;
}
/* rollforward */
function tkRoll(el) {
  const m = S.tb.length ? model() : null;
  el.innerHTML = `
  <div class="card card-pad max-w-2xl">
    <h2 class="font-bold text-[15px] mb-1">Roll forward to next year</h2>
    <p class="text-[13px] text-mut mb-4">Closes this file and opens next year's engagement in one click: closing balances become comparatives, retained earnings roll up automatically, setup and directors carry over. This year's file stays untouched.</p>
    ${!m ? '<div class="text-mut text-[13px]">Import a trial balance first.</div>' : `
    <table class="fs-doc" style="max-width:26rem">
      <tr><td>Current FYE</td><td class="num">${dMY(S.setup.fye)}</td></tr>
      <tr><td>New FYE</td><td class="num">${dMY(addMonths(S.setup.fye, 12))}</td></tr>
      <tr><td>Closing retained earnings → opening</td><td class="num mono">${fmt(m.reClose)}</td></tr>
      <tr><td>Accounts carried as comparatives</td><td class="num mono">${S.tb.length}</td></tr>
    </table>
    <button class="btn btn-pri mt-4" onclick="rollForward()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      Create ${S.setup.fye ? new Date(addMonths(S.setup.fye,12)).getFullYear() : 'next year'} engagement</button>`}
  </div>`;
}
function rollForward() {
  const src = S;
  const m = model();
  const c = Object.assign(BLANK(), { id:nid(), created:Date.now() });
  c.setup = { ...src.setup, fye: addMonths(src.setup.fye, 12), firstaudit:'no' };
  c.directors = src.directors.map(d => ({...d}));
  c.intake = { ...src.intake };
  c.notes = { ...src.notes };
  c.sign = { ...BLANK().sign, firm:src.sign.firm, af:src.sign.af, partner:src.sign.partner, approval:src.sign.approval, place:src.sign.place };
  // comparatives: every row's adjusted natural balance becomes PY
  const adjByCat = {};
  for (const a of src.adjustments) for (const e of a.entries) adjByCat[e.cat] = (adjByCat[e.cat]||0) + e.amt;
  c.tb = src.tb.map(r => ({ id:nid(), name:r.name, cat:r.cat, dr:'', cr:'',
    py: Math.round((num(r.dr) - num(r.cr)) * CAT[r.cat].side), autoWeak:false }));
  // spread category-level adjustments onto the first row of each category
  for (const [cat, amt] of Object.entries(adjByCat)) {
    const row = c.tb.find(r => r.cat === cat);
    const nat = Math.round(amt * CAT[cat].side);
    if (row) row.py = num(row.py) + nat;
    else c.tb.push({ id:nid(), name: CAT[cat].label + ' (b/f)', cat, dr:'', cr:'', py: nat, autoWeak:false });
  }
  DB.clients.push(c);
  switchClient(c.id);
  saveState();
  toast(`Rolled forward — FYE ${dMY(c.setup.fye)} engagement created`);
  show('setup');
}
/* ---------- MBRS / SSM export ----------
   SSM's own mTool (the free desktop app used to prepare the XBRL filing) has a
   built-in "Import source document → Auto Tag" feature: you feed it a clean
   Excel file and it matches line items to SSMxT taxonomy elements by
   accounting-term synonym (confirmed from SSM's mTool User Manual v2.4).
   We cannot fabricate a valid XBRL instance against SSM's proprietary
   taxonomy — a wrong tag would be worse than no export. What we CAN do,
   honestly and to real effect, is build exactly the clean source document
   mTool's own Auto Tag engine is designed to read: current-year-before-
   prior-year columns, one clean table per statement, no merged cells,
   standard synonym-friendly labels. This does not submit anything — the
   auditor still opens it in mTool, runs Auto Tag, reviews, and validates. */
function buildMbrsWorkbook() {
  const m = model(), p = hasPY() ? model(true) : null;
  const cy = S.setup.fye ? new Date(S.setup.fye).getFullYear() : '';
  const g = k => m.nat[k], gp = k => p ? p.nat[k] : 0;
  const wb = XLSX.utils.book_new();
  const addSheet = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31));

  // Filing Information — the questions mTool's "Filing Information" step asks first
  addSheet('Filing Information', [
    ['MBRS Filing Information — source data for mTool "Change Filing Information"'],
    [],
    ['Company name', S.setup.name || ''],
    ['Registration number', S.setup.regno || ''],
    ['Financial year end', S.setup.fye || ''],
    ['Reporting framework', S.setup.framework === 'MPERS' ? 'MPERS' : 'MFRS'],
    ['Entry point', S.setup.framework === 'MPERS' ? 'FS-MPERS' : 'FS-MFRS'],
    ['Principal activity', S.setup.activity || ''],
    ['Registered office', S.setup.address || ''],
    ['Currency', 'RM (Ringgit Malaysia)'],
    ['Level of rounding', 'Unit (RM1)'],
    ['Number of employees', S.setup.employees || ''],
    ['Directors', S.directors.map(d => d.name).join('; ')],
    ['Auditor', S.sign.firm ? `${S.sign.firm} (${S.sign.af || ''})` : ''],
    ['Engagement partner', S.sign.partner || ''],
    ['Date of auditors\' report', S.sign.date || ''],
    [],
    ['Note: import this file into mTool via Toolbox → Source Document, then Auto Tag each template. Review every tagged and untagged (orange) cell before validating.'],
  ]);

  // Statement of Financial Position — current year BEFORE prior year, per mTool guidance
  const sofp = [
    ['Statement of financial position', cy, cy ? cy - 1 : ''],
    ['Non-current assets', '', ''],
    ['Property, plant and equipment', g('PPE') - g('ACCDEP'), p ? gp('PPE') - gp('ACCDEP') : ''],
  ];
  if (g('INTANG')) sofp.push(['Intangible assets', g('INTANG'), p ? gp('INTANG') : '']);
  if (g('INVEST')) sofp.push(['Other investments', g('INVEST'), p ? gp('INVEST') : '']);
  sofp.push(['Total non-current assets', m.nca, p ? p.nca : '']);
  sofp.push(['Current assets', '', '']);
  if (g('INV')) sofp.push(['Inventories', g('INV'), p ? gp('INV') : '']);
  sofp.push(['Trade and other receivables', g('TR') + g('OR'), p ? gp('TR') + gp('OR') : '']);
  if (g('DIRADV')) sofp.push(['Amount owing by directors', g('DIRADV'), p ? gp('DIRADV') : '']);
  if (g('RPTREC')) sofp.push(['Amount owing by related parties', g('RPTREC'), p ? gp('RPTREC') : '']);
  if (g('FD')) sofp.push(['Fixed deposits placed with licensed banks', g('FD'), p ? gp('FD') : '']);
  sofp.push(['Cash and bank balances', g('CASH'), p ? gp('CASH') : '']);
  sofp.push(['Total current assets', m.ca, p ? p.ca : '']);
  sofp.push(['Total assets', m.totalAssets, p ? p.totalAssets : '']);
  sofp.push(['Equity', '', '']);
  sofp.push(['Share capital', g('SC'), p ? gp('SC') : '']);
  sofp.push(['Retained earnings/(accumulated losses)', m.reClose, p ? p.reClose : '']);
  sofp.push(['Total equity', m.equity, p ? p.equity : '']);
  sofp.push(['Non-current liabilities', '', '']);
  if (g('BORR')) sofp.push(['Bank borrowings, non-current', g('BORR'), p ? gp('BORR') : '']);
  if (g('HP')) sofp.push(['Hire purchase payables, non-current', g('HP'), p ? gp('HP') : '']);
  if (g('DEFTAX')) sofp.push(['Deferred tax liabilities', g('DEFTAX'), p ? gp('DEFTAX') : '']);
  sofp.push(['Current liabilities', '', '']);
  sofp.push(['Trade and other payables', g('TP') + g('OP'), p ? gp('TP') + gp('OP') : '']);
  if (g('DIROWE')) sofp.push(['Amount owing to directors', g('DIROWE'), p ? gp('DIROWE') : '']);
  if (g('RPTPAY')) sofp.push(['Amount owing to related parties', g('RPTPAY'), p ? gp('RPTPAY') : '']);
  if (g('OD')) sofp.push(['Bank overdraft', g('OD'), p ? gp('OD') : '']);
  if (g('TAXPAY')) sofp.push(['Current tax payable', g('TAXPAY'), p ? gp('TAXPAY') : '']);
  sofp.push(['Total liabilities', m.totalLiab, p ? p.totalLiab : '']);
  sofp.push(['Total equity and liabilities', m.equity + m.totalLiab, p ? p.equity + p.totalLiab : '']);
  addSheet('SOFP', sofp);

  // Statement of Profit or Loss and OCI
  addSheet('SOPL', [
    ['Statement of profit or loss and other comprehensive income', cy, cy ? cy - 1 : ''],
    ['Revenue', m.revenue, p ? p.revenue : ''],
    ['Cost of sales', -m.cos, p ? -p.cos : ''],
    ['Gross profit', m.gp, p ? p.gp : ''],
    ['Other income', m.othinc, p ? p.othinc : ''],
    ['Administrative expenses', -(g('ADMIN') + g('SELL')), p ? -(gp('ADMIN') + gp('SELL')) : ''],
    ['Depreciation and amortisation', -g('DEPR'), p ? -gp('DEPR') : ''],
    ['Finance costs', -m.fin, p ? -p.fin : ''],
    ['Profit/(loss) before tax', m.pbt, p ? p.pbt : ''],
    ['Tax expense/(income)', -m.taxexp, p ? -p.taxexp : ''],
    ['Profit/(loss) for the financial year', m.pat, p ? p.pat : ''],
    ['Other comprehensive income, net of tax', 0, p ? 0 : ''],
    ['Total comprehensive income for the financial year', m.pat, p ? p.pat : ''],
  ]);

  // Statement of Changes in Equity
  addSheet('SOCE', [
    ['Statement of changes in equity', 'Share capital', 'Retained earnings', 'Total'],
    ['At beginning of financial year', g('SC'), g('RE'), g('SC') + g('RE')],
    ['Total comprehensive income for the financial year', 0, m.pat, m.pat],
    ...(g('DIV') ? [['Dividends declared', 0, -g('DIV'), -g('DIV')]] : []),
    ['At end of financial year', g('SC'), m.reClose, m.equity],
  ]);

  // Statement of Cash Flows (only meaningful with PY comparatives)
  if (p) {
    const dep = g('DEPR');
    const dWC = k => -((m.nat[k] || 0) - (p.nat[k] || 0));
    const dWCl = k => ((m.nat[k] || 0) - (p.nat[k] || 0));
    const ops = m.pbt + dep + m.fin + dWC('INV') + dWC('TR') + dWC('OR') + dWC('DIRADV') + dWC('RPTREC')
      + dWCl('TP') + dWCl('OP') + dWCl('DIROWE') + dWCl('RPTPAY');
    const taxPaid = -(p.nat.TAXPAY + m.taxexp - m.nat.TAXPAY);
    const capex = -(m.nat.PPE - p.nat.PPE);
    const invFlow = capex - (m.nat.INTANG - p.nat.INTANG) - (m.nat.INVEST - p.nat.INVEST) - (m.nat.FD - p.nat.FD);
    const finFlow = (m.nat.BORR - p.nat.BORR) + (m.nat.HP - p.nat.HP) - m.fin - m.nat.DIV + (m.nat.SC - p.nat.SC);
    const net = ops + taxPaid + invFlow + finFlow;
    const openCash = p.nat.CASH - p.nat.OD, closeCash = m.nat.CASH - m.nat.OD;
    addSheet('SOCF', [
      ['Statement of cash flows', cy],
      ['Profit before tax', m.pbt], ['Depreciation and amortisation', dep], ['Finance costs', m.fin],
      ['Changes in working capital', ops - m.pbt - dep - m.fin], ['Cash generated from operations', ops],
      ['Tax paid', taxPaid], ['Net cash used in investing activities', invFlow],
      ['Net cash from/(used in) financing activities', finFlow],
      ['Net increase/(decrease) in cash and cash equivalents', net],
      ['Cash and cash equivalents at beginning of financial year', openCash],
      ['Cash and cash equivalents at end of financial year', closeCash],
    ]);
  }

  // Notes — flattened tabular figures for the note-heavy elements (PPE movement, staff costs, tax reconciliation)
  const notesRows = [['Notes to the financial statements — key figures', cy, cy ? cy - 1 : '']];
  notesRows.push(['Depreciation charge for the year', g('DEPR'), p ? gp('DEPR') : '']);
  notesRows.push(['Accumulated depreciation, end of year', g('ACCDEP'), p ? gp('ACCDEP') : '']);
  const statTax = Math.round(m.pbt * 0.24);
  notesRows.push(['Tax at statutory rate of 24%', statTax, '']);
  notesRows.push(['Tax expense for the year', m.taxexp, p ? gp('TAXEXP') : '']);
  const staffRows = S.tb.filter(r => /salar|wages|bonus|gaji/i.test(r.name));
  const staff = staffRows.reduce((s, r) => s + num(r.dr) - num(r.cr), 0);
  if (staff) notesRows.push(['Staff costs (salaries, wages, bonuses)', staff, '']);
  if (g('DIRADV')) notesRows.push(['Amount owing by directors — non-trade, unsecured, interest-free, repayable on demand', g('DIRADV'), p ? gp('DIRADV') : '']);
  if (g('DIROWE')) notesRows.push(['Amount owing to directors — non-trade, unsecured, interest-free, repayable on demand', g('DIROWE'), p ? gp('DIROWE') : '']);
  addSheet('Notes — key figures', notesRows);

  // Key Financial Indicators — the simpler KFI-MFRS/KFI-MPERS entry point some exempt companies use
  addSheet('KFI', [
    ['Key Financial Indicators', cy],
    ['Revenue', m.revenue], ['Profit/(loss) before tax', m.pbt], ['Profit/(loss) for the year', m.pat],
    ['Total assets', m.totalAssets], ['Total liabilities', m.totalLiab], ['Total equity', m.equity],
    ['Number of employees', num(S.setup.employees)],
  ]);

  return wb;
}
function exportMbrs() {
  if (!S.tb.length) { toast('Import a trial balance first'); return; }
  if (typeof XLSX === 'undefined') { toast('Spreadsheet writer failed to load'); return; }
  const wb = buildMbrsWorkbook();
  const fname = `MBRS-source-${(S.setup.name || 'engagement').replace(/[^\w]+/g, '-')}-FYE${S.setup.fye || ''}.xlsx`;
  XLSX.writeFile(wb, fname);
  toast('MBRS source document downloaded — import into mTool via Toolbox → Source Document, then Auto Tag');
}
function tkMbrs(el) {
  const has = S.tb.length > 0;
  el.innerHTML = `
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div class="card card-pad lg:col-span-2">
      <h2 class="font-bold text-[15px] mb-1">MBRS / SSM lodgement export</h2>
      <p class="text-[12.5px] text-mut mb-3">Malaysia's MBRS filing is prepared in SSM's free desktop tool (<strong>mTool</strong>), which validates and generates the actual XBRL instance against SSM's taxonomy (SSMxT) — that step has to happen in mTool itself; no third-party tool can safely fabricate a valid XBRL file for you.</p>
      <p class="text-[12.5px] text-mut mb-4">What Mr Auditor <em>can</em> do — and does — is prepare mTool's own recommended input: a clean source document for mTool's built-in <strong>Auto Tag</strong> feature, which matches line items to taxonomy elements by accounting-term synonym. This turns hours of manual re-keying into a few minutes of review.</p>
      <ol class="text-[12.5px] list-decimal pl-5 space-y-1 mb-4">
        <li>Download the source document below (one Excel file, current-year figures before prior-year — exactly as mTool expects).</li>
        <li>In mTool: <strong>Create Filing</strong> → select the FS-${S.setup.framework === 'MPERS' ? 'MPERS' : 'MFRS'} entry point → Toolbox → <strong>Source Document</strong> → choose this file.</li>
        <li>Select each statement's table rows → click <strong>Auto Tag</strong>. Tagged cells turn pale green; untagged cells turn orange — review and complete those manually.</li>
        <li><strong>Validate</strong>, fix any errors, then generate and submit the XBRL file via mPortal as usual.</li>
      </ol>
      <button class="btn btn-pri" ${!has ? 'disabled' : ''} onclick="exportMbrs()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        Download MBRS source document (.xlsx)
      </button>
      ${!has ? '<p class="text-[12px] text-warn mt-2">Import a trial balance first.</p>' : ''}
      <p class="text-[11.5px] text-mut mt-3">Sheets included: Filing Information, SOFP, SOPL, SOCE${hasPY() ? ', SOCF' : ''}, key note figures, and KFI. This is a preparation aid, not a filed document — the auditor remains responsible for what's ultimately lodged.</p>
    </div>
    <div class="card card-pad">
      <h2 class="font-bold text-[15px] mb-2">Entry point</h2>
      <table class="fs-doc" style="width:100%">
        <tr><td>Framework</td><td class="num">${S.setup.framework}</td></tr>
        <tr><td>Entry point</td><td class="num mono">FS-${S.setup.framework === 'MPERS' ? 'MPERS' : 'MFRS'}</td></tr>
        <tr><td>FYE</td><td class="num">${dMY(S.setup.fye)}</td></tr>
      </table>
      <p class="text-[11.5px] text-mut mt-3">Companies with an approved EA2 exemption may instead file the simpler <span class="mono">KFI-${S.setup.framework === 'MPERS' ? 'MPERS' : 'MFRS'}</span> entry point — the KFI sheet in the download covers that case too.</p>
    </div>
  </div>`;
}

/* export / import */
function tkData(el) {
  el.innerHTML = `
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-4xl">
    <div class="card card-pad">
      <h2 class="font-bold text-[15px] mb-1">Export this engagement</h2>
      <p class="text-[12.5px] text-mut mb-3">Everything except vault files (those live in the browser's IndexedDB) — use for backup, or to move to another machine / the future Supabase backend.</p>
      <button class="btn btn-pri" onclick="tkExport()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        Download engagement JSON</button>
    </div>
    <div class="card card-pad">
      <h2 class="font-bold text-[15px] mb-1">Import an engagement</h2>
      <p class="text-[12.5px] text-mut mb-3">Restores a previously exported engagement as a new client file.</p>
      <label class="btn btn-ghost cursor-pointer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>
        Choose JSON file<input type="file" accept=".json" class="hidden" onchange="tkImport(this)">
      </label>
    </div>
  </div>`;
}
function tkExport() {
  const data = JSON.stringify(S, null, 2);
  const blob = new Blob([data], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mr-auditor-${(S.setup.name||'engagement').replace(/[^\w]+/g,'-').toLowerCase()}-${S.setup.fye||''}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast('Engagement exported');
}
function tkImport(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d.setup || !Array.isArray(d.tb)) { toast('Not a Mr Auditor engagement file'); return; }
      const c = hydrate(d); c.id = nid(); c.created = Date.now();
      DB.clients.push(c); switchClient(c.id); saveState();
      toast(`${c.setup.name || 'Engagement'} imported`);
      show('dashboard');
    } catch(e) { toast('Could not read that file'); }
  };
  rd.readAsText(f);
}

/* ============================================================
   AUDIT FILE — WORKING PAPERS
   The digital equivalent of the auditor's Excel workbook:
   A-series planning papers, B-series completion papers, and
   lettered lead schedules (C–Q) that wire TB → WP → FS → notes.
   ============================================================ */
const WP_PLAN = [
  ['A1','Acceptance & independence','MIA By-Laws · ISA 210/220'],
  ['A2','Materiality','ISA 320'],
  ['A3','Risk assessment & scoping','ISA 315'],
  ['A4','Preliminary analytical review','ISA 520'],
  ['A5','Audit strategy memorandum','ISA 300'],
  ['A6','Fraud risk assessment','ISA 240'],
  ['A7','Going concern — planning','ISA 570'],
  ['A8','Laws & regulations','ISA 250'],
  ['A9','Related parties — planning','ISA 550'],
];
const WP_COMPL = [
  ['B1','Final analytical review','ISA 520'],
  ['B2','Misstatement evaluation','ISA 450'],
  ['B3','Subsequent events','ISA 560'],
  ['B4','Going concern — conclusion','ISA 570'],
  ['B5','Management representation letter','ISA 580'],
  ['B6','Completion checklist','ISQM 1 · ISA 230'],
  ['B7','Partner review notes','ISA 220'],
];
const WP_AREAS = [
  ['C','Cash & bank',['CASH','FD'],'Bank statements & confirmations'],
  ['D','Trade & other receivables',['TR','OR','SUSP'],'Sales & receivables evidence'],
  ['E','Inventories',['INV'],'Inventory count sheets'],
  ['F','PPE & intangibles',['PPE','ACCDEP','INTANG'],'Fixed asset register & invoices'],
  ['G','Investments',['INVEST'],'Agreements & facility letters'],
  ['H','Trade & other payables',['TP','OP'],'Purchases & payables evidence'],
  ['J','Borrowings & hire purchase',['OD','BORR','HP'],'Agreements & facility letters'],
  ['K','Taxation',['TAXEXP','TAXPAY','DEFTAX'],'Tax — CP204 / Form C / assessments'],
  ['L','Equity',['SC','RE','DIV'],'SSM & statutory records'],
  ['M','Related parties & directors',['DIRADV','DIROWE','RPTREC','RPTPAY'],'SSM & statutory records'],
  ['N','Revenue',['REV'],'Sales & receivables evidence'],
  ['O','Cost of sales',['COS'],'Purchases & payables evidence'],
  ['P','Operating expenses',['ADMIN','SELL','DEPR'],'Payroll · EPF · SOCSO'],
  ['Q','Other income & finance costs',['OTHINC','FIN'],'Bank statements & confirmations'],
];
const WP_FINDING_CATS = { 'dir-adv':['DIRADV'], 'no-depr':['PPE','ACCDEP','DEPR'], 'accdep-exceeds':['PPE','ACCDEP'],
  'neg-cash':['CASH','OD'], 'rec-days':['TR','REV'], 'inv-days':['INV','COS'], 'neg-gp':['REV','COS'], 'gp-swing':['REV','COS'],
  'rpt-disc':['RPTREC','RPTPAY','DIROWE','DIRADV'], 'no-interest':['BORR','HP','OD','FIN'], 'interest-no-loan':['FIN'],
  'fd-no-int':['FD'], 'no-epf':['ADMIN','OP'], 'suspense':['SUSP'], 'illegal-div':['DIV','RE'], 'neg-equity':['SC','RE'],
  'sst':['REV'], 'einvoice':['REV'], 'no-tax':['TAXEXP','TAXPAY'], 'py-gap':['RE'] };

let curWp = 'A2';
/* dotted-path state helpers so every paper input persists with one attribute */
function wpGet(path, dflt) { let o = S; for (const k of path.split('.')) { if (o == null) return dflt; o = o[k]; } return o == null ? dflt : o; }
function wpSet(path, val) {
  if (guardArchived()) return;
  const seg = path.split('.'); let o = S;
  for (let i = 0; i < seg.length - 1; i++) { if (typeof o[seg[i]] !== 'object' || o[seg[i]] == null) o[seg[i]] = {}; o = o[seg[i]]; }
  o[seg[seg.length - 1]] = val;
  saveState(); wpIndexRefresh();
}
function wpStatus(ref) {
  const s = (S.wpSign || {})[ref] || {};
  return s.rev ? 'rev' : s.prep ? 'prep' : 'none';
}
function wpAreaFigures(cats) {
  const m = S.tb.length ? model() : null;
  if (!m) return { rows: [], tot: 0, totPy: 0, gross: 0 };
  // Contra accounts display negated within their host schedule so the total
  // ties to the FS carrying amount (PPE cost − acc dep = NBV; equity − dividends).
  const flip = c => ((c === 'ACCDEP' && cats.includes('PPE')) || (c === 'DIV' && cats.includes('SC'))) ? -1 : 1;
  const rows = S.tb.filter(r => cats.includes(r.cat)).map(r => {
    const cy = (num(r.dr) - num(r.cr)) * CAT[r.cat].side * flip(r.cat), py = num(r.py) * flip(r.cat);
    return { name: r.name, cat: r.cat, cy, py, mv: py ? (cy - py) / Math.abs(py) * 100 : null };
  });
  // include category-level audit adjustments so the WP ties to the adjusted TB / FS
  const adj = {};
  for (const a of S.adjustments) for (const e of a.entries) if (cats.includes(e.cat)) adj[e.cat] = (adj[e.cat] || 0) + e.amt * CAT[e.cat].side * flip(e.cat);
  for (const [cat, amt] of Object.entries(adj)) rows.push({ name: CAT[cat].label + ' (audit adjustments)', cat, cy: amt, py: 0, mv: null, isAdj: true });
  const tot = rows.reduce((s, r) => s + r.cy, 0), totPy = rows.reduce((s, r) => s + r.py, 0);
  const gross = rows.reduce((s, r) => s + Math.abs(r.cy), 0);
  return { rows, tot, totPy, gross };
}
function wpAreaRisk(ref, cats, gross) {
  const mat = materiality();
  const ev = S.tb.length ? evaluate() : { open: [] };
  const hits = ev.open.filter(f => (WP_FINDING_CATS[f.id] || []).includes(cats[0]) || (WP_FINDING_CATS[f.id] || []).some(c => cats.includes(c)));
  const level = hits.some(f => ['blocker','high'].includes(f.sev)) ? 'high'
    : (hits.some(f => f.sev === 'medium') || gross >= mat.pm) ? 'medium' : 'low';
  return { level, hits, abovePM: gross >= mat.pm };
}
/* shared paper chrome: header + body + conclusion/sign-off */
function wpChrome(ref, title, isa, body) {
  const s = (S.wpSign || {})[ref] || {};
  const fileArchived = isArchived();
  const locked = !!s.rev || fileArchived;       // reviewed or whole-file archived = locked
  const canReview = ['manager','partner'].includes(myRole()) && !fileArchived;
  return `
  <div class="fs-doc">
    <div class="flex items-start justify-between flex-wrap gap-2 border-b border-line pb-3 mb-4">
      <div>
        <div class="font-bold text-[16px]">${esc(S.setup.name) || '[Client]'} — ${title}</div>
        <div class="text-[12px] text-mut">FYE ${dMY(S.setup.fye)} · ${isa} · Prepared by Mr Auditor engine, reviewed by the engagement team</div>
      </div>
      <span class="pill ${locked ? 'pill-ok' : 'pill-mut'} mono !text-[13px]">${ref}${locked ? ' · locked' : ''}</span>
    </div>
    ${fileArchived ? `<div class="flex items-center gap-2 rounded-xl bg-okbg text-ok text-[12.5px] font-medium px-3 py-2 mb-4">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
      File finalised &amp; archived — every paper is read-only. Reopen the file from the Reports screen (reason required).
    </div>` : locked ? `<div class="flex items-center gap-2 rounded-xl bg-okbg text-ok text-[12.5px] font-medium px-3 py-2 mb-4">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
      Reviewed by ${esc(s.rev)}${s.revDate ? ' on ' + dMY(s.revDate) : ''} — this paper is locked.
      ${canReview ? `<button class="btn btn-ghost !py-1 !px-2 !text-[11.5px] ml-auto" onclick="wpReopen('${ref}')">Reopen for editing</button>`
        : '<span class="ml-auto text-[11.5px] font-normal">ask a manager or partner to reopen it</span>'}
    </div>` : ''}
    <fieldset ${locked ? 'disabled' : ''} class="border-0 m-0 p-0 min-w-0">
    ${body}
    <div class="mt-6 border-t border-line pt-4">
      <label class="fieldlbl">Conclusion</label>
      <textarea class="field !text-[13px]" rows="2" placeholder="e.g. Work performed as planned; balance fairly stated subject to the matters referred to the partner."
        onchange="wpSet('wpSign.${ref}.concl', this.value)">${esc(s.concl || '')}</textarea>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <div><label class="fieldlbl">Prepared by</label><input class="field !py-1.5" value="${esc(s.prep || '')}" onchange="wpSet('wpSign.${ref}.prep', this.value)"></div>
        <div><label class="fieldlbl">Date</label><input class="field mono !py-1.5" type="date" value="${esc(s.prepDate || '')}" onchange="wpSet('wpSign.${ref}.prepDate', this.value)"></div>
      </div>
    </fieldset>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
      <div><label class="fieldlbl">Reviewed by ${canReview ? '' : '<span class="text-mut">(manager/partner only)</span>'}</label>
        <input class="field !py-1.5" value="${esc(s.rev || '')}" ${canReview && !locked ? '' : 'disabled'} onchange="wpReview('${ref}', this.value)"></div>
      <div><label class="fieldlbl">Date</label><input class="field mono !py-1.5" type="date" value="${esc(s.revDate || '')}" ${canReview && !locked ? '' : 'disabled'} onchange="wpSet('wpSign.${ref}.revDate', this.value)"></div>
    </div>
  </div>`;
}
function wpReview(ref, name) {
  wpSet(`wpSign.${ref}.rev`, name);
  if (name && !wpGet(`wpSign.${ref}.revDate`, '')) wpSet(`wpSign.${ref}.revDate`, dISO(new Date()));
  if (name) { logActivity('Reviewed & locked working paper', ref + ' by ' + name); toast(`${ref} reviewed — paper locked`); }
  wpShow(ref);
}
function wpReopen(ref) {
  if (!confirm(`Reopen ${ref} for editing? The review signature will be cleared and the reopening is logged.`)) return;
  const prev = wpGet(`wpSign.${ref}.rev`, '');
  wpSet(`wpSign.${ref}.rev`, ''); wpSet(`wpSign.${ref}.revDate`, '');
  logActivity('Reopened working paper', `${ref} (was reviewed by ${prev})`);
  wpShow(ref);
}
function wpChecklist(ref, items) {
  return items.map((it, i) => {
    const on = wpGet(`plan.checks.${ref}.${i}`, false);
    return `<label class="flex items-start gap-2 py-1 text-[13px] cursor-pointer">
      <input type="checkbox" class="mt-0.5" ${on ? 'checked' : ''} onchange="wpSet('plan.checks.${ref}.${i}', this.checked)">
      <span>${it}</span></label>`;
  }).join('');
}
function wpNotes(path, placeholder) {
  return `<label class="fieldlbl mt-3">Notes</label>
  <textarea class="field !text-[13px]" rows="3" placeholder="${placeholder || 'Auditor notes…'}" onchange="wpSet('${path}', this.value)">${esc(wpGet(path, ''))}</textarea>`;
}
function wpRatioTable() {
  const m = S.tb.length ? model() : null;
  if (!m) return '<p class="text-mut text-[13px]">Import a trial balance first.</p>';
  const mp = hasPY() ? model(true) : null;
  const R = [];
  const push = (l, cy, py, read) => R.push([l, cy, py, read]);
  const gp = m.revenue ? m.gp / m.revenue * 100 : NaN;
  push('Gross margin', pct(gp), mp && mp.revenue ? pct(mp.gp / mp.revenue * 100) : '–', gp < 0 ? 'Investigate — below cost' : 'Compare to industry norm');
  const np = m.revenue ? m.pbt / m.revenue * 100 : NaN;
  push('PBT margin', pct(np), mp && mp.revenue ? pct(mp.pbt / mp.revenue * 100) : '–', np < 0 ? 'Loss-making' : '');
  const cr = m.clSimple ? m.ca / m.clSimple : NaN;
  push('Current ratio', isFinite(cr) ? cr.toFixed(2) + '×' : '–', mp && mp.clSimple ? (mp.ca / mp.clSimple).toFixed(2) + '×' : '–', cr < 1 ? 'Net current liabilities' : '');
  const rd = m.revenue ? m.nat.TR / m.revenue * 365 : NaN;
  push('Receivable days', isFinite(rd) ? Math.round(rd) + 'd' : '–', mp && mp.revenue ? Math.round(mp.nat.TR / mp.revenue * 365) + 'd' : '–', rd > 120 ? 'Impairment risk' : '');
  const pd = m.cos ? m.nat.TP / m.cos * 365 : NaN;
  push('Payable days', isFinite(pd) ? Math.round(pd) + 'd' : '–', mp && mp.cos ? Math.round(mp.nat.TP / mp.cos * 365) + 'd' : '–', '');
  const idays = m.cos ? m.nat.INV / m.cos * 365 : NaN;
  if (m.nat.INV) push('Inventory days', isFinite(idays) ? Math.round(idays) + 'd' : '–', mp && mp.cos ? Math.round(mp.nat.INV / mp.cos * 365) + 'd' : '–', idays > 180 ? 'NRV testing' : '');
  const debt = m.nat.BORR + m.nat.HP + m.nat.OD;
  push('Gearing (debt÷equity)', m.equity > 0 ? (debt / m.equity).toFixed(2) + '×' : debt > 0 ? '∞' : '–', mp && mp.equity > 0 ? ((mp.nat.BORR + mp.nat.HP + mp.nat.OD) / mp.equity).toFixed(2) + '×' : '–', '');
  return `<table class="tbl"><thead><tr><th>Indicator</th><th class="num">CY</th><th class="num">PY</th><th>Auditor's reading</th></tr></thead>
    <tbody>${R.map(r => `<tr><td>${r[0]}</td><td class="num mono">${r[1]}</td><td class="num mono text-mut">${r[2]}</td><td class="text-[12px] text-mut">${r[3]}</td></tr>`).join('')}</tbody></table>`;
}

/* ---------- planning papers ---------- */
function wpA1() {
  const i = S.intake || {};
  return wpChrome('A1', 'Acceptance & independence', 'MIA By-Laws · ISA 210/220', `
    <p class="text-[13px] text-mut mb-3">Engagement acceptance/continuance and ethical clearance — the paper practice reviewers open first.</p>
    <table class="tbl mb-3"><tbody>
      <tr><td class="text-mut">First audit?</td><td>${S.setup.firstaudit === 'yes' ? '<span class="pill pill-warn">Yes — ISA 510 opening balance work required</span>' : 'No — recurring engagement'}</td></tr>
      <tr><td class="text-mut">Previous auditor</td><td>${esc(i.prevauditor) || '—'} ${i.prevauditor ? '<span class="pill pill-warn">professional clearance letter required</span>' : ''}</td></tr>
      <tr><td class="text-mut">Bookkeeping condition (intake)</td><td>${esc(i.bookkeeping) || 'not assessed'}</td></tr>
      <tr><td class="text-mut">Known risk notes (intake)</td><td>${esc(i.risknotes) || '—'}</td></tr>
    </tbody></table>
    ${wpChecklist('A1', [
      'Client identity, beneficial owners and directors verified (SSM search on file; AMLA/CDD completed)',
      'Independence assessed — no financial interest, family relationship or long-association threat (MIA By-Laws Part 4A / s.290)',
      'Total fees from this client below the fee-dependency threshold of recurring practice income',
      'Professional clearance received from the predecessor auditor (or N/A — recurring)',
      'Firm has the competence, time and resources for this engagement (industry, size, deadline)',
      'Engagement letter (ISA 210) issued and signed for this financial year',
      'No management-integrity or scope-limitation red flags from prior years or the intake notes',
    ])}
    ${wpNotes('plan.notes.A1', 'Threats identified and safeguards applied…')}`);
}
function wpA2() {
  const m = S.tb.length ? model() : null;
  const q = wpGet('plan.mat', {});
  const yn = (k, label, hint) => {
    const v = wpGet(`plan.mat.${k}`, '');
    return `<div class="flex items-start justify-between gap-3 py-2 border-b border-line/60">
      <div class="text-[13px]">${label}${hint ? `<div class="text-[11.5px] text-mut">${hint}</div>` : ''}</div>
      <div class="flex gap-1 flex-none">
        <button class="btn ${v === 'y' ? 'btn-pri' : 'btn-ghost'} !py-1 !px-3 !text-[12px]" onclick="wpSet('plan.mat.${k}','y'); wpShow('A2')">Yes</button>
        <button class="btn ${v === 'n' ? 'btn-pri' : 'btn-ghost'} !py-1 !px-3 !text-[12px]" onclick="wpSet('plan.mat.${k}','n'); wpShow('A2')">No</button>
      </div></div>`;
  };
  // recommendation engine
  let bench = 'revenue', benchWhy = 'a stable, understandable base for an owner-managed entity';
  if (q.q3 === 'y' || (m && m.pbt <= 0)) { bench = q.q4 === 'y' ? 'assets' : 'revenue'; benchWhy = 'profit before tax is loss-making/marginal this year, so it is not a meaningful base'; }
  else if (q.q4 === 'y') { bench = 'assets'; benchWhy = 'the entity is asset-intensive, so total assets best reflect its scale'; }
  else if (q.q1 === 'y') { bench = 'pbt'; benchWhy = 'the entity is profit-oriented with stable earnings, so users focus on profit'; }
  const pmPct = q.q5 === 'y' ? '0.6' : '0.75';
  const benches = m ? { revenue: Math.max(Math.round(Math.abs(m.revenue) * .01), 1000), pbt: Math.max(Math.round(Math.abs(m.pbt) * .05), 1000), assets: Math.max(Math.round(Math.abs(m.totalAssets) * .015), 1000) } : null;
  const benchLabel = { revenue: '1% of revenue', pbt: '5% of profit before tax', assets: '1.5% of total assets' }[bench];
  const overall = benches ? benches[bench] : 0;
  const rationale = `Benchmark selected: ${benchLabel}, because ${benchWhy}. The primary users of these financial statements are ${q.q2 === 'y' ? 'the owner-directors, their bankers and the tax authorities' : 'the members and other external users'}. Performance materiality set at ${Math.round(parseFloat(pmPct) * 100)}% of overall materiality${q.q5 === 'y' ? ' to reflect the elevated engagement risk identified at planning' : ' (normal risk)'}, with a clearly trivial threshold of 5%.`;
  const applied = q.applied && S.audit.benchmark === bench && S.audit.pm === pmPct;
  return wpChrome('A2', 'Materiality', 'ISA 320', `
    <p class="text-[13px] text-mut mb-2">Answer the questions — the paper selects the benchmark <em>and</em> writes the rationale ISA 320 requires you to document.</p>
    ${yn('q1', 'Is the entity profit-oriented with reasonably stable earnings?', m ? `This year's PBT: ${fmtRM(m.pbt)}` : '')}
    ${yn('q2', 'Owner-managed, with bankers and LHDN as the main users of the accounts?', 'Typical Sdn Bhd profile')}
    ${yn('q3', 'Is the entity loss-making or at marginal profitability this year?', m && m.revenue ? `PBT margin ${pct(m.pbt / m.revenue * 100)}` : '')}
    ${yn('q4', 'Is the entity asset-intensive (property/investment holding)?', '')}
    ${yn('q5', 'Elevated engagement risk? (first audit, weak records, significant findings)', S.tb.length ? `${evaluate().open.filter(f => ['blocker','high'].includes(f.sev)).length} high-risk finding(s) open` : '')}
    <div class="mt-4 p-3 rounded-xl bg-indigosoft">
      <div class="text-[12px] font-semibold text-indigo uppercase tracking-wide mb-1">Recommendation</div>
      ${m ? `<table class="fs-doc" style="max-width:26rem">
        <tr><td>Benchmark</td><td class="num">${benchLabel}</td></tr>
        <tr><td>Overall materiality</td><td class="num mono">${fmtRM(overall)}</td></tr>
        <tr><td>Performance materiality (${Math.round(parseFloat(pmPct) * 100)}%)</td><td class="num mono">${fmtRM(Math.round(overall * parseFloat(pmPct)))}</td></tr>
        <tr><td>Clearly trivial (5%)</td><td class="num mono">${fmtRM(Math.round(overall * .05))}</td></tr>
      </table>` : '<p class="text-[13px] text-mut">Import the trial balance to compute the figures.</p>'}
      <p class="text-[12.5px] mt-2">${rationale}</p>
      <button class="btn ${applied ? 'btn-mint' : 'btn-pri'} mt-2" onclick="wpSet('plan.mat.applied', true); wpSet('plan.mat.rationale', ${JSON.stringify(rationale).replace(/"/g, '&quot;')}); S.audit.benchmark='${bench}'; S.audit.pm='${pmPct}'; saveState(); wpShow('A2'); toast('Materiality applied to the engagement')">
        ${applied ? '✓ Applied to the engagement' : 'Apply to the engagement'}</button>
    </div>`);
}
function wpA3() {
  const mat = materiality();
  const rows = WP_AREAS.map(([ref, title, cats]) => {
    const fig = wpAreaFigures(cats);
    const risk = wpAreaRisk(ref, cats, fig.gross);
    const approach = risk.abovePM || risk.level === 'high' ? 'Full substantive testing'
      : risk.level === 'medium' ? 'Analytical review + targeted tests' : 'Analytical review only';
    return `<tr>
      <td class="mono">${ref}</td><td>${title}</td>
      <td class="num mono">${fmt(fig.gross, true)}</td>
      <td>${risk.abovePM ? '<span class="pill pill-warn">above PM</span>' : '<span class="pill pill-mut">below PM</span>'}</td>
      <td><span class="pill ${risk.level === 'high' ? 'pill-risk' : risk.level === 'medium' ? 'pill-warn' : 'pill-ok'}">${risk.level}</span></td>
      <td class="text-[12px]">${approach}</td>
      <td><input class="field !py-1 !text-[12px]" placeholder="comment…" value="${esc(wpGet('plan.scope.' + ref, ''))}" onchange="wpSet('plan.scope.${ref}', this.value)"></td>
    </tr>`;
  }).join('');
  const highs = S.tb.length ? evaluate().open.filter(f => ['blocker','high'].includes(f.sev)) : [];
  return wpChrome('A3', 'Risk assessment & scoping', 'ISA 315', `
    <p class="text-[13px] text-mut mb-3">Every area classified against performance materiality of <span class="mono font-semibold">${fmtRM(mat.pm)}</span>. Above PM = significant account = full testing. Controls reliance: none — fully substantive approach (typical owner-managed SME; controls not tested).</p>
    <div class="overflow-x-auto"><table class="tbl min-w-[720px]">
      <thead><tr><th>Ref</th><th>Area</th><th class="num">Gross balance</th><th>vs PM</th><th>Inherent risk</th><th>Audit approach</th><th>Auditor's comment</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="mt-3 text-[13px]"><span class="font-semibold">Significant engagement risks:</span>
      ${highs.length ? `<ul class="list-disc pl-5 mt-1 space-y-0.5">${highs.map(f => `<li>${f.title} <span class="text-mut">(${f.law})</span></li>`).join('')}</ul>` : ' none identified above the high-risk threshold.'}</div>
    ${wpNotes('plan.notes.A3', 'Overall engagement risk, planned responses…')}`);
}
function wpA4() {
  return wpChrome('A4', 'Preliminary analytical review', 'ISA 520', `
    <p class="text-[13px] text-mut mb-3">Planning-stage analytics — identify where the numbers don't move as expected, and direct testing there.</p>
    ${wpRatioTable()}
    ${wpNotes('plan.notes.A4', 'Expectations vs actuals; unusual movements to follow up in fieldwork…')}`);
}
function wpA5() {
  const ds = deadlines();
  const mat = materiality();
  const applied = wpGet('plan.mat.applied', false);
  return wpChrome('A5', 'Audit strategy memorandum', 'ISA 300', `
    <div class="text-[13px] space-y-2">
      <p><strong>Entity.</strong> ${esc(S.setup.name)} — ${esc(S.setup.activity) || '[activity]'}, ${S.setup.framework} reporting, FYE ${dMY(S.setup.fye)}. ${esc((S.intake || {}).software) ? 'Records maintained on ' + esc(S.intake.software) + '.' : ''}</p>
      <p><strong>Materiality.</strong> ${applied ? `Overall ${fmtRM(mat.overall)} (${mat.label}); PM ${fmtRM(mat.pm)} — rationale documented at A2.` : 'Not yet documented — complete A2 first.'}</p>
      <p><strong>Approach.</strong> Fully substantive; no reliance on internal controls (owner-managed entity, limited segregation of duties). Significant accounts per the A3 scoping paper receive tests of detail with sampling per the lead schedules; remaining areas by analytical review.</p>
      <p><strong>Timing.</strong> ${ds.length ? `FS to be circulated by ${dMY(ds[0].date)}; SSM lodgement by ${dMY(ds[1] ? ds[1].date : ds[0].date)}; Form e-C due ${ds[2] ? dMY(ds[2].date) : '—'}.` : 'Set the FYE to compute statutory deadlines.'}</p>
      <p><strong>Team & review.</strong> ${S.sign.partner ? `Engagement partner ${esc(S.sign.partner)} (${esc(S.sign.firm)}).` : 'Engagement partner to be recorded on the Reports screen.'} All working papers reviewed before the report is signed; file assembled within 60 days of the report date.</p>
    </div>
    ${wpNotes('plan.notes.A5', 'Additional strategy considerations — experts needed, component work, prior-year issues brought forward…')}`);
}
function wpA6() {
  const ev = S.tb.length ? evaluate() : { open: [] };
  const flags = ev.open.filter(f => ['neg-gp', 'dir-adv', 'suspense', 'illegal-div', 'gp-swing'].includes(f.id));
  return wpChrome('A6', 'Fraud risk assessment', 'ISA 240', `
    <p class="text-[13px] text-mut mb-3">Two presumptions apply to every audit and cannot be rebutted lightly: fraud risk in revenue recognition, and management override of controls.</p>
    <table class="tbl mb-3"><tbody>
      <tr><td class="font-medium">Revenue recognition (presumed risk)</td><td class="text-[12.5px]">Response: cut-off testing either side of year end; bank-in completeness vs recorded takings; credit note review post year end.</td></tr>
      <tr><td class="font-medium">Management override (mandatory)</td><td class="text-[12.5px]">Response: journal entry testing (unusual/late/round-sum entries), review of estimates for bias, rationale for unusual transactions.</td></tr>
    </tbody></table>
    ${flags.length ? `<div class="text-[13px] mb-2"><span class="font-semibold">Fraud risk indicators from this file:</span>
      <ul class="list-disc pl-5 mt-1 space-y-0.5">${flags.map(f => `<li>${f.title}</li>`).join('')}</ul></div>` : ''}
    ${wpChecklist('A6', [
      'Engagement team discussion held on fraud susceptibility (ISA 240.15) — documented below',
      'Incentives/pressures considered (owner remuneration, tax minimisation, bank covenants)',
      'Opportunities considered (cash sales, weak segregation of duties, related-party channels)',
      'Attitudes/rationalisations considered (management tone, prior-year adjustments history)',
      'Journal entry testing scoped into fieldwork',
    ])}
    ${wpNotes('plan.notes.A6', 'Team discussion notes, identified fraud risks and responses…')}`);
}
function wpA7() {
  const m = S.tb.length ? model() : null;
  const ev = S.tb.length ? evaluate() : { gc: false };
  const ind = [];
  if (m && m.equity < 0) ind.push(`Negative shareholders' funds of ${fmtRM(m.equity)}`);
  if (m && m.netCurrent < 0) ind.push(`Net current liabilities of ${fmtRM(-m.netCurrent)}`);
  if (m && m.pbt < 0) ind.push(`Loss before tax of ${fmtRM(m.pbt)}`);
  return wpChrome('A7', 'Going concern — planning', 'ISA 570', `
    <div class="text-[13px] mb-3"><span class="font-semibold">Indicators from the numbers:</span>
      ${ind.length ? `<ul class="list-disc pl-5 mt-1">${ind.map(x => `<li>${x}</li>`).join('')}</ul>` : ' none — equity positive, net current assets, profitable.'}
      ${ev.gc ? '<div class="pill pill-warn mt-2">Engine flags going-concern uncertainty — extended procedures required</div>' : ''}</div>
    ${wpChecklist('A7', [
      'Management asked for its going-concern assessment covering ≥ 12 months from the report date',
      'Cash-flow forecast to be obtained and stress-tested',
      'Director/shareholder support letter planned (with assessment of the supporter’s capacity to pay)',
      'Banking facilities: limits, expiry and covenant compliance to be confirmed',
      'Post-year-end trading and collections to be reviewed',
    ])}
    ${wpNotes('plan.notes.A7', 'Preliminary assessment…')}`);
}
function wpA8() {
  const ev = S.tb.length ? evaluate() : { open: [] };
  const has = id => ev.open.some(f => f.id === id);
  const laws = [
    ['Companies Act 2016', 'Accounting records (s.245), FS circulation & lodgement (s.257–259), loans to directors (s.224/225), dividends (s.131)', has('dir-adv') || has('illegal-div')],
    ['Income Tax Act 1967', 'Form e-C, CP204 estimates, s.140B deemed interest, record keeping', false],
    ['Sales Tax / Service Tax Act 2018', 'Registration thresholds, SST-02 returns, service tax on F&B where applicable', has('sst')],
    ['EPF Act 1991 / SOCSO Act 1969', 'Monthly statutory contributions for all employees', has('no-epf')],
    ['LHDN e-Invoice mandate', 'MyInvois onboarding per turnover phase', has('einvoice')],
    ['Licensing', 'Local authority business/premise licences (industry-specific)', false],
  ];
  return wpChrome('A8', 'Laws & regulations', 'ISA 250', `
    <table class="tbl mb-3"><thead><tr><th>Law</th><th>Key obligations for this entity</th><th>Status</th></tr></thead>
    <tbody>${laws.map(([l, o, flag]) => `<tr><td class="font-medium">${l}</td><td class="text-[12.5px]">${o}</td>
      <td>${flag ? '<span class="pill pill-warn">finding raised</span>' : '<span class="pill pill-mut">no flag</span>'}</td></tr>`).join('')}</tbody></table>
    ${wpChecklist('A8', [
      'Management enquiry made on compliance with laws & regulations and any known breaches',
      'Correspondence with regulators (LHDN, Customs, SSM, local authority) reviewed',
      'Non-compliance identified is evaluated for FS impact (provisions, disclosures) and reporting obligations',
    ])}
    ${wpNotes('plan.notes.A8', '')}`);
}
function wpA9() {
  const fig = wpAreaFigures(['DIRADV', 'DIROWE', 'RPTREC', 'RPTPAY']);
  return wpChrome('A9', 'Related parties — planning', 'ISA 550 · MPERS s.33', `
    ${fig.rows.length ? `<table class="tbl mb-3"><thead><tr><th>Balance</th><th class="num">CY</th><th class="num">PY</th></tr></thead>
      <tbody>${fig.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num mono">${fmt(r.cy, true)}</td><td class="num mono text-mut">${fmt(r.py, true)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="text-[13px] text-mut mb-2">No related-party balances on the TB — completeness procedures still required.</p>'}
    ${wpChecklist('A9', [
      'Related parties identified: directors, shareholders and their close family; entities under common control (SSM searches)',
      'Balances and transactions confirmed directly with the related parties',
      'Terms established and disclosed (non-trade, unsecured, interest-free, repayable on demand — verify, don’t assume)',
      'Legality of loans to directors assessed (s.224/225 CA 2016); s.140B deemed interest passed to the tax computation',
      'Completeness: minutes, bank statements and contracts scanned for unrecorded related-party dealings',
    ])}
    ${wpNotes('plan.notes.A9', '')}`);
}

/* ---------- completion papers ---------- */
function wpB1() {
  return wpChrome('B1', 'Final analytical review', 'ISA 520', `
    <p class="text-[13px] text-mut mb-3">Performed at completion on the adjusted figures — do the FS as a whole make sense against our knowledge of the business?</p>
    ${wpRatioTable()}
    ${wpNotes('plan.notes.B1', 'Final view: results are consistent with our understanding because…')}`);
}
function wpB2() {
  if (!S.tb.length) return wpChrome('B2', 'Misstatement evaluation', 'ISA 450', '<p class="text-mut text-[13px]">Import a trial balance first.</p>');
  const ev = evaluate();
  return wpChrome('B2', 'Misstatement evaluation', 'ISA 450', `
    <table class="fs-doc" style="max-width:30rem">
      <tr><td>Overall materiality</td><td class="num mono">${fmtRM(ev.mat.overall)}</td></tr>
      <tr><td>Uncorrected misstatements</td><td class="num mono">${fmtRM(ev.totalMis)}</td></tr>
      <tr><td>Adjustments posted (corrected)</td><td class="num mono">${S.adjustments.length}</td></tr>
    </table>
    ${ev.uncorrected.length ? `<table class="tbl mt-3"><thead><tr><th>Uncorrected item</th><th class="num">Effect (RM)</th></tr></thead>
      <tbody>${ev.uncorrected.map(f => `<tr><td>${f.title}</td><td class="num mono">${fmt(f.misstate)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-[13px] text-ok mt-2">No uncorrected misstatements above the trivial threshold.</p>'}
    <div class="mt-3 p-3 rounded-xl bg-indigosoft text-[13px]">
      <span class="font-semibold">Effect on the opinion:</span> ${OPINION_LABEL[ev.opinion]}. ${ev.why}
      ${ev.gc ? '<br><span class="font-semibold">Going concern:</span> material uncertainty indicators present — see B4.' : ''}
    </div>
    <p class="text-[12.5px] text-mut mt-2">Uncorrected misstatements to be communicated to those charged with governance and included in the representation letter (B5).</p>`);
}
function wpB3() {
  return wpChrome('B3', 'Subsequent events', 'ISA 560', `
    <div class="mb-2"><label class="fieldlbl">Review performed up to (date)</label>
      <input class="field mono !w-48" type="date" value="${esc(wpGet('plan.seDate', ''))}" onchange="wpSet('plan.seDate', this.value)"></div>
    ${wpChecklist('B3', [
      'Post-year-end management accounts / bank statements reviewed',
      'Board minutes and significant contracts after year end read',
      'Receivable collections after year end traced (supports recoverability)',
      'Inventory selling prices after year end support NRV',
      'New litigation, claims or regulator correspondence enquired of management',
      'New borrowings, defaults or covenant breaches after year end checked',
      'Dividends declared after year end identified for disclosure',
    ])}
    ${wpNotes('plan.notes.B3', 'Events identified and their treatment (adjusting vs disclosure)…')}`);
}
function wpB4() {
  const ev = S.tb.length ? evaluate() : { gc: false };
  const v = wpGet('plan.gcConcl', '');
  const opt = (val, label) => `<label class="flex items-center gap-2 py-1 text-[13px]">
    <input type="radio" name="gcc" ${v === val ? 'checked' : ''} onchange="wpSet('plan.gcConcl','${val}'); ${val === 'mugc' ? "S.sign.goingconcern=true; saveState();" : val === 'ok' ? "S.sign.goingconcern=false; saveState();" : ''} wpShow('B4')"> ${label}</label>`;
  return wpChrome('B4', 'Going concern — conclusion', 'ISA 570', `
    <p class="text-[13px] mb-2">Engine assessment: ${ev.gc ? '<span class="pill pill-warn">material uncertainty indicators present</span>' : '<span class="pill pill-ok">no primary indicators</span>'} — see A7 for the planning-stage detail and evidence obtained.</p>
    <div class="mb-2">
      ${opt('ok', 'Going concern basis appropriate — no material uncertainty (unmodified report)')}
      ${opt('mugc', 'Going concern basis appropriate — material uncertainty exists and is adequately disclosed (MUGC paragraph in the report — auto-ticked on the Reports screen)')}
      ${opt('bad', 'Going concern basis NOT appropriate, or disclosure inadequate (qualified/adverse — partner decision)')}
    </div>
    ${wpNotes('plan.notes.B4', 'Evidence relied on: forecasts, support letters, facilities…')}`);
}
function wpB5() {
  const d1 = S.directors[0] ? esc(S.directors[0].name) : '[Director]';
  const fin = esc((S.intake || {}).finperson) || d1;
  const m = S.tb.length ? model() : null;
  const ev = S.tb.length ? evaluate() : null;
  return wpChrome('B5', 'Management representation letter', 'ISA 580', `
    <div class="rep-doc border border-line rounded-xl p-4" id="replet">
      <p class="text-[12px] text-mut">[On ${esc(S.setup.name) || 'client'} letterhead]</p>
      <p>${S.sign.date ? dMY(S.sign.date) : '[Date — same date as the auditor’s report]'}</p>
      <p><strong>${esc(S.sign.firm) || '[Audit firm]'}</strong><br>Chartered Accountants</p>
      <p>Dear Sirs,</p>
      <p><strong>Representation letter — audit of the financial statements for the year ended ${dMY(S.setup.fye)}</strong></p>
      <p>This letter is provided in connection with your audit of the financial statements of ${esc(S.setup.name)} for the year ended ${dMY(S.setup.fye)}. We confirm, to the best of our knowledge and belief, the following representations:</p>
      <p>1. We have fulfilled our responsibilities for the preparation of financial statements that give a true and fair view in accordance with the ${S.setup.framework === 'MPERS' ? 'Malaysian Private Entities Reporting Standard' : 'Malaysian Financial Reporting Standards'} and the Companies Act 2016.</p>
      <p>2. We have provided you with access to all information, records and personnel relevant to the audit, and all transactions have been recorded and are reflected in the financial statements.</p>
      <p>3. Significant assumptions used in making accounting estimates are reasonable.</p>
      <p>4. Related party relationships and transactions — including all balances with directors and entities under common control — have been disclosed to you and appropriately accounted for and disclosed.${m && (m.nat.DIRADV > 0 || m.nat.DIROWE > 0) ? ` The amount owing ${m.nat.DIRADV > 0 ? 'by' : 'to'} directors of ${fmtRM(m.nat.DIRADV || m.nat.DIROWE)} is unsecured, interest-free and repayable on demand.` : ''}</p>
      <p>5. All events subsequent to the reporting date requiring adjustment or disclosure have been adjusted or disclosed.</p>
      <p>6. We have disclosed to you all known instances of fraud, suspected fraud, or non-compliance with laws and regulations affecting the entity.</p>
      <p>7. We have no plans or intentions that may materially affect the carrying value or classification of assets and liabilities.</p>
      ${ev && ev.gc ? '<p>8. We confirm our assessment that the company remains a going concern, the feasibility of our plans to address the conditions creating doubt, and the completeness of the related disclosures. Undertakings of financial support obtained are within the capacity of the parties giving them.</p>' : ''}
      ${ev && ev.uncorrected.length ? `<p>${ev.gc ? 9 : 8}. We believe the effects of uncorrected misstatements aggregating ${fmtRM(ev.totalMis)} are immaterial, individually and in aggregate, to the financial statements as a whole.</p>` : ''}
      <p>Yours faithfully,</p>
      <div class="mt-8 grid grid-cols-2 gap-10" style="max-width:34rem">
        <div style="border-top:1px solid #1D1D1F; padding-top:.4rem"><strong>${d1}</strong><br>Director</div>
        <div style="border-top:1px solid #1D1D1F; padding-top:.4rem"><strong>${fin}</strong><br>${fin === d1 ? 'Director' : 'Person responsible for financial management'}</div>
      </div>
    </div>
    <p class="text-[12px] text-mut mt-2">Dated the same day as the auditor's report; signed before the report is released.</p>`);
}
function wpB6() {
  return wpChrome('B6', 'Completion checklist', 'ISQM 1 · ISA 230', repChecklistHTML());
}
function wpB7() {
  const notes = wpGet('plan.review', []);
  return wpChrome('B7', 'Partner review notes', 'ISA 220', `
    <div class="flex gap-2 mb-3">
      <input class="field" id="rv-new" placeholder="New review point — e.g. obtain the FreshMart supplier statement reconciliation">
      <button class="btn btn-pri flex-none" onclick="rvAdd()">Add</button>
    </div>
    ${notes.length ? notes.map((n, i) => `
      <div class="flex items-center gap-2 py-1.5 border-b border-line/60 ${n.done ? 'opacity-60' : ''}">
        <input type="checkbox" ${n.done ? 'checked' : ''} onchange="rvToggle(${i})">
        <span class="text-[13px] flex-1 ${n.done ? 'line-through' : ''}">${esc(n.t)}</span>
        <button class="btn btn-ghost !px-1.5 !py-1" onclick="rvDel(${i})" aria-label="Delete note">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#D70015" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>`).join('') : '<p class="text-[13px] text-mut">No open review points. The partner review must be evidenced before the report is signed.</p>'}`);
}
function rvAdd() { const v = $('rv-new').value.trim(); if (!v) return;
  const arr = wpGet('plan.review', []); arr.push({ t: v, done: false }); wpSet('plan.review', arr); wpShow('B7'); }
function rvToggle(i) { const arr = wpGet('plan.review', []); arr[i].done = !arr[i].done; wpSet('plan.review', arr); wpShow('B7'); }
function rvDel(i) { const arr = wpGet('plan.review', []); arr.splice(i, 1); wpSet('plan.review', arr); wpShow('B7'); }

/* ---------- lead schedules with sampling & testing ---------- */
const SMP_FACTORS = { high: 3.0, medium: 2.31, low: 1.61 };
function smpSet(ref, field, val) { if (!S.samples[ref]) S.samples[ref] = { rows: [] }; S.samples[ref][field] = val; saveState(); wpShow(ref); }
function smpRowAdd(ref) { if (!S.samples[ref]) S.samples[ref] = { rows: [] }; (S.samples[ref].rows = S.samples[ref].rows || []).push({ item: '', amt: '', result: 'ok', note: '' }); saveState(); wpShow(ref); }
function smpRowSet(ref, i, field, val) { S.samples[ref].rows[i][field] = val; saveState(); wpShow(ref); }
function smpRowDel(ref, i) { S.samples[ref].rows.splice(i, 1); saveState(); wpShow(ref); }
async function wpLead([ref, title, cats, evCat]) {
  const fig = wpAreaFigures(cats);
  // Equity schedule: TB only carries share capital + RE b/f — the current-year
  // profit lives in the P&L rows, so add it here or the total can never tie
  // to the FS equity figure.
  if (ref === 'L' && S.tb.length) {
    const mm = model();
    const pyPat = hasPY() ? model(true).pat : 0;
    fig.rows.push({ name:'Profit for the year (per adjusted TB)', cat:'RE', cy: mm.pat, py: pyPat, mv:null, isAdj:true });
    fig.tot += mm.pat; fig.totPy += pyPat;
  }
  // Does this schedule land on a single FS destination? If not, the footer
  // must not claim a single tie-out that doesn't exist.
  const dests = new Set(cats.map(c => {
    if (c === 'ACCDEP') return 'asset'; if (c === 'DIV') return 'equity';
    if (['SC','RE'].includes(c)) return 'equity';
    if (CAT[c].kind === 'pl') return CAT[c].side === -1 ? 'income' : 'expense';
    return CAT[c].side === 1 ? 'asset' : 'liability';
  }));
  const tiesToFs = dests.size === 1;
  const mat = materiality();
  const risk = wpAreaRisk(ref, cats, fig.gross);
  const smp = S.samples[ref] || { rows: [] };
  const pop = num(smp.pop) || Math.round(fig.gross);
  const keyAmt = num(smp.keyAmt) || 0;
  const rlevel = smp.risk || risk.level;
  const factor = SMP_FACTORS[rlevel] || 2.31;
  const interval = mat.pm > 0 ? Math.round(mat.pm / factor) : 0;
  const residual = Math.max(pop - keyAmt, 0);
  const n = interval > 0 ? Math.ceil(residual / interval) : 0;
  const rows = smp.rows || [];
  const sampledAmt = rows.reduce((s, r) => s + num(r.amt), 0);
  const excAmt = rows.filter(r => r.result === 'exception').reduce((s, r) => s + num(r.amt), 0);
  const projected = sampledAmt > 0 ? Math.round(excAmt / sampledAmt * residual) : 0;
  const kb = [...new Set(cats.flatMap(c => (KB[c] || { p: [] }).p))];
  const asserts = [...new Set(cats.map(c => (KB[c] || {}).a).filter(Boolean))].join(' · ');
  let evHTML = '<p class="text-[12.5px] text-mut">Sign in to see vault evidence.</p>';
  let evFileIds = [];
  try {
    const files = (await vaultListRows(S.id)).filter(f => f.category === evCat);
    evFileIds = files.map(f => f.id);
    evHTML = files.length ? files.map(f => `
      <div class="flex items-center gap-2 py-1 text-[12.5px]">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#0071E3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
        <button class="text-indigo hover:underline" onclick="vaultView('${f.id}')">${esc(f.file_name)}</button></div>`).join('')
      + `<button class="btn btn-ghost !py-1 !text-[11.5px] mt-1" onclick="wpAnalyzeEvidence('${ref}','${evCat.replace(/'/g,"\\'")}')">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/></svg>
          Analyze this evidence with AI</button><div id="wp-analysis-${ref}"></div>`
      : `<p class="text-[12.5px] text-warn">No evidence filed under “${evCat}” yet — <button class="text-indigo hover:underline" onclick="show('vault')">open the vault</button>.</p>`;
  } catch (e) {}
  return wpChrome(ref, title + ' — lead schedule', `ties to FS · assertions: ${asserts || '—'}`, `
    <div class="flex flex-wrap gap-2 mb-3">
      ${risk.abovePM ? '<span class="pill pill-warn">above PM — significant account</span>' : '<span class="pill pill-mut">below PM</span>'}
      <span class="pill ${risk.level === 'high' ? 'pill-risk' : risk.level === 'medium' ? 'pill-warn' : 'pill-ok'}">inherent risk: ${risk.level}</span>
      <span class="pill pill-info mono">PM ${fmtRM(mat.pm)}</span>
    </div>
    ${fig.rows.length ? `<table class="tbl mb-1"><thead><tr><th>GL account</th><th class="num">CY (RM)</th><th class="num">PY (RM)</th><th class="num">Mvmt</th></tr></thead>
      <tbody>${fig.rows.map(r => `<tr class="${r.isAdj ? 'text-indigo' : ''}"><td>${esc(r.name)}</td><td class="num mono">${fmt(r.cy, true)}</td>
        <td class="num mono text-mut">${fmt(r.py, true)}</td>
        <td class="num mono ${r.mv !== null && Math.abs(r.mv) > 25 ? 'text-warn font-semibold' : ''}">${r.mv === null ? '–' : (r.mv > 0 ? '+' : '') + r.mv.toFixed(0) + '%'}</td></tr>`).join('')}
      </tbody><tfoot><tr class="font-semibold"><td>${tiesToFs ? 'Total — agrees to the financial statements' : 'Net per schedule — components tie to separate FS lines (not netted in the FS)'}</td><td class="num mono">${fmt(fig.tot, true)}</td><td class="num mono">${fmt(fig.totPy, true)}</td><td></td></tr></tfoot></table>
      <p class="text-[11.5px] text-mut mb-3">${tiesToFs ? 'Wired live from the adjusted trial balance — this total flows into the statements and the notes automatically, so the tie-out cannot break.' : 'Wired live from the adjusted trial balance. This schedule spans more than one FS caption — each component ties to its own line; the net figure here is for the working paper only.'}</p>`
      : '<p class="text-[13px] text-mut mb-3">No accounts classified to this area on the current TB.</p>'}
    ${risk.hits.length ? `<div class="text-[13px] mb-3"><span class="font-semibold">Open findings on this area:</span>
      <ul class="list-disc pl-5 mt-1">${risk.hits.map(f => `<li>${f.title} <span class="pill ${['blocker','high'].includes(f.sev) ? 'pill-risk' : f.sev === 'medium' ? 'pill-warn' : 'pill-info'}">${f.sev}</span></li>`).join('')}</ul></div>` : ''}
    <div class="text-[13px] mb-3"><span class="font-semibold">Procedures for this area:</span>
      <ul class="list-disc pl-5 mt-1 space-y-0.5 text-[12.5px]">${kb.map(p => `<li>${p}</li>`).join('') || '<li>Standard substantive procedures</li>'}</ul></div>
    <div class="text-[13px] mb-4"><span class="font-semibold">Evidence on file (${evCat}):</span>${evHTML}</div>

    <div class="border border-line rounded-xl p-3.5 mb-2">
      <div class="font-semibold text-[13.5px] mb-1">Sampling & testing (monetary-unit method)</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
        <div><label class="fieldlbl">Population (RM)</label><input class="field mono !py-1.5" value="${smp.pop ? fmt(num(smp.pop)) : fmt(pop)}" onchange="smpSet('${ref}','pop',this.value)"></div>
        <div><label class="fieldlbl">Key items ≥ interval, tested 100% (RM)</label><input class="field mono !py-1.5" value="${smp.keyAmt ? fmt(num(smp.keyAmt)) : ''}" placeholder="0" onchange="smpSet('${ref}','keyAmt',this.value)"></div>
        <div><label class="fieldlbl">Risk (reliability factor)</label>
          <select class="field !py-1.5" onchange="smpSet('${ref}','risk',this.value)">
            <option value="high" ${rlevel === 'high' ? 'selected' : ''}>High (3.0)</option>
            <option value="medium" ${rlevel === 'medium' ? 'selected' : ''}>Medium (2.31)</option>
            <option value="low" ${rlevel === 'low' ? 'selected' : ''}>Low (1.61)</option>
          </select></div>
        <div><label class="fieldlbl">Computed</label>
          <div class="text-[12.5px] mono pt-2">interval ${fmtRM(interval)}<br><span class="font-semibold">sample n = ${n}</span></div></div>
      </div>
      <table class="tbl"><thead><tr><th>Item tested (ref / description)</th><th class="num">Amount (RM)</th><th>Result</th><th>Note</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td><input class="field !py-1 !text-[12px]" value="${esc(r.item)}" onchange="smpRowSet('${ref}',${i},'item',this.value)"></td>
        <td class="num"><input class="field mono !py-1 !text-[12px] !text-right !w-28" value="${r.amt ? fmt(num(r.amt)) : ''}" onchange="smpRowSet('${ref}',${i},'amt',this.value)"></td>
        <td><select class="field !py-1 !text-[12px] !w-28" onchange="smpRowSet('${ref}',${i},'result',this.value)">
          <option value="ok" ${r.result !== 'exception' ? 'selected' : ''}>Agreed</option>
          <option value="exception" ${r.result === 'exception' ? 'selected' : ''}>Exception</option></select></td>
        <td><input class="field !py-1 !text-[12px]" value="${esc(r.note)}" onchange="smpRowSet('${ref}',${i},'note',this.value)"></td>
        <td><button class="btn btn-ghost !px-1.5 !py-0.5" onclick="smpRowDel('${ref}',${i})" aria-label="Remove row">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#D70015" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></td>
      </tr>`).join('')}</tbody></table>
      <div class="flex flex-wrap items-center gap-3 mt-2">
        <button class="btn btn-ghost !py-1.5" onclick="smpRowAdd('${ref}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add tested item</button>
        <span class="text-[12.5px] mono ml-auto">tested ${fmtRM(sampledAmt)} · exceptions ${fmtRM(excAmt)}
          ${excAmt > 0 ? ` · <span class="${projected > mat.pm ? 'text-risk' : 'text-warn'} font-semibold">projected misstatement ${fmtRM(projected)}</span>` : ''}</span>
      </div>
      ${projected > 0 ? `<p class="text-[12px] ${projected > mat.overall ? 'text-risk' : 'text-warn'} mt-1">Projected misstatement ${projected > mat.overall ? 'EXCEEDS overall materiality — extend testing or propose an adjustment (Audit Engine → AJE register)' : 'is below overall materiality — carry to the ISA 450 evaluation (B2) as an uncorrected item if not adjusted'}.</p>` : ''}
    </div>
    ${wpNotes(`plan.notes.${ref}`, 'Facts extracted from evidence, testing observations…')}`);
}
async function wpAnalyzeEvidence(ref, evCat) {
  const slot = $('wp-analysis-' + ref);
  if (!slot) return;
  const files = (await vaultListRows(S.id)).filter(f => f.category === evCat);
  if (!files.length) return;
  slot.innerHTML = `<div class="border border-indigo/30 rounded-xl p-3 mt-2 bg-white">
    <div class="flex items-center gap-2"><span class="pill pill-info">Mr Auditor AI</span>
    <span class="text-[12px] text-mut">reading ${files.length} document(s) in full…</span></div></div>`;
  try {
    const result = await aiRequestDocs(
      `You are testing the "${ref}" lead schedule. Read every document filed as its evidence ("${evCat}") in full and extract the concrete facts relevant to this audit area: figures, dates, counterparties, balances confirmed, terms, and anything that agrees or disagrees with the trial balance figures already in your context. Cite the specific document for each fact.`,
      files.map(f => f.id));
    slot.innerHTML = `<div class="border border-indigo/30 rounded-xl p-3 mt-2 bg-white">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2"><span class="pill pill-info">Mr Auditor AI</span>
        <span class="text-[11px] text-mut">${result.documentsRead || 0} document(s) read in full</span></div>
        <button class="btn btn-ghost !py-1 !text-[11.5px]" onclick="wpAnalyzeToNotes('${ref}', this)">Add to notes below</button>
      </div>
      ${result.skipped && result.skipped.length ? `<div class="text-[11.5px] text-warn mb-2">Not read: ${result.skipped.map(s=>`${esc(s.name)} (${esc(s.reason)})`).join('; ')}</div>` : ''}
      <div class="text-[13px] leading-relaxed" data-ai-text="${encodeURIComponent(result.answer||'')}">${aiFormat(result.answer || '')}</div>
    </div>`;
    logActivity('Analyzed evidence with AI', `${ref} · ${result.documentsRead||0} document(s), ${(result.skipped||[]).length} skipped`);
  } catch (e) {
    slot.innerHTML = `<div class="border border-line rounded-xl p-3 mt-2 text-[12.5px] text-mut">Could not analyze: ${esc(e.message||'unknown error')}</div>`;
  }
}
function wpAnalyzeToNotes(ref, btn) {
  const text = decodeURIComponent(btn.closest('div.border').querySelector('[data-ai-text]').dataset.aiText);
  const existing = wpGet(`plan.notes.${ref}`, '');
  wpSet(`plan.notes.${ref}`, (existing ? existing + '\n\n' : '') + `[AI-drafted document analysis, ${dMY(dISO(new Date()))} — verify against source documents; this paper's sign-off covers the content]\n${text}`);
  wpShow(ref);
  toast('Added to working paper notes');
}

/* ---------- audit file screen ---------- */
function wpIndexHTML() {
  const dot = ref => { const st = wpStatus(ref);
    return `<span class="inline-block w-2 h-2 rounded-full flex-none ${st === 'rev' ? 'bg-mint' : st === 'prep' ? 'bg-warn' : 'bg-line'}"></span>`; };
  const item = (ref, title) => `
    <div class="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer ${curWp === ref ? 'bg-indigosoft text-indigo font-semibold' : 'hover:bg-paper'}" onclick="wpShow('${ref}')">
      ${dot(ref)}<span class="mono text-[11px] w-6 flex-none">${ref}</span><span class="truncate">${title}</span></div>`;
  const grp = label => `<div class="text-[10px] font-semibold uppercase tracking-wider text-mut px-2 pt-3 pb-1">${label}</div>`;
  return grp('A · Planning') + WP_PLAN.map(([r, t]) => item(r, t)).join('')
    + grp('Lead schedules') + WP_AREAS.map(([r, t]) => item(r, t)).join('')
    + grp('B · Completion') + WP_COMPL.map(([r, t]) => item(r, t)).join('');
}
function wpIndexRefresh() {
  const el = $('wp-index'); if (!el) return;
  el.innerHTML = wpIndexHTML();
  const total = WP_PLAN.length + WP_AREAS.length + WP_COMPL.length;
  const signed = [...WP_PLAN, ...WP_AREAS, ...WP_COMPL].filter(([r]) => wpStatus(r) !== 'none').length;
  const pg = $('wp-progress'); if (pg) pg.textContent = `${signed}/${total} signed`;
  document.querySelectorAll('#nav-wp-count').forEach(e => e.textContent = signed || '');
}
async function wpShow(ref) {
  curWp = ref;
  wpIndexRefresh();
  const all = [...WP_PLAN, ...WP_COMPL];
  const meta = all.find(([r]) => r === ref);
  const area = WP_AREAS.find(([r]) => r === ref);
  $('wp-crumb').innerHTML = `Audit file → <span class="font-semibold text-ink">${ref} · ${meta ? meta[1] : area ? area[1] : ''}</span>`;
  const fns = { A1: wpA1, A2: wpA2, A3: wpA3, A4: wpA4, A5: wpA5, A6: wpA6, A7: wpA7, A8: wpA8, A9: wpA9,
    B1: wpB1, B2: wpB2, B3: wpB3, B4: wpB4, B5: wpB5, B6: wpB6, B7: wpB7 };
  $('wp-render').innerHTML = '<div class="text-mut text-[13px]">Loading…</div>';
  $('wp-render').innerHTML = area ? await wpLead(area) : fns[ref] ? fns[ref]() : '';
}
function renderWps() { wpIndexRefresh(); wpShow(curWp); }

/* ============================================================
   DEFENCE & POSITIONS — AI position papers + cross-examination
   ============================================================ */
async function aiRequest(question) {
  const r = await aiRequestDocs(question, []);
  return r.answer;
}
/* Document-grounded AI call — passes real vault document IDs through to the
   edge function, which downloads them and attaches them to Claude natively
   (full PDF/image reading, not a filename reference). Returns
   { answer, skipped, documentsRead } — skipped[] must always be surfaced to
   the user, never swallowed, so nothing is "read" silently only in name. */
async function aiRequestDocs(question, documentIds) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sign in to use the AI');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ask-mr-auditor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ question, context: aiContext(), documentIds: documentIds && documentIds.length ? documentIds : undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `AI service error (${res.status})`);
  return { answer: data.answer || '', skipped: data.skipped || [], documentsRead: data.documentsRead || 0 };
}
function defenceTopics() {
  const base = [
    ['revenue', 'Revenue recognition & completeness'],
    ['going-concern', 'Going concern assessment'],
  ];
  if (!S.tb.length) return base;
  const map = { 'dir-adv': 'Director’s advances — legality & recoverability (s.224/225, s.140B)',
    'no-depr': 'Depreciation estimate & PPE carrying value', 'neg-cash': 'Overdrawn bank reclassification',
    'suspense': 'Suspense account treatment', 'rec-days': 'Receivables recoverability & impairment',
    'inv-days': 'Inventory NRV', 'neg-gp': 'Negative margin & revenue completeness',
    'illegal-div': 'Dividend legality (s.131/132 CA 2016)', 'sst': 'SST registration exposure',
    'no-epf': 'EPF/SOCSO compliance exposure', 'neg-equity': 'Negative equity & solvency' };
  for (const f of evaluate().open) if (map[f.id] && !base.some(x => x[0] === f.id)) base.push([f.id, map[f.id]]);
  return base;
}
function renderDefence() {
  const topics = defenceTopics();
  const cross = S.defence.find(d => d.topic === 'cross-exam');
  const card = (topic, title) => {
    const paper = S.defence.find(d => d.topic === topic);
    return `
    <div class="card card-pad" id="defcard-${topic}">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="font-semibold text-[14px]">${title}</div>
        ${paper ? `<button class="btn btn-ghost !py-1 !px-2" onclick="printSection('def-${topic}')" title="Print">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg></button>` : ''}
      </div>
      ${paper ? `<div class="text-[13px] leading-relaxed max-h-72 overflow-y-auto" id="def-${topic}">${aiFormat(paper.text)}</div>
        <div class="flex items-center gap-2 mt-3">
          <span class="text-[11px] text-mut">drafted ${new Date(paper.ts).toLocaleDateString('en-MY')}</span>
          <button class="btn btn-ghost !py-1 !text-[12px] ml-auto" onclick="defenceGenerate('${topic}', ${JSON.stringify(title).replace(/"/g, '&quot;')})">Regenerate</button>
        </div>`
      : `<p class="text-[12.5px] text-mut mb-3">No position paper yet.</p>
        <button class="btn btn-pri !py-1.5" onclick="defenceGenerate('${topic}', ${JSON.stringify(title).replace(/"/g, '&quot;')})">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/></svg>
          Draft the position paper</button>`}
    </div>`;
  };
  $('defence-list').innerHTML =
    (cross ? `<div class="card card-pad lg:col-span-2" id="defcard-cross-exam">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="font-semibold text-[14px]">Cross-examination — the reviewer's hardest questions</div>
        <button class="btn btn-ghost !py-1 !px-2" onclick="printSection('def-cross-exam')" title="Print">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg></button>
      </div>
      <div class="text-[13px] leading-relaxed" id="def-cross-exam">${aiFormat(cross.text)}</div>
    </div>` : '') +
    topics.map(([t, title]) => card(t, title)).join('');
  staggerChildren('defence-list', 40);
}
async function defenceGenerate(topic, title) {
  const el = $('defcard-' + topic);
  if (el) el.innerHTML = `<div class="flex items-center gap-2"><span class="pill pill-info">Mr Auditor AI</span><span class="text-[12.5px] text-mut">drafting the position paper…</span></div>`;
  try {
    const answer = await aiRequest(`Draft a defence position paper for the audit judgement: "${title}" on this engagement. Structure it exactly as: **1. Our position** — the treatment taken in this file and its basis, citing the specific MPERS/ISA/CA 2016/ITA 1967 provisions and the actual figures from the engagement context. **2. Anticipated challenges** — the questions a MIA practice reviewer or LHDN officer would raise on this position. **3. Prepared responses** — the rebuttal to each challenge, pointing to the evidence and working papers this file should hold. Keep it tight and usable as a working paper.`);
    S.defence = S.defence.filter(d => d.topic !== topic);
    S.defence.push({ topic, title, text: answer, ts: Date.now() });
    saveState();
  } catch (e) { toast(e.message); }
  renderDefence();
}
async function defenceCrossExam() {
  const btnState = S.defence.find(d => d.topic === 'cross-exam');
  toast(btnState ? 'Re-running the cross-examination…' : 'Cross-examining the file…');
  try {
    const answer = await aiRequest(`Act as a MIA practice reviewer performing a cold review of this audit file. Based on the engagement context, ask the 8 hardest questions you would put to the engagement partner — the ones most likely to expose weaknesses in this specific file. For each: state the question, why you are asking it (what the data suggests), and what a satisfactory answer must contain. Number them 1–8.`);
    S.defence = S.defence.filter(d => d.topic !== 'cross-exam');
    S.defence.push({ topic: 'cross-exam', title: 'Cross-examination', text: answer, ts: Date.now() });
    saveState();
  } catch (e) { toast(e.message); }
  renderDefence();
}

/* ---------- reference ---------- */
function renderRef() {
  const card = (title, body) => `<div class="card card-pad"><h2 class="font-bold text-[15px] mb-2">${title}</h2><div class="text-[13px] leading-relaxed space-y-2">${body}</div></div>`;
  $('ref-render').innerHTML = [
    card('Audit exemption — PD 10/2024 (SSM)', `
      <p>Private companies may skip the audit if they meet <strong>any 2 of 3</strong> criteria in the current + two preceding FYs:</p>
      <table class="tbl"><thead><tr><th>FY commencing</th><th class="num">Revenue ≤</th><th class="num">Assets ≤</th><th class="num">Employees ≤</th></tr></thead>
      <tbody><tr><td>2025</td><td class="num">RM1.0m</td><td class="num">RM1.0m</td><td class="num">10</td></tr>
      <tr><td>2026</td><td class="num">RM2.0m</td><td class="num">RM2.0m</td><td class="num">20</td></tr>
      <tr><td>2027+</td><td class="num">RM3.0m</td><td class="num">RM3.0m</td><td class="num">30</td></tr></tbody></table>
      <p>Dormant companies also qualify. Not available to: EPCs filing the s.260 certificate, subsidiaries of public companies, foreign companies. Members ≥5% can still demand an audit; unaudited FS + certificate still lodged via MBRS.</p>`),
    card('Financial statements clock — CA 2016', `
      <p><strong>s.248–249</strong>: directors must prepare FS within 6 months of FYE (18 months from incorporation for the first FS), compliant with approved accounting standards.</p>
      <p><strong>s.251–252</strong>: FS approved by the board; Statement by Directors + Statutory Declaration attached.</p>
      <p><strong>s.257–258</strong>: circulate audited FS to members within 6 months of FYE (private company).</p>
      <p><strong>s.259</strong>: lodge with SSM within 30 days of circulation — via <strong>MBRS 2.0</strong> (XBRL, mandatory for all FS filings since 1 June 2025 rollout completion).</p>
      <p>Penalty: fine up to RM50,000 + RM1,000/day continuing.</p>`),
    card('Reporting frameworks', `
      <p><strong>MPERS</strong> — private entities (word-for-word IFRS for SMEs, adapted). Cost-model options, simplified instruments, lighter disclosures.</p>
      <p><strong>MFRS</strong> — full IFRS-equivalent; mandatory for entities that file with SC/BNM or subsidiaries/associates of such filers; private entities may opt in.</p>
      <p>Switching frameworks is a first-time-adoption exercise — don't do it casually.</p>`),
    card('Auditor licensing — who can sign', `
      <p>Only an <strong>approved company auditor</strong> — MIA chartered accountant holding a Ministry of Finance audit approval under <strong>s.263 CA 2016</strong>, practising through a registered audit firm (AF number). The report is addressed solely to the members per <strong>s.266</strong>.</p>
      <p>Auditor must report whether FS give a true and fair view, and whether accounting records per <strong>s.245</strong> are properly kept. Audit follows Malaysian Approved Standards on Auditing (= ISAs) with ISQM 1/2 at firm level.</p>`),
    card('Corporate tax — ITA 1967', `
      <p><strong>SME (paid-up ≤ RM2.5m, gross income ≤ RM50m, ≤20% foreign/corporate ownership)</strong>: 15% on first RM150k, 17% on next RM450k, 24% on balance. Others: flat 24%.</p>
      <p><strong>Form e-C</strong>: 7 months after FYE. <strong>CP204</strong>: estimate 30 days before basis period; minimum 85% of prior estimate; revisions in 6th/9th (and 11th) months; >30% underestimate → 10% penalty on the excess (s.107C).</p>
      <p>Common add-backs: book depreciation (replaced by Sch 3 capital allowances), 50% entertainment, fines/penalties, unapproved donations, unrealised forex, s.140B deemed interest on director loans.</p>`),
    card('What practice reviewers punish (MIA)', `
      <p>The recurring findings from MIA Practice Review / AOB inspections:</p>
      <p>1. <strong>Documentation</strong> — working papers missing partner review evidence, key judgements, or linkage from risk to procedures.<br>
      2. <strong>Generic risk assessments</strong> — checklists not tailored to the client (ISA 315).<br>
      3. <strong>ISQM 1 manuals copied</strong> from templates without customisation; no monitoring/RCA cycle.<br>
      4. <strong>Partner involvement post-signing</strong> instead of during the audit.<br>
      5. <strong>Going concern</strong> — support letters obtained without assessing supporter capacity.</p>
      <p>Mr Auditor's findings cards + completion checklist are built to close exactly these gaps.</p>`),
  ].join('');
}

/* ---------- print ---------- */
function printSection(id) {
  const z = $('print-zone');
  z.innerHTML = $(id).innerHTML;
  z.classList.remove('hidden');
  window.print();
  setTimeout(() => z.classList.add('hidden'), 500);
}

/* ---------- persistence ---------- */
function saveState(announce) {
  // Backstop for the archived state: nothing persists to the cloud from an
  // archived file, whatever path tried to mutate it.
  if (isArchived()) { if (announce) guardArchived(); return; }
  try { localStorage.setItem('mr-auditor-v2', JSON.stringify(DB)); } catch(e) {}
  if (sb && authUser) {
    const client = S;
    clearTimeout(_cloudTimers[client.id]);
    if (announce) cloudPushEngagement(client).then(() => toast('Saved to your account'));
    else _cloudTimers[client.id] = setTimeout(() => cloudPushEngagement(client), 800);
  } else if (announce) toast('Saved locally');
}
function hydrate(d) {
  const c = Object.assign(BLANK(), d);
  c.setup = Object.assign(BLANK().setup, d.setup); c.tax = Object.assign(BLANK().tax, d.tax);
  c.sign = Object.assign(BLANK().sign, d.sign); c.audit = Object.assign(BLANK().audit, d.audit);
  c.notes = Object.assign({}, d.notes);
  c.plan = Object.assign({}, d.plan); c.wpSign = Object.assign({}, d.wpSign);
  c.samples = Object.assign({}, d.samples); c.defence = Array.isArray(d.defence) ? d.defence : [];
  return c;
}

/* ---------- cloud sync (Supabase) ---------- */
const _cloudTimers = {};
async function cloudPushEngagement(client) {
  if (!sb || !authUser) return;
  // Update-then-insert rather than upsert: a shared engagement is saved by a
  // team member who is NOT the owner, and the update payload must never carry
  // the owner column (RLS would reject it, and a member must not be able to
  // claim ownership).
  const { _owner, _members, ...persistable } = client;
  const payload = { name: client.setup.name || '', fye: client.setup.fye || null, data: persistable };
  const { data, error } = await sb.from('engagements').update(payload).eq('id', client.id).select('id');
  if (error) { console.error('cloud save failed', error); return; }
  if (!data || !data.length) {
    const { error: insErr } = await sb.from('engagements').insert({ id: client.id, owner: authUser.id, ...payload });
    if (insErr) console.error('cloud save failed', insErr);
  }
}
async function cloudDeleteEngagement(id) {
  if (!sb || !authUser) return;
  const { error } = await sb.from('engagements').delete().eq('id', id);
  if (error) console.error('cloud delete failed', error);
}
async function cloudLoadEngagements() {
  if (!sb || !authUser) return [];
  // No owner filter — RLS returns engagements I own plus ones shared with me.
  const { data, error } = await sb.from('engagements').select('id,owner,data').order('created_at', { ascending:true });
  if (error || !data) return [];
  return data.map(row => { const c = hydrate(row.data); c.id = row.id; c._owner = row.owner; return c; });
}

/* ---------- reset ---------- */
async function resetAllData() {
  if (!confirm('Delete every engagement (including all vault documents) and start with a single blank one? This cannot be undone.')) return;
  const all = [...DB.clients];
  for (const c of all) {
    await cloudDeleteEngagementFiles(c.id).catch(()=>{});
    await cloudDeleteEngagement(c.id).catch(()=>{});
  }
  const fresh = Object.assign(BLANK(), { id:nid(), created:Date.now() });
  DB = { ver:2, activeId: fresh.id, clients:[fresh] };
  S = fresh;
  saveState();
  updateTop();
  show('home');
  toast('All engagements cleared — starting fresh');
}

/* ---------- demo: TPO Sdn Bhd (restaurant) ---------- */
const DEMO_NAMES = ['TPO Sdn Bhd', 'Delta Precision Engineering Sdn. Bhd.'];
async function loadDemo() {
  // demo lives in its own engagement — never wipes real clients
  const stale = DB.clients.filter(c => DEMO_NAMES.includes(c.setup.name));
  DB.clients = DB.clients.filter(c => !stale.includes(c));
  for (const old of stale) {
    await cloudDeleteEngagementFiles(old.id).catch(()=>{});
    await cloudDeleteEngagement(old.id).catch(()=>{});
  }
  // drop the initial empty shell if untouched
  DB.clients = DB.clients.filter(c => c.setup.name || c.tb.length);
  const c = Object.assign(BLANK(), { id:nid(), created:Date.now() });
  DB.clients.push(c); DB.activeId = c.id; S = c;
  const fyeYear = new Date().getFullYear() - 1;
  S.setup = { name:'TPO Sdn Bhd', regno:'201901022334 (1329988-P)',
    incdate:'2019-03-12', fye:`${fyeYear}-12-31`, activity:'operation of a restaurant and catering services',
    framework:'MPERS', capital:'300000', employees:'16', firstaudit:'no', foreign:'no',
    address:'No. 12, Jalan SS2/61, 47300 Petaling Jaya, Selangor' };
  S.directors = [ {name:'Pang Tze Onn', ic:'800505-14-5011', shares:'180000'}, {name:'Lim Mei Fong', ic:'850912-10-6244', shares:'120000'} ];
  S.intake = { finperson:'Pang Tze Onn', contact:'Lim Mei Fong', email:'accounts@tpo.my', phone:'+60 12-338 8112',
    prevauditor:'', software:'SQL Account', banks:'Maybank (CA + term loan), CIMB (CA), Public Bank (FD)',
    borrowings:'yes', sst:'yes', einvoice:'no', bookkeeping:'average',
    risknotes:'Mostly cash & card sales through POS; director takes advances; kitchen renovation done 2 years ago. Pandemic-era accumulated losses now recovering — director support of RM618k partly repaid during the year.' };
  const rows = [
    // name, dr, cr, py(natural magnitude)
    ['Sales — restaurant', 0, 2845000, 2510000],
    ['Sales — catering', 0, 186000, 142000],
    ['Interest income — fixed deposit', 0, 3800, 3600],
    ['Food & beverage purchases', 1152000, 0, 1004000],
    ['Salaries and wages', 598000, 0, 546000],
    ['EPF contributions', 71800, 0, 65500],
    ['SOCSO & EIS', 11200, 0, 10300],
    ['Rental of premises', 216000, 0, 216000],
    ['Utilities', 96500, 0, 88200],
    ['Kitchen gas & fuel', 38400, 0, 35100],
    ['Upkeep & cleaning', 21700, 0, 19800],
    ['Entertainment', 12800, 0, 9600],
    ['Fines and penalties', 2400, 0, 800],
    ['Marketing & delivery platform commission', 84300, 0, 61500],
    ['Insurance', 14200, 0, 13600],
    ['Professional fees', 18500, 0, 17200],
    ['Licenses & permits', 9600, 0, 9200],
    ['Bank charges & card commissions', 28900, 0, 24400],
    ['Interest on term loan', 31200, 0, 36800],
    ['Hire purchase interest', 6400, 0, 8100],
    ['Kitchen equipment & renovation — cost', 685000, 0, 685000],
    ['Accumulated depreciation', 0, 274000, 274000],
    ['Inventories — food & beverage', 24600, 0, 21300],
    ['Trade receivables — catering', 68400, 0, 41200],
    ['Deposits & prepayments', 64000, 0, 60000],
    ['Amount owing by director', 95000, 0, 60000],
    ['Fixed deposit — Public Bank', 120000, 0, 120000],
    ['Maybank current account', 268400, 0, 195600],
    ['CIMB current account', 0, 9850, 12000],
    ['Cash floats', 6000, 0, 6000],
    ['Suspense account', 5200, 0, 0],
    ['Trade payables', 0, 156700, 141800],
    ['Accruals and other payables', 0, 48300, 44100],
    ['SST payable', 0, 14300, 12600],
    ['Amount owing to director', 0, 180000, 618550],
    ['Term loan — Maybank', 0, 285000, 342000],
    ['Hire purchase payables', 0, 64500, 92000],
    ['Provision for taxation', 0, 38000, 31000],
    ['Share capital', 0, 300000, 300000],
  ];
  let dr = 0, cr = 0;
  for (const [name, d, cc] of rows) { dr += d; cr += cc; }
  // retained earnings b/f as the balancing figure (credit if dr>cr).
  // PY value: accumulated losses at the START of the prior year, chosen so the
  // PY column articulates AND rolls forward (RE b/f CY = RE b/f PY + PY profit).
  const rePlug = dr - cr;
  rows.push(['Retained earnings b/f', rePlug < 0 ? -rePlug : 0, rePlug > 0 ? rePlug : 0, -1144450]);
  S.tb = rows.map(([name, d, cc, py]) => {
    const cat = classify(name, d, cc);
    return { id:nid(), name, cat, dr: d||'', cr: cc||'', py: py||'', autoWeak: !RULES.some(([re])=>re.test(name)) };
  });
  S.tax = Object.assign(BLANK().tax, { entertain:'6400', fines:'2400', ca:'52000', cp204:'60000' });
  // note details consistent with the mock vault documents, so a fresh demo
  // pack renders with zero unresolved placeholders
  S.notes = { termsGiven:'30 days', termsRecd:'30 to 60 days', deprRates:'10% to 20% (straight-line)',
    fdRate:'2.60%', borrSec:'a first legal charge over the shop-lot premises and the directors’ joint and several guarantee',
    borrRate:'4.75%', hpCurrent:'27500', auditFee:'12000', dirRem:'186000' };
  S.sign = Object.assign(BLANK().sign, { place:'Petaling Jaya', date: dISO(new Date()) });
  saveState();
  if (sb && authUser) await cloudPushEngagement(c);
  show('dashboard');
  toast('Demo loaded — TPO Sdn Bhd. Filing the evidence vault…');
  const filed = await demoSeedVault(c.id);
  updateTop();
  if (current === 'vault') renderVault();
  toast(filed ? `TPO Sdn Bhd ready — ${filed} documents filed in the evidence vault` : 'TPO Sdn Bhd ready (sign in to file vault documents)');
}

/* mock client documents, consistent with the TPO trial balance */
function demoDocs() {
  const fy = new Date().getFullYear() - 1;
  const tbCsv = 'Account,Debit,Credit,Prior year\n' + S.tb.map(r =>
    `"${r.name}",${num(r.dr) || ''},${num(r.cr) || ''},${num(r.py) || ''}`).join('\n');
  return [
    ['Trial balance & management accounts', `TPO-trial-balance-FY${fy}.csv`, tbCsv],
    ['Bank statements & confirmations', `Maybank-statement-Dec-${fy}.csv`,
`Maybank Islamic Berhad — Statement of Account
Account: TPO SDN BHD 5142 8890 1123 | Period: 01/12/${fy} - 31/12/${fy}
Date,Description,Debit,Credit,Balance
01/12/${fy},BALANCE B/F,,,231855.20
05/12/${fy},CARD SETTLEMENT MEPS,,48211.40,280066.60
08/12/${fy},SUPPLIER PAYMENT - FRESHMART,36420.00,,243646.60
12/12/${fy},CARD SETTLEMENT MEPS,,52108.75,295755.35
15/12/${fy},RENTAL - LIM PROPERTIES,18000.00,,277755.35
20/12/${fy},PAYROLL,49820.00,,227935.35
22/12/${fy},CATERING RECEIPT - SUNWAY EVENTS,,26400.00,254335.35
28/12/${fy},TERM LOAN INSTALMENT,5890.65,,248444.70
31/12/${fy},CARD SETTLEMENT MEPS,,19955.30,268400.00
31/12/${fy},CLOSING BALANCE,,,268400.00`],
    ['Bank statements & confirmations', `CIMB-statement-Dec-${fy}.csv`,
`CIMB Bank Berhad — Statement of Account
Account: TPO SDN BHD 8006 7712 34 | Period: 01/12/${fy} - 31/12/${fy}
Date,Description,Debit,Credit,Balance
01/12/${fy},BALANCE B/F,,,4120.50
10/12/${fy},SUPPLIER PAYMENT - OCEAN SEAFOOD,8960.00,,-4839.50
18/12/${fy},TRANSFER IN,,5000.00,160.50
27/12/${fy},SST PAYMENT - CUSTOMS,10010.50,,-9850.00
31/12/${fy},CLOSING BALANCE (OD),,,-9850.00
Note: account overdrawn at year end — no formal OD facility on file.`],
    ['Sales & receivables evidence', `POS-z-report-monthly-summary-FY${fy}.csv`,
`TPO Sdn Bhd — POS Z-Report Monthly Summary FY${fy}
Month,Gross sales (RM),Service tax collected (RM)
Jan,215400,12924
Feb,198200,11892
Mar,224800,13488
Apr,231500,13890
May,246900,14814
Jun,238700,14322
Jul,242300,14538
Aug,251600,15096
Sep,233400,14004
Oct,244100,14646
Nov,252800,15168
Dec,265300,15918
Total,2845000,170700`],
    ['Purchases & payables evidence', `Supplier-statement-FreshMart-Dec-${fy}.txt`,
`FRESHMART FOOD SUPPLIES SDN BHD — Statement of Account
Customer: TPO SDN BHD | As at 31/12/${fy}
Balance outstanding: RM 62,340.00
Aging: Current RM 41,200 | 30 days RM 15,890 | 60 days RM 5,250
Terms: 30 days. Please reconcile against your trade payables ledger.`],
    ['Fixed asset register & invoices', `Fixed-asset-register-FY${fy}.csv`,
`TPO Sdn Bhd — Fixed Asset Register as at 31/12/${fy}
Asset,Date acquired,Cost (RM),Rate,Acc. dep. b/f (RM)
Kitchen renovation & fit-out,${fy-2}-04-15,320000,10%,64000
Commercial kitchen equipment,${fy-2}-05-02,215000,20%,86000
Freezers & chillers,${fy-2}-05-02,68000,20%,27200
POS system & computers,${fy-2}-06-10,32000,33%,21120
Furniture & fittings,${fy-2}-04-20,50000,10%,10000
Total,,685000,,208320
NOTE: register acc. dep. b/f (RM208,320) does not tie to GL (RM274,000) — investigate.
No depreciation charged in FY${fy} yet.`],
    ['Inventory count sheets', `Stock-count-sheet-31Dec${fy}.csv`,
`TPO Sdn Bhd — Physical Stock Count 31/12/${fy} (counted by: LMF, witnessed by: auditor TBD)
Item,Qty,Unit cost (RM),Value (RM)
Frozen seafood,86 kg,38.00,3268
Meat & poultry,124 kg,24.50,3038
Dry goods & sauces,lot,,6890
Beverages & liquor,lot,,8404
Packaging & disposables,lot,,3000
Total,,,24600`],
    ['Payroll · EPF · SOCSO', `EPF-Borang-A-Dec-${fy}.txt`,
`KWSP BORANG A — Employer: TPO SDN BHD (E/No: 199x1234567)
Month: December ${fy} | Employees: 16
Total wages: RM 49,820 | Employer EPF: RM 6,477 | Employee EPF: RM 5,480
Payment date: 08/01/${fy+1} (within statutory deadline)`],
    ['SSM & statutory records', `SSM-company-profile-TPO.txt`,
`SSM e-Info — Company Profile
Name: TPO SDN BHD | Reg No: 201901022334 (1329988-P)
Incorporated: 12/03/2019 | Status: Existing
Registered office: No. 12, Jalan SS2/61, 47300 Petaling Jaya, Selangor
Nature of business: Operation of a restaurant and catering services
Issued share capital: RM 300,000 (300,000 ordinary shares)
Directors: PANG TZE ONN (800505-14-5011), LIM MEI FONG (850912-10-6244)
Shareholders: PANG TZE ONN — 210,000 shares (70%), LIM MEI FONG — 90,000 shares (30%)`],
    ['Tax — CP204 / Form C / assessments', `CP204-YA${fy}.txt`,
`LHDN CP204 — Estimate of Tax Payable YA ${fy}
Company: TPO SDN BHD | Tax file: C 24881234-08
Estimate submitted: RM 60,000 (12 instalments of RM 5,000)
Instalments paid to date: RM 60,000
Note: compare against final computation — s.107C(10) 10% penalty if actual tax exceeds estimate by >30%.`],
    ['Agreements & facility letters', `Tenancy-agreement-summary.txt`,
`Tenancy Agreement — Summary
Landlord: Lim Properties Sdn Bhd | Tenant: TPO Sdn Bhd
Premises: No. 12, Jalan SS2/61, Petaling Jaya
Term: 3 years from 01/01/${fy-1}, monthly rent RM 18,000 (RM 216,000/yr)
Deposit held: RM 54,000 (3 months) — see Deposits & prepayments.`],
    ['Prior-year FS & working papers', `TPO-audited-FS-FYE${fy-1}-summary.txt`,
`TPO SDN BHD — Audited Financial Statements FYE 31/12/${fy-1} (extract)
Auditors: KL Wong & Co PLT (AF 002211) — unmodified opinion with a Material
Uncertainty Related to Going Concern paragraph, dated 30/05/${fy}
(pandemic-era accumulated losses; directors confirmed continued support)
Revenue: RM 2,652,000 | PBT: RM 489,500 | Total assets: RM 927,100
Accumulated losses c/f: RM (654,950) (= opening RE for FY${fy})
Amount owing to director at FYE: RM 618,550
Full signed copy in permanent file.`],
  ];
}
async function demoSeedVault(clientId) {
  if (!sb || !authUser) return 0;
  let filed = 0;
  for (const [cat, name, content] of demoDocs()) {
    const type = name.endsWith('.csv') ? 'text/csv' : 'text/plain';
    const file = new File([content], name, { type });
    if (await vaultUploadOne(file, cat, clientId)) filed++;
  }
  return filed;
}

/* ---------- auth gate (Supabase) ---------- */
function authSetError(msg) { const el = $('gate-err'); el.textContent = msg; el.classList.remove('hidden'); }
function authToggleMode() {
  const form = $('gate-form');
  const toSignup = form.dataset.mode !== 'signup';
  form.dataset.mode = toSignup ? 'signup' : 'signin';
  $('gate-title').textContent = toSignup ? 'Create your account' : 'Welcome back';
  $('gate-sub').textContent = toSignup ? 'Set up access to your firm\'s audit files.' : 'Sign in to your Mr Auditor account.';
  $('gate-submit').textContent = toSignup ? 'Create account' : 'Sign in';
  $('gate-toggle').textContent = toSignup ? 'Already have an account? Sign in' : 'Don\'t have an account? Sign up';
  $('gate-err').classList.add('hidden');
}
async function authSubmit(e) {
  e.preventDefault();
  const email = $('gate-email').value.trim();
  const pass = $('gate-pass').value;
  const mode = $('gate-form').dataset.mode || 'signin';
  $('gate-err').classList.add('hidden');
  $('gate-submit').disabled = true;
  try {
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: pass });
      if (error) throw error;
      if (!data.session) { authSetError('Account created — check your email to confirm it, then sign in.'); return; }
      authUser = data.user;
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      authUser = data.user;
    }
    await afterAuth();
  } catch (err) {
    authSetError(err.message || 'Something went wrong — try again.');
  } finally {
    $('gate-submit').disabled = false;
  }
  return false;
}
async function authSignOut() {
  if (sb) await sb.auth.signOut();
  authUser = null;
  try { localStorage.removeItem('mr-auditor-v2'); } catch(e) {}
  location.reload();
}
async function afterAuth() {
  $('gate').style.display = 'none';
  // cloud is the source of truth — no localStorage auto-migration (it would resurrect
  // deliberately deleted engagements from a stale browser cache)
  let cloud = await cloudLoadEngagements();
  if (!cloud.length) cloud = [Object.assign(BLANK(), { id:nid(), created:Date.now() })];
  DB = { ver:2, activeId: cloud[0].id, clients: cloud };
  S = cloud[0];
  saveState();
  render(current);
  updateTop();
}

/* ---------- boot ---------- */
document.querySelectorAll('#sidenav .navlink[data-scr]').forEach(n => n.addEventListener('click', () => show(n.dataset.scr)));
$('mobile-nav').innerHTML = document.querySelector('#sidenav').outerHTML.replace('id="sidenav"','id="sidenav-m"') ;
document.querySelectorAll('#mobile-nav .navlink[data-scr]').forEach(n => n.addEventListener('click', () => show(n.dataset.scr)));
$('mobile-nav').classList.add('p-3','pt-6','overflow-y-auto');
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); askOpen(); }
  if (e.key === 'Escape') askClose();
});
$('ask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); askAI(); }
});
show('home');
(async () => {
  if (!window.supabase) { authSetError('Could not load the login service — check your connection and reload.'); return; }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await sb.auth.getSession();
  if (session) { authUser = session.user; await afterAuth(); }
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });
})();
