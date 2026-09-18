/**
 * ============================================================
 * DASHBOARD MONITORING KDA (Kecamatan Dalam Angka) 2026
 * ============================================================
 * Cara pasang:
 * 1. Buka spreadsheet "Monitoring KDA 2025 - 1800" -> Extensions > Apps Script
 * 2. Hapus isi Code.gs default, paste isi file ini.
 * 3. Buat file HTML baru bernama "Index" (File > New > HTML), paste isi Index.html.
 * 4. Kembali ke Spreadsheet, refresh. Akan muncul menu "Dashboard KDA".
 * 5. Klik menu "Dashboard KDA" > "1. Setup Sheet Tahun 2026" (sekali saja).
 * 6. Klik menu "Dashboard KDA" > "2. Buat/Perbarui Sheet Password". Ini membuat
 *    sheet baru bernama "Password" berisi daftar kode admin + semua kab/kota.
 *    Isi kolom Password di sheet tsb secara manual untuk tiap baris (kode
 *    yang kolom Password-nya masih kosong belum bisa dipakai login).
 * 7. Deploy > New deployment > Web app > Execute as: Me, Who has access: sesuai kebutuhan.
 * 8. Buka URL web app yang muncul.
 * ============================================================
 */

// ============ KONFIGURASI ============
var CONFIG = {
  YEAR: 2026,
  SOURCE_YEAR: 2025,
  SUFFIX: '_2026',                 // nama sheet 2026 = <kode>_2026
  KODE_SHEET_REGEX: /^\d{4}$/,     // sheet sumber 2025 dikenali dari nama 4 digit, mis. "1800"
  FIRST_DATA_ROW: 5,               // baris pertama data kecamatan
  COL_NO: 1,                       // A
  COL_PUBLIKASI: 2,                // B
  COL_ASPEK_START: 3,              // C
  COL_ASPEK_END: 12,               // L
  COL_PROGRES: 13,                 // M
  CHECK_MARK: '✓',                 // nilai yang disimpan di cell saat aspek dicentang
  NOTE_PREFIX: 'Diupdate: ',       // prefix catatan tanggal pada cell
  DATE_ASPECTS: ['ARC'],           // aspek yang diisi dengan TANGGAL manual, bukan checkbox
  ADMIN_CODE: 'admin-1800',        // kode login untuk provinsi (akses ke SEMUA kab/kota)
  // Password login TIDAK disimpan di kode ini, melainkan di sheet berikut, supaya
  // admin bisa mengisi/mengganti password sendiri langsung dari Google Sheets.
  PASSWORD_SHEET_NAME: 'Password', // nama sheet berisi daftar kode + password
  PASSWORD_FIRST_ROW: 2,           // baris 1 = header (Kode | Nama Wilayah | Password)
  SESSION_TTL_SECONDS: 21600,      // masa berlaku sesi login (6 jam, maksimum CacheService)
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

var BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// ============ AUTENTIKASI ============
/**
 * Login membutuhkan DUA hal:
 * 1. code     -> CONFIG.ADMIN_CODE (mis. "admin-1800") -> role 'admin', akses SEMUA kab/kota (provinsi).
 *                atau 4 digit kode kab/kota yang sheet-nya ada (mis. "1801" utk Lampung Barat) -> role 'kabkota'.
 * 2. password -> dicocokkan dengan kolom Password di sheet CONFIG.PASSWORD_SHEET_NAME (baris
 *                yang kolom Kode-nya sama dengan code di atas). Password TIDAK disimpan di
 *                Code.gs — admin mengisinya langsung di sheet tsb (lihat setupPasswordSheet()).
 *                Ini lapisan keamanan tambahan supaya orang tidak bisa asal login hanya dengan
 *                menebak kode wilayah 4 digit (kode wilayah biasanya sudah dikenal publik).
 * Token sesi disimpan di CacheService (server), BUKAN dipercaya dari client, supaya
 * kab/kota tidak bisa mengaku-aku sebagai admin atau kab/kota lain dari console browser.
 */
function login(code, password) {
  code = String(code || '').trim();
  password = String(password || '');

  if (!code) return { ok: false, message: 'Kode tidak boleh kosong.' };
  if (!password) return { ok: false, message: 'Password tidak boleh kosong.' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var auth = null;
  var authKode = null; // kunci lowercase yang dipakai untuk mencari password di sheet Password

  if (code.toLowerCase() === CONFIG.ADMIN_CODE.toLowerCase()) {
    auth = { role: 'admin', kode: null, nama: 'Admin Provinsi' };
    authKode = CONFIG.ADMIN_CODE.toLowerCase();
  } else {
    var sheets = getKabSheets2026_(ss);
    var match = sheets.filter(function (sh) {
      return sh.getName().replace(CONFIG.SUFFIX, '') === code;
    })[0];
    if (match) {
      var namaKab = String(match.getRange(2, 1).getValue() || match.getName());
      auth = { role: 'kabkota', kode: code, nama: namaKab };
      authKode = code.toLowerCase();
    } else if (sheets.length === 0) {
      return {
        ok: false,
        message: 'Belum ada sheet tahun ' + CONFIG.YEAR + '. Jalankan menu Dashboard KDA > 1. Setup Sheet Tahun ' + CONFIG.YEAR + ' di Google Sheets terlebih dahulu.'
      };
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

/**
 * Membaca sheet Password dan mengembalikan peta { kode_lowercase: password }.
 * Jika sheet belum ada atau masih kosong, mengembalikan objek kosong (semua login
 * password akan ditolak dengan pesan "belum diisi").
 */
function getPasswordMap_(ss) {
  var sheet = ss.getSheetByName(CONFIG.PASSWORD_SHEET_NAME);
  var map = {};
  if (!sheet) return map;

  var lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.PASSWORD_FIRST_ROW) return map;

  var numRows = lastRow - CONFIG.PASSWORD_FIRST_ROW + 1;
  var values = sheet.getRange(CONFIG.PASSWORD_FIRST_ROW, 1, numRows, 3).getValues();
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
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Lempar error kalau token tidak berhak mengedit sheet tsb (dipakai sebelum toggle/isi tanggal)
function requireEditAccess_(token, sheetName) {
  var auth = getAuth_(token);
  if (!auth) {
    throw new Error('Sesi login sudah berakhir atau Anda belum login. Silakan login ulang.');
  }
  if (auth.role === 'admin') return auth;

  var kodeSheet = sheetName.replace(CONFIG.SUFFIX, '');
  if (auth.role === 'kabkota' && auth.kode === kodeSheet) return auth;

  throw new Error('Anda tidak memiliki akses untuk mengedit data wilayah ini.');
}

// ============ MENU ============
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Dashboard KDA')
    .addItem('1. Setup Sheet Tahun 2026', 'setupTahun2026')
    .addItem('2. Buat/Perbarui Sheet Password', 'setupPasswordSheet')
    .addItem('3. Cara Buka Dashboard (Deploy)', 'tampilkanPanduanDeploy')
    .addToUi();
}

function tampilkanPanduanDeploy() {
  SpreadsheetApp.getUi().alert(
    'Klik Deploy > New deployment > pilih tipe "Web app" > Execute as: Me > ' +
    'Who has access: sesuaikan (mis. Anyone within organization) > Deploy. ' +
    'Salin URL yang muncul, itulah link dashboard Anda. ' +
    'Pastikan sheet "' + CONFIG.PASSWORD_SHEET_NAME + '" sudah diisi passwordnya ' +
    '(menu "2. Buat/Perbarui Sheet Password") sebelum link dibagikan ke kab/kota.'
  );
}

/**
 * Membuat sheet "Password" (jika belum ada) berisi header Kode | Nama Wilayah | Password,
 * lalu menambahkan baris untuk kode admin + setiap kab/kota yang sheet-nya terdeteksi
 * (baik sheet sumber 4 digit maupun sheet _2026), TANPA menimpa baris/password yang
 * sudah ada. Aman dijalankan berulang kali. Kolom Password sengaja dikosongkan —
 * admin mengisinya sendiri langsung di sheet ini.
 */
function setupPasswordSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.PASSWORD_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.PASSWORD_SHEET_NAME);
  }

  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 3).setValues([['Kode', 'Nama Wilayah', 'Password']]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 3, 170);
  }

  // Daftar kode yang seharusnya ada: admin + semua kab/kota (dari sheet sumber ATAU sheet _2026)
  var expected = [{ kode: CONFIG.ADMIN_CODE, nama: 'Admin Provinsi' }];
  var seen = {};
  seen[CONFIG.ADMIN_CODE.toLowerCase()] = true;

  getKodeKabSheets_(ss).concat(getKabSheets2026_(ss)).forEach(function (sh) {
    var kode = sh.getName().replace(CONFIG.SUFFIX, '');
    if (!CONFIG.KODE_SHEET_REGEX.test(kode)) return;
    var key = kode.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    var nama = String(sh.getRange(2, 1).getValue() || kode);
    expected.push({ kode: kode, nama: nama });
  });

  // Kode yang sudah punya baris di sheet Password (supaya tidak dobel & password lama tidak tertimpa)
  var existingKode = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= CONFIG.PASSWORD_FIRST_ROW) {
    var numRows = lastRow - CONFIG.PASSWORD_FIRST_ROW + 1;
    sheet.getRange(CONFIG.PASSWORD_FIRST_ROW, 1, numRows, 1).getValues().forEach(function (r) {
      var k = String(r[0] || '').trim().toLowerCase();
      if (k) existingKode[k] = true;
    });
  }

  var rowsToAdd = expected.filter(function (e) { return !existingKode[e.kode.toLowerCase()]; });

  if (rowsToAdd.length) {
    var startRow = Math.max(sheet.getLastRow() + 1, CONFIG.PASSWORD_FIRST_ROW);
    var values = rowsToAdd.map(function (e) { return [e.kode, e.nama, '']; });
    sheet.getRange(startRow, 1, values.length, 3).setValues(values);
  }

  SpreadsheetApp.getUi().alert(
    rowsToAdd.length
      ? 'Sheet "' + CONFIG.PASSWORD_SHEET_NAME + '" siap, ' + rowsToAdd.length + ' baris kode baru ditambahkan.\n\n' +
        'Silakan buka sheet tsb dan isi kolom Password untuk tiap baris, lalu simpan.'
      : 'Sheet "' + CONFIG.PASSWORD_SHEET_NAME + '" sudah lengkap, tidak ada kode baru yang perlu ditambahkan.'
  );
}

// ============ SETUP SHEET 2026 ============
/**
 * Menduplikasi semua sheet kab/kota 2025 (nama 4 digit, mis "1800","1801", dst)
 * menjadi sheet baru <kode>_2026, dengan:
 * - Teks "2025" di kolom B diganti "2026"
 * - Kolom aspek (C:L) dan Progres (M) dikosongkan (nilai + catatan) / diberi formula progres baru
 * Aman dijalankan berulang: sheet 2026 yang sudah ada akan di-skip (tidak menimpa data).
 */
function setupTahun2026() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheets = getKodeKabSheets_(ss);

  if (sourceSheets.length === 0) {
    SpreadsheetApp.getUi().alert('Tidak ditemukan sheet sumber dengan nama 4 digit (contoh: "1800"). Setup dibatalkan.');
    return;
  }

  var dibuat = [];
  var dilewati = [];

  sourceSheets.forEach(function (sheet) {
    var targetName = sheet.getName() + CONFIG.SUFFIX;
    if (ss.getSheetByName(targetName)) {
      dilewati.push(targetName);
      return;
    }

    var newSheet = sheet.copyTo(ss);
    newSheet.setName(targetName);

    var lastRow = newSheet.getLastRow();
    if (lastRow >= CONFIG.FIRST_DATA_ROW) {
      var numRows = lastRow - CONFIG.FIRST_DATA_ROW + 1;

      // Ganti teks tahun di kolom Publikasi (B)
      var pubRange = newSheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_PUBLIKASI, numRows, 1);
      var pubValues = pubRange.getValues().map(function (r) {
        var text = String(r[0] || '');
        return [text.replace(String(CONFIG.SOURCE_YEAR), String(CONFIG.YEAR))];
      });
      pubRange.setValues(pubValues);

      // Kosongkan kolom aspek C:L (nilai maupun catatan/komentar bawaan dari sheet sumber)
      var aspekRange = newSheet.getRange(
        CONFIG.FIRST_DATA_ROW, CONFIG.COL_ASPEK_START,
        numRows, CONFIG.COL_ASPEK_END - CONFIG.COL_ASPEK_START + 1
      );
      aspekRange.clearContent();
      aspekRange.clearNote();

      // Pasang formula Progres di kolom M (referensi cepat langsung di sheet;
      // dashboard sendiri menghitung progres dari isi kolom aspek, bukan dari sini)
      for (var i = 0; i < numRows; i++) {
        var row = CONFIG.FIRST_DATA_ROW + i;
        var colC = columnToLetter_(CONFIG.COL_ASPEK_START);
        var colL = columnToLetter_(CONFIG.COL_ASPEK_END);
        var formula = '=IF(COUNTA(' + colC + row + ':' + colL + row + ')=0,0,' +
          'ROUND(COUNTA(' + colC + row + ':' + colL + row + ')/' + CONFIG.ASPECTS.length + '*100,2))';
        newSheet.getRange(row, CONFIG.COL_PROGRES).setFormula(formula);
      }

      // Update judul di baris 1 (kalau ada teks tahun)
      var titleCell = newSheet.getRange(1, 1);
      var titleVal = String(titleCell.getValue() || '');
      if (titleVal.indexOf(String(CONFIG.SOURCE_YEAR)) !== -1) {
        titleCell.setValue(titleVal.replace(String(CONFIG.SOURCE_YEAR), String(CONFIG.YEAR)));
      }
    }

    // Pindahkan sheet baru ke akhir supaya rapi
    ss.setActiveSheet(newSheet);
    ss.moveActiveSheet(ss.getNumSheets());
    dibuat.push(targetName);
  });

  var pesan = '';
  if (dibuat.length) pesan += 'Sheet dibuat: ' + dibuat.join(', ') + '.\n';
  if (dilewati.length) pesan += 'Sudah ada (dilewati): ' + dilewati.join(', ') + '.';
  SpreadsheetApp.getUi().alert(pesan || 'Tidak ada sheet baru yang dibuat.');
}

function getKodeKabSheets_(ss) {
  return ss.getSheets().filter(function (sh) {
    return CONFIG.KODE_SHEET_REGEX.test(sh.getName());
  });
}

function getKabSheets2026_(ss) {
  return ss.getSheets().filter(function (sh) {
    return sh.getName().indexOf(CONFIG.SUFFIX) !== -1;
  });
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

// ============ WEB APP ============
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dashboard Monitoring KDA ' + CONFIG.YEAR)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Mengambil data dashboard untuk tahun 2026, disaring sesuai hak akses token:
 * - Tanpa token / token tidak valid (publik): ringkasan provinsi saja
 *   (semua kab/kota terlihat, tapi hanya nama+progres kecamatan, TANPA rincian
 *   checklist aspek per kecamatan).
 * - Token role 'kabkota': hanya wilayahnya sendiri, lengkap dengan rincian checklist.
 * - Token role 'admin': semua kab/kota, lengkap dengan rincian checklist.
 * Jika sheet 2026 belum ada, kembalikan flag needsSetup = true.
 */
function getDashboardData(token) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = getKabSheets2026_(ss);
  var auth = getAuth_(token);
  var role = auth ? auth.role : 'public';

  if (sheets.length === 0) {
    return { needsSetup: true, kabupaten: [], aspects: CONFIG.ASPECTS, year: CONFIG.YEAR, role: role };
  }

  if (role === 'admin') {
    var kabupatenList = sheets.map(function (sheet) { return readKabSheet_(sheet); });
    kabupatenList.sort(function (a, b) { return Number(a.kode) - Number(b.kode); });
    return { needsSetup: false, kabupaten: kabupatenList, aspects: CONFIG.ASPECTS, year: CONFIG.YEAR, role: 'admin', nama: auth.nama };
  }

  if (role === 'kabkota') {
    var ownSheet = sheets.filter(function (sh) {
      return sh.getName().replace(CONFIG.SUFFIX, '') === auth.kode;
    })[0];
    var kabupatenOwn = ownSheet ? [readKabSheet_(ownSheet)] : [];
    return {
      needsSetup: false,
      kabupaten: kabupatenOwn,
      aspects: CONFIG.ASPECTS,
      year: CONFIG.YEAR,
      role: 'kabkota',
      kode: auth.kode,
      nama: auth.nama
    };
  }

  // Publik (belum login): ringkasan saja, tanpa rincian checklist per aspek
  var kabupatenPublik = sheets.map(function (sheet) {
    var full = readKabSheet_(sheet);
    return {
      kode: full.kode,
      sheetName: full.sheetName,
      nama: full.nama,
      totalKecamatan: full.totalKecamatan,
      selesai: full.selesai,
      belumMulai: full.belumMulai,
      proses: full.proses,
      rataRata: full.rataRata,
      kecamatan: full.kecamatan.map(function (k) {
        return { row: k.row, nama: k.nama, progres: k.progres };
      })
    };
  });
  kabupatenPublik.sort(function (a, b) { return Number(a.kode) - Number(b.kode); });

  return { needsSetup: false, kabupaten: kabupatenPublik, aspects: CONFIG.ASPECTS, year: CONFIG.YEAR, role: 'public' };
}

/**
 * Membaca satu sheet kab/kota dan menghitung progres LANGSUNG dari isi kolom
 * aspek (bukan dari formula di kolom Progres/M). Ini membuat progres selalu
 * akurat begitu sebuah aspek dicentang/dibatalkan, tanpa tergantung apakah
 * formula di kolom M sudah sempat dipasang/ter-refresh atau belum.
 * Juga mengembalikan field "riwayat": daftar aktivitas (aspek apa, di kecamatan
 * mana, tanggal & jam berapa) yang dipakai oleh fitur Riwayat Aktivitas di
 * dashboard, diurutkan dari yang paling baru.
 */
function readKabSheet_(sheet) {
  var kode = sheet.getName().replace(CONFIG.SUFFIX, '');
  var namaKab = String(sheet.getRange(2, 1).getValue() || sheet.getName());
  var lastRow = sheet.getLastRow();
  var kecamatanList = [];
  var riwayatList = [];

  if (lastRow >= CONFIG.FIRST_DATA_ROW) {
    var numRows = lastRow - CONFIG.FIRST_DATA_ROW + 1;
    var numAspek = CONFIG.COL_ASPEK_END - CONFIG.COL_ASPEK_START + 1;

    var pubRange = sheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_PUBLIKASI, numRows, 1);
    var pubValues = pubRange.getValues();

    var aspekRange = sheet.getRange(CONFIG.FIRST_DATA_ROW, CONFIG.COL_ASPEK_START, numRows, numAspek);
    var aspekValues = aspekRange.getValues();
    var aspekNotes = aspekRange.getNotes();

    for (var idx = 0; idx < numRows; idx++) {
      var publikasi = String(pubValues[idx][0] || '').trim();
      if (!publikasi) continue; // lewati baris kosong

      var row = CONFIG.FIRST_DATA_ROW + idx;
      var namaKecamatan = publikasi
        .replace(' Dalam Angka ' + CONFIG.YEAR, '')
        .replace(' Dalam Angka ' + CONFIG.SOURCE_YEAR, '');

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
            var parsedCatatan = note ? parseCatatanTanggalJam_(display) : null;
            if (parsedCatatan) {
              rawDate = parsedCatatan.tanggal;
              jam = parsedCatatan.jam;
              tanggalDisplay = parsedCatatan.tanggalDisplay;
            }
          }

          // Catat ke riwayat aktivitas kalau tanggal pengerjaannya berhasil diketahui
          // (dari nilai tanggal aspek ARC, atau dari catatan otomatis saat checkbox dicentang).
          if (rawDate) {
            riwayatList.push({
              tanggal: rawDate,
              tanggalDisplay: tanggalDisplay,
              jam: jam,
              kecamatan: namaKecamatan,
              kecamatanRow: row,
              aspek: CONFIG.ASPECTS[a]
            });
          }
        } else {
          missing.push(CONFIG.ASPECTS[a]);
        }

        aspekList.push({
          label: CONFIG.ASPECTS[a],
          filled: filled,
          value: display,
          isDate: isDateAspect,
          rawDate: rawDate
        });
      }

      var progres = Math.round((filledCount / CONFIG.ASPECTS.length) * 10000) / 100;

      kecamatanList.push({
        row: row,
        namaLengkap: publikasi,
        nama: namaKecamatan,
        aspek: aspekList,
        missing: missing,
        progres: progres
      });
    }
  }

  var totalProgres = kecamatanList.reduce(function (s, k) { return s + k.progres; }, 0);
  var rataRata = kecamatanList.length ? Math.round((totalProgres / kecamatanList.length) * 100) / 100 : 0;
  var selesai = kecamatanList.filter(function (k) { return k.progres >= 100; }).length;
  var belumMulai = kecamatanList.filter(function (k) { return k.progres <= 0; }).length;

  // Urutkan riwayat dari yang paling baru
  riwayatList.sort(function (a, b) {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
    return (b.jam || '').localeCompare(a.jam || '');
  });

  return {
    kode: kode,
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

/**
 * Mem-parsing kembali teks catatan tanggal+jam yang otomatis disimpan di NOTE_PREFIX
 * saat sebuah aspek dicentang (format: "15 September 2026, 14:30") menjadi
 * { tanggal: 'yyyy-MM-dd', jam: 'HH:mm', tanggalDisplay: '15 September 2026' }.
 * Dipakai untuk membangun Riwayat Aktivitas (fitur "apa dikerjakan di tanggal berapa").
 * Mengembalikan null kalau formatnya tidak dikenali (mis. catatan lama/manual yang
 * tidak mengikuti format ini) — aspek tsb tetap tercentang seperti biasa, hanya saja
 * tidak akan muncul di daftar Riwayat Aktivitas.
 */
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

// Ubah string 'yyyy-MM-dd' (dari <input type="date">) menjadi Date, dijangkarkan
// jam 12:00 siang pada timezone spreadsheet supaya TIDAK meleset H-1/H+1 akibat
// perbedaan timezone default project Apps Script vs timezone spreadsheet.
function parseTanggalInput_(dateStr) {
  var tz = Session.getScriptTimeZone();
  return Utilities.parseDate(dateStr + ' 12:00:00', tz, 'yyyy-MM-dd HH:mm:ss');
}

// Aspek yang diisi dengan TANGGAL manual (mis. "ARC"), bukan checkbox
function isDateAspect_(aspectIndex) {
  return CONFIG.DATE_ASPECTS.indexOf(CONFIG.ASPECTS[aspectIndex]) !== -1;
}

/**
 * Toggle satu aspek untuk satu kecamatan di satu sheet kab/kota.
 * checked = true  -> isi cell dengan tanda centang, tanggal/jam disimpan sebagai
 *                     CATATAN (note) pada cell tsb (bukan sebagai nilai cell).
 * checked = false -> kosongkan nilai dan catatan pada cell tsb.
 */
function toggleAspek(token, sheetName, row, aspectIndex, checked) {
  requireEditAccess_(token, sheetName);

  if (isDateAspect_(aspectIndex)) {
    throw new Error('Aspek "' + CONFIG.ASPECTS[aspectIndex] + '" diisi dengan tanggal, bukan checkbox.');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);

  var col = CONFIG.COL_ASPEK_START + aspectIndex;
  var cell = sheet.getRange(row, col);

  if (checked) {
    cell.setValue(CONFIG.CHECK_MARK);
    cell.setNote(CONFIG.NOTE_PREFIX + formatTanggalWaktuID_(new Date()));
  } else {
    cell.clearContent();
    cell.clearNote();
  }

  SpreadsheetApp.flush();

  // Kembalikan data kab/kota ini yang sudah diperbarui (progres dihitung ulang di sini)
  return readKabSheet_(sheet);
}

/**
 * Mengisi/mengosongkan aspek bertipe TANGGAL (mis. "ARC") untuk satu kecamatan.
 * dateStr berformat 'yyyy-MM-dd' (bawaan <input type="date">), atau string kosong
 * untuk mengosongkan kembali sel tsb.
 */
function setAspekTanggal(token, sheetName, row, aspectIndex, dateStr) {
  requireEditAccess_(token, sheetName);

  if (!isDateAspect_(aspectIndex)) {
    throw new Error('Aspek "' + CONFIG.ASPECTS[aspectIndex] + '" bukan aspek bertipe tanggal.');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);

  var col = CONFIG.COL_ASPEK_START + aspectIndex;
  var cell = sheet.getRange(row, col);

  if (dateStr) {
    var d = parseTanggalInput_(String(dateStr));
    cell.setValue(d);
    cell.clearNote(); // tanggalnya sudah tersimpan sebagai nilai cell, tidak perlu catatan
  } else {
    cell.clearContent();
    cell.clearNote();
  }

  SpreadsheetApp.flush();

  return readKabSheet_(sheet);
}