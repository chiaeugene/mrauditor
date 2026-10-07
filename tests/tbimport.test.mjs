/* The importer against the layouts Malaysian accounting packages actually
   export. Run: node tests/tbimport.test.mjs
   It loads the real classifier and amount parser out of app.js, so a change to
   either is exercised here too. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'app.js'), 'utf-8');
const cut = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
const src = cut('const esc = s =>', 'const dMY') + '\n' + cut('const CATS = [', '/* Classifier self-test') + '\n' +
  readFileSync(join(ROOT, 'tbimport.js'), 'utf-8') +
  '\n;globalThis.T = { tbiAnalyse, tbiBuild, tbDiagnose, tbiPasteGrid, tbiHealCsv, classify, num };';
const ctx = vm.createContext({ console, track() {}, toast() {}, document: {}, S: { tb: [] } });
vm.runInContext(src, ctx);
const { tbiAnalyse, tbiBuild, tbDiagnose, tbiPasteGrid, tbiHealCsv } = ctx.T;

let fail = 0;
const check = (name, cond, extra) => { if (!cond) { fail++; console.log('  FAIL', name, extra ?? ''); } else console.log('  ok  ', name); };
const run = grid => { const a = tbiAnalyse(grid); return { a, b: tbiBuild(grid, a, a.map) }; };
const near = (a, b) => Math.abs(a - b) < 0.01;

// The same eight accounts, laid out the way each package prints them.
const ACC = [
  ['1000', 'Cash at bank - Maybank', 120000, 0, 95000, 0],
  ['1100', 'Trade receivables', 300000, 0, 250000, 0],
  ['1500', 'Motor vehicles - cost', 80000, 0, 80000, 0],
  ['2000', 'Trade payables', 0, 150000, 0, 120000],
  ['3000', 'Share capital', 0, 100000, 0, 100000],
  ['3100', 'Retained earnings', 0, 180000, 0, 150000],
  ['4000', 'Sales', 0, 500000, 0, 420000],
  ['5000', 'Purchases', 430000, 0, 365000, 0],
];
const TOTAL = 930000;

console.log('AutoCount — code, description, debit, credit, with title rows and a total');
{
  const g = [['MULTI AGRI SDN BHD'], ['Trial Balance as at 31/12/2025'], [],
    ['Acc. No.', 'Description', 'Debit', 'Credit'],
    ...ACC.map(r => [r[0], r[1], r[2] || '', r[3] || '']), ['', 'Total', TOTAL, TOTAL]];
  const { a, b } = run(g);
  check('name column is the description, not the code', a.map.name === 1);
  check('8 accounts', b.rows.length === 8, b.rows.length);
  check('balances', near(b.diff, 0) && near(b.dr, TOTAL), b.dr + '/' + b.cr);
  check('total row left out with a reason', b.skipped.length === 1);
  check('account code kept', b.rows[0].code === '1000');
}

console.log('SQL Account — numeric codes, formatted strings, credits with CR suffix in one column');
{
  const g = [['Code', 'Description', 'Balance'],
    ...ACC.map(r => [Number(r[0]), r[1], r[2] ? r[2].toLocaleString('en') + '.00' : r[3].toLocaleString('en') + '.00 CR'])];
  const { a, b } = run(g);
  check('one signed column detected', a.map.cr === -1 && a.map.dr === 2);
  check('numeric account codes are not mistaken for money', a.map.name === 1 && a.map.code === 0);
  check('balances', near(b.diff, 0) && near(b.cr, TOTAL), b.dr + '/' + b.cr);
}

console.log('UBS — opening, period and closing groups; brackets for credits');
{
  const g = [['', '', 'Opening', '', 'This Period', '', 'Year To Date', ''],
    ['A/C No', 'Account Name', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'],
    ...ACC.map(r => [r[0], r[1], r[4] || '', r[5] || '', Math.max(0, r[2] - r[4]) || '', Math.max(0, r[3] - r[5]) || '', r[2] || '', r[3] || '']),
    ['', 'TOTAL', 1, 1, 1, 1, TOTAL, TOTAL]];
  const { a, b } = run(g);
  check('takes the year-to-date pair, not opening or period', a.map.dr === 6 && a.map.cr === 7, JSON.stringify(a.map));
  check('balances at the closing figures', near(b.dr, TOTAL) && near(b.diff, 0), b.dr);
}

console.log('Comparative — this year and last year side by side');
{
  const g = [['Account', '2025 Debit', '2025 Credit', 'Prior year Debit', 'Prior year Credit'],
    ...ACC.map(r => [r[1], r[2] || '', r[3] || '', r[4] || '', r[5] || ''])];
  const { a, b } = run(g);
  check('current pair first, prior pair second', a.map.dr === 1 && a.map.cr === 2 && a.map.py === 3 && a.map.pyCr === 4, JSON.stringify(a.map));
  check('prior year found', b.hasPy);
  const sales = b.rows.find(r => r.name === 'Sales'), cash = b.rows.find(r => /Cash/.test(r.name));
  check('prior year stored in natural sign (revenue positive)', near(sales.py, 420000), sales.py);
  check('prior year asset positive', near(cash.py, 95000), cash.py);
}

console.log('No header at all — three bare columns, as pasted from Excel');
{
  const g = tbiPasteGrid(ACC.map(r => [r[1], r[2] || '', r[3] || ''].join('\t')).join('\n'));
  const { b } = run(g);
  check('8 accounts, balanced', b.rows.length === 8 && near(b.diff, 0), b.rows.length + ' ' + b.diff);
}

console.log('CSV with unquoted thousands separators');
{
  const raw = 'Account,Debit,Credit\nCash at bank,120,000.00,\nSales,,120,000.00';
  const g = tbiHealCsv(tbiPasteGrid(raw));
  const { b } = run(g);
  check('figures stitched back together', b.rows.length === 2 && near(b.dr, 120000) && near(b.cr, 120000), JSON.stringify(b.rows.map(r => [r.dr, r.cr])));
}

console.log('Bahasa Malaysia headings');
{
  const g = [['Kod', 'Keterangan', 'Debit', 'Kredit'], ['1000', 'Tunai di bank', 5000, ''], ['4000', 'Jualan', '', 5000], ['', 'Jumlah', 5000, 5000]];
  const { b } = run(g);
  check('reads, skips Jumlah, balances', b.rows.length === 2 && near(b.diff, 0) && b.skipped.length === 1);
  check('classified in Malay', b.rows[0].cat === 'CASH' && b.rows[1].cat === 'REV', b.rows.map(r => r.cat).join());
}

console.log('Diagnosis — the reasons a trial balance does not balance');
{
  const rows = ACC.map(r => ({ name: r[1], dr: r[2], cr: r[3], cat: ctx.T.classify(r[1], r[2], r[3]) }));
  // a debit keyed as a credit
  const wrong = rows.map(r => ({ ...r })); wrong[2] = { ...wrong[2], dr: 0, cr: 80000 };
  const h1 = tbDiagnose(wrong, []);
  check('wrong side is named', h1.some(h => h.kind === 'side' && /Motor vehicles/.test(h.text)), JSON.stringify(h1.map(h => h.kind)));
  // a profit line left in
  const extra = [...rows.map(r => ({ ...r })), { name: 'Current year profit', dr: 0, cr: 70000, cat: 'RE' }];
  const h2 = tbDiagnose(extra, []);
  check('the row equal to the difference is named', h2.some(h => h.kind === 'extra' && /Current year profit/.test(h.text)));
  // an account wrongly skipped as a total
  const miss = rows.filter(r => r.name !== 'Trade payables');
  const h3 = tbDiagnose(miss, [{ line: 9, name: 'Total creditors', dr: 0, cr: 150000, why: 'a total' }]);
  check('a left-out line that equals the gap is offered back', h3.some(h => h.kind === 'left' && h.fix === 'add'));
  check('a balanced file produces no hints', tbDiagnose(rows, []).length === 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
