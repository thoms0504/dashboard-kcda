/**
 * ============================================================
 * DASHBOARD MONITORING KDA (Kecamatan Dalam Angka) — MULTI TAHUN
 * ============================================================
 * Cara pasang:
 * 1. Buka spreadsheet "Monitoring KDA 2025 - 1800" -> Extensions > Apps Script
 * 2. Hapus isi Code.gs lama, paste isi file ini.
 * 3. Ganti isi file HTML "Index" dengan Index.html yang baru.
 * 4. Kembali ke Spreadsheet, refresh. Akan muncul menu "Dashboard KDA".
 * 5. (Hanya jika sheet <kode>_2026 BELUM ada) Klik "1. Setup Sheet Tahun Awal".
 *    Kalau sheet _2026 sudah ada dari versi sebelumnya, langkah ini tidak perlu.
 * 6. Klik "2. Buat/Perbarui Sheet Password", lalu isi kolom Password.
 * 7. Deploy > Manage deployments > Edit (ikon pensil) > Version: New version > Deploy
 *    (atau New deployment kalau belum pernah deploy).
 *
 * FITUR BARU
 * - Multi tahun: tahun dikenali otomatis dari nama sheet <kode>_<tahun>
 *   (mis. 1801_2026, 1801_2027). Hanya TAHUN TERBARU yang bisa diedit;
 *   tahun sebelumnya otomatis menjadi arsip (hanya bisa dilihat).
 * - Tambah Tahun (admin provinsi): menyalin semua sheet tahun terbaru menjadi
 *   sheet tahun berikutnya dengan checklist kosong. Bisa dari dashboard
 *   (menu Kelola Data) atau dari menu spreadsheet "3. Tambah Tahun Baru".
 * - Tambah Kecamatan (admin provinsi & kab/kota utk wilayahnya sendiri):
 *   menambah baris kecamatan di sheet tahun terbaru. Karena tahun baru disalin
 *   dari tahun terbaru, kecamatan baru otomatis ikut ke tahun-tahun berikutnya.
 * - Diskusi/Komentar per kecamatan (boleh merujuk ke aspek tertentu atau ke
 *   kecamatan secara umum) antara admin provinsi dan kab/kota terkait.
 *   Disimpan di sheet "Komentar" (dibuat otomatis). Ada penanda belum dibaca
 *   dan status Terbuka/Selesai.
 * ============================================================
 */

// ============ KONFIGURASI ============
var CONFIG = {
  FIRST_YEAR: 2026,                // tahun pertama yang dibuat dari sheet sumber 4 digit
  SOURCE_YEAR: 2025,               // tahun data pada sheet sumber 4 digit (mis. "1800")
  KODE_SHEET_REGEX: /^\d{4}$/,     // sheet sumber lama dikenali dari nama 4 digit
  YEAR_SHEET_REGEX: /^(\d{4})_(\d{4})$/, // sheet tahunan: <kode>_<tahun>
  FIRST_DATA_ROW: 5,               // baris pertama data kecamatan
  COL_NO: 1,                       // A
  COL_PUBLIKASI: 2,                // B
  COL_ASPEK_START: 3,              // C
  COL_ASPEK_END: 12,               // L
  COL_PROGRES: 13,                 // M
  CHECK_MARK: '✓',
  NOTE_PREFIX: 'Diupdate: ',
  DATE_ASPECTS: ['ARC'],
  ADMIN_CODE: 'admin-1800',
  PASSWORD_SHEET_NAME: 'Password',
  PASSWORD_FIRST_ROW: 2,
  SESSION_TTL_SECONDS: 21600,
  KOMENTAR_SHEET_NAME: 'Komentar',
  KOMENTAR_MAX_LEN: 1000,
  KECAMATAN_MAX_LEN: 60,
  ASPECTS: [
    'ARC',
    'Tabulasi Data',
    'Entri Data Tabel',
    'Pendahuluan',
    'Penjelasan Teknis',
    'Ulasan',
    'Cover',
    'Infografis',
    'Pdf Publikasi',
    'Unggah Website'
  ]
};

// Kolom sheet "Komentar" (index 0-based)
var KOMENTAR_HEADERS = [
  'ID', 'Waktu', 'Tahun', 'Kode Kab', 'Nama Kab', 'Kecamatan', 'Aspek',
  'Pengirim (Role)', 'Nama Pengirim', 'Isi Komentar', 'Status',
  'Dibaca Admin', 'Dibaca Kab/Kota', 'Diselesaikan Oleh', 'Waktu Selesai'
];
var KI = {
  ID: 0, WAKTU: 1, TAHUN: 2, KODE: 3, NAMA_KAB: 4, KEC: 5, ASPEK: 6,
  ROLE: 7, NAMA: 8, ISI: 9, STATUS: 10, BACA_ADMIN: 11, BACA_KAB: 12,
  SELESAI_OLEH: 13, WAKTU_SELESAI: 14
};

var BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// ============ UTIL NAMA SHEET & TAHUN ============
function parseSheetName_(name) {
  var m = CONFIG.YEAR_SHEET_REGEX.exec(String(name));
  return m ? { kode: m[1], year: Number(m[2]) } : null;
}

function sheetNameFor_(kode, year) {
  return String(kode) + '_' + String(year);
}

/** Semua sheet tahunan (<kode>_<tahun>); kalau year diisi, hanya tahun tsb. */
function getYearSheets_(ss, year) {
  var filterYear = (year === undefined || year === null) ? null : Number(year);
  return ss.getSheets().filter(function (sh) {
    var p = parseSheetName_(sh.getName());
    return !!p && (filterYear === null || p.year === filterYear);
  });
}

/** Daftar tahun yang tersedia, urut naik. */
function getYears_(ss) {
  var set = {};
  getYearSheets_(ss).forEach(function (sh) {
    set[parseSheetName_(sh.getName()).year] = true;
  });
  return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
}

function getLatestYear_(ss) {
  var years = getYears_(ss);
  return years.length ? years[years.length - 1] : null;
}

/** Sheet sumber lama (nama 4 digit, mis. "1800"). */
function getKodeKabSheets_(ss) {
  return ss.getSheets().filter(function (sh) {
    return CONFIG.KODE_SHEET_REGEX.test(sh.getName());
  });
}

/** "Kecamatan Balik Bukit Dalam Angka 2026" -> "Kecamatan Balik Bukit" */
function extractNamaKecamatan_(publikasi) {
  var s = String(publikasi || '').trim();
  var nama = s.replace(/\s*Dalam\s+Angka\s*\d{4}\s*$/i, '').trim();
  return nama || s;
}

/** Cegah teks input pengguna dianggap formula oleh Sheets. */
function safeText_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@']/.test(s) ? "'" + s : s;
}

function normalizeNamaKec_(s) {
  return String(s || '').toLowerCase().replace(/^kecamatan\s+/, '').replace(/\s+/g, ' ').trim();
}

function columnToLetter_(col) {
  var letter = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

function progresFormula_(row) {
  var colC = columnToLetter_(CONFIG.COL_ASPEK_START);
  var colL = columnToLetter_(CONFIG.COL_ASPEK_END);
  var rng = colC + row + ':' + colL + row;
  return '=IF(COUNTA(' + rng + ')=0,0,ROUND(COUNTA(' + rng + ')/' + CONFIG.ASPECTS.length + '*100,2))';
}

/** Baris terakhir yang kolom Publikasi (B)-nya terisi. */
function findLastDataRow_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) return CONFIG.FIRST_DATA_ROW - 1;
  var vals = sheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_PUBLIKASI, lastRow - CONFIG.FIRST_DATA_ROW + 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0] || '').trim()) return CONFIG.FIRST_DATA_ROW + i;
  }
  return CONFIG.FIRST_DATA_ROW - 1;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Server sedang memproses permintaan lain. Silakan coba lagi sebentar.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ============ AUTENTIKASI ============
/**
 * Login membutuhkan kode + password.
 * - code = CONFIG.ADMIN_CODE -> role 'admin' (akses semua kab/kota).
 * - code = 4 digit kode kab/kota yang sheet tahunannya ada -> role 'kabkota'.
 * Password dicocokkan dengan sheet "Password".
 */
function login(code, password) {
  code = String(code || '').trim();
  password = String(password || '');

  if (!code) return { ok: false, message: 'Kode tidak boleh kosong.' };
  if (!password) return { ok: false, message: 'Password tidak boleh kosong.' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var auth = null;
  var authKode = null;

  if (code.toLowerCase() === CONFIG.ADMIN_CODE.toLowerCase()) {
    auth = { role: 'admin', kode: null, nama: 'Admin Provinsi' };
    authKode = CONFIG.ADMIN_CODE.toLowerCase();
  } else {
    var sheets = getYearSheets_(ss);
    if (!sheets.length) {
      return {
        ok: false,
        message: 'Belum ada sheet data tahunan. Jalankan menu Dashboard KDA > 1. Setup Sheet Tahun Awal di Google Sheets terlebih dahulu.'
      };
    }
    var latest = getLatestYear_(ss);
    var match = null;
    sheets.forEach(function (sh) {
      var p = parseSheetName_(sh.getName());
      if (p.kode !== code) return;
      if (!match || p.year === latest) match = sh;
    });
    if (match) {
      var namaKab = String(match.getRange(2, 1).getValue() || match.getName());
      auth = { role: 'kabkota', kode: code, nama: namaKab };
      authKode = code.toLowerCase();
    }
  }

  if (!auth) {
    return { ok: false, message: 'Kode akses "' + code + '" tidak dikenali. Periksa kembali kode kab/kota atau kode admin.' };
  }

  var expectedPassword = getPasswordMap_(ss)[authKode];
  if (!expectedPassword) {
    return {
      ok: false,
      message: 'Password untuk kode "' + code + '" belum diisi di sheet "' + CONFIG.PASSWORD_SHEET_NAME + '". Hubungi admin provinsi.'
    };
  }
  if (password !== expectedPassword) {
    return { ok: false, message: 'Password salah.' };
  }

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('kdaauth_' + token, JSON.stringify(auth), CONFIG.SESSION_TTL_SECONDS);

  return { ok: true, token: token, role: auth.role, kode: auth.kode, nama: auth.nama };
}

function getPasswordMap_(ss) {
  var sheet = ss.getSheetByName(CONFIG.PASSWORD_SHEET_NAME);
  var map = {};
  if (!sheet) return map;
  var lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.PASSWORD_FIRST_ROW) return map;
  var values = sheet.getRange(CONFIG.PASSWORD_FIRST_ROW, 1, lastRow - CONFIG.PASSWORD_FIRST_ROW + 1, 3).getValues();
  values.forEach(function (r) {
    var kode = String(r[0] || '').trim();
    var pass = String(r[2] || '');
    if (kode) map[kode.toLowerCase()] = pass;
  });
  return map;
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('kdaauth_' + token);
  return { ok: true };
}

function getAuth_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('kdaauth_' + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function requireAuth_(token) {
  var auth = getAuth_(token);
  if (!auth) throw new Error('Sesi login sudah berakhir atau Anda belum login. Silakan login ulang.');
  return auth;
}

function requireAdmin_(token) {
  var auth = requireAuth_(token);
  if (auth.role !== 'admin') throw new Error('Hanya admin provinsi yang dapat melakukan aksi ini.');
  return auth;
}

/** Admin boleh semua kab/kota; kab/kota hanya wilayahnya sendiri. */
function requireKabAccess_(token, kode) {
  var auth = requireAuth_(token);
  if (auth.role === 'admin') return auth;
  if (auth.role === 'kabkota' && auth.kode === String(kode)) return auth;
  throw new Error('Anda tidak memiliki akses ke data wilayah ini.');
}

/** Hanya tahun terbaru yang boleh diubah; tahun sebelumnya = arsip. */
function requireEditableYear_(ss, year) {
  var latest = getLatestYear_(ss);
  if (Number(year) !== latest) {
    throw new Error('Data tahun ' + year + ' adalah arsip dan hanya bisa dilihat. Perubahan hanya dapat dilakukan pada tahun ' + latest + '.');
  }
  return latest;
}

function requireEditAccess_(token, sheetName) {
  var p = parseSheetName_(sheetName);
  if (!p) throw new Error('Sheet tidak dikenali: ' + sheetName);
  var auth = requireKabAccess_(token, p.kode);
  requireEditableYear_(SpreadsheetApp.getActiveSpreadsheet(), p.year);
  return auth;
}

// ============ MENU SPREADSHEET ============
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Dashboard KDA')
    .addItem('1. Setup Sheet Tahun Awal (' + CONFIG.FIRST_YEAR + ')', 'setupTahunAwal')
    .addItem('2. Buat/Perbarui Sheet Password', 'setupPasswordSheet')
    .addItem('3. Tambah Tahun Baru', 'tambahTahunDariMenu')
    .addItem('4. Cara Buka Dashboard (Deploy)', 'tampilkanPanduanDeploy')
    .addToUi();
}

function tampilkanPanduanDeploy() {
  SpreadsheetApp.getUi().alert(
    'Klik Deploy > New deployment > pilih tipe "Web app" > Execute as: Me > ' +
    'Who has access: sesuaikan (mis. Anyone within organization) > Deploy. ' +
    'Salin URL yang muncul, itulah link dashboard Anda.\n\n' +
    'Setelah mengubah kode, gunakan Deploy > Manage deployments > Edit > Version: New version ' +
    'supaya link lama tetap dipakai.\n\n' +
    'Pastikan sheet "' + CONFIG.PASSWORD_SHEET_NAME + '" sudah diisi passwordnya sebelum link dibagikan.'
  );
}

/**
 * Membuat/memperbarui sheet "Password": header + baris untuk admin dan setiap
 * kab/kota yang terdeteksi. Tidak menimpa password yang sudah ada.
 */
function setupPasswordSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.PASSWORD_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.PASSWORD_SHEET_NAME);

  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 3).setValues([['Kode', 'Nama Wilayah', 'Password']]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 3, 170);
  }

  var expected = [{ kode: CONFIG.ADMIN_CODE, nama: 'Admin Provinsi' }];
  var seen = {};
  seen[CONFIG.ADMIN_CODE.toLowerCase()] = true;

  function addKode(kode, sh) {
    if (!CONFIG.KODE_SHEET_REGEX.test(kode)) return;
    var key = kode.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    expected.push({ kode: kode, nama: String(sh.getRange(2, 1).getValue() || kode) });
  }

  getYearSheets_(ss).forEach(function (sh) { addKode(parseSheetName_(sh.getName()).kode, sh); });
  getKodeKabSheets_(ss).forEach(function (sh) { addKode(sh.getName(), sh); });

  var existingKode = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= CONFIG.PASSWORD_FIRST_ROW) {
    sheet.getRange(CONFIG.PASSWORD_FIRST_ROW, 1, lastRow - CONFIG.PASSWORD_FIRST_ROW + 1, 1).getValues().forEach(function (r) {
      var k = String(r[0] || '').trim().toLowerCase();
      if (k) existingKode[k] = true;
    });
  }

  var rowsToAdd = expected.filter(function (e) { return !existingKode[e.kode.toLowerCase()]; });
  if (rowsToAdd.length) {
    var startRow = Math.max(sheet.getLastRow() + 1, CONFIG.PASSWORD_FIRST_ROW);
    sheet.getRange(startRow, 1, rowsToAdd.length, 3).setValues(rowsToAdd.map(function (e) { return [e.kode, e.nama, '']; }));
  }

  SpreadsheetApp.getUi().alert(
    rowsToAdd.length
      ? 'Sheet "' + CONFIG.PASSWORD_SHEET_NAME + '" siap, ' + rowsToAdd.length + ' baris kode baru ditambahkan.\n\nSilakan isi kolom Password untuk tiap baris.'
      : 'Sheet "' + CONFIG.PASSWORD_SHEET_NAME + '" sudah lengkap, tidak ada kode baru yang perlu ditambahkan.'
  );
}

// ============ PERSIAPAN SHEET TAHUN BARU ============
/**
 * Menyiapkan sheet hasil salinan untuk tahun baru:
 * - teks tahun lama di kolom Publikasi (B) & baris judul diganti tahun baru
 * - kolom aspek C:L dikosongkan (nilai + catatan)
 * - formula Progres (M) dipasang ulang
 */
function prepareSheetForYear_(sheet, fromYear, toYear) {
  var from = String(fromYear);
  var to = String(toYear);
  var lastRow = sheet.getLastRow();

  if (lastRow >= CONFIG.FIRST_DATA_ROW) {
    var numRows = lastRow - CONFIG.FIRST_DATA_ROW + 1;

    var pubRange = sheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_PUBLIKASI, numRows, 1);
    pubRange.setValues(pubRange.getValues().map(function (r) {
      return [String(r[0] || '').split(from).join(to)];
    }));

    var aspekRange = sheet.getRange(
      CONFIG.FIRST_DATA_ROW, CONFIG.COL_ASPEK_START,
      numRows, CONFIG.COL_ASPEK_END - CONFIG.COL_ASPEK_START + 1
    );
    aspekRange.clearContent();
    aspekRange.clearNote();

    var lastDataRow = findLastDataRow_(sheet);
    if (lastDataRow >= CONFIG.FIRST_DATA_ROW) {
      var formulas = [];
      for (var row = CONFIG.FIRST_DATA_ROW; row <= lastDataRow; row++) formulas.push([progresFormula_(row)]);
      sheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_PROGRES, formulas.length, 1).setFormulas(formulas);
    }
  }

  // Baris judul/header (di atas baris data)
  var hdrRows = CONFIG.FIRST_DATA_ROW - 1;
  var lastCol = sheet.getLastColumn();
  if (hdrRows > 0 && lastCol > 0) {
    var hr = sheet.getRange(1, 1, hdrRows, lastCol);
    var hv = hr.getValues();
    var hf = hr.getFormulas();
    for (var r = 0; r < hdrRows; r++) {
      for (var c = 0; c < lastCol; c++) {
        if (!hf[r][c] && typeof hv[r][c] === 'string' && hv[r][c].indexOf(from) !== -1) {
          sheet.getRange(r + 1, c + 1).setValue(hv[r][c].split(from).join(to));
        }
      }
    }
  }
}

/**
 * Setup awal: membuat sheet <kode>_<FIRST_YEAR> dari sheet sumber 4 digit.
 * Aman dijalankan ulang (sheet yang sudah ada dilewati).
 */
function setupTahunAwal() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheets = getKodeKabSheets_(ss);

  if (sourceSheets.length === 0) {
    SpreadsheetApp.getUi().alert('Tidak ditemukan sheet sumber dengan nama 4 digit (contoh: "1800"). Setup dibatalkan.');
    return;
  }

  var dibuat = [];
  var dilewati = [];
  sourceSheets.forEach(function (sheet) {
    var targetName = sheetNameFor_(sheet.getName(), CONFIG.FIRST_YEAR);
    if (ss.getSheetByName(targetName)) { dilewati.push(targetName); return; }
    var newSheet = sheet.copyTo(ss);
    newSheet.setName(targetName);
    prepareSheetForYear_(newSheet, CONFIG.SOURCE_YEAR, CONFIG.FIRST_YEAR);
    dibuat.push(targetName);
  });

  var pesan = '';
  if (dibuat.length) pesan += 'Sheet dibuat: ' + dibuat.join(', ') + '.\n';
  if (dilewati.length) pesan += 'Sudah ada (dilewati): ' + dilewati.join(', ') + '.';
  SpreadsheetApp.getUi().alert(pesan || 'Tidak ada sheet baru yang dibuat.');
}

// Nama lama, dipertahankan supaya tombol/trigger lama tetap jalan
function setupTahun2026() { setupTahunAwal(); }

// ============ TAMBAH TAHUN ============
function tambahTahunCore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return withLock_(function () {
    var latest = getLatestYear_(ss);
    if (!latest) throw new Error('Belum ada data tahun apa pun. Jalankan "1. Setup Sheet Tahun Awal" terlebih dahulu.');
    var newYear = latest + 1;

    var src = getYearSheets_(ss, latest).sort(function (a, b) {
      return Number(parseSheetName_(a.getName()).kode) - Number(parseSheetName_(b.getName()).kode);
    });

    var dibuat = [];
    src.forEach(function (sheet) {
      var p = parseSheetName_(sheet.getName());
      var target = sheetNameFor_(p.kode, newYear);
      if (ss.getSheetByName(target)) return;
      var ns = sheet.copyTo(ss);
      ns.setName(target);
      prepareSheetForYear_(ns, latest, newYear);
      dibuat.push(target);
    });
    SpreadsheetApp.flush();
    return { ok: true, fromYear: latest, year: newYear, dibuat: dibuat };
  });
}

/** Dipanggil dari dashboard (admin provinsi saja). */
function tambahTahun(token) {
  requireAdmin_(token);
  return tambahTahunCore_();
}

/** Dipanggil dari menu spreadsheet. */
function tambahTahunDariMenu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var latest = getLatestYear_(ss);
  if (!latest) {
    ui.alert('Belum ada data tahun apa pun. Jalankan "1. Setup Sheet Tahun Awal" terlebih dahulu.');
    return;
  }
  var resp = ui.alert(
    'Tambah Tahun ' + (latest + 1),
    'Semua sheet tahun ' + latest + ' akan disalin menjadi sheet tahun ' + (latest + 1) + ' dengan checklist kosong.\n' +
    'Setelah itu data tahun ' + latest + ' menjadi arsip (hanya bisa dilihat di dashboard).\n\nLanjutkan?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  var res = tambahTahunCore_();
  ui.alert('Tahun ' + res.year + ' berhasil dibuat. Sheet baru: ' + (res.dibuat.join(', ') || '-'));
}

// ============ TAMBAH KECAMATAN ============
/**
 * Menambah kecamatan baru di sheet kab/kota pada tahun TERBARU.
 * Boleh dilakukan admin provinsi atau kab/kota untuk wilayahnya sendiri.
 */
function tambahKecamatan(token, kode, nama) {
  kode = String(kode || '').trim();
  var auth = requireKabAccess_(token, kode);

  nama = String(nama || '').replace(/\s+/g, ' ').trim();
  if (!nama) throw new Error('Nama kecamatan tidak boleh kosong.');
  if (nama.length > CONFIG.KECAMATAN_MAX_LEN) throw new Error('Nama kecamatan maksimal ' + CONFIG.KECAMATAN_MAX_LEN + ' karakter.');
  if (!/^[A-Za-z0-9 .,'()\/\-]+$/.test(nama)) {
    throw new Error('Nama kecamatan hanya boleh berisi huruf, angka, spasi, dan tanda baca . , \' ( ) / -');
  }
  if (/dalam\s+angka/i.test(nama)) {
    throw new Error('Cukup tulis nama kecamatannya saja, tanpa "Dalam Angka <tahun>".');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var latest = getLatestYear_(ss);
  var sheet = ss.getSheetByName(sheetNameFor_(kode, latest));
  if (!sheet) throw new Error('Sheet ' + sheetNameFor_(kode, latest) + ' tidak ditemukan.');

  return withLock_(function () {
    var existing = readKabSheet_(sheet).kecamatan;
    var lastDataRow = findLastDataRow_(sheet);

    // Ikuti format penamaan baris sebelumnya (mis. diawali "Kecamatan ")
    var pakaiPrefix = existing.length > 0 && /^kecamatan\s/i.test(existing[existing.length - 1].nama);
    var namaFinal = (pakaiPrefix && !/^kecamatan\s/i.test(nama)) ? 'Kecamatan ' + nama : nama;

    var dup = existing.some(function (k) { return normalizeNamaKec_(k.nama) === normalizeNamaKec_(namaFinal); });
    if (dup) throw new Error('Kecamatan "' + namaFinal + '" sudah ada di ' + String(sheet.getRange(2, 1).getValue()) + '.');

    var lastCol = Math.max(sheet.getLastColumn(), CONFIG.COL_PROGRES);
    var newRow;
    var no = existing.length + 1;
    if (lastDataRow < CONFIG.FIRST_DATA_ROW) {
      newRow = CONFIG.FIRST_DATA_ROW;
    } else {
      sheet.insertRowAfter(lastDataRow);
      newRow = lastDataRow + 1;
      sheet.getRange(lastDataRow, 1, 1, lastCol)
        .copyTo(sheet.getRange(newRow, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      var prevNo = sheet.getRange(lastDataRow, CONFIG.COL_NO).getValue();
      if (typeof prevNo === 'number') no = prevNo + 1;
    }

    sheet.getRange(newRow, CONFIG.COL_NO).setValue(no);
    sheet.getRange(newRow, CONFIG.COL_PUBLIKASI).setValue(safeText_(namaFinal + ' Dalam Angka ' + latest));
    var aspekRange = sheet.getRange(newRow, CONFIG.COL_ASPEK_START, 1, CONFIG.COL_ASPEK_END - CONFIG.COL_ASPEK_START + 1);
    aspekRange.clearContent();
    aspekRange.clearNote();
    sheet.getRange(newRow, CONFIG.COL_PROGRES).setFormula(progresFormula_(newRow));
    SpreadsheetApp.flush();

    return { ok: true, kab: readKabSheet_(sheet), row: newRow, nama: namaFinal, oleh: auth.nama };
  });
}

// ============ WEB APP ============
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dashboard Monitoring KDA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Data dashboard untuk tahun tertentu (default: tahun terbaru), disaring sesuai
 * hak akses token:
 * - publik: ringkasan semua kab/kota tanpa rincian checklist, tanpa komentar
 * - kabkota: wilayah sendiri + komentar wilayah sendiri
 * - admin: semua kab/kota + semua komentar
 * editable = true hanya bila tahun yang dilihat adalah tahun terbaru & sudah login.
 */
function getDashboardData(token, year) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var auth = getAuth_(token);
  var role = auth ? auth.role : 'public';
  var years = getYears_(ss);

  if (!years.length) {
    return {
      needsSetup: true, kabupaten: [], aspects: CONFIG.ASPECTS, year: CONFIG.FIRST_YEAR,
      years: [], latestYear: null, editable: false, role: role, komentar: []
    };
  }

  var latest = years[years.length - 1];
  var y = Number(year);
  if (years.indexOf(y) === -1) y = latest;

  var sheets = getYearSheets_(ss, y);
  var base = {
    needsSetup: false,
    aspects: CONFIG.ASPECTS,
    year: y,
    years: years,
    latestYear: latest,
    editable: y === latest && role !== 'public',
    role: role,
    kode: auth ? auth.kode : null,
    nama: auth ? auth.nama : null,
    komentar: [],
    kabupaten: []
  };

  if (role === 'admin') {
    base.kabupaten = sheets.map(readKabSheet_).sort(function (a, b) { return Number(a.kode) - Number(b.kode); });
    base.komentar = getKomentarList_(ss, y, null);
    return base;
  }

  if (role === 'kabkota') {
    var own = sheets.filter(function (sh) { return parseSheetName_(sh.getName()).kode === auth.kode; })[0];
    base.kabupaten = own ? [readKabSheet_(own)] : [];
    base.komentar = getKomentarList_(ss, y, auth.kode);
    return base;
  }

  base.kabupaten = sheets.map(function (sheet) {
    var full = readKabSheet_(sheet);
    return {
      kode: full.kode,
      year: full.year,
      sheetName: full.sheetName,
      nama: full.nama,
      totalKecamatan: full.totalKecamatan,
      selesai: full.selesai,
      belumMulai: full.belumMulai,
      proses: full.proses,
      rataRata: full.rataRata,
      kecamatan: full.kecamatan.map(function (k) { return { row: k.row, nama: k.nama, progres: k.progres }; })
    };
  }).sort(function (a, b) { return Number(a.kode) - Number(b.kode); });
  return base;
}

/**
 * Membaca satu sheet kab/kota; progres dihitung langsung dari kolom aspek.
 * Juga mengembalikan "riwayat" aktivitas (terbaru di atas).
 */
function readKabSheet_(sheet) {
  var p = parseSheetName_(sheet.getName()) || { kode: sheet.getName(), year: null };
  var namaKab = String(sheet.getRange(2, 1).getValue() || sheet.getName());
  var lastRow = sheet.getLastRow();
  var kecamatanList = [];
  var riwayatList = [];

  if (lastRow >= CONFIG.FIRST_DATA_ROW) {
    var numRows = lastRow - CONFIG.FIRST_DATA_ROW + 1;
    var numAspek = CONFIG.COL_ASPEK_END - CONFIG.COL_ASPEK_START + 1;

    var pubValues = sheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_PUBLIKASI, numRows, 1).getValues();
    var aspekRange = sheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_ASPEK_START, numRows, numAspek);
    var aspekValues = aspekRange.getValues();
    var aspekNotes = aspekRange.getNotes();

    for (var idx = 0; idx < numRows; idx++) {
      var publikasi = String(pubValues[idx][0] || '').trim();
      if (!publikasi) continue;

      var row = CONFIG.FIRST_DATA_ROW + idx;
      var namaKecamatan = extractNamaKecamatan_(publikasi);
      var aspekList = [];
      var missing = [];
      var filledCount = 0;

      for (var a = 0; a < CONFIG.ASPECTS.length; a++) {
        var raw = aspekValues[idx][a];
        var filled = raw !== '' && raw !== null;
        var isDateAspect = isDateAspect_(a);
        var note = String(aspekNotes[idx][a] || '');
        var display = '';
        var rawDate = '';
        var jam = '';
        var tanggalDisplay = '';

        if (filled) {
          filledCount++;
          if (isDateAspect) {
            if (raw instanceof Date) {
              display = formatTanggalID_(raw);
              rawDate = Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
              tanggalDisplay = display;
            } else {
              display = String(raw);
            }
          } else {
            display = note ? note.replace(CONFIG.NOTE_PREFIX, '') : String(raw);
            var parsed = note ? parseCatatanTanggalJam_(display) : null;
            if (parsed) {
              rawDate = parsed.tanggal;
              jam = parsed.jam;
              tanggalDisplay = parsed.tanggalDisplay;
            }
          }
          if (rawDate) {
            riwayatList.push({
              tanggal: rawDate, tanggalDisplay: tanggalDisplay, jam: jam,
              kecamatan: namaKecamatan, kecamatanRow: row, aspek: CONFIG.ASPECTS[a]
            });
          }
        } else {
          missing.push(CONFIG.ASPECTS[a]);
        }

        aspekList.push({ label: CONFIG.ASPECTS[a], filled: filled, value: display, isDate: isDateAspect, rawDate: rawDate });
      }

      kecamatanList.push({
        row: row,
        namaLengkap: publikasi,
        nama: namaKecamatan,
        aspek: aspekList,
        missing: missing,
        progres: Math.round((filledCount / CONFIG.ASPECTS.length) * 10000) / 100
      });
    }
  }

  var totalProgres = kecamatanList.reduce(function (s, k) { return s + k.progres; }, 0);
  var rataRata = kecamatanList.length ? Math.round((totalProgres / kecamatanList.length) * 100) / 100 : 0;
  var selesai = kecamatanList.filter(function (k) { return k.progres >= 100; }).length;
  var belumMulai = kecamatanList.filter(function (k) { return k.progres <= 0; }).length;

  riwayatList.sort(function (a, b) {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
    return (b.jam || '').localeCompare(a.jam || '');
  });

  return {
    kode: p.kode,
    year: p.year,
    sheetName: sheet.getName(),
    nama: namaKab,
    kecamatan: kecamatanList,
    totalKecamatan: kecamatanList.length,
    selesai: selesai,
    belumMulai: belumMulai,
    proses: kecamatanList.length - selesai - belumMulai,
    rataRata: rataRata,
    riwayat: riwayatList
  };
}

function formatTanggalWaktuID_(date) {
  var tz = Session.getScriptTimeZone();
  var d = Number(Utilities.formatDate(date, tz, 'd'));
  var m = Number(Utilities.formatDate(date, tz, 'M'));
  var y = Utilities.formatDate(date, tz, 'yyyy');
  var jam = Utilities.formatDate(date, tz, 'HH:mm');
  return d + ' ' + BULAN_ID[m - 1] + ' ' + y + ', ' + jam;
}

function formatTanggalID_(date) {
  var tz = Session.getScriptTimeZone();
  var d = Number(Utilities.formatDate(date, tz, 'd'));
  var m = Number(Utilities.formatDate(date, tz, 'M'));
  var y = Utilities.formatDate(date, tz, 'yyyy');
  return d + ' ' + BULAN_ID[m - 1] + ' ' + y;
}

/** "15 September 2026, 14:30" -> { tanggal:'2026-09-15', jam:'14:30', tanggalDisplay:'15 September 2026' } */
function parseCatatanTanggalJam_(teks) {
  if (!teks) return null;
  var parts = String(teks).split(',');
  if (parts.length < 2) return null;
  var tanggalPart = parts[0].trim().split(' ');
  var jamPart = parts[1].trim();
  if (tanggalPart.length !== 3) return null;
  var tgl = parseInt(tanggalPart[0], 10);
  var bulanIdx = BULAN_ID.indexOf(tanggalPart[1]);
  var thn = parseInt(tanggalPart[2], 10);
  if (isNaN(tgl) || bulanIdx === -1 || isNaN(thn)) return null;
  var jamMatch = jamPart.match(/^(\d{1,2}):(\d{2})/);
  var jamStr = jamMatch ? (('0' + jamMatch[1]).slice(-2) + ':' + jamMatch[2]) : '';
  var tanggalStr = thn + '-' + ('0' + (bulanIdx + 1)).slice(-2) + '-' + ('0' + tgl).slice(-2);
  return { tanggal: tanggalStr, jam: jamStr, tanggalDisplay: tanggalPart.join(' ') };
}

function parseTanggalInput_(dateStr) {
  var tz = Session.getScriptTimeZone();
  return Utilities.parseDate(dateStr + ' 12:00:00', tz, 'yyyy-MM-dd HH:mm:ss');
}

function isDateAspect_(aspectIndex) {
  return CONFIG.DATE_ASPECTS.indexOf(CONFIG.ASPECTS[aspectIndex]) !== -1;
}

// ============ EDIT CHECKLIST ============
function toggleAspek(token, sheetName, row, aspectIndex, checked) {
  requireEditAccess_(token, sheetName);
  if (isDateAspect_(aspectIndex)) {
    throw new Error('Aspek "' + CONFIG.ASPECTS[aspectIndex] + '" diisi dengan tanggal, bukan checkbox.');
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);

  var cell = sheet.getRange(row, CONFIG.COL_ASPEK_START + aspectIndex);
  if (checked) {
    cell.setValue(CONFIG.CHECK_MARK);
    cell.setNote(CONFIG.NOTE_PREFIX + formatTanggalWaktuID_(new Date()));
  } else {
    cell.clearContent();
    cell.clearNote();
  }
  SpreadsheetApp.flush();
  return readKabSheet_(sheet);
}

function setAspekTanggal(token, sheetName, row, aspectIndex, dateStr) {
  requireEditAccess_(token, sheetName);
  if (!isDateAspect_(aspectIndex)) {
    throw new Error('Aspek "' + CONFIG.ASPECTS[aspectIndex] + '" bukan aspek bertipe tanggal.');
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);

  var cell = sheet.getRange(row, CONFIG.COL_ASPEK_START + aspectIndex);
  if (dateStr) {
    cell.setValue(parseTanggalInput_(String(dateStr)));
    cell.clearNote();
  } else {
    cell.clearContent();
    cell.clearNote();
  }
  SpreadsheetApp.flush();
  return readKabSheet_(sheet);
}

// ============ KOMENTAR / DISKUSI ============
function getKomentarSheet_(ss) {
  var sh = ss.getSheetByName(CONFIG.KOMENTAR_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.KOMENTAR_SHEET_NAME);
    sh.getRange(1, 1, 1, KOMENTAR_HEADERS.length).setValues([KOMENTAR_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(KI.ISI + 1, 360);
  }
  return sh;
}

function readKomentarValues_(ss) {
  var sh = ss.getSheetByName(CONFIG.KOMENTAR_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return { sheet: sh, values: [] };
  return { sheet: sh, values: sh.getRange(2, 1, sh.getLastRow() - 1, KOMENTAR_HEADERS.length).getValues() };
}

function komentarToClient_(r) {
  var waktu = r[KI.WAKTU] instanceof Date ? r[KI.WAKTU] : null;
  var waktuSelesai = r[KI.WAKTU_SELESAI] instanceof Date ? r[KI.WAKTU_SELESAI] : null;
  return {
    id: String(r[KI.ID]),
    waktuMs: waktu ? waktu.getTime() : 0,
    waktuDisplay: waktu ? formatTanggalWaktuID_(waktu) : '',
    tahun: Number(r[KI.TAHUN]),
    kode: String(r[KI.KODE]),
    namaKab: String(r[KI.NAMA_KAB] || ''),
    kecamatan: String(r[KI.KEC] || ''),
    aspek: String(r[KI.ASPEK] || ''),
    pengirimRole: String(r[KI.ROLE] || ''),
    pengirimNama: String(r[KI.NAMA] || ''),
    isi: String(r[KI.ISI] || ''),
    status: String(r[KI.STATUS] || 'Terbuka'),
    dibacaAdmin: r[KI.BACA_ADMIN] === true,
    dibacaKab: r[KI.BACA_KAB] === true,
    diselesaikanOleh: String(r[KI.SELESAI_OLEH] || ''),
    waktuSelesaiDisplay: waktuSelesai ? formatTanggalWaktuID_(waktuSelesai) : ''
  };
}

/** Komentar tahun tertentu; kode = null berarti semua kab/kota (admin). */
function getKomentarList_(ss, year, kode) {
  var data = readKomentarValues_(ss);
  return data.values
    .filter(function (r) {
      return String(r[KI.ID]) && Number(r[KI.TAHUN]) === Number(year) && (!kode || String(r[KI.KODE]) === String(kode));
    })
    .map(komentarToClient_)
    .sort(function (a, b) { return a.waktuMs - b.waktuMs; });
}

/**
 * Menambah komentar pada kecamatan tertentu. aspek boleh kosong (= komentar
 * umum untuk kecamatan) atau salah satu nama aspek.
 */
function tambahKomentar(token, year, kode, kecamatan, aspek, isi) {
  kode = String(kode || '');
  var auth = requireKabAccess_(token, kode);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  requireEditableYear_(ss, year);

  isi = String(isi || '').replace(/\r\n/g, '\n').trim();
  if (!isi) throw new Error('Isi komentar tidak boleh kosong.');
  if (isi.length > CONFIG.KOMENTAR_MAX_LEN) throw new Error('Komentar maksimal ' + CONFIG.KOMENTAR_MAX_LEN + ' karakter.');

  aspek = String(aspek || '');
  if (aspek && CONFIG.ASPECTS.indexOf(aspek) === -1) throw new Error('Aspek tidak dikenali: ' + aspek);

  var sheet = ss.getSheetByName(sheetNameFor_(kode, year));
  if (!sheet) throw new Error('Data kab/kota ' + kode + ' tahun ' + year + ' tidak ditemukan.');
  var kab = readKabSheet_(sheet);
  var kecOk = kab.kecamatan.some(function (k) { return k.nama === kecamatan; });
  if (!kecOk) throw new Error('Kecamatan "' + kecamatan + '" tidak ditemukan di ' + kab.nama + '.');

  withLock_(function () {
    getKomentarSheet_(ss).appendRow([
      Utilities.getUuid(), new Date(), Number(year), "'" + kode, safeText_(kab.nama), safeText_(kecamatan),
      aspek, auth.role, safeText_(auth.nama), safeText_(isi), 'Terbuka',
      auth.role === 'admin', auth.role === 'kabkota', '', ''
    ]);
    SpreadsheetApp.flush();
  });

  return getKomentarList_(ss, Number(year), auth.role === 'admin' ? null : auth.kode);
}

/** Menandai komentar Selesai (selesai = true) atau membukanya kembali. */
function setStatusKomentar(token, id, selesai) {
  var auth = requireAuth_(token);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var tahun = withLock_(function () {
    var data = readKomentarValues_(ss);
    var idx = -1;
    for (var i = 0; i < data.values.length; i++) {
      if (String(data.values[i][KI.ID]) === String(id)) { idx = i; break; }
    }
    if (idx === -1) throw new Error('Komentar tidak ditemukan (mungkin sudah dihapus dari sheet).');

    var r = data.values[idx];
    requireKabAccess_(token, String(r[KI.KODE]));
    requireEditableYear_(ss, r[KI.TAHUN]);

    var rowNum = idx + 2;
    data.sheet.getRange(rowNum, KI.STATUS + 1).setValue(selesai ? 'Selesai' : 'Terbuka');
    data.sheet.getRange(rowNum, KI.SELESAI_OLEH + 1, 1, 2).setValues([[selesai ? safeText_(auth.nama) : '', selesai ? new Date() : '']]);
    SpreadsheetApp.flush();
    return Number(r[KI.TAHUN]);
  });

  return getKomentarList_(ss, tahun, auth.role === 'admin' ? null : auth.kode);
}

/** Menandai semua komentar di satu kecamatan sudah dibaca oleh pihak yang login. */
function tandaiKomentarDibaca(token, year, kode, kecamatan) {
  var auth = requireKabAccess_(token, kode);
  var col = auth.role === 'admin' ? KI.BACA_ADMIN : KI.BACA_KAB;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  return withLock_(function () {
    var data = readKomentarValues_(ss);
    if (!data.values.length) return { ok: true, changed: 0 };
    var changed = 0;
    var colVals = data.values.map(function (r) {
      var match = Number(r[KI.TAHUN]) === Number(year) && String(r[KI.KODE]) === String(kode) && String(r[KI.KEC]) === String(kecamatan);
      if (match && r[col] !== true) { changed++; return [true]; }
      return [r[col] === true];
    });
    if (changed) data.sheet.getRange(2, col + 1, colVals.length, 1).setValues(colVals);
    return { ok: true, changed: changed };
  });
}
