/* File names → vault folders. Run: node tests/naming.test.mjs */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'intake.js'), 'utf-8');
const body = src.slice(src.indexOf('const NAME_RULES'), src.indexOf('const fileExt'));
const ctx = vm.createContext({}); vm.runInContext(body + ';globalThis.g = guessCategory;', ctx);
const T = 'Trial balance & management accounts', B = 'Bank statements & confirmations', P = 'Prior-year FS & working papers',
  X = 'Tax — CP204 / Form C / assessments', S = 'SSM & statutory records', Y = 'Payroll · EPF · SOCSO', F = 'Fixed asset register & invoices',
  I = 'Inventory count sheets', A = 'Agreements & facility letters', R = 'Sales & receivables evidence', C = 'Purchases & payables evidence';
const cases = [
  ['TB Dec 2025.xlsx', T], ['Trial Balance 31.12.2025.pdf', T], ['TB_FYE2025.xls', T], ['General Ledger 2025.pdf', T], ['Imbangan Duga 2025.xlsx', T],
  ['Management Accounts Dec25.xlsx', T], ['P&L and Balance Sheet.pdf', T],
  ['AFFIN Bank Statement Dec 2025.pdf', B], ['Maybank Jan-Dec.pdf', B], ['Penyata CIMB 12-2025.pdf', B], ['FD cert PBB.pdf', B], ['Bank confirmation.pdf', B],
  ['Audited FS 2024.pdf', P], ['Financial Statements 31.12.2024 (signed).pdf', P], ['Auditors Report 2024.doc', P], ['AFS 2024.pdf', P],
  ['CP204 2025.pdf', X], ['Form C YA2024.pdf', X], ['Tax computation YA 2025.xlsx', X], ['Borang C 2024.pdf', X], ['LHDN notice.pdf', X],
  ['SSM Company Profile.pdf', S], ['Section 58 change of directors.pdf', S], ['Annual Return 2025.pdf', S], ['Form 24.pdf', S], ['Constitution.pdf', S],
  ['EPF Borang A Dec.pdf', Y], ['Payroll summary 2025.xlsx', Y], ['SOCSO Dec.pdf', Y], ['EA Forms 2025.pdf', Y], ['Gaji Disember.xlsx', Y],
  ['Fixed Asset Register 2025.xlsx', F], ['FAR.xlsx', F], ['Depreciation schedule.xlsx', F],
  ['Stock take 31.12.25.xlsx', I], ['Inventory listing.csv', I],
  ['Tenancy Agreement - shoplot.pdf', A], ['Hire Purchase Agreement.pdf', A], ['Letter of Offer Maybank term loan.pdf', A], ['Aging report.xlsx', null],
  ['Debtors Aging Dec 2025.xlsx', R], ['Sales invoices Dec.pdf', R], ['Creditors Aging.xlsx', C], ['Supplier statement.pdf', C],
  ['scan0007.pdf', null], ['IMG_2231.jpg', null], ['Document (3).pdf', null], ['New folder.zip', null],
];
let fail = 0;
for (const [n, want] of cases) { const got = ctx.g(n); if (got !== want) { fail++; console.log('FAIL', n, '→', got, '(wanted', want + ')'); } }
console.log(fail ? fail + ' FAILED of ' + cases.length : 'all ' + cases.length + ' passed'); process.exit(fail ? 1 : 0);
