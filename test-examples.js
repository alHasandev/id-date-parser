import IndonesianDateParser from './index.js';

const parser = new IndonesianDateParser({
  referenceDate: new Date('2026-05-16'),
  weekStart: 'monday'
});

const examples = {
  abbr: ['bsk', 'kmrn', 'hr ini', 'dlm 3 hr', 'tgl 14 Maret', 'bln depan', 'thn lalu', 'mggu depan', 'sblm Natal', 'stlh Idul Fitri'],
  typo: ['besk', 'kemaren', 'senin dpan', 'minggu dpann', 'awal bln', 'akhir mnggu', 'dalm 5 hari', '3 hari yg lalu', 'hari kamiss', 'bulan dpan'],
  combo: ['bsk smp lusa', '3 hr sblm Natal', 'mgg depn - mgg llu', 'dlm 2 bln lg', 'tgl 17 agst', 'kmrn lusa dr skrg', 'awl thn dpann', 'akhr mnggu ini', 'april 2029 sampai juni 2026', 'april 2029 sampai juni'],
  arithmetic: ['3 hari sebelum Natal', '2 minggu setelah Idul Fitri', '1 hari sebelum Tahun Baru', '7 hari sesudah Waisak', 'sebelum Natal', 'setelah Idul Fitri', 'sesudah Waisak']
};

let passed = 0;
let failed = 0;
const failures = [];

function resultStr(result) {
  if (result.type === 'error') return `ERROR: ${result.message}`;
  if (result.type === 'ambiguous')
    return result.results.map(r => {
      if (r.type === 'range') return `${r.start.value}→${r.end.value}`;
      return `${r.value} (${r.label})`;
    }).join(' | ');
  if (result.type === 'range-ambiguous')
    return result.results.map(r => `${r.start.value}→${r.end.value} [${r.label}]`).join(' | ');
  if (result.type === 'range') return `${result.start.value} → ${result.end.value}`;
  return `${result.value} (${result.kind})`;
}

for (const [category, phrases] of Object.entries(examples)) {
  console.log(`\n=== ${category.toUpperCase()} ===`);
  for (const phrase of phrases) {
    try {
      const result = parser.parse(phrase);
      if (result.type === 'error') {
        console.log(`  ❌ "${phrase}" -> ${result.message}`);
        failed++;
        failures.push({ category, phrase, error: result.message });
      } else {
        console.log(`  ✅ "${phrase}" -> ${resultStr(result)}`);
        passed++;
      }
    } catch (err) {
      console.log(`  ❌ "${phrase}" -> THREW: ${err.message}`);
      failed++;
      failures.push({ category, phrase, error: err.message });
    }
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failures.length > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) {
    console.log(`  [${f.category}] "${f.phrase}": ${f.error}`);
  }
}
