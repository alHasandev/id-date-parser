# id-date-parser

Natural language date parser for Indonesian (Bahasa Indonesia) with typo correction, holiday support, and range parsing.

## Install

```bash
npm install id-date-parser
```

Browser (CDN + polyfill):
```html
<script src="https://cdn.jsdelivr.net/npm/temporal-polyfill@0.3.2/global.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/id-date-parser@1/index.min.js"></script>
```

## Usage

```javascript
const IndonesianDateParser = require('id-date-parser');

// Tanggal 16 Mei 2026 sebagai referensi
const parser = new IndonesianDateParser({
  referenceDate: new Date('2026-05-16'),
  weekStart: 'monday' // atau 'sunday'
});

parser.parse('hari ini');           // 2026-05-16
parser.parse('besok');              // 2026-05-17
parser.parse('kemarin');            // 2026-05-15
parser.parse('lusa');               // 2026-05-18
parser.parse('3 hari lalu');        // 2026-05-13
parser.parse('dalam 2 minggu');     // 2026-05-30
parser.parse('1 bulan lagi');       // 2026-06-16
parser.parse('Senin depan');        // 2026-05-18
parser.parse('Natal');              // 2026-12-25
parser.parse('Idul Fitri');         // 2026-03-20
parser.parse('idul fitri 2027')     // 2027-03-09 (resolved via Aladhan API)
parser.parse('14 Maret 2026');      // 2026-03-14
parser.parse('14/03/2026');         // 2026-03-14
parser.parse('april');              // 2026-04-01 (bulan ini, tahun ini)
parser.parse('april 2028');         // 2028-04-01

// Range
parser.parse('dari besok sampai lusa');
// { type: 'range', start: '2026-05-17', end: '2026-05-18' }

parser.parse('14 Maret sampai 28 Maret');
// { type: 'range', start: '2026-03-14', end: '2026-03-28' }

// Range terbalik → 3 kemungkinan
parser.parse('Idul Adha sampai Idul Fitri');
// { type: 'range-ambiguous', results: [...] }

// Kombinasi typo + singkatan
parser.parse('bsk smp lusa');       // besok sampai lusa
parser.parse('3 hr sblm Natal');   // 3 hari sebelum Natal
parser.parse('mgg depn');          // minggu depan (dengan typo)
```

### API pre-caching (opsional)

Untuk akurasi tanggal libur Islam via Aladhan API:

```javascript
const parser = new IndonesianDateParser();

// Pre-cache 2024-2036
await parser.init([2024,2025,2026,2027,2028,2029,2030,2031,2032,2033,2034,2035,2036]);

// Atau auto: current year ± 5 hingga +10
await parser.init();
```

## Response Format

### Single date
```json
{
  "type": "single",
  "value": "2026-05-16",
  "date": "<PlainDate>",
  "kind": "anchor"
}
```

### Range
```json
{
  "type": "range",
  "value": "2026-05-10/2026-05-17",
  "start": { "value": "2026-05-10", "date": "<PlainDate>" },
  "end": { "value": "2026-05-17", "date": "<PlainDate>" },
  "kind": "period-week"
}
```

### Multiple interpretations
```json
{
  "type": "ambiguous",
  "results": [
    { "type": "single", "value": "2026-05-17", "kind": "weekday", "label": "hari" },
    { "type": "range", "start": {...}, "end": {...}, "kind": "period-week", "label": "periode" }
  ]
}
```

### Error with suggestions
```json
{
  "type": "error",
  "message": "Tidak dapat memahami ekspresi tanggal",
  "suggestions": ["minggu ini", "minggu depan", "minggu lalu"]
}
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `referenceDate` | `new Date()` | Tanggal referensi untuk ekspresi relatif |
| `weekStart` | `'monday'` | Awal minggu: `'monday'` atau `'sunday'` |
| `locale` | `'id-ID'` | Locale untuk `formatDisplay()` |

## Features

- **Anchor**: hari ini, besok, lusa, kemarin, kemarin lusa
- **Relative**: dalam 3 hari, 2 minggu lalu, 1 bulan yang lalu
- **Weekday**: Senin depan, Jumat lalu, Sabtu minggu depan
- **Period**: minggu ini/depan/lalu, bulan ini/depan/lalu, tahun ini/depan/lalu
- **Boundary**: awal/akhir bulan/minggu/tahun
- **Holiday**: Natal, Idul Fitri, Idul Adha, Waisak, Tahun Baru, Hari Kemerdekaan, dll
- **Date formats**: 14 Maret 2026, 14/03/2026, 2026-03-14, tgl 14 Maret
- **Range**: dari ... sampai, ... - ...
- **Arithmetic**: 3 hari sebelum Natal, 2 minggu setelah Idul Fitri
- **Typo correction**: 3-layer (abbreviation + phrase + fuzzy Levenshtein)
- **Phrase suggestions**: saat parsing gagal, menampilkan frasa terdekat
- **Temporal.PlainDate**: internal date handling tanpa bug timezone

## License

MIT
