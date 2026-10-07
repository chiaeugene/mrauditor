/* ============================================================
   Trial balance import — read what the client actually sends
   ============================================================
   The first outside firm to use Mr Auditor imported a 71-account AutoCount
   trial balance, was told "Trial balance does not balance", marked the finding
   as noted because there was nothing else to do with it, and re-imported the
   same file eleven hours later. The old importer assumed one layout —
   Account, Debit, Credit, Prior year — and silently took whatever sat in those
   positions. Real exports carry an account code first, opening / period /
   closing column groups, sub-totals, page headers and a grand total.

   So this works the other way round: look at the sheet, decide which column
   is which, SHOW that decision with the totals it produces, and let the
   auditor correct it before a single row lands in the file. When it still
   does not balance, say which row is the likely reason.
   ============================================================ */

const TBI_AMT = /^\(?\s*-?\s*(?:rm|myr)?\s*-?\d[\d,\s]*(?:\.\d+)?\s*\)?\s*(?:cr|dr)?\.?\s*-?$/i;
const tbiIsAmt = v => typeof v === 'number' ? isFinite(v) : (typeof v === 'string' && v.trim() !== '' && TBI_AMT.test(v.trim()));
const tbiStr = v => (v === null || v === undefined) ? '' : String(v).trim();
const TBI_TOTAL = /^(grand\s*)?(sub[- ]?)?totals?\b|^jumlah\b|\btotal\s*:?\s*$|^net (profit|loss)|^(profit|loss) (for|before|after)|^balance (c\/d|b\/d|c\/f)|^untung (bersih|kasar)|^rugi bersih|^difference\b/i;
const TBI_HDR = /^(account|acc|a\/c|akaun|code|kod|no\.?|description|keterangan|butiran|particulars|name|nama|debit|debet|dr\.?|credit|kredit|cr\.?|balance|baki|amount|amaun|ytd|opening|closing|period|movement)/i;

/* Which numeric columns are which. Labels come from the header row and the
   row above it (the group row: "Opening", "This period", "Year to date"). */
function tbiAnalyse(grid) {
  const rows = grid.map(r => (Array.isArray(r) ? r : [r]));
  const width = Math.max(0, ...rows.map(r => r.length));
  if (!rows.length || !width) return null;

  // 1. header row: the first early row that reads like column titles
  let hdr = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(tbiStr).filter(Boolean);
    const hits = cells.filter(c => TBI_HDR.test(c)).length;
    const amts = rows[i].filter(c => typeof c === 'number' || /\d\.\d\d/.test(tbiStr(c))).length;
    if (hits >= 2 && amts === 0) { hdr = i; break; }
  }
  const body = rows.slice(hdr + 1);

  // 2. profile each column over the body
  const prof = [];
  for (let c = 0; c < width; c++) {
    let amt = 0, txt = 0, len = 0, filled = 0;
    for (const r of body) {
      const v = r[c]; const s = tbiStr(v); if (!s) continue; filled++;
      if (tbiIsAmt(v)) amt++; else if (/[A-Za-z\u00C0-\uFFFF]{2}/.test(s)) { txt++; len += s.length; }
    }
    prof.push({ c, amt, txt, filled, avg: txt ? len / txt : 0 });
  }
  // the name column is the wordiest one
  const nameCol = prof.filter(p => p.txt >= Math.max(1, body.length * 0.2))
    .sort((a, b) => (b.txt * b.avg) - (a.txt * a.avg))[0];
  if (!nameCol) return null;
  const name = nameCol.c;

  // anything that looks numeric LEFT of the name is an account code, not money
  const code = prof.filter(p => p.c < name && p.filled >= body.length * 0.3).sort((a, b) => b.filled - a.filled)[0];
  const nums = prof.filter(p => p.c > name && p.amt >= Math.max(1, Math.ceil(body.length * 0.05))).map(p => p.c);

  // 3. labels
  const lab = {};
  if (hdr >= 0) {
    let carry = '';
    for (let c = 0; c < width; c++) {
      const up = hdr > 0 ? tbiStr(rows[hdr - 1][c]) : '';
      if (up) carry = up;                       // merged group headings fill rightwards
      lab[c] = ((c > name ? carry : '') + ' ' + tbiStr(rows[hdr][c])).toLowerCase().trim();
    }
  }
  const is = (c, re) => re.test(lab[c] || '');
  const R = { dr: /debit|debet|\bdr\b/, cr: /credit|kredit|\bcr\b/, py: /prior|previous|last year|comparative|\bpy\b|preceding|tahun (lepas|lalu)/,
              open: /opening|b\/f|brought|beginning|awal|pembukaan/, per: /period|month|movement|transaction|bulan|semasa|this month/,
              ytd: /ytd|year to date|to date|closing|c\/f|ending|akhir|penutup/ };

  const map = { name, code: code ? code.c : -1, dr: -1, cr: -1, py: -1, pyCr: -1 };
  const labelled = hdr >= 0 && nums.some(c => is(c, R.dr) || is(c, R.cr));
  if (labelled) {
    // pair each debit column with the credit column that follows it
    const pairs = [];
    for (let i = 0; i < nums.length; i++) {
      if (is(nums[i], R.dr)) {
        const j = nums.slice(i + 1).find(c => is(c, R.cr));
        if (j !== undefined) pairs.push({ dr: nums[i], cr: j, l: lab[nums[i]] });
      }
    }
    const kind = p => R.py.test(p.l) ? 'py' : R.open.test(p.l) ? 'open' : R.ytd.test(p.l) ? 'ytd' : R.per.test(p.l) ? 'per' : '';
    let cur = pairs.find(p => kind(p) === 'ytd');
    if (!cur) {
      const plain = pairs.filter(p => !['py', 'open', 'per'].includes(kind(p)));
      cur = plain.length ? (pairs.length >= 3 ? plain[plain.length - 1] : plain[0]) : pairs[pairs.length - 1];
    }
    if (cur) { map.dr = cur.dr; map.cr = cur.cr; }
    const py = pairs.find(p => kind(p) === 'py' && p !== cur);
    if (py) { map.py = py.dr; map.pyCr = py.cr; }
  }
  if (map.dr < 0) {
    // no usable labels: go by count, which is how these files are laid out
    const k = nums.length;
    if (k === 1) { map.dr = nums[0]; }
    else if (k === 2) { map.dr = nums[0]; map.cr = nums[1]; }
    else if (k === 3) { map.dr = nums[0]; map.cr = nums[1]; map.py = nums[2]; }
    else if (k === 4 || k === 5) {
      // two pairs: either this year + last year, or this period + year to date.
      // Year-to-date figures are at least as large as the period's, row by row.
      let bigger = 0, seen = 0;
      for (const r of body) {
        const a = Math.abs(num(r[nums[0]])) + Math.abs(num(r[nums[1]])), b = Math.abs(num(r[nums[2]])) + Math.abs(num(r[nums[3]]));
        if (a || b) { seen++; if (b >= a) bigger++; }
      }
      if (seen && bigger / seen > 0.9) { map.dr = nums[2]; map.cr = nums[3]; }
      else { map.dr = nums[0]; map.cr = nums[1]; map.py = nums[2]; map.pyCr = nums[3]; }
    } else if (k >= 6) { map.dr = nums[k - 2]; map.cr = nums[k - 1]; }
  }
  // single labelled balance columns ("Balance", "2025", "2024")
  if (map.dr >= 0 && map.cr < 0 && map.py < 0 && nums.length >= 2 && labelled === false && hdr >= 0) {
    const other = nums.find(c => c !== map.dr); if (other !== undefined) map.py = other;
  }
  return { hdr, width, name, nums, lab, map, cols: prof };
}

/* Turn the sheet into rows under a given column map. Nothing is dropped
   quietly: every row that is left out is kept with the reason. */
function tbiBuild(grid, a, map, force, drop) {
  const out = [], skipped = [];
  force = force || new Set(); drop = drop || new Set();
  let headings = 0;
  const single = map.cr < 0;                         // one signed balance column
  for (let i = a.hdr + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    if (drop.has(i + 1)) continue;
    const forced = force.has(i + 1);
    let name = tbiStr(r[map.name]);
    const d = map.dr >= 0 ? num(r[map.dr]) : 0, c = map.cr >= 0 ? num(r[map.cr]) : 0;
    let dr = 0, cr = 0;
    if (single) { if (d >= 0) dr = d; else cr = -d; }
    else { dr = Math.abs(d); cr = Math.abs(c); if (d < 0 && !c) { cr = -d; dr = 0; } if (c < 0 && !d) { dr = -c; cr = 0; } }
    let pyDr = 0, pyCr = 0, pySigned = null;
    if (map.py >= 0 && map.pyCr >= 0) { pyDr = Math.abs(num(r[map.py])); pyCr = Math.abs(num(r[map.pyCr])); }
    else if (map.py >= 0) pySigned = num(r[map.py]);
    const hasAmt = dr || cr || pyDr || pyCr || pySigned;
    if (!name && !hasAmt) continue;
    if (!name && forced) name = 'Unnamed account';
    if (!name) { skipped.push({ line: i + 1, name: '(no account name)', dr, cr, why: 'a figure with no account name — usually a total' }); continue; }
    if (TBI_HDR.test(name) && !hasAmt) continue;
    if (!hasAmt) { headings++; continue; }
    if (!forced && TBI_TOTAL.test(name)) { skipped.push({ line: i + 1, name, dr, cr, why: 'a total or profit line, not an account' }); continue; }
    out.push({ name, code: map.code >= 0 ? tbiStr(r[map.code]) : '', dr, cr, pyDr, pyCr, pySigned, line: i + 1 });
  }
  // a single prior-year column is either already "natural" (all positive) or
  // debit-positive with credits negative. Tell them apart by the credit accounts.
  const withCat = out.map(r => ({ ...r, cat: classify(r.name, r.dr, r.cr) }));
  const crNat = withCat.filter(r => r.pySigned && CAT[r.cat].side === -1);
  const signed = crNat.length >= 2 && crNat.filter(r => r.pySigned < 0).length / crNat.length > 0.5;
  for (const r of withCat) {
    const side = CAT[r.cat].side;
    if (r.pyDr || r.pyCr) r.py = (r.pyDr - r.pyCr) * side;
    else if (r.pySigned !== null && r.pySigned !== 0) r.py = signed ? r.pySigned * side : r.pySigned;
    else r.py = 0;
    r.weak = !RULES.some(([re]) => re.test(r.name));
  }
  const t = withCat.reduce((s, r) => ({ dr: s.dr + r.dr, cr: s.cr + r.cr }), { dr: 0, cr: 0 });
  return { rows: withCat, skipped, headings, dr: t.dr, cr: t.cr, diff: t.dr - t.cr, hasPy: withCat.some(r => r.py) };
}

/* Why a set of rows might not balance — the things an auditor would check by
   hand, checked first. Each hint names the row and, where it is safe, carries
   the fix. */
function tbDiagnose(rows, skipped) {
  const dr = rows.reduce((s, r) => s + num(r.dr), 0), cr = rows.reduce((s, r) => s + num(r.cr), 0);
  const diff = dr - cr, gap = Math.abs(diff), hints = [];
  if (gap <= 0.5) return hints;
  const heavy = diff > 0 ? 'dr' : 'cr', light = diff > 0 ? 'cr' : 'dr';
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  rows.forEach((r, i) => {
    const v = num(r[heavy]);
    if (v && near(v, gap)) hints.push({ kind: 'extra', i, text: `"${r.name}" is exactly the difference (${fmtRM(gap)}). If it is a total, a profit line or a duplicate, remove it.`, fix: 'remove' });
    if (v && near(v, gap / 2)) hints.push({ kind: 'side', i, text: `"${r.name}" is exactly half the difference. It is probably on the wrong side — it should be a ${light === 'dr' ? 'debit' : 'credit'}.`, fix: 'flip' });
    if (num(r.dr) && num(r.cr)) hints.push({ kind: 'both', i, text: `"${r.name}" has a figure on both sides.` });
  });
  (skipped || []).forEach((s, k) => {
    const v = num(s[light]);
    if (v && near(v, gap)) hints.push({ kind: 'left', k, text: `Line ${s.line}, "${s.name}", was left out as ${s.why} — and it is exactly the missing ${fmtRM(gap)}.`, fix: 'add' });
  });
  if (!hints.length) {
    const pl = rows.filter(r => CAT[r.cat] && CAT[r.cat].kind === 'pl').reduce((s, r) => s + num(r.dr) - num(r.cr), 0);
    if (near(Math.abs(pl), gap)) hints.push({ kind: 'pl', text: `The difference equals this year's ${pl < 0 ? 'profit' : 'loss'} (${fmtRM(gap)}). The export probably shows the balance sheet after closing while still listing the income and expense accounts — ask for the trial balance before the year-end closing entry.` });
    else if (Math.abs(Math.round(gap * 100)) % 9 === 0) hints.push({ kind: 'swap', text: `The difference (${fmtRM(gap)}) divides by nine — the usual sign of two digits swapped in one figure. Compare the larger balances to the source.` });
    else hints.push({ kind: 'none', text: `No single row explains ${fmtRM(gap)}. Check that the file is the full trial balance — a missing page or a filtered export is the usual cause.` });
  }
  return hints.slice(0, 6);
}

/* ---------- the preview ---------- */
let TBI = null;   // { grid, a, map, built, source, mode, sheets, wb, sheet }

function tbiEnsure() {
  if ($('tbi')) return;
  const el = document.createElement('div');
  el.id = 'tbi';
  el.className = 'fixed inset-0 z-[60] hidden items-start md:items-center justify-center bg-ink/60 backdrop-blur p-3 md:p-6 overflow-y-auto';
  el.innerHTML = `<div class="card card-pad w-[58rem] max-w-full my-auto modal-card" id="tbi-card"></div>`;
  document.body.appendChild(el);
}
function tbiOpen(grid, source, opts) {
  opts = opts || {};
  const a = tbiAnalyse(grid);
  if (!a) { toast('Could not find a column of account names in that'); track('import', 'tb_unreadable', { source: opts.kind || '' }); return false; }
  tbiEnsure();
  TBI = { grid, a, map: { ...a.map }, source: source || 'pasted rows', mode: opts.mode || (S.tb.length ? 'replace' : 'replace'),
          comparatives: !!opts.comparatives, sheets: opts.sheets || null, wb: opts.wb || null, sheet: opts.sheet || null, kind: opts.kind || 'paste',
          force: new Set(), drop: new Set() };
  tbiRender();
  const m = $('tbi'); m.classList.remove('hidden'); m.classList.add('flex');
  return true;
}
function tbiClose() { const m = $('tbi'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } TBI = null; }
function tbiSet(role, v) { TBI.map[role] = +v; tbiRender(); }
function tbiSheet(nm) {
  const grid = tbiSheetGrid(TBI.wb, nm);
  const a = tbiAnalyse(grid);
  if (!a) { toast('No account names found on that sheet'); return; }
  TBI.grid = grid; TBI.a = a; TBI.map = { ...a.map }; TBI.sheet = nm; TBI.force = new Set(); TBI.drop = new Set(); tbiRender();
}
function tbiColName(c) {
  if (c < 0) return '—';
  const l = (TBI.a.lab[c] || '').replace(/\s+/g, ' ').trim();
  const letter = c < 26 ? String.fromCharCode(65 + c) : 'A' + String.fromCharCode(65 + c - 26);
  return `Column ${letter}${l ? ' · ' + l : ''}`;
}
function tbiRender() {
  const { a, map, grid } = TBI;
  const b = TBI.built = tbiBuild(grid, a, map, TBI.force, TBI.drop);
  const hints = TBI.comparatives ? [] : tbDiagnose(b.rows, b.skipped);
  TBI.hints = hints;
  const ok = Math.abs(b.diff) <= 0.5;
  const sel = (role, allowNone, noneLabel) => {
    const opts = (role === 'name' ? a.cols.filter(p => p.txt > 0).map(p => p.c) : a.nums);
    return `<select class="field !py-1.5 !min-h-0 !text-[12.5px]" onchange="tbiSet('${role}', this.value)">
      ${allowNone ? `<option value="-1" ${map[role] < 0 ? 'selected' : ''}>${noneLabel}</option>` : ''}
      ${opts.map(c => `<option value="${c}" ${map[role] === c ? 'selected' : ''}>${esc(tbiColName(c))}</option>`).join('')}</select>`;
  };
  const weak = b.rows.filter(r => r.weak).length;
  const cmp = TBI.comparatives ? tbiMatchPy(b.rows) : null;
  $('tbi-card').innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-1">
      <div>
        <h2 class="font-bold text-[17px] tracking-display">${TBI.comparatives ? 'Bring in last year’s figures' : 'Check what was read before it goes in'}</h2>
        <p class="text-[12.5px] text-mut mt-0.5">From <strong>${esc(TBI.source)}</strong>. Nothing has changed in the file yet.</p>
      </div>
      <button class="btn btn-ghost !px-2.5 !py-1.5 !min-h-0" onclick="tbiClose()" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>

    ${TBI.sheets && TBI.sheets.length > 1 ? `<div class="flex flex-wrap gap-1.5 my-3">${TBI.sheets.map(s =>
      `<button class="btn ${s === TBI.sheet ? 'btn-pri' : 'btn-ghost'} !py-1 !px-3 !min-h-0 !text-[12px]" onclick="tbiSheet('${esc(s).replace(/'/g, "\\'")}')">${esc(s)}</button>`).join('')}</div>` : ''}

    ${TBI.comparatives ? `
    <div class="p-3 rounded-xl ${cmp.matched ? 'bg-okbg text-ok' : 'bg-warnbg text-warn'} text-[13px] my-3">
      <strong>${cmp.matched} of ${S.tb.length}</strong> accounts in this year’s trial balance were found in last year’s.
      ${cmp.onlyPy.length ? `${cmp.onlyPy.length} account(s) existed only last year and will be added with no current-year balance.` : ''}
      ${cmp.unmatchedCy ? `<div class="text-[12px] mt-1">${cmp.unmatchedCy} current account(s) have no figure last year — new this year, or named differently. They stay blank for you to fill.</div>` : ''}
    </div>` : `
    <div class="p-3 rounded-xl ${ok ? 'bg-okbg text-ok' : 'bg-riskbg text-risk'} text-[13px] my-3">
      <div class="font-semibold">${b.rows.length} accounts · debits ${fmtRM(b.dr)} · credits ${fmtRM(b.cr)} —
        ${ok ? 'they balance.' : `out by ${fmtRM(Math.abs(b.diff))}.`}</div>
      <div class="text-[12px] mt-0.5 ${ok ? '' : 'text-ink'}">
        ${b.hasPy ? 'Prior-year figures found. ' : 'No prior-year column found — you can bring last year in afterwards. '}
        ${weak ? `${weak} account name(s) could not be classified with confidence and will be flagged amber.` : 'Every account was classified.'}
      </div>
    </div>
    ${hints.length ? `<div class="rounded-xl border border-line p-3 mb-3 text-[12.5px] space-y-2">
      <div class="font-semibold text-[13px]">Where the ${fmtRM(Math.abs(b.diff))} is likely to be</div>
      ${hints.map((h, k) => `<div class="flex items-start gap-2"><span class="mt-[5px] w-1.5 h-1.5 rounded-full bg-risk flex-none"></span>
        <span class="flex-1">${esc(h.text)}</span>
        ${h.fix ? `<button class="btn btn-ghost !py-1 !px-2.5 !min-h-0 !text-[11.5px] flex-none" onclick="tbiFix(${k})">${h.fix === 'remove' ? 'Leave it out' : h.fix === 'flip' ? 'Move it across' : 'Put it back'}</button>` : ''}</div>`).join('')}
      <div class="text-[11.5px] text-mut">If the columns below are wrong, correct them first — a wrong column is the commonest reason of all.</div>
    </div>` : ''}`}

    <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
      <div><label class="fieldlbl">Account name</label>${sel('name')}</div>
      <div><label class="fieldlbl">${map.cr < 0 ? 'Balance (+ debit, − credit)' : 'Debit'}</label>${sel('dr')}</div>
      <div><label class="fieldlbl">Credit</label>${sel('cr', true, 'none — one signed column')}</div>
      <div><label class="fieldlbl">Prior year${map.pyCr >= 0 ? ' debit' : ''}</label>${sel('py', true, 'not in this file')}</div>
      <div><label class="fieldlbl">Prior year credit</label>${sel('pyCr', true, 'none')}</div>
    </div>

    <div class="overflow-x-auto border border-line rounded-xl">
      <table class="tbl min-w-[620px]">
        <thead><tr><th>Account</th><th>Will be classified as</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Prior year</th></tr></thead>
        <tbody>${b.rows.slice(0, 8).map(r => `<tr>
          <td class="${r.weak ? 'text-warn' : ''}">${r.code ? `<span class="mono text-mut text-[11px] mr-1.5">${esc(r.code)}</span>` : ''}${esc(r.name)}</td>
          <td class="text-mut text-[12px]">${CAT[r.cat].label}</td>
          <td class="num mono">${r.dr ? fmt(r.dr) : ''}</td><td class="num mono">${r.cr ? fmt(r.cr) : ''}</td>
          <td class="num mono text-mut">${r.py ? fmt(r.py) : ''}</td></tr>`).join('')}
          ${b.rows.length > 8 ? `<tr><td colspan="5" class="text-mut text-[12px]">… and ${b.rows.length - 8} more</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    ${b.skipped.length ? `<details class="mt-2 text-[12px]"><summary class="cursor-pointer text-mut">${b.skipped.length} line(s) left out — see which</summary>
      <div class="mt-1.5 space-y-1">${b.skipped.slice(0, 25).map(s => `<div class="flex gap-2"><span class="mono text-mut w-14 flex-none">line ${s.line}</span>
        <span class="flex-1 truncate">${esc(s.name)}</span><span class="mono">${s.dr ? fmt(s.dr) : ''}${s.cr ? ' (' + fmt(s.cr) + ' cr)' : ''}</span>
        <span class="text-mut hidden md:inline">${esc(s.why)}</span></div>`).join('')}</div></details>` : ''}

    <div class="flex flex-wrap items-center gap-2 mt-4">
      ${!TBI.comparatives && S.tb.length ? `<label class="text-[12.5px] flex items-center gap-1.5"><input type="radio" name="tbi-mode" ${TBI.mode === 'replace' ? 'checked' : ''} onchange="TBI.mode='replace'"> Replace the ${S.tb.length} rows already here</label>
        <label class="text-[12.5px] flex items-center gap-1.5 mr-auto"><input type="radio" name="tbi-mode" ${TBI.mode === 'add' ? 'checked' : ''} onchange="TBI.mode='add'"> Add to them</label>` : '<span class="mr-auto"></span>'}
      <button class="btn btn-ghost" onclick="tbiClose()">Cancel</button>
      <button class="btn ${ok || TBI.comparatives ? 'btn-mint' : 'btn-pri'}" onclick="tbiCommit()" ${b.rows.length ? '' : 'disabled'}>
        ${TBI.comparatives ? `Add last year to ${cmp.matched} account(s)` : ok ? `Put these ${b.rows.length} accounts in` : `Put them in anyway — I will fix it in the file`}</button>
    </div>`;
}
/* One-click repairs from the diagnosis. They edit the sheet being previewed,
   never the file, so the auditor sees the totals move before committing. */
function tbiFix(k) {
  const h = TBI.hints[k], b = TBI.built; if (!h) return;
  const { map, grid } = TBI;
  if (h.fix === 'remove') { TBI.drop.add(b.rows[h.i].line); }
  else if (h.fix === 'flip' && map.cr >= 0) {
    const r = grid[b.rows[h.i].line - 1]; const d = r[map.dr], c = r[map.cr]; r[map.dr] = c; r[map.cr] = d;
  } else if (h.fix === 'flip') { const r = grid[b.rows[h.i].line - 1]; r[map.dr] = -num(r[map.dr]); }
  else if (h.fix === 'add') { TBI.force.add(b.skipped[h.k].line); }
  track('import', 'tb_fix_' + h.fix);
  tbiRender();
}
const tbiKey = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
function tbiMatchPy(pyRows) {
  const byName = new Map(), byCode = new Map();
  pyRows.forEach(r => { byName.set(tbiKey(r.name), r); if (r.code) byCode.set(r.code, r); });
  let matched = 0; const used = new Set();
  const plan = S.tb.map(r => {
    const hit = (r.code && byCode.get(r.code)) || byName.get(tbiKey(r.name));
    if (hit) { matched++; used.add(hit); }
    return hit || null;
  });
  return { plan, matched, unmatchedCy: S.tb.length - matched, onlyPy: pyRows.filter(r => !used.has(r)) };
}
function tbiCommit() {
  if (guardArchived()) return;
  const b = TBI.built;
  if (TBI.comparatives) {
    /* Last year's closing balance of an account is this year's comparative.
       Stored in natural sign, like every other prior-year figure in the file. */
    const cmp = tbiMatchPy(b.rows);
    const nat = r => (r.dr - r.cr) * CAT[r.cat].side;
    cmp.plan.forEach((hit, i) => { if (hit) S.tb[i].py = nat({ ...hit, cat: S.tb[i].cat }) || ''; });
    cmp.onlyPy.forEach(r => S.tb.push({ id: nid(), name: r.name, code: r.code || undefined, cat: r.cat, dr: '', cr: '', py: nat(r) || '', autoWeak: r.weak }));
    logActivity('Brought in prior-year figures', `${cmp.matched} matched, ${cmp.onlyPy.length} added from ${TBI.source}`);
    track('import', 'py_done', { matched: cmp.matched, added: cmp.onlyPy.length });
    toast(`Last year’s figures added to ${cmp.matched} account(s)`);
  } else {
    const rows = b.rows.map(r => ({ id: nid(), name: r.name, code: r.code || undefined, cat: r.cat, dr: r.dr || '', cr: r.cr || '', py: r.py || '', autoWeak: r.weak }));
    if (TBI.mode === 'add') S.tb.push(...rows); else { S.tb = rows; S.adjustments = []; S.findingStatus = {}; }
    logActivity('Imported trial balance', `${rows.length} account(s) from ${TBI.source}, ${b.skipped.length} line(s) left out, ${Math.abs(b.diff) <= 0.5 ? 'balanced' : 'out by ' + fmtRM(Math.abs(b.diff))}`);
    track('import', 'tb_done', { rows: rows.length, skipped: b.skipped.length, balanced: Math.abs(b.diff) <= 0.5, py: b.hasPy, kind: TBI.kind, weak: rows.filter(r => r.autoWeak).length });
    toast(`${rows.length} accounts in${Math.abs(b.diff) <= 0.5 ? ' and balanced' : ''}`);
  }
  tbiClose();
  saveState(); updateTop();
  if (current === 'tb') renderTB(); else show('tb');
}

/* ---------- sources: paste, spreadsheet, PDF ---------- */
function tbiSheetGrid(wb, nm) {
  return XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '' }).filter(r => r.some(c => tbiStr(c) !== ''));
}
function tbiPasteGrid(raw) {
  const tabbed = /\t/.test(raw);
  return raw.split(/\r?\n/).filter(l => l.trim()).map(line => tabbed ? line.split('\t').map(s => s.trim())
    : line.split(/;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(p => p.replace(/^"|"$/g, '').trim()));
}
/* Thousands separators inside an unquoted CSV split one figure into two cells.
   Stitch "1" + "234.56" back together when that is plainly what happened. */
function tbiHealCsv(grid) {
  return grid.map(r => {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const s = tbiStr(r[i]);
      if (out.length > 1 && /^\d{3}(\.\d+)?\)?$/.test(s) && /^\(?-?\d{1,3}$/.test(tbiStr(out[out.length - 1]))) out[out.length - 1] = tbiStr(out[out.length - 1]) + s;
      else out.push(r[i]);
    }
    return out;
  });
}
function importPaste() {
  const raw = $('tb-paste').value.trim();
  if (!raw) { toast('Nothing to import — paste the rows first'); return; }
  let grid = tbiPasteGrid(raw);
  if (!/\t/.test(raw)) grid = tbiHealCsv(grid);
  tbiOpen(grid, 'pasted rows', { kind: 'paste' });
}
async function tbiReadFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { grid: await tbiPdfGrid(f), kind: 'pdf' };
  if (typeof XLSX === 'undefined') throw new Error('the spreadsheet reader did not load — paste the rows instead');
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
  // the sheet that reads best as a trial balance, not merely the first
  let best = null;
  for (const nm of wb.SheetNames) {
    const g = tbiSheetGrid(wb, nm); if (!g.length) continue;
    const a = tbiAnalyse(g); if (!a) continue;
    const b = tbiBuild(g, a, a.map);
    const score = b.rows.length + (Math.abs(b.diff) <= 0.5 && b.rows.length > 3 ? 1000 : 0) + (/trial|tb|imbangan/i.test(nm) ? 50 : 0);
    if (!best || score > best.score) best = { nm, g, score };
  }
  if (!best) throw new Error('no rows with account names in that file');
  return { grid: best.g, kind: ext, wb, sheets: wb.SheetNames, sheet: best.nm };
}
async function importXlsx(input, comparatives) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  try {
    const r = await tbiReadFile(f);
    tbiOpen(r.grid, f.name, { ...r, comparatives: !!comparatives });
  } catch (e) { toast('Could not read that file: ' + (e.message || e)); track('error', 'tb_file', { m: String(e.message || e).slice(0, 120) }); }
}
function importPyFile(input) {
  if (!S.tb.length) { input.value = ''; toast('Import this year’s trial balance first'); return; }
  importXlsx(input, true);
}

/* A PDF trial balance printed from accounting software still has real text in
   it. Rebuild the columns from where the figures sit on the page: figures that
   share a right-hand edge are one column. A scanned PDF has no text at all —
   that case is handed to the AI reader instead. */
let _pdfjs = null;
async function tbiLoadPdf() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import('./vendor/pdf.min.mjs');
  _pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
  return _pdfjs;
}
async function tbiPdfGrid(file) {
  const lib = await tbiLoadPdf();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const byY = new Map();
    for (const it of tc.items) {
      const s = (it.str || '').trim(); if (!s) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ s, x: it.transform[4], r: it.transform[4] + it.width });
    }
    [...byY.keys()].sort((a, b) => b - a).forEach(y => lines.push(byY.get(y).sort((a, b) => a.x - b.x)));
  }
  if (lines.reduce((n, l) => n + l.length, 0) < 20) throw new Error('this PDF is a scan with no text in it — use "Build from documents" so Mr Auditor can read the image');
  // column edges: right edges of figures, clustered
  const edges = [];
  for (const l of lines) for (const t of l) if (TBI_AMT.test(t.s) && /\d/.test(t.s) && (/[.,]\d\d\)?$/.test(t.s) || t.s.length > 3)) edges.push(t.r);
  edges.sort((a, b) => a - b);
  const cols = [];
  for (const e of edges) { const last = cols[cols.length - 1]; if (last && e - last.max < 14) { last.max = e; last.n++; } else cols.push({ min: e, max: e, n: 1 }); }
  const keep = cols.filter(c => c.n >= Math.max(3, edges.length * 0.04));
  if (!keep.length) throw new Error('no columns of figures were found in that PDF');
  const firstEdge = keep[0].min;
  return lines.map(l => {
    const row = new Array(keep.length + 1).fill('');
    const nameParts = [];
    for (const t of l) {
      const ci = keep.findIndex(c => t.r >= c.min - 10 && t.r <= c.max + 10);
      if (ci >= 0 && (TBI_AMT.test(t.s) || TBI_HDR.test(t.s))) row[ci + 1] = row[ci + 1] ? row[ci + 1] + ' ' + t.s : t.s;
      else if (t.x < firstEdge - 20) nameParts.push(t.s);
      else { const near = keep.findIndex(c => Math.abs(((t.x + t.r) / 2) - (c.min + c.max) / 2) < 45); if (near >= 0 && TBI_HDR.test(t.s)) row[near + 1] = t.s; else nameParts.push(t.s); }
    }
    // "100-000 CASH AT BANK" → the code in its own column, the way a spreadsheet has it
    const full = nameParts.join(' ').trim();
    const m = full.match(/^([A-Z]{0,2}\d[\d\-\/.]{2,}[A-Z]?)\s+(\S.*)$/);
    row[0] = m ? m[2] : full;
    return [m ? m[1] : '', ...row];
  }).filter(r => r.some(c => c !== ''));
}
