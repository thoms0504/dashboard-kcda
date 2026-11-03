/**
 * ============================================================
 * NOTIFIKASI PESAN — tambahan untuk Dashboard KDA
 * ============================================================
 * Cara pasang:
 *   Apps Script > tombol (+) di samping "Files" > Script > beri nama "Notifikasi"
 *   lalu paste isi file ini. Code.gs TIDAK perlu diubah — semua file .gs
 *   dalam satu project berbagi fungsi & variabel (CONFIG, KI, dsb).
 *
 * Fungsi yang dipanggil dashboard:
 *   - getNotifikasi(token)              -> dipanggil berkala (±45 detik) oleh dashboard
 *   - tandaiSemuaKomentarDibaca(token)  -> tombol "Tandai dibaca" di panel lonceng
 * ============================================================
 */

/**
 * Mengembalikan daftar komentar TAHUN TERBARU yang boleh dilihat oleh pemilik
 * token (admin: semua; kab/kota: wilayahnya sendiri). Dashboard memakai data ini
 * untuk menghitung pesan belum dibaca dan memunculkan notifikasi pesan baru.
 */
function getNotifikasi(token) {
  var auth = getAuth_(token);
  if (!auth) return { ok: false, expired: true };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var latest = getLatestYear_(ss);
  if (!latest) return { ok: true, year: null, komentar: [], serverMs: new Date().getTime() };

  var komentar = getKomentarList_(ss, latest, auth.role === 'admin' ? null : auth.kode);
  return { ok: true, year: latest, komentar: komentar, serverMs: new Date().getTime() };
}

/** Menandai semua komentar tahun terbaru (dalam wilayah akses) sudah dibaca. */
function tandaiSemuaKomentarDibaca(token) {
  var auth = requireAuth_(token);
  var col = auth.role === 'admin' ? KI.BACA_ADMIN : KI.BACA_KAB;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var latest = getLatestYear_(ss);
  if (!latest) return { ok: true, changed: 0 };

  return withLock_(function () {
    var data = readKomentarValues_(ss);
    if (!data.values.length) return { ok: true, changed: 0 };
    var changed = 0;
    var colVals = data.values.map(function (r) {
      var match = Number(r[KI.TAHUN]) === latest &&
        (auth.role === 'admin' || String(r[KI.KODE]) === String(auth.kode));
      if (match && r[col] !== true) { changed++; return [true]; }
      return [r[col] === true];
    });
    if (changed) data.sheet.getRange(2, col + 1, colVals.length, 1).setValues(colVals);
    return { ok: true, changed: changed };
  });
}
