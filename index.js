/**
 * Indonesian Natural Language Date Parser v2
 * Dengan Fuzzy Matching / Typo Correction
 * 
 * Parser tanggal bahasa Indonesia untuk ekspresi natural language
 * dengan kemampuan memahami typo dan singkatan.
 * 
 * Mendukung:
 * - Anchor: hari ini, besok, lusa, kemarin, kemarin lusa
 * - Relative: dalam 3 hari, 2 minggu lalu, 1 bulan yang lalu
 * - Weekday: Senin depan, hari Selasa, Jumat lalu
 * - Period: minggu ini/depan/lalu, bulan ini/depan/lalu, tahun ini/depan/lalu
 * - Boundary: awal/akhir bulan/minggu/tahun, akhir pekan
 * - Holidays: Natal, Idul Fitri, Tahun Baru, Waisak, Nyepi, dll
 * - Date formats: 14 Maret 2026, 14/03/2026, 2026-03-14, tgl 14 Maret
 * - Ranges: dari 14 Maret sampai 28 Maret, besok - lusa
 * - Arithmetic: 3 hari sebelum Natal, 2 minggu setelah Idul Fitri
 * - Typo correction: bsk→besok, mggu depn→minggu depan, dll
 */

// Node.js: load Temporal polyfill (browser loads via CDN script before this file)
if (typeof Temporal === 'undefined') {
    try { var { Temporal } = require('temporal-polyfill'); } catch (e) { }
}

class IndonesianDateParser {
    constructor(options = {}) {
        this.locale = options.locale || 'id-ID';
        this.weekStart = options.weekStart || 'monday';
        this.allowPast = options.allowPast ?? true;
        this.referenceDate = options.referenceDate
            ? new Temporal.PlainDate(
                options.referenceDate.getFullYear(),
                options.referenceDate.getMonth() + 1,
                options.referenceDate.getDate()
            )
            : Temporal.Now.plainDateISO();

        // Indonesian month names
        this.monthNames = [
            'januari', 'februari', 'maret', 'april', 'mei', 'juni',
            'juli', 'agustus', 'september', 'oktober', 'november', 'desember'
        ];

        this.monthShortNames = [
            'jan', 'feb', 'mar', 'apr', 'mei', 'jun',
            'jul', 'agu', 'sep', 'okt', 'nov', 'des'
        ];

        // Weekday names (0 = Sunday, 1 = Monday, ... 6 = Saturday)
        this.weekdayNames = {
            'minggu': 0, 'senin': 1, 'selasa': 2, 'rabu': 3,
            'kamis': 4, 'jumat': 5, 'sabtu': 6
        };

        // Time units
        this.units = {
            'hari': 'day', 'harian': 'day',
            'minggu': 'week', 'pekan': 'week',
            'bulan': 'month',
            'tahun': 'year', 'taun': 'year'
        };

        // "se-" prefix units (meaning "one" unit)
        this.seUnits = {
            'sehari': 'hari', 'seminggu': 'minggu', 'sepekan': 'pekan',
            'sebulan': 'bulan', 'setahun': 'tahun'
        };

        // Anchor expressions
        this.anchors = {
            'hari ini': 0,
            'sekarang': 0,
            'besok': 1,
            'bsok': 1,
            'lusa': 2,
            'kemarin': -1,
            'kmrn': -1,
            'kemarin lusa': -2,
            'kmrn lusa': -2
        };

        // === FUZZY MATCHING SETUP ===
        this._buildAbbreviationMap();
        this.holidayDates = this._buildHolidayTable();
        this._buildFuzzyDictionary();
        this._buildPhraseDictionary();

        // Islamic holiday API cache
        this._islamicCache = {};
        this._apiBaseUrl = 'https://api.aladhan.com/v1/hToG';

        // Pre-compiled regex patterns & pre-bound rule cascade
        this._rangePatterns = [
            /^dari\s+(.+?)\s+(sampai|hingga|s\/d|sd)\s+(.+)$/,
            /^(.+?)\s+(sampai|hingga|s\/d|sd)\s+(.+)$/,
            /^(.+?)\s*[-–—]\s*(.+)$/
        ];
        this._periodPatterns = [
            { pattern: /^minggu\s+(ini|depan|lalu)$/, unit: 'week' },
            { pattern: /^pekan\s+(ini|depan|lalu)$/, unit: 'week' },
            { pattern: /^bulan\s+(ini|depan|lalu)$/, unit: 'month' },
            { pattern: /^tahun\s+(ini|depan|lalu)$/, unit: 'year' }
        ];
        this._yearPattern = /^tahun\s+(\d{4})$/;
        this._boundaryModPattern = /^(awal|akhir)\s+(bulan|minggu|tahun|pekan)\s+(ini|depan|lalu)$/;
        this._holidayYearPattern = /^(.+)\s+(\d{4})$/;
        this._weekdayHariPattern = /^hari\s+(minggu|senin|selasa|rabu|kamis|jumat|sabtu)(?:\s+(depan|lalu|ini|minggu\s+depan|minggu\s+lalu|bulan\s+depan|bulan\s+lalu))?$/;
        this._weekdayPlainPattern = /^(minggu|senin|selasa|rabu|kamis|jumat|sabtu)(?:\s+(depan|lalu|ini|minggu\s+depan|minggu\s+lalu|bulan\s+depan|bulan\s+lalu))?$/;
        this._arithmeticExplicit = /^(\d+)\s+(hari|minggu|bulan|tahun)\s+(sebelum|sesudah|setelah)\s+(.+)$/;
        this._arithmeticDefault = /^(sebelum|sesudah|setelah)\s+(.+)$/;
        this._relativeFuturePatterns = [
            /^dalam\s+(\d+)\s+(hari|minggu|bulan|tahun|pekan)$/,
            /^(\d+)\s+(hari|minggu|bulan|tahun|pekan)\s+(lagi|mendatang|yang akan datang)$/,
            /^(\d+)\s+(hari|minggu|bulan|tahun|pekan)\s+dari\s+sekarang$/,
            /^dalam\s+(\d+)\s+(hari|minggu|bulan|tahun|pekan)\s+lagi$/,
            /^dalam\s+(sehari|seminggu|sepekan|sebulan|setahun)$/,
            /^(sehari|seminggu|sepekan|sebulan|setahun)\s+(lagi|mendatang|yang akan datang)$/,
            /^(sehari|seminggu|sepekan|sebulan|setahun)\s+dari\s+sekarang$/,
            /^dalam\s+(sehari|seminggu|sepekan|sebulan|setahun)\s+lagi$/
        ];
        this._relativePastPatterns = [
            /^(\d+)\s+(hari|minggu|bulan|tahun|pekan)\s+(yang\s+)?lalu$/,
            /^sejak\s+(\d+)\s+(hari|minggu|bulan|tahun|pekan)\s+(yang\s+)?lalu$/,
            /^(sehari|seminggu|sepekan|sebulan|setahun)\s+(yang\s+)?lalu$/,
            /^sejak\s+(sehari|seminggu|sepekan|sebulan|setahun)\s+(yang\s+)?lalu$/
        ];
        this._dateFormatPatterns = [
            { regex: /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/, kind: 'dayMonthYear' },
            { regex: /^([a-z]+)\s+(\d{4})$/, kind: 'monthYear' },
            { regex: /^([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?$/, kind: 'monthDayYear' },
            { regex: /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/, kind: 'slashDMY' },
            { regex: /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/, kind: 'slashYMD' },
            { regex: /^([a-z]+)$/, kind: 'monthOnly' },
            { regex: /^(\d{1,2})[\/\-.](\d{1,2})$/, kind: 'slashDM' }
        ];

        // Pre-bound rule cascade
        this._singleRules = [
            this._tryArithmeticAroundHoliday.bind(this),
            this._tryAnchor.bind(this),
            this._tryRelativeFuture.bind(this),
            this._tryRelativePast.bind(this),
            this._tryWeekday.bind(this),
            this._tryPeriod.bind(this),
            this._tryBoundary.bind(this),
            this._tryHoliday.bind(this),
            this._tryDateFormat.bind(this)
        ];

        // Pre-build phrase candidates for multi-word protection (Layer 2b)
        this._phraseCandidates = this._buildPhraseCandidates();
    }

    _getDayOfWeek(date) {
        return date.dayOfWeek % 7;
    }

    /**
     * Build abbreviation map (common Indonesian text abbreviations)
     */
    _buildAbbreviationMap() {
        this.abbreviations = {
            // Core words
            'tgl': 'tanggal',
            'tg': 'tanggal',
            'hr': 'hari',
            'hri': 'hari',
            'bln': 'bulan',
            'bl': 'bulan',
            'thn': 'tahun',
            'th': 'tahun',
            'taun': 'tahun',
            'mg': 'minggu',
            'mgg': 'minggu',
            'mggu': 'minggu',
            'mnggu': 'minggu',
            'mngu': 'minggu',
            'pekan': 'pekan',
            'pkn': 'pekan',

            // Modifiers
            'dlm': 'dalam',
            'dalm': 'dalam',
            'sblm': 'sebelum',
            'sbelum': 'sebelum',
            'stlh': 'setelah',
            'stelah': 'setelah',
            'ssdh': 'sesudah',
            'ssudah': 'sesudah',
            'skrg': 'sekarang',
            'skrng': 'sekarang',
            'skarang': 'sekarang',
            'skrang': 'sekarang',
            'sdh': 'sudah',
            'udh': 'sudah',
            'udah': 'sudah',
            'lg': 'lagi',
            'lgi': 'lagi',
            'dpn': 'depan',
            'dPN': 'depan',
            'dPNn': 'depan',
            'dpan': 'depan',
            'awl': 'awal',
            'akhr': 'akhir',
            'akhri': 'akhir',

            // Months
            'ags': 'agustus',
            'agst': 'agustus',
            'agt': 'agustus',

            // Anchors
            'bsk': 'besok',
            'besk': 'besok',
            'bsok': 'besok',
            'kmrn': 'kemarin',
            'kmaren': 'kemarin',
            'kmrin': 'kemarin',
            'kmarenlusa': 'kemarin lusa',
            'kmrnlusa': 'kemarin lusa',
            'lsa': 'lusa',
            'hrini': 'hari ini',
            'hr ini': 'hari ini',

            // Weekdays
            'snin': 'senin',
            'slasa': 'selasa',
            'sls': 'selasa',
            'rbo': 'rabu',
            'rbu': 'rabu',
            'kms': 'kamis',
            'jmt': 'jumat',
            'jmat': 'jumat',
            'sbtu': 'sabtu',

            // Conjunctions
            'smp': 'sampai',
            'smpi': 'sampai',
            'smpe': 'sampai',
            'hngga': 'hingga',
            'hgga': 'hingga',
            'dr': 'dari',
            'dri': 'dari',
            'sd': 'sampai',
            's/d': 'sampai',

            // Periods
            'mgu': 'minggu',
            'mggini': 'minggu ini',
            'mggdepan': 'minggu depan',
            'mgglalu': 'minggu lalu',
            'blnini': 'bulan ini',
            'blndepan': 'bulan depan',
            'blnlalu': 'bulan lalu',
            'thnini': 'tahun ini',
            'thndepan': 'tahun depan',
            'thnlalu': 'tahun lalu',

            // Misc
            'yglalu': 'yang lalu',
            'ynglalu': 'yang lalu',
            'yg': 'yang',
            'yng': 'yang',
            'utk': 'untuk',
            'untk': 'untuk',
            'dgn': 'dengan',
            'dg': 'dengan',
            'krn': 'karena',
            'tdk': 'tidak',
            'gak': 'tidak',
            'ga': 'tidak',
            'tdak': 'tidak',
            'bkn': 'bukan',
            'jga': 'juga',
            'jg': 'juga',
            'sja': 'saja',
            'sj': 'saja',
            'sbg': 'sebagai',
            'sbgai': 'sebagai',
            'lbh': 'lebih',
            'krg': 'kurang',
            'spt': 'seperti',
            'sprti': 'seperti',
            'mslh': 'masalah',
            'pr': 'perlu',
            'prlu': 'perlu',
            'hrs': 'harus',
            'hrus': 'harus',
            'bisa': 'bisa',
            'bs': 'bisa',
            'dpt': 'dapat',
            'dapat': 'dapat',
            'trmsk': 'termasuk',
            'trmsuk': 'termasuk',
            'msuk': 'masuk',
            'klr': 'keluar',
            'mndatang': 'mendatang',
            'mdatang': 'mendatang',
            'mendtg': 'mendatang',
            'akn': 'akan',
            'akn dtg': 'akan datang',
            'dtg': 'datang',
            'brkt': 'berikut',
            'brkut': 'berikut',
            'sblmnya': 'sebelumnya',
            'sblumnya': 'sebelumnya',
            'sbmnya': 'sebelumnya',
            'stlhnya': 'setelahnya',
            'stlhny': 'setelahnya',
            'sudh': 'sudah',
            'blm': 'belum',
            'blum': 'belum',
            'nnti': 'nanti',
            'ntar': 'nanti',
            'ntn': 'nanti',
            'kmdian': 'kemudian',
            'skrgjuga': 'sekarang juga',
            'skrngjga': 'sekarang juga',

            // Numbers (text)
            'st': 'satu',
            'du': 'dua',
            'tga': 'tiga',
            'emp': 'empat',
            'lma': 'lima',
            'enm': 'enam',
            'tuj': 'tujuh',
            'dlpn': 'delapan',
            'smbln': 'sembilan',
            'sbln': 'sembilan',
            'spuluh': 'sepuluh',
            'sbls': 'sebelas',
            'dua bls': 'dua belas',
            'tiga bls': 'tiga belas',
            'dtg': 'datang',
            'brp': 'berapa',
            'brpa': 'berapa',

            // Boundaries
            'awlbln': 'awal bulan',
            'akhrbln': 'akhir bulan',
            'awlmgg': 'awal minggu',
            'akhrmgg': 'akhir minggu',
            'awlthn': 'awal tahun',
            'akhrthn': 'akhir tahun',
            'akhrpkn': 'akhir pekan',
            'akhrpekan': 'akhir pekan',
            'akhrmnggu': 'akhir minggu',

            // Holidays
            'idfitri': 'idul fitri',
            'idulfitri': 'idul fitri',
            'lebaran': 'lebaran',
            'lbrn': 'lebaran',
            'iduladha': 'idul adha',
            'idadha': 'idul adha',
            'natal': 'natal',
            'ntal': 'natal',
            'thbaru': 'tahun baru',
            'thnbaru': 'tahun baru',
            'thbarumasehi': 'tahun baru masehi',
            'wsk': 'waisak',
            'wysak': 'waisak',
            'nyep': 'nyepi',
            'imlk': 'imlek',
            'maulid': 'maulid nabi',
            'maulidnabi': 'maulid nabi',
            'isramiraj': 'isra miraj',
            'kemerdekaan': 'hari kemerdekaan',
            'merdeka': 'hari kemerdekaan',
            'pahlawan': 'hari pahlawan',
            'kartini': 'hari kartini',
            'ibu': 'hari ibu',
            'buruh': 'hari buruh',
            'pancasila': 'hari pancasila',

            // Special
            'hrlibur': 'hari libur',
            'hrlbr': 'hari libur',
            'hrkerja': 'hari kerja',
            'hrminggu': 'hari minggu',
            'hansenin': 'hari senin',
            'harselasa': 'hari selasa',
            'harrabu': 'hari rabu',
            'harkamis': 'hari kamis',
            'harjumat': 'hari jumat',
            'harsabtu': 'hari sabtu',
            'harmggu': 'hari minggu',
        };
    }

    /**
     * Build dictionary for fuzzy matching (all known words)
     */
    _buildFuzzyDictionary() {
        const dict = new Set();

        // Anchors
        Object.keys(this.anchors).forEach(w => w.split(/\s+/).forEach(t => dict.add(t)));

        // Weekdays
        Object.keys(this.weekdayNames).forEach(w => dict.add(w));

        // Units
        Object.keys(this.units).forEach(w => dict.add(w));

        // Months
        this.monthNames.forEach(w => dict.add(w));
        this.monthShortNames.forEach(w => dict.add(w));

        // Modifiers
        ['depan', 'lalu', 'ini', 'lagi', 'mendatang', 'yang', 'sebelum',
            'sesudah', 'setelah', 'dari', 'sampai', 'hingga', 'dalam',
            'sejak', 'sudah', 'belum', 'akan', 'nanti', 'datang',
            'awal', 'akhir', 'hari', 'tanggal', 'kemudian', 'berikut',
            'sebelumnya', 'setelahnya', 'sekarang', 'juga', 'perlu',
            'harus', 'bisa', 'dapat', 'masuk', 'keluar', 'termasuk',
            'seperti', 'lebih', 'kurang', 'saja', 'bukan', 'karena',
            'untuk', 'dengan', 'masalah', 'berapa'].forEach(w => dict.add(w));

        // Holidays
        Object.keys(this.holidayDates || {}).forEach(w => w.split(/\s+/).forEach(t => dict.add(t)));

        // Numbers
        ['satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan',
            'sembilan', 'sepuluh', 'sebelas', 'dua belas', 'tiga belas',
            'empat belas', 'lima belas', 'enam belas', 'tujuh belas',
            'delapan belas', 'sembilan belas', 'dua puluh'].forEach(w => dict.add(w));

        // "se-" prefix units (one unit)
        Object.keys(this.seUnits).forEach(w => dict.add(w));

        // Remove abbreviations (already handled separately)
        Object.keys(this.abbreviations).forEach(abbr => dict.delete(abbr));

        this.fuzzySet = dict;
        this.fuzzyDict = Array.from(dict);
    }

    /**
     * Build phrase dictionary for multi-word exact matching
     */
    _buildPhraseDictionary() {
        this.phraseDictionary = new Set([
            // Anchors
            'hari ini', 'besok', 'lusa', 'kemarin', 'kemarin lusa', 'sekarang',
            // Periods
            'minggu ini', 'minggu depan', 'minggu lalu',
            'pekan ini', 'pekan depan', 'pekan lalu',
            'bulan ini', 'bulan depan', 'bulan lalu',
            'tahun ini', 'tahun depan', 'tahun lalu',
            'akhir pekan', 'akhir minggu',
            // Boundaries
            'awal bulan', 'akhir bulan', 'awal minggu', 'akhir minggu',
            'awal tahun', 'akhir tahun',
            // Modifiers
            'yang lalu', 'yang akan datang', 'yang mendatang',
            'dari sekarang',
            // Holidays (common phrases)
            'idul fitri', 'idul adha', 'tahun baru', 'tahun baru masehi',
            'tahun baru imlek', 'hari raya', 'hari raya idul fitri',
            'hari raya idul adha', 'hari raya waisak', 'hari raya nyepi',
            'maulid nabi', 'maulid nabi muhammad', 'isra miraj',
            'hari kemerdekaan', 'hari pahlawan', 'hari kartini',
            'hari ibu', 'hari buruh', 'hari pancasila',
            // Weekday contexts
            'hari senin', 'hari selasa', 'hari rabu', 'hari kamis',
            'hari jumat', 'hari sabtu', 'hari minggu',
            'senin depan', 'selasa depan', 'rabu depan',
            'kamis depan', 'jumat depan', 'sabtu depan', 'minggu depan',
            'senin lalu', 'selasa lalu', 'rabu lalu',
            'kamis lalu', 'jumat lalu', 'sabtu lalu', 'minggu lalu',
            'senin ini', 'selasa ini', 'rabu ini',
            'kamis ini', 'jumat ini', 'sabtu ini', 'minggu ini',
            'minggu depan', 'minggu lalu',
            // Arithmetic
            'dari sekarang',
            // Range
            'sampai dengan',
        ]);
    }

    _buildPhraseCandidates() {
        const candidates = [];
        for (const phrase of this.phraseDictionary) {
            const words = phrase.split(/\s+/);
            if (words.length > 1) candidates.push(words);
        }
        for (const key of Object.keys(this.holidayDates || {})) {
            const words = key.split(/\s+/);
            if (words.length > 1) candidates.push(words);
        }
        candidates.sort((a, b) => b.length - a.length);
        return candidates;
    }

    /**
     * Find related known phrases by matching recognized words.
     * Used to suggest alternatives when parsing fails.
     */
    _findRelatedPhrases(input) {
        const tokens = input.toLowerCase().split(/\s+/);
        const knownWords = new Set();
        for (const t of tokens) {
            if (!isNaN(t) || this.fuzzySet.has(t) || this.abbreviations[t]) {
                knownWords.add(t);
            }
        }
        if (knownWords.size === 0) return [];

        const candidates = [];
        for (const phrase of this.phraseDictionary) {
            const phraseWords = phrase.split(/\s+/);
            let hits = 0;
            for (const pw of phraseWords) {
                if (knownWords.has(pw)) hits++;
            }
            if (hits > 0) {
                candidates.push({ phrase, hits, len: phraseWords.length });
            }
        }
        candidates.sort((a, b) => b.hits - a.hits || a.len - b.len);
        return candidates.slice(0, 5).map(c => c.phrase);
    }

    /**
     * Levenshtein distance (iterative, space-optimized)
     */
    _levenshtein(a, b) {
        if (a === b) return 0;
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        // Ensure a is the shorter string for space optimization
        if (a.length > b.length) [a, b] = [b, a];

        const m = a.length;
        const n = b.length;
        let prev = new Array(m + 1);
        let curr = new Array(m + 1);

        for (let i = 0; i <= m; i++) prev[i] = i;

        for (let j = 1; j <= n; j++) {
            curr[0] = j;
            for (let i = 1; i <= m; i++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[i] = Math.min(
                    prev[i] + 1,      // deletion
                    curr[i - 1] + 1,  // insertion
                    prev[i - 1] + cost // substitution
                );
            }
            [prev, curr] = [curr, prev];
        }

        return prev[m];
    }

    /**
     * Calculate max allowed edit distance based on word length
     */
    _maxDistance(length) {
        if (length <= 3) return 1;
        if (length <= 5) return 2;
        if (length <= 8) return 3;
        return 4;
    }

    /**
     * Find best fuzzy match for a token in dictionary
     */
    _findBestMatch(token, dictionary, maxDist) {
        let best = null;
        let bestDist = Infinity;

        for (const word of dictionary) {
            if (Math.abs(word.length - token.length) > maxDist) continue;

            const dist = this._levenshtein(token, word);
            if (dist <= maxDist && dist < bestDist) {
                bestDist = dist;
                best = word;
                if (dist === 0) break; // exact match
            }
        }

        return best;
    }

    /**
     * Correct typos in input using 3-layer approach:
     * 1. Abbreviation exact match
     * 2. Phrase exact match (multi-word)
     * 3. Token-level fuzzy matching
     */
    _correctTypos(input) {
        let corrected = input;
        const corrections = [];

        // Layer 1: Exact abbreviation replacement (whole words)
        const tokens = corrected.split(/\s+/);
        const correctedTokens = tokens.map((token, idx) => {
            const clean = token.toLowerCase().replace(/[^a-z\/]/g, '');
            let replacement = null;
            if (this.abbreviations[clean]) {
                replacement = this.abbreviations[clean];
            } else if (this.abbreviations[token.toLowerCase()]) {
                replacement = this.abbreviations[token.toLowerCase()];
            }
            if (replacement) {
                const expandedWords = replacement.split(/\s+/);
                // Avoid duplication: if expanded first word matches previous token, drop it
                if (idx > 0 && expandedWords[0] === tokens[idx - 1].toLowerCase()) {
                    expandedWords.shift();
                }
                // Avoid duplication: if expanded last word matches next token, drop it
                if (idx < tokens.length - 1 && expandedWords.length > 0 && expandedWords[expandedWords.length - 1] === tokens[idx + 1].toLowerCase()) {
                    expandedWords.pop();
                }
                if (expandedWords.length > 0) {
                    const expanded = expandedWords.join(' ');
                    corrections.push({ from: token, to: expanded, method: 'abbr' });
                    return expanded;
                }
                return token;
            }
            return token;
        });
        corrected = correctedTokens.join(' ');

        // Layer 2: Try exact phrase match from dictionary
        // Check if the whole corrected string matches a known phrase
        if (this.phraseDictionary.has(corrected.toLowerCase())) {
            return { text: corrected, corrections };
        }

        // Layer 2b: Find known multi-word phrases and protect their tokens
        const protectedTokens = new Set();
        const correctedWords = corrected.split(/\s+/);
        for (const phraseWords of this._phraseCandidates) {
            const phraseLen = phraseWords.length;
            for (let i = 0; i <= correctedWords.length - phraseLen; i++) {
                let match = true;
                for (let j = 0; j < phraseLen; j++) {
                    if (correctedWords[i + j].toLowerCase() !== phraseWords[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    for (let j = 0; j < phraseLen; j++) {
                        protectedTokens.add(i + j);
                    }
                }
            }
        }

        // Layer 3: Token-level fuzzy matching for remaining unknown tokens
        const fuzzyCorrected = correctedWords.map((token, idx) => {
            const lowerToken = token.toLowerCase();

            // Skip if it's a number
            if (/^\d+$/.test(token)) return token;

            // Skip if protected by multi-word phrase match
            if (protectedTokens.has(idx)) return token;

            // Skip if already in dictionary (exact match)
            if (this.fuzzySet.has(lowerToken)) return token;

            // Skip if it's a known abbreviation (already handled)
            if (this.abbreviations[lowerToken]) return token;

            // Try fuzzy match
            const maxDist = this._maxDistance(lowerToken.length);
            const match = this._findBestMatch(lowerToken, this.fuzzyDict, maxDist);

            if (match) {
                corrections.push({
                    from: token,
                    to: match,
                    method: 'fuzzy',
                    distance: this._levenshtein(lowerToken, match)
                });
                // Preserve original case pattern if possible
                return match;
            }

            return token;
        });

        corrected = fuzzyCorrected.join(' ');

        return { text: corrected, corrections };
    }

    /**
     * Build holiday lookup table
     */
    _buildHolidayTable() {
        return {
            // Fixed Gregorian holidays
            'natal': { fixed: { month: 12, day: 25 } },
            'tahun baru': { fixed: { month: 1, day: 1 } },
            'tahun baru masehi': { fixed: { month: 1, day: 1 } },
            'hari kemerdekaan': { fixed: { month: 8, day: 17 } },
            'hari pahlawan': { fixed: { month: 11, day: 10 } },
            'hari kartini': { fixed: { month: 4, day: 21 } },
            'hari ibu': { fixed: { month: 12, day: 22 } },
            'hari buruh': { fixed: { month: 5, day: 1 } },
            'hari pancasila': { fixed: { month: 6, day: 1 } },
            'hari raya nyepi': { fixed: { month: 3, day: 11 } },

            // Idul Fitri (Hijri 1 Shawwal)
            'idul fitri': {
                islamic: { month: 10, day: 1 },
                lookup: {
                    2024: { month: 4, day: 10 },
                    2025: { month: 3, day: 31 },
                    2026: { month: 3, day: 20 },
                    2027: { month: 3, day: 9 }
                }
            },
            'lebaran': { aliasOf: 'idul fitri' },
            'hari raya idul fitri': { aliasOf: 'idul fitri' },

            // Idul Adha (Hijri 10 Dhu al-Hijjah)
            'idul adha': {
                islamic: { month: 12, day: 10 },
                lookup: {
                    2024: { month: 6, day: 17 },
                    2025: { month: 6, day: 7 },
                    2026: { month: 5, day: 27 },
                    2027: { month: 5, day: 17 }
                }
            },
            'hari raya idul adha': { aliasOf: 'idul adha' },

            // Tahun Baru Imlek (Lunar)
            'tahun baru imlek': {
                lookup: {
                    2024: { month: 2, day: 10 },
                    2025: { month: 1, day: 29 },
                    2026: { month: 2, day: 17 },
                    2027: { month: 2, day: 6 },
                    2028: { month: 1, day: 26 },
                    2029: { month: 2, day: 13 },
                    2030: { month: 2, day: 3 }
                }
            },
            'imlek': { aliasOf: 'tahun baru imlek' },

            // Waisak (Vesak)
            'waisak': {
                lookup: {
                    2024: { month: 5, day: 23 },
                    2025: { month: 5, day: 12 },
                    2026: { month: 5, day: 31 },
                    2027: { month: 5, day: 20 },
                    2028: { month: 5, day: 9 },
                    2029: { month: 5, day: 28 },
                    2030: { month: 5, day: 18 }
                }
            },
            'hari raya waisak': { aliasOf: 'waisak' },

            // Maulid Nabi (Hijri 12 Rabi al-Awwal)
            'maulid nabi': {
                islamic: { month: 3, day: 12 },
                lookup: {
                    2024: { month: 9, day: 16 },
                    2025: { month: 9, day: 5 },
                    2026: { month: 8, day: 26 },
                    2027: { month: 8, day: 16 }
                }
            },
            'maulid nabi muhammad': { aliasOf: 'maulid nabi' },

            // Isra Mi'raj (Hijri 27 Rajab)
            'isra miraj': {
                islamic: { month: 7, day: 27 },
                lookup: {
                    2024: { month: 2, day: 8 },
                    2025: { month: 1, day: 27 },
                    2026: { month: 1, day: 17 },
                    2027: { month: 1, day: 6 }
                }
            },
            'isra mi raj': { aliasOf: 'isra miraj' },
        };
    }

    /**
     * Main parse entry point
     */
    parse(input) {
        if (!input || typeof input !== 'string') {
            return { type: 'error', message: 'Input harus berupa string' };
        }

        const normalized = this._normalize(input);
        if (!normalized) {
            return { type: 'error', message: 'Input kosong' };
        }

        // Apply typo correction
        const { text: corrected, corrections } = this._correctTypos(normalized);

        // Try parsing with corrected text
        const tryParse = (text) => {
            const rangeResult = this._tryRange(text);
            if (rangeResult) return rangeResult;

            const singles = this._collectAllSingles(text);
            if (singles.length === 0) return null;
            if (singles.length === 1) return singles[0];
            return { type: 'ambiguous', results: singles, original: text };
        };

        let result = tryParse(corrected);
        if (!result && corrected.endsWith(' dari sekarang')) {
            result = tryParse(corrected.slice(0, -' dari sekarang'.length));
        }

        if (result) {
            result.corrections = corrections;
            result.originalInput = input;
            return result;
        }

        return {
            type: 'error',
            message: 'Tidak dapat memahami ekspresi tanggal',
            input: normalized,
            corrected,
            corrections,
            suggestions: this._findRelatedPhrases(corrected),
            originalInput: input
        };
    }

    /**
     * Normalize input text (lowercase, strip ordinals, etc.)
     */
    _normalize(input) {
        return input
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/([0-9]+)(st|nd|rd|th)/gi, '$1');
    }

    /**
     * Try to parse as a date range
     */
    _tryRange(input) {
        for (const pattern of this._rangePatterns) {
            const match = input.match(pattern);
            if (match) {
                let startStr = match[1].trim();
                let endStr = match[3] ? match[3].trim() : match[2].trim();
                const origStartStr = startStr;
                const origEndStr = endStr;

                const endSingle = this._trySingle(endStr);
                if (endSingle && endSingle.date) {
                    const endMonth = endSingle.date.month - 1;
                    const endYear = endSingle.date.year;

                    if (/^\d{1,2}$/.test(startStr)) {
                        startStr = `${startStr} ${this.monthNames[endMonth]} ${endYear}`;
                    }
                }

                const start = this._trySingle(startStr);
                const end = this._trySingle(endStr);

                if (start && end && start.date && end.date) {
                    if (Temporal.PlainDate.compare(start.date, end.date) > 0) {
                        return this._generateRangeAlternatives(start, end, origStartStr, origEndStr, input);
                    }
                    return this._makeRangeResult(start, end);
                }
            }
        }
        return null;
    }

    _buildSingleResult(date, kind, input) {
        return { type: 'single', value: this._formatDate(date), date, kind, original: input };
    }

    _buildRangeResult(startDate, endDate, kind, input) {
        const s = this._formatDate(startDate);
        const e = this._formatDate(endDate);
        return {
            type: 'range',
            value: `${s}/${e}`,
            start: { value: s, date: startDate, kind },
            end: { value: e, date: endDate, kind },
            kind,
            original: input
        };
    }

    _makeRangeResult(start, end) {
        return this._buildRangeResult(start.date, end.date, 'range');
    }

    _reparseForYear(text, year) {
        const prevRef = this.referenceDate;
        try {
            this.referenceDate = new Temporal.PlainDate(year, prevRef.month, prevRef.day);
            return this._trySingle(text);
        } finally {
            this.referenceDate = prevRef;
        }
    }

    _generateRangeAlternatives(startResult, endResult, startStr, endStr, input) {
        const startDate = startResult.date;
        const endDate = endResult.date;
        const results = [];
        const seen = new Set();

        const addResult = (s, e, label) => {
            if (!s || !e || !s.date || !e.date) return;
            const key = `${this._formatDate(s.date)}/${this._formatDate(e.date)}`;
            if (seen.has(key)) return;
            seen.add(key);
            const r = this._makeRangeResult(s, e);
            r.label = label;
            results.push(r);
        };

        // Alt 1: Swap (balik urutan, paling natural)
        addResult(endResult, startResult, 'tukar urutan');

        // Alt 2: End pushed to next year (setelah awal)
        const startYear = startDate.year;
        const endNextYear = this._reparseForYear(endStr, startYear + 1);
        if (endNextYear && endNextYear.date) {
            addResult(startResult, endNextYear, 'akhir di tahun berikutnya');
        }

        // Alt 3: Start pushed to previous year (sebelum akhir)
        const endYear = endDate.year;
        const startPrevYear = this._reparseForYear(startStr, endYear - 1);
        if (startPrevYear && startPrevYear.date) {
            addResult(startPrevYear, endResult, 'awal di tahun sebelumnya');
        }

        return {
            type: 'range-ambiguous',
            results,
            original: input
        };
    }

    /**
     * Try to parse as single date using rule cascade
     */
    _trySingle(input) {
        for (const rule of this._singleRules) {
            const result = rule(input);
            if (result) return result;
        }
        return null;
    }

    _collectAllSingles(input) {
        const results = [];
        const LABELS = { range: 'periode', weekday: 'hari', anchor: 'acuan', boundary: 'batas', holiday: 'hari libur', absolute: 'tanggal' };
        for (const rule of this._singleRules) {
            const result = rule(input);
            if (result) {
                result.label = LABELS[result.kind] || result.kind;
                results.push(result);
            }
        }
        return results;
    }

    _tryArithmeticAroundHoliday(input) {
        const explicitMatch = input.match(this._arithmeticExplicit);

        if (explicitMatch) {
            const amount = parseInt(explicitMatch[1]);
            const unit = this.units[explicitMatch[2]];
            const direction = explicitMatch[3];
            const holidayName = explicitMatch[4].trim();

            const holiday = this._resolveHoliday(holidayName);
            if (!holiday) return null;

            const multiplier = (direction === 'sebelum') ? -1 : 1;
            const resultDate = this._add(holiday, { [unit + 's']: amount * multiplier });

            return this._buildSingleResult(resultDate, 'holiday-offset', input);
        }

        const defaultMatch = input.match(this._arithmeticDefault);

        if (defaultMatch) {
            const direction = defaultMatch[1];
            const holidayName = defaultMatch[2].trim();

            const holiday = this._resolveHoliday(holidayName);
            if (!holiday) return null;

            const multiplier = (direction === 'sebelum') ? -1 : 1;
            const resultDate = this._add(holiday, { days: 1 * multiplier });

            return this._buildSingleResult(resultDate, 'holiday-offset', input);
        }

        return null;
    }

    _tryAnchor(input) {
        for (const [phrase, days] of Object.entries(this.anchors)) {
            if (input === phrase || input === `tanggal ${phrase}`) {
                const date = this._add(this.referenceDate, { days });
                return this._buildSingleResult(date, 'anchor', input);
            }
        }
        if (input.endsWith(' dari sekarang')) {
            const stripped = input.slice(0, -' dari sekarang'.length);
            const result = this._tryAnchor(stripped);
            if (result) {
                result.original = input;
                return result;
            }
        }
        return null;
    }

    _tryRelative(input, patterns, sign, kind) {
        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match) {
                let amount, unit;
                if (this.seUnits[match[1]]) {
                    amount = 1;
                    unit = this.units[this.seUnits[match[1]]];
                } else {
                    amount = parseInt(match[1]);
                    unit = this.units[match[2]];
                }
                const date = this._add(this.referenceDate, { [unit + 's']: sign * amount });
                return this._buildSingleResult(date, kind, input);
            }
        }
        return null;
    }

    _tryRelativeFuture(input) {
        return this._tryRelative(input, this._relativeFuturePatterns, 1, 'relative-future');
    }

    _tryRelativePast(input) {
        return this._tryRelative(input, this._relativePastPatterns, -1, 'relative-past');
    }

    _tryWeekday(input) {
        let match = input.match(this._weekdayHariPattern) || input.match(this._weekdayPlainPattern);
        if (!match) return null;

        const dayName = match[1];
        const modifier = match[2] || '';
        const targetDay = this.weekdayNames[dayName];

        if (targetDay === undefined) return null;

        let resultDate;
        const ref = this.referenceDate;
        const currentDay = this._getDayOfWeek(ref);

        if (modifier.includes('minggu depan')) {
            const daysUntilNextWeek = (7 - currentDay) + 7;
            const daysUntilTarget = daysUntilNextWeek + ((targetDay - 0 + 7) % 7);
            resultDate = this._add(ref, { days: daysUntilTarget });
        } else if (modifier.includes('minggu lalu')) {
            const daysUntilLastWeek = -currentDay - 7;
            const daysUntilTarget = daysUntilLastWeek + targetDay;
            resultDate = this._add(ref, { days: daysUntilTarget });
        } else if (modifier === 'depan') {
            let daysDiff = targetDay - currentDay;
            if (daysDiff <= 0) daysDiff += 7;
            resultDate = this._add(ref, { days: daysDiff });
        } else if (modifier === 'lalu') {
            let daysDiff = targetDay - currentDay;
            if (daysDiff >= 0) daysDiff -= 7;
            resultDate = this._add(ref, { days: daysDiff });
        } else if (modifier === 'ini') {
            let daysDiff = targetDay - currentDay;
            resultDate = this._add(ref, { days: daysDiff });
        } else {
            let daysDiff = targetDay - currentDay;
            if (daysDiff < 0) daysDiff += 7;
            resultDate = this._add(ref, { days: daysDiff });
        }

        return this._buildSingleResult(resultDate, 'weekday', input);
    }

    _tryPeriod(input) {
        for (const { pattern, unit } of this._periodPatterns) {
            const match = input.match(pattern);
            if (match) {
                const modifier = match[1];
                let startDate, endDate;
                const ref = this.referenceDate;

                if (unit === 'week') {
                    const weekStart = this._getWeekStart(ref);
                    if (modifier === 'ini') {
                        startDate = weekStart;
                        endDate = this._add(weekStart, { days: 6 });
                    } else if (modifier === 'depan') {
                        startDate = this._add(weekStart, { days: 7 });
                        endDate = this._add(startDate, { days: 6 });
                    } else {
                        startDate = this._add(weekStart, { days: -7 });
                        endDate = this._add(startDate, { days: 6 });
                    }
                } else if (unit === 'month') {
                    if (modifier === 'ini') {
                        startDate = new Temporal.PlainDate(ref.year, ref.month, 1);
                        endDate = new Temporal.PlainDate(ref.year, ref.month, 1).add({ months: 1 }).subtract({ days: 1 });
                    } else if (modifier === 'depan') {
                        startDate = new Temporal.PlainDate(ref.year, ref.month + 1, 1);
                        endDate = new Temporal.PlainDate(ref.year, ref.month + 1, 1).add({ months: 1 }).subtract({ days: 1 });
                    } else {
                        startDate = new Temporal.PlainDate(ref.year, ref.month - 1, 1);
                        endDate = new Temporal.PlainDate(ref.year, ref.month - 1, 1).add({ months: 1 }).subtract({ days: 1 });
                    }
                } else if (unit === 'year') {
                    if (modifier === 'ini') {
                        startDate = new Temporal.PlainDate(ref.year, 1, 1);
                        endDate = new Temporal.PlainDate(ref.year, 12, 31);
                    } else if (modifier === 'depan') {
                        startDate = new Temporal.PlainDate(ref.year + 1, 1, 1);
                        endDate = new Temporal.PlainDate(ref.year + 1, 12, 31);
                    } else {
                        startDate = new Temporal.PlainDate(ref.year - 1, 1, 1);
                        endDate = new Temporal.PlainDate(ref.year - 1, 12, 31);
                    }
                }

                return this._buildRangeResult(startDate, endDate, `period-${unit}`, input);
            }
        }

        // "tahun <year>" — specific year
        const yearMatch = input.match(this._yearPattern);
        if (yearMatch) {
            const y = parseInt(yearMatch[1]);
            const startDate = new Temporal.PlainDate(y, 1, 1);
            const endDate = new Temporal.PlainDate(y, 12, 31);
            return this._buildRangeResult(startDate, endDate, 'period-year', input);
        }

        if (input === 'akhir pekan' || input === 'akhir minggu') {
            const ref = this.referenceDate;
            const currentDay = this._getDayOfWeek(ref);
            let saturday;
            if (currentDay === 0) {
                saturday = this._add(ref, { days: 6 });
            } else {
                saturday = this._add(ref, { days: 6 - currentDay });
            }
            const sunday = this._add(saturday, { days: 1 });

            return this._buildRangeResult(saturday, sunday, 'weekend', input);
        }

        return null;
    }

    _tryBoundary(input) {
        const boundaries = {
            'awal bulan': () => {
                const d = this.referenceDate;
                return new Temporal.PlainDate(d.year, d.month, 1);
            },
            'akhir bulan': () => {
                const d = this.referenceDate;
                return new Temporal.PlainDate(d.year, d.month, 1).add({ months: 1 }).subtract({ days: 1 });
            },
            'awal minggu': () => this._getWeekStart(this.referenceDate),
            'akhir minggu': () => {
                const start = this._getWeekStart(this.referenceDate);
                return this._add(start, { days: 6 });
            },
            'awal tahun': () => {
                const d = this.referenceDate;
                return new Temporal.PlainDate(d.year, 1, 1);
            },
            'akhir tahun': () => {
                const d = this.referenceDate;
                return new Temporal.PlainDate(d.year, 12, 31);
            }
        };

        const resolver = boundaries[input];
        if (resolver) {
            const date = resolver();
            return this._buildSingleResult(date, 'boundary', input);
        }

        const modMatch = input.match(this._boundaryModPattern);
        if (modMatch) {
            const edge = modMatch[1];       // awal or akhir
            const unitName = modMatch[2];   // bulan, minggu, tahun, pekan
            const modifier = modMatch[3];   // ini, depan, lalu
            const ref = this.referenceDate;
            let date;

            if (unitName === 'bulan') {
                let targetMonth = ref.month;
                let targetYear = ref.year;
                if (modifier === 'depan') { targetMonth++; }
                else if (modifier === 'lalu') { targetMonth--; }
                if (targetMonth < 1) { targetMonth = 12; targetYear--; }
                if (targetMonth > 12) { targetMonth = 1; targetYear++; }
                date = edge === 'awal'
                    ? new Temporal.PlainDate(targetYear, targetMonth, 1)
                    : new Temporal.PlainDate(targetYear, targetMonth, 1).add({ months: 1 }).subtract({ days: 1 });
            } else if (unitName === 'tahun') {
                let targetYear = ref.year;
                if (modifier === 'depan') targetYear++;
                else if (modifier === 'lalu') targetYear--;
                date = edge === 'awal'
                    ? new Temporal.PlainDate(targetYear, 1, 1)
                    : new Temporal.PlainDate(targetYear, 12, 31);
            } else {
                // minggu / pekan
                const weekStart = this._getWeekStart(ref);
                let baseStart;
                if (modifier === 'ini') baseStart = weekStart;
                else if (modifier === 'depan') baseStart = this._add(weekStart, { days: 7 });
                else baseStart = this._add(weekStart, { days: -7 });
                date = edge === 'awal' ? baseStart : this._add(baseStart, { days: 6 });
            }

            return this._buildSingleResult(date, 'boundary', input);
        }

        return null;
    }

    _tryHoliday(input) {
        // Try matching the full input as-is
        let holiday = this._resolveHoliday(input);
        if (holiday) {
            return this._buildSingleResult(holiday, 'holiday', input);
        }

        // Try pattern: "<holiday name> <4-digit year>"
        const yearMatch = input.match(this._holidayYearPattern);
        if (yearMatch) {
            const holidayName = yearMatch[1].trim();
            const year = parseInt(yearMatch[2]);
            holiday = this._resolveHoliday(holidayName, year);
            if (holiday) {
                return this._buildSingleResult(holiday, 'holiday', input);
            }
        }

        return null;
    }

    _resolveHoliday(name, year) {
        const normalized = name.toLowerCase().trim();
        const holidayData = this.holidayDates[normalized];

        if (!holidayData) return null;

        if (holidayData.aliasOf) {
            return this._resolveHoliday(holidayData.aliasOf, year);
        }

        if (year === undefined) {
            year = this.referenceDate.year;
        }

        if (holidayData.fixed) {
            return new Temporal.PlainDate(year, holidayData.fixed.month, holidayData.fixed.day);
        }

        // Use trusted lookup data if available for this year
        if (holidayData.lookup && holidayData.lookup[year]) {
            const entry = holidayData.lookup[year];
            return new Temporal.PlainDate(year, entry.month, entry.day);
        }

        // Compute dynamically for Islamic holidays using Hijri calendar
        if (holidayData.islamic) {
            return this._computeIslamicHoliday(holidayData.islamic, year);
        }

        // Fallback: extrapolate from nearest known year (for non-Islamic lookup holidays)
        if (holidayData.lookup) {
            const nearestYear = Object.keys(holidayData.lookup)
                .map(Number)
                .sort((a, b) => Math.abs(a - year) - Math.abs(b - year))[0];
            const nearest = holidayData.lookup[nearestYear];
            const yearDiff = year - nearestYear;
            let approxDate = new Temporal.PlainDate(year, nearest.month, nearest.day);
            approxDate = approxDate.add({ days: -(yearDiff * 11) });
            if (approxDate.year !== year) {
                approxDate = new Temporal.PlainDate(year, approxDate.month, approxDate.day);
            }
            return approxDate;
        }

        return null;
    }

    /**
     * Compute Islamic holiday date for a given Gregorian year
     * Uses Umm al-Qura / Kuwaiti algorithm
     */
    _computeIslamicHoliday(islamicDef, gregorianYear) {
        const approxHijri = Math.round((gregorianYear - 622) * 33 / 32);

        for (let h = approxHijri - 1; h <= approxHijri + 1; h++) {
            const date = this._hijriToGregorian(h, islamicDef.month, islamicDef.day);
            if (date.year === gregorianYear) {
                return date;
            }
        }

        return this._hijriToGregorian(approxHijri, islamicDef.month, islamicDef.day);
    }

    /**
     * Convert Hijri date to Gregorian Date
     * Umm al-Qura / Kuwaiti algorithm
     */
    _hijriToGregorian(hijriYear, hijriMonth, hijriDay) {
        const jd = Math.floor((11 * hijriYear + 3) / 30)
            + 354 * hijriYear
            + 30 * hijriMonth
            - Math.floor((hijriMonth - 1) / 2)
            + hijriDay
            + 1948440
            - 385;
        return this._jdToGregorian(jd);
    }

    /**
     * Convert Julian Day Number to Gregorian Date
     */
    _jdToGregorian(jd) {
        const l = jd + 68569;
        const n = Math.floor((4 * l) / 146097);
        const t = l - Math.floor((146097 * n + 3) / 4);
        const i = Math.floor((4000 * (t + 1)) / 1461001);
        const l2 = t - Math.floor((1461 * i) / 4) + 31;
        const j = Math.floor((80 * l2) / 2447);
        const d = l2 - Math.floor((2447 * j) / 80);
        const kk = Math.floor(j / 11);
        const m = j + 2 - 12 * kk;
        const y = 100 * (n - 49) + i + kk;
        return new Temporal.PlainDate(y, m, d);
    }

    /**
     * Pre-cache Islamic holiday dates from Aladhan API for a range of years.
     * Run once at page load for fast synchronous parsing afterwards.
     * @param {number[]} [years] - Array of Gregorian years to cache (default: current ± 5)
     */
    async init(years) {
        const currentYear = this.referenceDate.year;
        if (!years || years.length === 0) {
            years = [];
            for (let y = currentYear - 5; y <= currentYear + 10; y++) {
                years.push(y);
            }
        }

        const promises = [];
        for (const year of years) {
            for (const name of Object.keys(this.holidayDates)) {
                const data = this.holidayDates[name];
                if (data.islamic) {
                    promises.push(this._fetchIslamicHolidayViaApi(name, data.islamic, year));
                }
            }
        }
        return Promise.all(promises);
    }

    /**
     * Fetch a single Islamic holiday for a Gregorian year from the Aladhan API.
     * Stores the result in the lookup table on success.
     * On API failure, falls back to local computation.
     */
    async _fetchIslamicHolidayViaApi(name, islamicDef, gregorianYear) {
        const cacheKey = `${islamicDef.month}-${islamicDef.day}-${gregorianYear}`;
        if (this._islamicCache[cacheKey]) return;

        const approxHijri = Math.round((gregorianYear - 622) * 33 / 32);
        const candidates = [approxHijri, approxHijri - 1, approxHijri + 1];

        this._islamicCache[cacheKey] = 'pending';

        for (const h of candidates) {
            const pad = (n) => String(n).padStart(2, '0');
            const hDate = `${pad(islamicDef.day)}-${pad(islamicDef.month)}-${h}`;
            try {
                const res = await fetch(`${this._apiBaseUrl}/${hDate}`);
                if (!res.ok) continue;
                const json = await res.json();
                if (json.code !== 200) continue;
                const g = json.data.gregorian;
                if (parseInt(g.year) !== gregorianYear) continue;

                const date = new Temporal.PlainDate(parseInt(g.year), parseInt(g.month.number), parseInt(g.day));
                // Store in lookup for sync parse
                if (!this.holidayDates[name].lookup) {
                    this.holidayDates[name].lookup = {};
                }
                this.holidayDates[name].lookup[gregorianYear] = {
                    month: parseInt(g.month.number),
                    day: parseInt(g.day)
                };
                this._islamicCache[cacheKey] = date;
                return;
            } catch (e) {
                continue;
            }
        }

        // API failed, fall back to local computation
        const fallback = this._computeIslamicHoliday(islamicDef, gregorianYear);
        if (fallback) {
            if (!this.holidayDates[name].lookup) {
                this.holidayDates[name].lookup = {};
            }
            this.holidayDates[name].lookup[gregorianYear] = {
                month: fallback.month,
                day: fallback.day
            };
            this._islamicCache[cacheKey] = fallback;
        }
    }

    _tryDateFormat(input) {
        const cleanInput = input.replace(/^tanggal\s+/, '').trim();

        const patterns = [
            {
                regex: /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/,
                parser: (m) => {
                    const day = parseInt(m[1]);
                    const month = this._parseMonth(m[2]);
                    const year = m[3] ? parseInt(m[3]) : this.referenceDate.year;
                    if (month === -1 || day < 1 || day > 31) return null;
                    return new Temporal.PlainDate(year, month + 1, day);
                }
            },
            {
                regex: /^([a-z]+)\s+(\d{4})$/,
                parser: (m) => {
                    const month = this._parseMonth(m[1]);
                    const year = parseInt(m[2]);
                    if (month === -1) return null;
                    return new Temporal.PlainDate(year, month + 1, 1);
                }
            },
            {
                regex: /^([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?$/,
                parser: (m) => {
                    const month = this._parseMonth(m[1]);
                    const day = parseInt(m[2]);
                    const year = m[3] ? parseInt(m[3]) : this.referenceDate.year;
                    if (month === -1 || day < 1 || day > 31) return null;
                    return new Temporal.PlainDate(year, month + 1, day);
                }
            },
            {
                regex: /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/,
                parser: (m) => {
                    const day = parseInt(m[1]);
                    const month = parseInt(m[2]);
                    let year = parseInt(m[3]);
                    if (year < 100) year += year < 50 ? 2000 : 1900;
                    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
                    return new Temporal.PlainDate(year, month, day);
                }
            },
            {
                regex: /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/,
                parser: (m) => {
                    const year = parseInt(m[1]);
                    const month = parseInt(m[2]);
                    const day = parseInt(m[3]);
                    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
                    return new Temporal.PlainDate(year, month, day);
                }
            },
            {
                regex: /^([a-z]+)$/,
                parser: (m) => {
                    const month = this._parseMonth(m[1]);
                    const year = this.referenceDate.year;
                    if (month === -1) return null;
                    return new Temporal.PlainDate(year, month + 1, 1);
                }
            },
            {
                regex: /^(\d{1,2})[\/\-.](\d{1,2})$/,
                parser: (m) => {
                    const day = parseInt(m[1]);
                    const month = parseInt(m[2]);
                    const year = this.referenceDate.year;
                    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
                    return new Temporal.PlainDate(year, month, day);
                }
            }
        ];

        for (const { regex, parser } of patterns) {
            const match = cleanInput.match(regex);
            if (match) {
                try {
                    const date = parser(match);
                    if (date) {
                        return this._buildSingleResult(date, 'absolute', input);
                    }
                } catch (e) {
                    // invalid date, try next pattern
                }
            }
        }
        return null;
    }

    _parseMonth(name) {
        const normalized = name.toLowerCase().trim();

        const fullIdx = this.monthNames.indexOf(normalized);
        if (fullIdx !== -1) return fullIdx;

        const shortIdx = this.monthShortNames.indexOf(normalized);
        if (shortIdx !== -1) return shortIdx;

        const corrections = {
            'jan': 0, 'januari': 0,
            'feb': 1, 'februari': 1, 'pebruari': 1,
            'mar': 2, 'maret': 2,
            'apr': 3, 'april': 3,
            'mei': 4, 'may': 4,
            'jun': 5, 'juni': 5,
            'jul': 6, 'juli': 6,
            'agu': 7, 'agustus': 7, 'ags': 7, 'augustus': 7,
            'sep': 8, 'sept': 8, 'september': 8,
            'okt': 9, 'oktober': 9,
            'nov': 10, 'november': 10,
            'des': 11, 'desember': 11, 'december': 11
        };

        return corrections[normalized] !== undefined ? corrections[normalized] : -1;
    }

    _getWeekStart(date) {
        const d = date;
        const day = this._getDayOfWeek(d);
        const diff = this.weekStart === 'monday'
            ? (day === 0 ? -6 : 1) - day
            : -day;
        return d.add({ days: diff });
    }

    _add(date, duration) {
        return date.add(duration);
    }

    _formatDate(date) {
        return date.toString();
    }

    formatDisplay(date) {
        const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
        return d.toLocaleDateString(this.locale, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            timeZone: 'UTC'
        });
    }

}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = IndonesianDateParser;
}
if (typeof window !== 'undefined') {
    window.IndonesianDateParser = IndonesianDateParser;
}
