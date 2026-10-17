import { Check } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PublicHeader } from "@/components/public-header";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/privasi")({
  component: PrivasiPage,
  head: () => pageHead("/privasi"),
});

function CheckList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PrivasiPage() {
  return (
    <div className="min-h-svh">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Privasi</h1>
          <p className="mt-2 text-muted-foreground">
            Ringkas dan jujur: data apa yang tersimpan, apa yang tidak, dan cara menghapusnya.
          </p>
        </header>

        <div className="mt-8 space-y-3">
          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Data yang kami simpan</h2>
            <CheckList
              items={[
                "Akun: nama, email, dan foto profil dari akun Google yang kamu pakai untuk masuk. Kalau masuk dengan Apple di aplikasi iPhone, kami menyimpan nama (bila Apple memberikannya) dan email, yang bisa berupa alamat relai Apple. JoyoRogo tidak menyimpan kata sandi.",
                "Data diri: tahun lahir, jenis kelamin, tinggi, dan berat badan.",
                "Riwayat harian: berat timbangan, makanan, olahraga, tidur, dan air minum.",
                "Rencana harian: target makan, bakar, dan tidur yang dihitung dari data dirimu.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Satu akun = satu data. Kami tidak menyimpan apa pun yang tidak kamu masukkan sendiri.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Kamera, galeri, dan barcode</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kamera hanya dipakai saat kamu memotret makanan untuk dihitung kalorinya, memindai
              barcode kemasan, atau memotret tabel "Informasi Nilai Gizi" di kemasan, dan galeri
              hanya untuk foto yang kamu pilih sendiri (foto makanan, foto label, foto profil, foto
              cerita). Kami tidak membaca isi galerimu di luar foto yang kamu pilih. Untuk barcode,
              hanya nomor barcodenya yang dikirim lewat server kami dan basis data produk
              eksternal, seperti Open Food Facts (basis data produk terbuka), untuk mengambil info
              gizi; nomor itu tidak disertai nama atau emailmu.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu memotret label gizi produk, fotonya dikirim sekali ke server kami untuk
              dibaca oleh AI, lalu dibuang: foto itu tidak disimpan dan tidak ditahan. Yang
              tersimpan hanya nama produk dan angka gizi yang kamu ketik atau konfirmasi sendiri di
              formulir, dan data produk itu dibagikan ke semua pengguna JoyoRogo supaya mereka bisa
              memindai produk yang sama. Kontribusimu tetap terhubung ke akunmu supaya kami bisa
              menghitung berapa orang yang mengonfirmasi angkanya dan membatasi penyalahgunaan,
              tapi namamu tidak ditampilkan ke pengguna lain.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Foto makanan</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Foto yang kamu kirim diteruskan ke AI (Cloudflare Workers AI) untuk menghitung kalori
              dan kadar gizinya, dan tidak dipakai untuk melatih model. Foto itu ditahan sementara
              di server supaya tombol "Hitung ulang" bisa memakai foto yang sama, lalu terhapus
              otomatis dalam sekitar 2 hari (penghapusan otomatis bisa terlambat sedikit). Foto asli
              tidak disimpan permanen. Yang kami simpan hanya potongan tiap makanannya (tanpa
              latar) sebagai stiker diari, lewat alamat acak yang tidak bisa ditebak; hapus catatan
              makanannya, stikernya ikut terhapus.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menilai hasil scan "Kurang akurat" atau "Salah", ada kotak opsional yang
              tidak tercentang: "Boleh simpan foto ini untuk bantu memperbaiki AI". Hanya kalau kamu
              mencentangnya, foto itu disimpan bersama catatanmu, daftar makanan dari AI, dan hasil
              yang kamu simpan. Isinya dipakai hanya untuk menguji dan memperbaiki AI JoyoRogo, bisa
              dihapus atas permintaan, dan ikut terhapus saat kamu menghapus akun atau semua data.
              Tanpa centang, fotonya tidak disimpan di luar masa sementara tadi.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Untuk setiap scan foto, teks jawaban AI (daftar makanan, perkiraan berat, kalori, dan
              gizi, tanpa fotonya) kami simpan bersama hasil akhir yang kamu catat. Tujuannya
              mengukur dan memperbaiki akurasi AI. Teks itu ikut terhapus saat kamu menghapus akun
              atau semua data.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menyalakan "Simpan foto asli" di Profil, foto asli (versi kecil) dari scan
              yang kamu simpan ikut disimpan supaya bisa dilihat lagi di diari. Foto itu hanya bisa
              dibuka lewat akunmu. Mematikan pengaturan itu, atau menghapus semua data, menghapus
              semua foto asli yang tersimpan.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Satu pengecualian: akun yang ikut dataset akurasi internal (saat ini hanya akun milik
              pembuat JoyoRogo sendiri) menyimpan foto scan, jawaban AI, koreksi, dan hasil akhir
              yang disimpan, untuk mengevaluasi model. Foto itu tidak dipakai untuk melatih model,
              dan bisa dihapus atas permintaan. Akun lain tidak terpengaruh.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Lokasi tempat makan</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Lokasi mati secara bawaan. Kalau kamu menyalakan "Simpan lokasi tempat makan" saat
              mencatat piring dengan nama tempat, kami menyimpan titik tempat itu dibulatkan ke
              sekitar 100 meter, bukan titik persis. Lokasi hanya dipakai untuk peta dan urutan
              "Terdekat" di tab Tempat, hanya bisa dilihat akunmu, dan tidak pernah muncul di profil
              publik atau feed.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Lokasi bisa dihapus per tempat atau sekaligus semuanya dari tab Tempat tanpa
              mengubah catatan makanmu. Menghapus semua data juga menghapus semua lokasi tersimpan.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Cerita dan rekaman suara</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Saat kamu menceritakan makananmu, teks atau rekaman suaramu diteruskan ke AI
              (Cloudflare Workers AI) untuk diubah jadi teks dan dihitung kalorinya. Rekaman suara
              tidak disimpan dan tidak dipakai untuk melatih model. Yang tersimpan hanya makanan
              yang kamu pilih untuk dicatat.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Health Connect (Android)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menghubungkan Health Connect di aplikasi Android, kamu memilih sendiri
              data yang diizinkan, dan izinnya bisa dicabut kapan saja dari Health Connect.
              JoyoRogo membaca sesi olahraga, langkah, jarak, kalori aktif, dan sesi tidur dari 7
              hari terakhir, hanya saat aplikasi dibuka, dan tidak membaca di latar belakang.
            </p>
            <CheckList
              items={[
                "Dibaca: sesi olahraga, langkah, jarak, kalori aktif, dan tidur.",
                "Disimpan di akunmu: tiap olahraga (nama, durasi, kalori), ringkasan harian (langkah, jarak, kalori aktif), dan jam tidur per malam, supaya target harianmu bisa dihitung.",
                "Ditulis ke Health Connect: makanan yang kamu catat (nama, kalori, protein, karbohidrat, lemak, serat, jenis waktu makan), supaya aplikasi kesehatan lain yang kamu izinkan bisa membacanya.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Data Health Connect tidak dijual, tidak dipakai untuk iklan atau penentuan profil
              iklan, dan tidak dibagikan ke pihak ketiga. Data itu dipakai hanya untuk menghitung
              dan menampilkan progresmu. Menghapus semua data di Profil menghapus semua catatan
              yang sudah tersimpan di akunmu; data yang sudah kami tulis ke Health Connect dihapus
              lewat aplikasi Health Connect.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="apple-health">
            <h2 className="text-base font-bold tracking-tight">Apple Health (iPhone)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menghubungkan Apple Health di aplikasi iPhone, iOS meminta izinmu lewat
              dialog Apple Health sendiri, dan izinnya bisa dicabut kapan saja di aplikasi Kesehatan
              atau Pengaturan iPhone. JoyoRogo hanya membaca; aplikasi tidak menulis apa pun ke
              Apple Health. Yang dibaca adalah data 7 hari terakhir, saat kamu menjalankan sinkron
              dari Profil, dan setelah itu saat aplikasi dibuka. Tidak ada pembacaan di latar
              belakang.
            </p>
            <CheckList
              items={[
                "Dibaca: olahraga (jenis, waktu mulai dan selesai, kalori), langkah, jarak jalan dan lari, kalori aktif, dan tidur.",
                "Disimpan di akunmu: tiap olahraga (nama, jenis, durasi, kalori), ringkasan harian (langkah, jarak, kalori aktif, menit olahraga), dan jam tidur per malam, supaya target harianmu bisa dihitung.",
                "Tidak dibaca: detak jantung, rute GPS, berat badan, atau data kesehatan lain di luar daftar di atas.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Data Apple Health tidak dijual, tidak dipakai untuk iklan atau penentuan profil
              iklan, dan tidak dibagikan ke pihak ketiga. Data itu dipakai hanya untuk menghitung
              dan menampilkan progresmu. Menghapus semua data di Profil menghapus semua catatan
              yang sudah tersimpan di akunmu.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="strava">
            <h2 className="text-base font-bold tracking-tight">Strava (opsional)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menyambungkan Strava, JoyoRogo meminta izin baca aktivitasmu (
              <span className="font-mono text-xs">read</span> dan{" "}
              <span className="font-mono text-xs">activity:read_all</span>) untuk mengubahnya jadi
              kalori terbakar di diarimu. Saat kamu menekan Sinkron di Profil atau Olahraga,
              JoyoRogo mengambil 30 aktivitas terakhirmu.
            </p>
            <CheckList
              items={[
                "Dibaca dari tiap aktivitas: jenis, nama, waktu mulai, waktu bergerak, dan kalori. Kalau Strava tidak mencatat kalori, kami memperkirakannya dari jenis olahraga, durasi, dan beratmu.",
                "Disimpan di akunmu sebagai olahraga, dengan nomor aktivitas Strava supaya tidak tercatat dua kali. Olahraga dari Strava hanya terlihat olehmu: tidak dihitung di grup, tantangan, dan feed, dan tidak dipakai untuk menyesuaikan targetmu.",
                "Token akses dan ID atlet Strava disimpan di database JoyoRogo. JoyoRogo dan JoyoFit memakai satu aplikasi Strava, jadi sambungan itu dipakai bersama; olahraga yang diunggah JoyoFit ke Strava tidak diimpor lagi oleh JoyoRogo supaya tidak dobel.",
                "Olahraga dari Strava hanya disimpan 7 hari sejak aktivitasnya, sesuai Kebijakan API Strava (bagian 6.2: data Strava tidak boleh disimpan di cache lebih dari tujuh hari). Setelah itu seluruh barisnya, termasuk kalori, dihapus otomatis tiap beberapa menit, jadi kalori terbakar untuk hari yang lebih lama tidak lagi menyertakannya. Aktivitas yang sudah lewat 7 hari tidak diimpor sama sekali. Untuk kalori yang tetap tersimpan, pakai Health Connect (Android) atau Apple Health (iPhone).",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Memutus Strava di JoyoRogo menghapus olahraga yang diimpor dari Strava lebih awal.
              Izinnya dicabut di Strava hanya kalau JoyoFit juga tidak memakainya; kalau masih
              dipakai, sambungan JoyoFit tetap jalan. Kalau kamu mencabut aplikasi di strava.com
              (Pengaturan, Aplikasi Saya), semua token dan semua olahraga hasil impor Strava ikut
              terhapus. Menghapus data atau akunmu mencabut izin Strava sepenuhnya. JoyoRogo tidak
              memakai data Strava untuk iklan atau analitik, dan tidak menjualnya.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Komunitas: feed dan grup</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Tidak ada yang otomatis dibagikan. Hanya hal yang kamu pilih untuk diposting
              (makanan, latihan, berat, atau cerita, dengan foto dan keterangan yang kamu tulis)
              yang terlihat oleh orang lain: oleh anggota grupmu, atau oleh semua orang kalau
              kamu memilih publik dan menyalakan profil publik. Nama, foto profil, nama pengguna
              (handle), dan bio ikut tampil bersama postinganmu. Postingan publik dan komentar
              bisa dilaporkan, dan pengguna bisa memblokir pengguna lain. Kamu bisa menghapus
              postinganmu kapan saja.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Ikut tantangan grup berarti anggota grup itu bisa melihat apakah targetmu tercapai
              tiap hari, streakmu, dan angka langkah, strain, tidur, atau jumlah latihanmu untuk
              tantangan tersebut. Angka makananmu (kalori dan protein) hanya terlihat olehmu,
              teman hanya melihat tercapai atau tidak. Kamu bisa keluar dari tantangan kapan saja
              dan datamu di papan peringkatnya ikut hilang.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Pembayaran</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Di web, Pro dibayar sekali per periode lewat halaman pembayaran di browser: QRIS
              melalui Pakasir atau transfer bank melalui DOKU. Kami menyimpan nomor pesanan,
              jumlah, status, dan waktu pembayaran. DOKU menerima namamu dan emailmu untuk membuat
              halaman pembayaran. Kami tidak menyimpan nomor kartu, rekening, atau data dompet
              digitalmu; itu ditangani penyedia pembayaran. Bukti pembayaran dikirim ke emailmu.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Di aplikasi, Pro adalah langganan otomatis lewat App Store (iPhone) atau Google Play
              (Android). Pembayarannya ditangani Apple atau Google; kami tidak menerima nomor
              kartu atau data pembayaranmu. Yang kami simpan untuk mengaitkan langganan dengan
              akunmu dan memperpanjang atau mencabut Pro saat Apple atau Google memberi kabar
              (perpanjangan, pembatalan, pengembalian dana):
            </p>
            <CheckList
              items={[
                "App Store: ID transaksi asli, ID produk, lingkungan (Sandbox atau Production), status langganan, tanggal berakhir, dan token acak yang dipakai aplikasi saat membeli.",
                "Google Play: token pembelian, ID produk dan paket dasar, status langganan, dan ID pesanan terakhir.",
                "Catatan tiap transaksi: nomor transaksi atau pesanan, jumlah dalam rupiah, jumlah bulan, status, dan waktu.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Langganan dikelola dan dibatalkan di pengaturan Apple atau Google, bukan di JoyoRogo.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="masuk-apple">
            <h2 className="text-base font-bold tracking-tight">Masuk dengan Apple</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Di aplikasi iPhone kamu bisa masuk dengan Apple, selain dengan Google. Apple
              mengirim token identitas ke aplikasi, lalu JoyoRogo memeriksanya ke Apple. Yang
              kami terima dan simpan: ID pengguna Apple untuk akunmu, email (alamat relai pribadi
              Apple bila kamu memilih Sembunyikan Email Saya), dan nama bila Apple
              mengirimkannya. Kalau tidak ada nama, kami memakai "Pengguna". Kami tidak menerima
              kata sandi Apple IDmu.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Saat kamu menghapus akun dari aplikasi, JoyoRogo mencabut token Sign in with Apple
              milik akunmu di Apple lebih dulu. Untuk itu aplikasi meminta kamu masuk ulang dengan
              Apple, dan kalau pencabutannya gagal, akunmu belum dihapus dan bisa dicoba lagi.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Yang tidak kami lakukan</h2>
            <CheckList
              items={[
                "Tidak menjual datamu ke siapa pun.",
                "Tidak membagikan datamu ke pihak ketiga.",
                "Tidak memakai datamu untuk iklan.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Data yang bisa dilihat orang lain hanya halaman progres publik dan postingan yang
              kamu bagikan sendiri ke feed atau grup (lihat bagian Komunitas). Halaman progres
              publik hanya aktif kalau kamu menyalakannya di Profil, berisi berat awal ke berat
              sekarang saja, tanpa email dan tanpa catatan makanan.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Untuk tahu halaman dan tombol mana yang dipakai, kami memakai analitik tanpa cookie
              (Revklik): halaman yang dibuka, sumber kunjungan, jenis perangkat, dan langkah seperti
              daftar atau pembayaran Pro. Tanpa nama, email, atau catatan kesehatanmu.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="hapus-akun">
            <h2 className="text-base font-bold tracking-tight">Hapus akun dan data</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kamu bisa menghapus seluruh catatan (profil, berat, makanan, olahraga, tidur,
              postingan feed, foto, dan lokasi) secara permanen lewat tombol <span className="font-semibold">Hapus semua data saya</span> di
              halaman{" "}
              <Link
                to="/profil"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Profil
              </Link>
              . Akunmu tetap bisa dipakai, jadi kamu bisa mulai lagi dari nol kapan pun. Tombol ini
              tidak menghapus akunnya: riwayat pembayaran dan status Pro tetap ada.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Di aplikasi iPhone dan Android, tombol <span className="font-semibold">Hapus akun</span> di
              Profil menghapus akun itu sendiri: seluruh catatan, foto, dan lokasi di atas,
              sambungan Strava (izinnya dicabut di Strava), tautan masuk Google dan Apple, sesi,
              nama, email, dan riwayat pembayaran. Pro tidak bisa dipulihkan setelahnya.
              Langganan App Store atau Google Play tetap harus kamu batalkan sendiri di pengaturan
              Apple atau Google.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Dari web, atau kalau kamu tidak punya aplikasinya, kirim email dari
              alamat akun yang kamu pakai ke{" "}
              <a
                href="mailto:dzulfikar@joyorogo.com?subject=Hapus%20akun%20JoyoRogo"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                dzulfikar@joyorogo.com
              </a>{" "}
              dengan subjek <span className="font-semibold">Hapus akun JoyoRogo</span>. Kami
              menghapus akun beserta seluruh datanya dan mengonfirmasi lewat email setelah
              selesai. Halaman ini juga alamat permintaan penghapusan akun untuk aplikasi
              JoyoRogo di Google Play.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Kontak</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Ada pertanyaan soal datamu? Kirim email ke{" "}
              <a
                href="mailto:dzulfikar@joyorogo.com"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                dzulfikar@joyorogo.com
              </a>
              .
            </p>
          </section>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          JoyoRogo · dibuat di Malang, Indonesia
        </p>
      </main>
    </div>
  );
}
