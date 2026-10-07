/* ============================================================
   Intake, guidance and usage — getting a new firm to a first draft
   ============================================================
   What the first outside firm did, from the trail it left: registered a
   company, attached sixteen files (ten of them into one folder), imported a
   trial balance by hand on a different screen, was told it did not balance,
   opened the demo to see what a finished file looks like, and left. Each
   section below removes one of those dead ends.
   ============================================================ */

/* ---------- 1. usage: screens, actions, errors — never client data ---------- */
const _usage = { q: [], sid: Math.random().toString(36).slice(2, 10), errs: 0, t: null };
const _device = () => (/iphone|android|mobile/i.test(navigator.userAgent) ? 'mobile' : (window.innerWidth < 900 ? 'narrow' : 'desktop'));
function track(kind, name, detail) {
  try {
    _usage.q.push({ kind, name: String(name).slice(0, 80), detail: detail || null, session_id: _usage.sid, device: _device() });
    clearTimeout(_usage.t);
    _usage.t = setTimeout(trackFlush, _usage.q.length >= 12 ? 0 : 4000);
  } catch (e) { /* recording usage must never be the thing that breaks the app */ }
}
async function trackFlush() {
  if (!_usage.q.length || typeof sb === 'undefined' || !sb || !authUser) return;
  const batch = _usage.q.splice(0, 40);
  try { const { error } = await sb.from('usage_events').insert(batch); if (error) console.warn('usage not recorded:', error.message); }
  catch (e) { /* offline: these are lost, by design — nothing is retried into a pile */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') trackFlush(); });

/* A failure on a customer's screen used to leave no trace anywhere. */
function trackError(name, msg, where) {
  if (_usage.errs++ >= 12) return;                       // a loop must not flood the table
  track('error', name, { m: String(msg || '').slice(0, 180), at: String(where || '').slice(0, 80), scr: typeof current !== 'undefined' ? current : '' });
}
window.addEventListener('error', e => trackError('js', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => trackError('promise', (e.reason && (e.reason.message || e.reason)) || 'rejected', ''));

/* Wrap the two functions everything already goes through. */
{
  const _show = show;
  show = function (scr) { const r = _show(scr); track('screen', scr); guideRender(); return r; };
  const _log = logActivity;
  logActivity = function (action, detail) { track('action', action); return _log(action, detail); };
  const _updateTop = updateTop;
  updateTop = function () { const r = _updateTop(); guideRender(); return r; };
}

/* ---------- 2. file a document from its name ---------- */
/* Most client files say what they are. Reading every one with the AI to learn
   that "Bank Statement Dec 2025.pdf" is a bank statement costs a minute and
   money; the name is enough. Only the files whose names say nothing are read. */
const NAME_RULES = [
  [/audited|audit(or)?'?s? report|financial statements?|\bafs\b|\bfs\b.{0,6}20\d\d|20\d\d.{0,6}\bfs\b|prior year|previous year|last year|tahun lepas|signed (fs|accounts)/i, 'Prior-year FS & working papers'],
  [/cp ?204|cp ?500|form ?c\b|borang ?c\b|(^|[^a-z])e-c([^a-z]|$)|tax comp|tax agent|lhdn|hasil|assessment|\btax\b|cukai|capital allowance/i, 'Tax — CP204 / Form C / assessments'],
  [/payroll|salar|gaji|\bepf\b|kwsp|socso|perkeso|\beis\b|\bsip\b|ea ?form|\bpcb\b|cp ?39|borang ?e\b|payslip|hrdf/i, 'Payroll · EPF · SOCSO'],
  [/trial ?bal|(^|[^a-z])tb([^a-z]|$)|imbangan duga|management acc|mgmt acc|general ledger|(^|[^a-z])gl([^a-z]|$)|lejar|p ?& ?l|profit.{0,5}loss|balance sheet|kunci kira/i, 'Trial balance & management accounts'],
  [/agreement|perjanjian|tenancy|sewa|facility|offer letter|letter of offer|hire ?purchase|\bhp\b|loan|pinjaman|contract|lease/i, 'Agreements & facility letters'],
  [/bank|penyata|maybank|mbb|cimb|\brhb\b|public ?bank|\bpbb\b|\bhlb\b|hong ?leong|ambank|affin|alliance|\buob\b|ocbc|bsn|bank ?islam|muamalat|confirmation|fd cert|fixed deposit/i, 'Bank statements & confirmations'],
  [/fixed ?asset|asset register|(^|[^a-z])far?([^a-z]|$)|\bppe\b|depreciation|susut ?nilai|daftar aset/i, 'Fixed asset register & invoices'],
  [/stock|inventor|stok|count sheet|stock ?take/i, 'Inventory count sheets'],
  [/ssm|form ?(9|13|24|32a|44|49)\b|section ?(14|15|17|46|58|78)|constitution|m ?& ?a\b|annual return|company profile|super ?form|register of|resolution|minutes|cosec|secretar/i, 'SSM & statutory records'],
  [/sales|jualan|debtor|penghutang|receivable|(^|[^a-z])ar([^a-z]|$)|customer|pelanggan|invoice|invois|delivery order/i, 'Sales & receivables evidence'],
  [/purchase|belian|creditor|pemiutang|payable|(^|[^a-z])ap([^a-z]|$)|supplier|pembekal|bill|grn|\bpo\b/i, 'Purchases & payables evidence'],
];
function guessCategory(fileName) {
  const base = String(fileName || '').replace(/\.[A-Za-z0-9]+$/, '').replace(/[_\-.]+/g, ' ');
  for (const [re, cat] of NAME_RULES) if (re.test(base)) return cat;
  return null;
}
const fileExt = n => (String(n).split('.').pop() || '').toLowerCase();
const isSheet = n => ['xlsx', 'xls', 'csv', 'xlsm'].includes(fileExt(n));

/* The upload itself, now recording HOW the folder was chosen. */
async function vaultUploadOne(file, cat, clientId, source) {
  if (!sb || !authUser) return false;
  const path = `${authUser.id}/${clientId}/${nid()}-${sanitizeName(file.name)}`;
  let upErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 800 * attempt));
    ({ error: upErr } = await sb.storage.from('evidence').upload(path, file, { contentType: file.type || undefined }));
    if (!upErr) break;
  }
  if (upErr) { console.error('vault upload failed after retries', upErr); trackError('upload', upErr.message, fileExt(file.name)); return false; }
  const { data, error: insErr } = await sb.from('evidence_files').insert({
    engagement_id: clientId, owner: authUser.id, category: cat, category_source: source || 'user',
    file_name: file.name, mime_type: file.type, size_bytes: file.size, storage_path: path }).select('id').single();
  if (insErr) { console.error('vault record failed', insErr); trackError('upload_row', insErr.message, '');
    await sb.storage.from('evidence').remove([path]).catch(() => {}); return false; }
  return data ? data.id : true;
}

/* Limits a real firm will hit: a 60 MB scan, an empty file, the same file twice. */
const MAX_FILE_MB = 25;
function vetFiles(files, already) {
  const ok = [], no = [];
  const seen = new Set((already || []).map(f => f.name + '|' + f.size));
  for (const f of files) {
    if (!f.size) no.push(`${f.name} is empty`);
    else if (f.size > MAX_FILE_MB * 1048576) no.push(`${f.name} is ${(f.size / 1048576).toFixed(0)} MB — the limit is ${MAX_FILE_MB} MB. Split it or export at a lower resolution`);
    else if (seen.has(f.name + '|' + f.size)) no.push(`${f.name} is already here`);
    else { seen.add(f.name + '|' + f.size); ok.push(f); }
  }
  return { ok, no };
}

/* Put a batch in the vault: name first, AI only for what the name cannot say. */
async function intakeFile(files, clientId, opts) {
  opts = opts || {};
  const done = [], unknown = [];
  let n = 0;
  for (const it of files) {
    const cat = it.cat || guessCategory(it.file.name);
    const id = await vaultUploadOne(it.file, cat || 'Others', clientId, it.cat ? (it.src || 'user') : (cat ? 'auto' : 'user'));
    n++; if (opts.onProgress) opts.onProgress(n, files.length, it.file.name);
    if (!id) continue;
    done.push({ ...it, id, cat: cat || 'Others' });
    if (!cat && id !== true) unknown.push({ id, name: it.file.name });
  }
  // the ones whose names said nothing: read them, quietly, after the user is already moving
  if (unknown.length && opts.readUnknown !== false) (async () => {
    let moved = 0;
    for (const u of unknown) {
      try { await vaultAutoFile(u.id, u.name); moved++; } catch (e) { /* stays in Others, visibly */ }
    }
    track('import', 'ai_filed', { tried: unknown.length, moved });
    if (current === 'vault') renderVault();
    if (moved) toast(`Mr Auditor read ${moved} more document(s) and filed them`);
  })();
  track('import', 'files', { n: done.length, auto: done.filter(d => d.src !== 'user' && d.cat !== 'Others').length, unknown: unknown.length });
  return done;
}

/* Of the files just added, find the trial balance and open it for checking. */
async function intakeFindTb(items) {
  const cands = items.filter(i => i.cat === 'Trial balance & management accounts' && (isSheet(i.file.name) || fileExt(i.file.name) === 'pdf'));
  cands.sort((a, b) => (isSheet(b.file.name) - isSheet(a.file.name)) || (/trial|tb|imbangan/i.test(b.file.name) - /trial|tb|imbangan/i.test(a.file.name)));
  let best = null;
  for (const c of cands.slice(0, 8)) {
    try {
      const r = await tbiReadFile(c.file);
      const a = tbiAnalyse(r.grid); if (!a) continue;
      const b = tbiBuild(r.grid, a, a.map);
      if (b.rows.length < 5) continue;
      const score = b.rows.length + (Math.abs(b.diff) <= 0.5 ? 10000 : 0) + (/trial|tb|imbangan/i.test(c.file.name) ? 500 : 0);
      if (!best || score > best.score) best = { r, file: c.file, score };
      if (score > 10000) break;
    } catch (e) { /* not a trial balance, or a scan: try the next */ }
  }
  return best;
}

/* ---------- 3. registration, step 4: one place to put everything ---------- */
function regRenderAttach() {
  const files = regDraft.files;
  $('r-attach').innerHTML = `
    <label id="reg-drop" class="dropzone block rounded-2xl border-2 border-dashed border-line bg-paper/60 px-5 py-8 text-center cursor-pointer">
      <svg viewBox="0 0 24 24" width="30" height="30" class="mx-auto mb-2 text-indigo" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>
      <div class="font-semibold text-[14.5px]">Drop everything the client sent you</div>
      <div class="text-[12.5px] text-mut mt-1 max-w-md mx-auto">Trial balance, bank statements, last year’s accounts, tax, payroll — all at once, in any order. Mr Auditor sorts them into the right folders and reads the trial balance for you.</div>
      <div class="btn btn-ghost !py-1.5 mt-3 inline-flex">Choose files</div>
      <input type="file" multiple class="hidden" onchange="regAttach(this)">
    </label>
    ${files.length ? `<div class="mt-3 space-y-1.5">
      <div class="flex items-center justify-between text-[12px] text-mut"><span>${files.length} file(s) — change a folder if one is wrong</span>
        <span>${files.filter(f => !f.cat).length ? files.filter(f => !f.cat).length + ' will be read to decide' : 'all sorted by name'}</span></div>
      ${files.map((f, i) => `<div class="flex items-center gap-2 border border-line rounded-xl px-3 py-1.5 bg-white stagger-in" style="animation-delay:${Math.min(i, 12) * 25}ms">
        <span class="flex-none text-mut">${ICON_DOC}</span>
        <span class="text-[12.5px] font-medium truncate flex-1 min-w-0" title="${esc(f.file.name)}">${esc(f.file.name)}</span>
        <select class="field !py-1 !min-h-0 !text-[11.5px] !w-52 flex-none" onchange="regSetCat(${i}, this.value)">
          <option value="" ${!f.cat ? 'selected' : ''}>Let Mr Auditor read it</option>
          ${DOCCATS.map(c => `<option ${f.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <button class="btn btn-ghost !px-2 !py-1 !min-h-0 flex-none" onclick="regDraft.files.splice(${i},1); regRenderAttach()" aria-label="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="#D70015" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>`).join('')}</div>` : `<p class="text-[12px] text-mut mt-3 text-center">Nothing to hand yet? Skip this — everything can be added later from the Evidence Vault.</p>`}
    <div id="reg-progress" class="mt-3"></div>`;
  dropWire($('reg-drop'), fl => regAddFiles(fl));
  $('wiz-next').textContent = files.length ? 'Create and read the documents' : 'Create the engagement';
}
function regAddFiles(fileList) {
  const { ok, no } = vetFiles([...fileList], regDraft.files.map(f => f.file));
  for (const f of ok) { const g = guessCategory(f.name); regDraft.files.push({ file: f, cat: g || '', src: g ? 'auto' : '' }); }
  if (no.length) toast(no[0] + (no.length > 1 ? ` (+${no.length - 1} more)` : ''));
  regRenderAttach();
}
function regAttach(input) { regAddFiles(input.files); input.value = ''; }
function regSetCat(i, v) { regDraft.files[i].cat = v; regDraft.files[i].src = v ? 'user' : ''; regRenderAttach(); }

async function regNext() {
  if (regStep === 1) {
    let ok = true;
    for (const [id, err] of [['r-name', 'r-name-err'], ['r-regno', 'r-regno-err'], ['r-fye', 'r-fye-err']]) {
      const bad = !$(id).value.trim();
      $(err).classList.toggle('hidden', !bad);
      $(id).style.borderColor = bad ? '#D70015' : '';
      if (bad && ok) { $(id).focus(); ok = false; }
    }
    if (!ok) return;
  }
  if (regStep < 4) { regStep++; renderRegister(); track('guide', 'reg_step_' + regStep); return; }
  if ($('wiz-next').disabled) return;
  const g = id => $(id).value.trim();
  const c = newClient(g('r-name'));
  Object.assign(c.setup, { regno: g('r-regno'), incdate: g('r-incdate'), fye: g('r-fye'), activity: g('r-activity'),
    framework: g('r-framework'), capital: g('r-capital'), employees: g('r-employees'),
    firstaudit: g('r-firstaudit'), foreign: g('r-foreign'), address: g('r-address') });
  c.directors = regDraft.directors.filter(d => d.name.trim());
  c.intake = { finperson: g('r-finperson'), contact: g('r-contact'), email: g('r-email'), phone: g('r-phone'),
    prevauditor: g('r-prevauditor'), software: g('r-software'), banks: g('r-banks'), borrowings: g('r-borrowings'),
    sst: g('r-sst'), einvoice: g('r-einvoice'), bookkeeping: g('r-bookkeeping'), risknotes: g('r-risknotes') };
  saveState();
  /* The engagement row has to exist before a file can be attached to it. */
  if (sb && authUser) await cloudPushEngagement(c);
  if (!DB.clients.includes(c)) { regDraft = null; show('home'); return; }   // the plan refused it

  const items = regDraft.files.slice();
  const btn = $('wiz-next'); btn.disabled = true; btn.textContent = items.length ? 'Filing…' : 'Creating…';
  const bar = $('reg-progress');
  const done = await intakeFile(items, c.id, { onProgress: (n, of, name) => {
    if (bar) bar.innerHTML = `<div class="text-[12px] text-mut mb-1">Filing ${n} of ${of} — ${esc(name)}</div>
      <div class="h-1.5 rounded-full bg-line overflow-hidden"><div class="h-full w-full bg-indigo rounded-full progress-fill" style="transform:scaleX(${(n / of).toFixed(3)})"></div></div>`; } });
  btn.disabled = false;
  ['r-name', 'r-regno', 'r-incdate', 'r-fye', 'r-activity', 'r-address', 'r-capital', 'r-employees', 'r-finperson',
   'r-contact', 'r-email', 'r-phone', 'r-prevauditor', 'r-software', 'r-banks', 'r-risknotes'].forEach(id => $(id).value = '');
  regDraft = null;
  logActivity('Registered the company', `${done.length} document(s) filed on arrival`);

  /* The point of attaching the trial balance is to have it read. */
  let tb = null;
  if (done.length) { if (bar) bar.innerHTML = '<div class="text-[12px] text-mut">Looking for the trial balance…</div>'; tb = await intakeFindTb(done); }
  if (tb) {
    show('tb');
    tbiOpen(tb.r.grid, tb.file.name, tb.r);
    toast(`${c.setup.name} registered · ${done.length} file(s) filed · trial balance found`);
  } else {
    show('dashboard');
    toast(`${c.setup.name} registered${done.length ? ' · ' + done.length + ' file(s) filed' : ''}`);
  }
}
{
  /* the wizard's last button now says what it does */
  const _rr = renderRegister;
  renderRegister = function () { _rr(); if (regStep === 4) $('wiz-next').textContent = regDraft && regDraft.files.length ? 'Create and read the documents' : 'Create the engagement'; };
}

/* ---------- 4. drag and drop, anywhere a file is wanted ---------- */
function dropWire(el, onFiles) {
  if (!el || el._wired) return; el._wired = true;
  const on = e => { e.preventDefault(); e.stopPropagation(); el.classList.add('is-over'); };
  const off = e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('is-over'); };
  el.addEventListener('dragenter', on); el.addEventListener('dragover', on);
  el.addEventListener('dragleave', off);
  el.addEventListener('drop', e => { off(e); if (e.dataTransfer && e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
}
/* A file dropped anywhere outside a drop zone would otherwise replace the app
   with the file. On an engagement screen, treat it as evidence instead. */
window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  if (current === 'register' && regStep === 4) return regAddFiles(e.dataTransfer.files);
  if (['vault', 'dashboard', 'tb'].includes(current) && S.setup.name) vaultTakeFiles([...e.dataTransfer.files]);
});

/* ---------- 5. the vault: drop, sort, read ---------- */
async function vaultTakeFiles(files, chosenCat) {
  if (guardArchived()) return;
  const existing = (await vaultListRows(S.id)).map(r => ({ name: r.file_name, size: r.size_bytes }));
  const { ok, no } = vetFiles(files, existing);
  if (no.length) toast(no[0] + (no.length > 1 ? ` (+${no.length - 1} more)` : ''));
  if (!ok.length) return;
  const auto = !chosenCat || chosenCat === AI_FILING_CHOICE;
  toast(`Filing ${ok.length} file(s)…`);
  const done = await intakeFile(ok.map(f => ({ file: f, cat: auto ? '' : chosenCat, src: auto ? '' : 'user' })), S.id);
  if (done.length) logActivity('Filed evidence', `${done.length} file(s)${auto ? ', sorted automatically' : ' under "' + chosenCat + '"'}`);
  toast(done.length ? `${done.length} file(s) filed` : 'Upload failed — check your connection');
  if (current === 'vault') renderVault();
  updateTop();
  if (!S.tb.length && done.length) {
    const tb = await intakeFindTb(done);
    if (tb) { show('tb'); tbiOpen(tb.r.grid, tb.file.name, tb.r); }
  }
}
async function vaultUpload(input) {
  const files = [...input.files]; input.value = '';
  if (files.length) await vaultTakeFiles(files, $('vault-cat').value);
}
{
  const _rv = renderVault;
  renderVault = async function () {
    await _rv();
    if (!$('vault-drop')) {
      const d = document.createElement('div');
      d.id = 'vault-drop';
      d.className = 'dropzone rounded-2xl border-2 border-dashed border-line bg-paper/60 px-5 py-5 mb-4 text-center';
      d.innerHTML = `<div class="font-semibold text-[13.5px]">Drop files here — or anywhere on this screen</div>
        <div class="text-[12px] text-mut mt-0.5">They are sorted into the folders below by name; anything unclear is read by Mr Auditor and filed. Up to ${MAX_FILE_MB} MB each.</div>`;
      $('vault-grid').parentNode.insertBefore(d, $('vault-grid'));
      dropWire(d, fl => vaultTakeFiles([...fl]));
    }
    const sel = $('vault-cat');
    if (sel && sel.options.length && sel.options[0].text === AI_FILING_CHOICE) sel.options[0].text = 'Sort them for me';
  };
}

/* ---------- 6. what to do next ---------- */
/* One list of stages, used by the dashboard and by the top bar, so the two can
   never disagree about where a file stands. */
function journey() {
  const has = S.tb.length > 0;
  const t = has ? tbTotals() : { diff: 0 };
  let ev = null, m = null;
  if (has) { try { ev = evaluate(); m = model(); } catch (e) { ev = null; } }
  const weak = S.tb.filter(r => r.autoWeak).length;
  const highs = ev ? ev.open.filter(f => ['blocker', 'high'].includes(f.sev)).length : 0;
  const bal = has && Math.abs(t.diff) <= 0.5;
  const first = S.setup.firstaudit === 'yes';
  const steps = [
    { key: 'setup', lbl: 'Company registered', done: !!(S.setup.name && S.setup.fye), scr: 'setup', go: 'Fill in the company’s particulars',
      sub: S.setup.name ? `${S.setup.name} · ${S.setup.framework}` : 'name, registration number, year end, framework' },
    { key: 'docs', lbl: 'Documents in the vault', done: _vaultN > 0, scr: 'vault', go: 'Drop in what the client sent',
      sub: _vaultN > 0 ? `${_vaultN} file(s) filed` : 'trial balance, bank statements, last year’s accounts — all at once' },
    { key: 'tb', lbl: 'Trial balance in and balanced', done: bal, scr: 'tb',
      go: !has ? 'Bring in the trial balance' : 'Find why the trial balance is out',
      sub: has ? `${S.tb.length} accounts · ${bal ? 'balanced' : 'out by ' + fmtRM(Math.abs(t.diff))}` : 'from the Excel, CSV or PDF the client exported' },
    { key: 'class', lbl: 'Classifications checked', done: has && weak === 0, scr: 'tb', go: `Check ${weak || 'the'} flagged account${weak === 1 ? '' : 's'}`,
      sub: has ? (weak ? `${weak} account(s) Mr Auditor was not sure about` : 'every account placed') : 'which line of the accounts each balance belongs to' },
    { key: 'py', lbl: first ? 'Prior year — first audit, none needed' : 'Last year’s figures', done: has && (first || hasPY()), scr: 'tb', go: 'Bring in last year’s figures',
      sub: has && hasPY() ? 'comparatives in place' : first ? 'marked as a first audit' : 'the comparative column of every statement' },
    { key: 'findings', lbl: 'Findings dealt with', done: has && bal && highs === 0, scr: 'audit', go: `Work through ${highs || 'the'} high-risk finding${highs === 1 ? '' : 's'}`,
      sub: ev ? `${ev.open.length} open, ${S.adjustments.length} adjustment(s) posted` : 'materiality, analytics and the automatic checks' },
    { key: 'wps', lbl: 'Working papers', done: !!(S.plan.mat && S.plan.mat.applied) && Object.keys(S.wpSign).length >= 3, scr: 'wps', go: 'Complete planning and the lead schedules',
      sub: S.plan.mat && S.plan.mat.applied ? `materiality documented · ${Object.keys(S.wpSign).length} paper(s) signed` : 'planning, risk, and one lead schedule per area' },
    { key: 'fs', lbl: 'Financial statements', done: !!m && Math.abs(m.balGap) <= 1, scr: 'fs', go: 'Review the financial statements',
      sub: m ? (Math.abs(m.balGap) <= 1 ? 'the balance sheet balances' : `balance sheet out by ${fmtRM(m.balGap)}`) : 'produced from the trial balance' },
    { key: 'tax', lbl: 'Tax computation', done: has && (num(S.tax.ca) > 0 || num(S.tax.cp204) > 0 || !!S.tax._touched), scr: 'tax', go: 'Prepare the tax computation',
      sub: 'add-backs, capital allowances, SME rates' },
    { key: 'sign', lbl: 'Reports ready to sign', done: !!(S.sign.partner && S.sign.firm && S.sign.date), scr: 'reports', go: 'Name the partner and date the report',
      sub: S.sign.partner ? `${S.sign.partner}, ${S.sign.firm}` : 'auditor’s report, directors’ report, statutory declaration' },
  ];
  steps.forEach((s, i) => s.n = i + 1);
  const doneCt = steps.filter(s => s.done).length;
  return { steps, next: steps.find(s => !s.done) || null, pct: Math.round(doneCt / steps.length * 100), doneCt };
}
const GUIDE_OFF = ['home', 'register', 'firm', 'agency', 'ref'];
function guideRender() {
  if (typeof S === 'undefined' || !$('top-status')) return;
  let el = $('top-next');
  if (!el) {
    el = document.createElement('button');
    el.id = 'top-next'; el.className = 'next-chip hidden';
    $('top-status').parentNode.insertBefore(el, $('top-status'));
  }
  /* The header blurs what is behind it, which makes it the anchor for anything
     "fixed" inside it. On a phone the chip is pinned to the bottom of the
     screen, so it has to live outside the header to get there. */
  const narrow = window.innerWidth < 1024, st = $('top-status');
  if (narrow && el.parentNode !== document.body) document.body.appendChild(el);
  if (!narrow && el.parentNode !== st.parentNode) st.parentNode.insertBefore(el, st);
  const j = S.setup.name ? journey() : null;
  const hide = !j || !j.next || GUIDE_OFF.includes(current) || isArchived();
  el.classList.toggle('hidden', hide);
  if (hide) return;
  const here = j.next.scr === current;
  el.innerHTML = `<span class="next-ring" style="--p:${j.pct}"><span>${j.doneCt}</span></span>
    <span class="next-txt"><span class="next-k">${here ? 'On this screen' : 'Next'}</span><span class="next-v">${esc(j.next.go)}</span></span>
    ${here ? '' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'}`;
  el.onclick = () => { track('guide', 'next_' + j.next.key); if (!here) show(j.next.scr); else guideNudge(j.next.key); };
}
/* Already on the right screen: point at the thing to press. */
function guideNudge(key) {
  const sel = { tb: '#tb-import-card', class: '#tb-class-health', py: '#tb-py-btn', docs: '#vault-drop' }[key];
  const t = sel && document.querySelector(sel);
  if (!t) return;
  t.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  t.classList.remove('nudge'); void t.offsetWidth; t.classList.add('nudge');
}

/* ---------- 7. the trial balance screen: say what is wrong, and offer the fix ---------- */
{
  const _rtb = renderTB;
  renderTB = function () {
    _rtb();
    const t = tbTotals();
    if (S.tb.length && Math.abs(t.diff) > 0.5) {
      const hints = tbDiagnose(S.tb, []);
      $('tb-balance-banner').innerHTML = `<div class="p-3 rounded-xl bg-riskbg text-[13px]">
        <div class="font-semibold text-risk">Out of balance by ${fmtRM(Math.abs(t.diff))} — debits ${fmtRM(t.dr)}, credits ${fmtRM(t.cr)}</div>
        <div class="mt-2 space-y-1.5 text-ink">${hints.map((h, k) => `<div class="flex items-start gap-2 text-[12.5px]">
          <span class="mt-[6px] w-1.5 h-1.5 rounded-full bg-risk flex-none"></span><span class="flex-1">${esc(h.text)}</span>
          ${h.fix === 'flip' ? `<button class="btn btn-ghost !py-1 !px-2.5 !min-h-0 !text-[11.5px] flex-none" onclick="tbFlip(${h.i})">Move it across</button>` : ''}
          ${h.fix === 'remove' ? `<button class="btn btn-ghost !py-1 !px-2.5 !min-h-0 !text-[11.5px] flex-none" onclick="tbDrop(${h.i})">Remove it</button>` : ''}</div>`).join('')}</div>
        <div class="text-[11.5px] text-mut mt-2">Nothing downstream — findings, statements, tax — can be relied on until this is zero. If the file was read into the wrong columns, import it again and correct the columns in the preview.</div></div>`;
    }
    // prior-year and confirm-all controls live with the health card
    const h = $('tb-class-health');
    if (h && S.tb.length) {
      const weak = S.tb.filter(r => r.autoWeak).length;
      h.insertAdjacentHTML('beforeend', `
        ${weak ? `<button class="btn btn-ghost w-full !py-1.5 !text-[12.5px] mt-1" onclick="tbConfirmAll()">I have checked them — the ${weak} flagged are right</button>` : ''}
        <div class="border-t border-line pt-2.5 mt-2.5">
          <div class="flex justify-between items-center"><span>Last year’s figures</span>
            <span class="pill ${hasPY() ? 'pill-ok' : 'pill-warn'}">${hasPY() ? S.tb.filter(r => num(r.py)).length + ' accounts' : 'missing'}</span></div>
          <label class="btn ${hasPY() ? 'btn-ghost' : 'btn-pri'} w-full !py-1.5 !text-[12.5px] mt-2 cursor-pointer" id="tb-py-btn">
            ${hasPY() ? 'Replace from last year’s trial balance' : 'Bring in last year’s trial balance'}
            <input type="file" accept=".xlsx,.xls,.csv,.pdf" class="hidden" onchange="importPyFile(this)"></label>
          <p class="text-[11.5px] text-mut mt-1.5">Last year’s closing trial balance, any layout. Accounts are matched by code, then by name.</p>
        </div>`);
    }
  };
}
function tbFlip(i) { if (guardArchived()) return; const r = S.tb[i]; const d = r.dr; r.dr = r.cr; r.cr = d; r.cat = classify(r.name, num(r.dr), num(r.cr)); saveState(); renderTB(); updateTop(); logActivity('Moved an account to the other side', 'from the out-of-balance diagnosis'); }
async function tbDrop(i) { if (guardArchived()) return;
  if (!await askConfirm(`Remove "${S.tb[i].name}" (${fmtRM(num(S.tb[i].dr) || num(S.tb[i].cr))}) from the trial balance?`, { title: 'Remove this row', confirmLabel: 'Remove it', danger: true })) return;
  S.tb.splice(i, 1); saveState(); renderTB(); updateTop(); }
function tbConfirmAll() { if (guardArchived()) return; const n = S.tb.filter(r => r.autoWeak).length; S.tb.forEach(r => r.autoWeak = false);
  saveState(); renderTB(); updateTop(); logActivity('Confirmed classifications', `${n} flagged account(s) accepted as classified`); }

/* ---------- 8. the platform's view of how firms are getting on ---------- */
{
  const _ra = renderAgency;
  renderAgency = async function () {
    await _ra();
    if (!isPlatform()) return;
    const host = $('agency-render'); if (!host) return;
    const card = document.createElement('div');
    card.className = 'card card-pad mt-4';
    card.innerHTML = '<h2 class="font-bold text-[15px] mb-1">How firms are getting on</h2><div class="text-[12.5px] text-mut">Loading…</div>';
    host.appendChild(card);
    try {
      const { data, error } = await sb.rpc('usage_summary', { days: 30 });
      if (error) throw new Error(error.message);
      const ago = iso => { if (!iso) return 'never'; const d = Math.floor((Date.now() - new Date(iso)) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
      card.innerHTML = `<h2 class="font-bold text-[15px] mb-1">How firms are getting on</h2>
        <p class="text-[12px] text-mut mb-3">Last 30 days. Screens opened, actions taken and errors hit — never client names, figures or documents.</p>
        ${(data || []).map(f => `<div class="border-t border-line py-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-[13.5px]">${esc(f.firm)}</span>
            <span class="pill ${!f.last_seen ? 'pill-mut' : (Date.now() - new Date(f.last_seen)) < 7 * 86400000 ? 'pill-ok' : 'pill-warn'}">last here ${ago(f.last_seen)}</span>
            <span class="text-[12px] text-mut">${f.days_active} day(s) active · ${f.people} person(s)${(f.devices || []).length ? ' · ' + f.devices.join(', ') : ''}</span>
          </div>
          ${(f.screens || []).length ? `<div class="flex flex-wrap gap-1.5 mt-2">${f.screens.map(s => `<span class="pill pill-mut !text-[11px]">${esc(TITLES[s.name] || s.name)} · ${s.n}</span>`).join('')}</div>
            <div class="text-[12px] text-mut mt-1.5">Stopped on: <strong class="text-ink">${esc(TITLES[(f.last_screens || [])[0]] || (f.last_screens || [])[0] || '—')}</strong></div>` : '<div class="text-[12px] text-mut mt-1">Nothing recorded yet.</div>'}
          ${(f.errors || []).length ? `<div class="mt-2 space-y-1">${f.errors.map(e => `<div class="text-[12px] text-risk">⚠ ${esc(e.m || e.name)} <span class="text-mut">× ${e.n}, ${ago(e.last)}</span></div>`).join('')}</div>` : ''}
        </div>`).join('') || '<div class="text-[12.5px] text-mut">No firms yet.</div>'}`;
    } catch (e) { card.innerHTML = `<h2 class="font-bold text-[15px] mb-1">How firms are getting on</h2><div class="text-[12.5px] text-warn">Could not load: ${esc(e.message)}</div>`; }
  };
}

/* ---------- 9. small pieces of feedback ---------- */
/* A line across the top whenever the app is waiting on the server for more
   than a moment — so a slow read of a document never looks like a dead button. */
{
  const bar = document.createElement('div'); bar.id = 'busy'; document.body.appendChild(bar);
  let live = 0, timer = null;
  const set = () => { clearTimeout(timer); if (live > 0) timer = setTimeout(() => bar.classList.add('on'), 280); else bar.classList.remove('on'); };
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const watched = /\/functions\/v1\/|\/storage\/v1\/object\//.test(url);
    if (!watched) return _fetch.apply(this, arguments);
    live++; set();
    return _fetch.apply(this, arguments).finally(() => { live = Math.max(0, live - 1); set(); });
  };
}
/* Re-drawing the screen you are already on is not an arrival: no entrance. */
{
  const _show2 = show;
  let last = null;
  show = function (scr) {
    const el = $('scr-' + scr);
    if (el) el.classList.toggle('same', last === scr);
    last = scr;
    const r = _show2(scr);
    if (el && !el.classList.contains('same')) window.scrollTo({ top: 0 });
    return r;
  };
}

/* "Reset" used to sit in the top bar of every screen, one press from deleting
   every client a firm has. It lives here now, behind the partner rule. */
{
  const _rc = renderCompliance;
  renderCompliance = function () {
    _rc();
    const host = $('scr-compliance'); if (!host || $('danger-zone')) return;
    const d = document.createElement('div');
    d.id = 'danger-zone'; d.className = 'card card-pad mt-4'; d.style.borderColor = '#FFD4D8';
    d.innerHTML = `<h2 class="font-bold text-[15px] mb-1 text-risk">Delete everything</h2>
      <p class="text-[12.5px] text-mut mb-3">Removes every engagement in this firm, with its evidence. There is no undo. Only a partner can do this.</p>
      <button class="btn btn-risk" onclick="dangerReset()">Delete every engagement…</button>`;
    host.appendChild(d);
  };
}
async function dangerReset() {
  if (!canDeleteEngagement()) { await askConfirm('Only a partner can delete the firm’s engagements.', { title: 'A partner has to do this', confirmLabel: 'I understand' }); return; }
  resetAllData();
}

window.addEventListener('resize', () => { clearTimeout(window._gr); window._gr = setTimeout(guideRender, 150); });
