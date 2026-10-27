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
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Semua yang dikirim antara aplikasi atau browser dan server JoyoRogo memakai HTTPS (TLS).
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
              Kalau kamu memotret label gizi produk, foto tabel gizinya (dan foto depan kemasan,
              kalau kamu mengambilnya) dikirim sekali ke server kami untuk dibaca oleh AI, lalu
              dibuang: foto itu tidak disimpan dan tidak ditahan. Yang tersimpan hanya nama produk
              dan angka gizi yang kamu ketik atau konfirmasi sendiri di formulir, dan data produk
              itu dibagikan ke semua pengguna JoyoRogo supaya mereka bisa memindai produk yang
              sama. Kontribusimu tetap terhubung ke akunmu supaya kami bisa menghitung berapa
              orang yang mengonfirmasi angkanya dan membatasi penyalahgunaan, tapi namamu tidak
              ditampilkan ke pengguna lain.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Ada satu pengecualian, dan hanya kalau kamu menyalakannya: di layar foto label ada
              pilihan "Pakai foto depan jadi stiker makanan", yang selalu mati dan baru muncul
              setelah kamu mengambil foto depan kemasan. Kalau menyala, server memotong foto depan
              itu (tanpa latar) dan menyimpan potongannya saja, lewat alamat acak yang tidak bisa
              ditebak, sebagai stiker makanan yang kamu catat dari produk itu. Foto aslinya dan foto
              tabel gizi tetap dibuang. Potongan itu tidak masuk ke data produk yang dibagikan.
              Hapus catatan makanannya, stikernya ikut terhapus, begitu juga saat kamu menghapus
              akun atau semua data. Kalau kamu tidak jadi mencatat makanannya, potongan itu
              terhapus otomatis dalam sekitar 2 hari. Kalau pilihan itu mati, produk dari label
              tidak punya stiker dari fotomu.
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
            <h2 className="text-base font-bold tracking-tight">Bot kalori di Threads</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menandai akun Threads JoyoRogo di postingan publik berisi foto makanan (atau
              di balasan di bawah foto makanan), kami membaca postingan itu lewat API resmi Threads,
              mengirim fotonya ke AI untuk memperkirakan kalori, lalu membalas di Threads. Fotonya
              hanya dibaca ke memori untuk satu kali scan dan tidak disimpan. Yang kami simpan hanya
              username Threads-mu, nama makanan dan rentang kalori dari AI, status balasan, dan
              waktunya. Postingan privat tidak terbaca. Mau datamu dihapus? Kirim email ke
              kontak di bawah.
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
              terhapus. Slot Strava terbatas: kalau sambunganmu lama tidak dipakai, kami bisa
              melepasnya supaya slotnya bisa dipakai orang lain. Izinnya dicabut di Strava, token
              serta olahraga hasil impor Strava dihapus, dan halaman Strava memberitahumu.
              Menghapus data atau akunmu mencabut izin Strava sepenuhnya. JoyoRogo tidak
              memakai data Strava untuk iklan atau analitik, dan tidak menjualnya.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="coros">
            <h2 className="text-base font-bold tracking-tight">COROS (opsional)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menyambungkan COROS, JoyoRogo meminta izin lewat server MCP resmi COROS
              (<span className="font-mono text-xs">openid mcp.tools offline_access</span>) untuk
              membaca latihan dari jammu dan mengubahnya jadi kalori terbakar di diarimu. Data
              dibaca saat kamu menekan Sinkron atau membuka halaman COROS di Profil.
            </p>
            <CheckList
              items={[
                "Dibaca dari tiap latihan: jenis olahraga, hari, durasi, dan kalori. Kalau COROS tidak mengirim kalori, kami memperkirakannya dari jenis olahraga, durasi, dan beratmu.",
                "Disimpan di akunmu sebagai olahraga, dengan nomor aktivitas COROS supaya tidak tercatat dua kali. Latihan yang sama dari Health Connect, Apple Health, atau Strava tidak dihitung dua kali.",
                "Token akses dan token penyegar COROS disimpan di database JoyoRogo. Latihan dari COROS dipakai seperti olahraga lain di diarimu, termasuk untuk Joyo AI dan target kalorimu.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Memutus COROS di JoyoRogo menghapus token dan semua olahraga yang diimpor dari COROS.
              Menghapus data atau akunmu juga menghapusnya. Kamu juga bisa mencabut izin
              JoyoRogo di aplikasi COROS. JoyoRogo tidak memakai data COROS untuk iklan, dan tidak
              menjualnya.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="latihan-joyofit">
            <h2 className="text-base font-bold tracking-tight">Latihan JoyoFit di cloud (Pro)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau akunmu Pro dan kamu masuk ke JoyoRogo di aplikasi JoyoFit, latihan yang direkam
              JoyoFit disimpan di akunmu supaya bisa dipulihkan di ponsel baru dan dilihat di
              halaman{" "}
              <Link
                to="/jam"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Latihan JoyoFit
              </Link>
              . Akun Free dan akun yang belum masuk di JoyoFit tidak mengunggah apa pun; latihannya
              tetap hanya di ponselmu.
            </p>
            <CheckList
              items={[
                "Disimpan: ringkasan latihan, rute GPS, detak jantung, ketinggian, kecepatan, irama langkah atau kayuhan, daya, dan analisis turunannya (jarak, waktu bergerak, tanjakan, zona, split).",
                "Tempat: penyimpanan Cloudflare milik JoyoRogo, terhubung ke akunmu dan tidak bisa dibuka tanpa masuk.",
                "Siapa yang bisa melihat: hanya kamu. Latihan yang kamu bagikan ke feed atau grup adalah salinan terpisah yang sudah disaring (misalnya tanpa rute atau detak jantung bila kamu menyembunyikannya), bukan data cloud ini. Lihat bagian Komunitas.",
                "Tidak dipakai untuk iklan atau melatih model, dan tidak dijual.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Hapus satu latihan atau semuanya dari halaman Latihan JoyoFit di web, atau lewat
              Settings, Health Connect and cloud (di iPhone: Apple Health and cloud), bagian Sinkron cloud, Delete cloud data, di aplikasi. Menghapus latihan juga menghapusnya dari
              ponsel yang menyinkronkannya pada sinkron berikutnya. Menghapus semua data atau akun
              juga menghapus semua latihan cloud. Kalau Pro berakhir, latihan yang sudah tersimpan
              tetap bisa dibaca dan dihapus; latihan baru tidak diunggah sampai Pro aktif lagi.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="riwayat-beban">
            <h2 className="text-base font-bold tracking-tight">Riwayat latihan beban lama</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Latihan beban sekarang dicatat di JoyoFit. Riwayat lama di JoyoRogo tetap bisa dilihat,
              tidak bisa diubah. Riwayat yang kamu bawa ke JoyoFit tersimpan di JoyoFit (di ponselmu,
              dan di cloud JoyoFit untuk Pro). Menghapus data di JoyoRogo tidak menghapus salinan itu.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="joyo-ai-rogo">
            <h2 className="text-base font-bold tracking-tight">Joyo AI di JoyoRogo (Pro)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Joyo AI menjawab pertanyaan soal makanan di web dan aplikasi JoyoRogo: tentang catatan
              makanmu sendiri, atau membandingkan makanan sebelum kamu makan. Fitur ini untuk akun Pro
              dan pengguna berusia 18 tahun ke atas. Joyo AI bukan dokter atau ahli gizi, dan
              jawabannya bisa keliru dan bukan saran medis.
            </p>
            <CheckList
              items={[
                "Tidak ada yang dikirim sebelum kamu menyetujui pemberitahuan di awal, sekali saja. Pemberitahuan itu menyebut data apa saja yang dikirim.",
                "Yang dikirim saat kamu bertanya: pesan yang kamu ketik dan sampai 12 pesan terakhir di percakapan itu; usia, jenis kelamin, tinggi, dan tujuanmu; target hariannya (kkal, protein, karbohidrat, lemak, serat, serta berat dan tanggal target); catatan hari ini (total makan, sisa target, nama, berat, dan kkal tiap makanan, air minum, dan status puasa); tujuh hari terakhir (kkal, protein, serat, dan air); dan berat badan terakhir beserta perubahannya. Kalau AI memintanya, catatan makan dan berat sampai 90 hari ke belakang dibacakan juga, hanya dibaca dan tidak pernah diubah.",
                "Dikirim lewat server JoyoRogo ke penyedia AI kami, yaitu Cloudflare Workers AI, hanya untuk menjawab pertanyaanmu, dan tidak dipakai untuk melatih model.",
                "Tidak pernah dikirim: nama, email, foto, lokasi atau GPS, data siklus haid, mode hamil atau menyusui, data Strava, dan ID perangkat. Kalau kamu sendiri menulis di pesan bahwa kamu hamil atau menyusui, Joyo AI menjawab lebih hati-hati, tetapi itu tidak pernah dibaca dari akunmu.",
                "Pesan dan jawaban tidak disimpan di server kami. Yang dicatat hanya jumlah pertanyaan per hari (untuk batas harian) dan pemakaian token.",
                "Percakapan disimpan di perangkatmu saja: di browser untuk web, di ponsel untuk aplikasi. Percakapan tidak ikut sinkron ke akunmu atau perangkat lain. Di web, Hapus semua percakapan di Riwayat Joyo AI menghapusnya, begitu juga menghapus data situs di browser, yang sekaligus mencabut persetujuanmu.",
                "Pesan yang menyebut cedera, nyeri, gejala, obat, atau gangguan makan dijawab dengan anjuran menemui dokter atau ahli gizi, tanpa saran diet. Joyo AI tidak tersedia untuk pengguna di bawah 18 tahun.",
              ]}
            />
            <p className="mt-3 text-sm leading-relaxed">
              Di aplikasi ponsel, Joyo AI juga bisa memakai kunci API milikmu sendiri tanpa Pro. Jalur
              itu terpisah: ponselmu mengirim langsung ke penyedia yang kamu pilih (OpenRouter,
              OpenAI, Anthropic, atau Google Gemini), tanpa lewat server JoyoRogo, dan kuncinya hanya
              ada di penyimpanan aman ponselmu. Setelah data sampai di penyedia itu, aturan privasi
              penyedia itu yang berlaku. Data dari Health Connect atau Apple Health (langkah, olahraga,
              tidur, detak jantung) tidak pernah dikirim lewat jalur ini. Web tidak mendukung kunci sendiri.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="coach-joyofit">
            <h2 className="text-base font-bold tracking-tight">Coach JoyoFit (Pro)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Coach di aplikasi JoyoFit punya dua bagian yang menyentuh server: dokumen rencana dan
              Joyo AI (dulu bernama Tanya coach) dengan mesin JoyoRogo. Keduanya hanya untuk akun Pro.
              Coach bukan dokter dan jawabannya bukan saran medis. Joyo AI juga punya mesin dengan
              kunci API milikmu sendiri, yang tidak lewat server kami (bagian di bawah ini).
            </p>
            <CheckList
              items={[
                "Dokumen rencana: pilihan rencana latihanmu (jenis, tingkat, hari, tanggal mulai), sesi yang kamu centang atau lewati, dan repetisi serta beban yang kamu catat. Disimpan di database JoyoRogo, terhubung ke akunmu, supaya sama di semua ponselmu dan bisa dipulihkan. Hanya kamu yang bisa membacanya. Dihapus saat kamu memakai Hapus semua data saya atau menghapus akun.",
                "Joyo AI dengan mesin JoyoRogo: pesan yang kamu ketik, ringkasan data kebugaran dari ponselmu (kesiapan, tidur, beban latihan, latihan terakhir, rencana), dan sedikit data akunmu (profil, berat terakhir, ringkasan makan) dikirim ke penyedia AI, yaitu Cloudflare Workers AI, untuk dijawab.",
                "Pesan dan jawaban Joyo AI dengan mesin JoyoRogo tidak disimpan di server kami. Yang dicatat hanya jumlah pesan per hari (untuk batas harian) dan pemakaian token.",
                "Pesan yang menyebut cedera, nyeri, gejala, obat, atau gangguan makan dijawab dengan anjuran menemui dokter atau fisioterapis, tanpa saran latihan atau diet.",
                "Tidak dipakai untuk iklan atau melatih model, dan tidak dijual.",
              ]}
            />
          </section>

          <section className="rounded-3xl bg-card p-5" id="joyo-ai">
            <h2 className="text-base font-bold tracking-tight">Joyo AI dengan kunci sendiri (JoyoFit, opsional, gratis)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Di aplikasi JoyoFit, Joyo AI juga bisa memakai kunci API milikmu sendiri (OpenRouter,
              OpenAI, Anthropic, Google Gemini, atau alamat yang kamu isi). Ini jalur terpisah dari
              mesin JoyoRogo di atas: ponselmu mengirim langsung ke penyedia yang kamu pilih, tanpa
              lewat server JoyoRogo.
            </p>
            <CheckList
              items={[
                "Tidak ada yang dikirim sebelum kamu memasukkan kunci, uji koneksi berhasil, dan kamu menyetujui untuk penyedia itu. Persetujuan menyebut data apa saja yang dikirim.",
                "Yang dikirim ke penyedia pilihanmu saat kamu bertanya: ringkasan data kebugaranmu (usia, jenis kelamin, tinggi, tujuan, kesiapan dan pemulihan, 14 hari terakhir tidur, detak jantung istirahat, HRV, strain, langkah, kalori aktif, dan menit olahraga, sampai 10 latihan terakhir, rencana latihan, serta berat badan dan catatan makan dari akun JoyoRogo bila kamu masuk), catatan coach yang kamu simpan, percakapannya, dan hasil pembacaan data yang diminta AI itu (maksimal 90 hari ke belakang).",
                "Tidak pernah dikirim: data siklus haid, mode hamil atau menyusui, nama, email, rute GPS, foto, dan data Strava.",
                "Kuncinya disimpan di penyimpanan aman ponselmu. JoyoRogo tidak menerima kunci, percakapan, catatan coach, atau ringkasan data dari mesin ini, dan semuanya tidak ikut sinkron ke akunmu. Untuk membaca berat badan dan catatan makan, aplikasi memakai sambungan akun JoyoRogo-mu yang biasa, hanya membaca.",
                "Setelah data sampai di penyedia, aturan privasi, penyimpanan, dan pelatihan model penyedia itu yang berlaku, bukan aturan JoyoRogo. Penyedia itu pilihanmu dan memakai akunmu sendiri; biaya pemakaian kamu tanggung sendiri. Pada tier gratis Gemini, aplikasi memperingatkan bahwa Google memakai isi yang diterimanya untuk memperbaiki produknya.",
                "Tidak tersedia untuk pengguna di bawah 18 tahun.",
                "Kamu bisa menghapus kunci, catatan dan percakapan, atau semuanya di pengaturan Joyo AI di aplikasi, dan Hapus dari HP ini saat keluar akun di JoyoFit juga menghapus semuanya. Data yang sudah sampai ke penyedia dihapus di akunmu di penyedia itu.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Jawaban AI bisa keliru dan bukan saran medis. Rincian lengkap ada di{" "}
              <a
                href="https://fit.joyorogo.com/privasi#joyo-ai"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                fit.joyorogo.com/privasi
              </a>
              .
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="beberapa-ponsel">
            <h2 className="text-base font-bold tracking-tight">Pengaturan di semua ponselmu</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Supaya dua atau tiga ponsel (Android dan iPhone) menampilkan hal yang sama, pilihan
              kecil yang kamu atur disimpan di akunmu dan ikut ke ponsel lain setelah kamu masuk.
              Ini berlaku untuk semua akun di JoyoRogo; di JoyoFit hanya untuk akun Pro.
            </p>
            <CheckList
              items={[
                "JoyoRogo (semua akun): tema, pengingat (jam dan hari), tampilan dan filter di tab Makan, pilihan privasi stiker (sembunyikan angka, tampilkan nama, watermark), dan pengumuman yang sudah kamu tutup. Bahasa tersimpan di profilmu.",
                "JoyoFit (Pro): pengaturan yang ikut akun (profil, target harian, tema, bahasa, satuan suhu dan nama kota cuaca, saklar siklus dan pengingatnya, laporan tidur), template stiker buatanmu, rute yang kamu simpan, HRV, skor tidur, metrik kesehatan yang dilaporkan jam, serta langkah dan tidur 90 hari terakhir untuk dipulihkan di ponsel baru.",
                "Data siklus (periode dan catatan harian) adalah data kesehatan. Ia hanya ikut akun Pro dan punya saklar sendiri, Sinkron data siklus, yang menyala secara bawaan. Mematikannya menghapus salinan siklus di cloud.",
                "Tidak ikut akun: izin notifikasi, saklar lokasi, koneksi Health Connect atau Apple Health, pilihan kamera, interval detak mentah, dan kunci pairing jam. Jam harus dipasangkan sendiri di tiap ponsel.",
                "Data Health Connect (Android) dan Apple Health (iPhone) tidak pernah dicampur. Kalau dua ponsel melaporkan hari yang sama, angka langkah tidak turun dan tidur yang lebih panjang yang dipakai, dan olahraga yang sama tidak dicatat dua kali.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Disimpan di database JoyoRogo, terhubung ke akunmu, dan hanya kamu yang bisa membacanya.
              Tidak dipakai untuk iklan atau melatih model, dan tidak dijual. Dihapus saat kamu memakai
              Hapus semua data saya atau menghapus akun, dan di JoyoFit lewat Delete cloud data.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="wawasan-tidur">
            <h2 className="text-base font-bold tracking-tight">Wawasan tidur (opsional)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Wawasan tidur mati secara bawaan. Baru setelah kamu menyalakannya (di JoyoRogo atau
              di JoyoFit, satu saklar yang sama), JoyoFit mengirim satu ringkasan per malam ke
              akunmu. Isinya:
            </p>
            <CheckList
              items={[
                "Jam mulai tidur dan jam bangun, serta selisih zona waktu ponselmu.",
                "Lama tidur, lama terjaga, dan berapa kali kamu terbangun.",
                "Total tahap tidur (dalam, REM, ringan) kalau jam tanganmu mengukurnya.",
                "Skor tidur dari jam tangan, HRV malam, dan detak jantung istirahat malam.",
                "Tidur siang (jam mulai dan selesai).",
                "Kalau kamu memasang termometer kamar di JoyoFit: rata-rata, terendah, dan tertinggi suhu dan kelembapan kamar selama tidur (bukan bacaan per menit).",
              ]}
            />
            <p className="mt-3 text-sm leading-relaxed">
              JoyoRogo menyejajarkan ringkasan itu dengan catatan makan dan olahragamu untuk
              menggambarkan pola, misalnya kapan makan malam terakhir atau hari saat kamu
              berolahraga. Teks AI hanya melihat hitungan dan rata-rata, tidak pernah malam per
              malam atau nama makanan. Kafein dan alkohol hanya dihitung dari catatan makanmu yang
              sudah ada, dan tidak ada data olahraga baru yang dikirim dari JoyoFit.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Disimpan paling banyak 90 malam terakhir. Mematikan saklar langsung menghapus semua
              malam yang tersimpan, begitu juga Hapus semua data saya dan menghapus akun. Data ini
              tidak dibagikan ke grup, feed, keluarga, atau konektor MCP, tidak dipakai untuk iklan
              atau pelacakan, dan tidak dijual. Wawasan tidur bukan saran medis; kalau tidurmu
              terganggu terus, bicarakan dengan tenaga kesehatan.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Di catatan makanan ada juga isian opsional "jam makan". Jam itu disimpan bersama
              entri makanannya, dipakai untuk wawasan berbasis waktu, dan dihapus bersama catatan
              makananmu.
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
              Latihan dari jam yang kamu posting lewat JoyoFit (Share to JoyoRogo) bisa membawa rute
              GPS, grafik detak jantung, dan analisis latihan, sesuai saklar yang kamu pilih saat
              memposting. Ringkasan latihannya terlihat oleh audiens yang kamu pilih (grup atau
              publik); detailnya (peta, grafik, split, zona) terlihat oleh kamu dan anggota JoyoRogo
              Pro. Postingan itu salinan terpisah: menghapus latihan di ponsel atau di cloud tidak
              menghapus postingannya, dan menghapus postingan menghapus kudos, komentar, rute, dan
              grafiknya. Postingan dan komentar disimpan sampai kamu menghapusnya atau akunmu
              dihapus.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Ikut tantangan grup berarti anggota grup itu bisa melihat apakah targetmu tercapai
              tiap hari, streakmu, dan angka langkah, strain, tidur, atau jumlah latihanmu untuk
              tantangan tersebut. Angka makananmu (kalori dan protein) hanya terlihat olehmu,
              teman hanya melihat tercapai atau tidak. Kamu bisa keluar dari tantangan kapan saja
              dan datamu di papan peringkatnya ikut hilang.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="keluarga">
            <h2 className="text-base font-bold tracking-tight">Keluarga di JoyoFit (opsional)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Di aplikasi JoyoFit ada fitur Keluarga yang mati sampai orang yang dipantau menerima
              undangan. Pemantau perlu masuk dengan akun JoyoRogo, dan nama JoyoRogo tiap orang
              ditampilkan ke orang yang terhubung dengannya.
            </p>
            <CheckList
              items={[
                "Yang dikirim hanya ringkasan harian: langkah, detak jantung istirahat, tidur semalam, kadar oksigen (SpO2) bila dinyalakan, serta kapan jam terakhir tersambung dan baterainya. Tidak pernah dikirim: lokasi, rute, detak jantung per menit, makanan, dan foto.",
                "Tempat: server cloud JoyoFit di akun Cloudflare pengembang, terpisah dari database JoyoRogo dan terhubung ke ID akun JoyoRogo-mu. Riwayat ringkasan disimpan 30 hari untuk pemantau Gratis dan 90 hari untuk pemantau Pro, lalu dihapus otomatis.",
                "Orang yang dipantau mengatur tiap kategori, bisa menjeda atau berhenti kapan saja (pemantau langsung tidak bisa melihat apa pun dan ringkasan yang terkirim dihapus), dan selalu bisa melihat siapa yang memantau.",
                "Menghapus akun JoyoRogo menghapus semua tautan Keluarga, ringkasan, dan token push, sebagai yang dipantau maupun sebagai pemantau.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Rincian lengkap ada di{" "}
              <a
                href="https://fit.joyorogo.com/privasi#keluarga"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                fit.joyorogo.com/privasi
              </a>
              .
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="notifikasi">
            <h2 className="text-base font-bold tracking-tight">Notifikasi push</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Notifikasi mati sampai kamu sendiri mengizinkannya. Ada dua jenis, dan keduanya hanya
              dipakai untuk memberimu kabar, bukan untuk iklan.
            </p>
            <CheckList
              items={[
                "Di browser (web): bila kamu mengizinkan notifikasi, kami menyimpan langganan push browsermu (alamat endpoint dan kunci enkripsinya) untuk pengingat puasa, kudos dan komentar di feed, dan colekan grup. Pemberitahuan dikirim lewat layanan push milik browsermu. Langganan yang sudah tidak berlaku dihapus otomatis, dan menghapus semua data atau akun juga menghapusnya.",
                "Di aplikasi JoyoFit (Keluarga): token push HP-mu (token Expo) disimpan di server JoyoFit dan dipakai untuk memberi tahu pemantau saat data terlihat tidak biasa. Pemberitahuan dikirim lewat layanan push Expo, lalu Google Firebase Cloud Messaging (Android) atau Apple Push Notification service (iPhone). Token dihapus saat kamu keluar dari akun di JoyoFit dan saat akun dihapus.",
              ]}
            />
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
              Pembelian dalam dolar AS (USD) di web diproses oleh Polar (polar.sh, Polar Software
              Inc.), merchant of record untuk transaksi itu. Polar mengumpulkan data kartu, nama,
              email, negara atau alamat penagihan, dan nomor pajak (bila ada) untuk menghitung
              pajak dan memeriksa penipuan. JoyoRogo menerima nomor pesanan, jumlah, status,
              status langganan, dan ID pelanggan Polar. JoyoRogo tidak pernah melihat nomor
              kartumu. Kebijakan privasi Polar:{" "}
              <a
                href="https://polar.sh/legal/privacy"
                target="_blank"
                rel="noopener"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                polar.sh/legal/privacy
              </a>
              .
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
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Syarat pembelian ada di{" "}
              <Link
                to="/syarat"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Syarat Layanan
              </Link>{" "}
              dan{" "}
              <Link
                to="/pengembalian-dana"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Pengembalian Dana
              </Link>
              .
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

          <section className="rounded-3xl bg-card p-5" id="koneksi-ai">
            <h2 className="text-base font-bold tracking-tight">Koneksi AI (Claude dan ChatGPT)</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Fitur JoyoRogo Pro ini membiarkan aplikasi AI yang kamu pilih, misalnya Claude dari
              Anthropic atau ChatGPT dari OpenAI, membaca datamu. Tidak ada yang tersambung kecuali
              kamu sendiri menambahkan penyambungnya di aplikasi AI itu, masuk ke JoyoRogo, dan
              menekan Izinkan di layar izin yang menyebut data apa saja yang diminta.
            </p>
            <CheckList
              items={[
                "Yang dibagikan: hanya data yang izinnya kamu setujui (profil dan target, catatan makan, berat badan, latihan, tidur dan pemulihan), dan hanya dibaca. Aplikasi AI tidak bisa mencatat, mengubah, atau menghapus apa pun di akunmu.",
                "Kapan dan ke siapa: data dikirim dari JoyoRogo ke aplikasi AI itu dan penyedianya, dan hanya saat kamu mengajukan pertanyaan di akunmu di sana. JoyoRogo tidak mengirim datamu ke mana pun atas inisiatif sendiri lewat koneksi ini.",
                "Setelah sampai di penyedia AI, aturan privasi, penyimpanan, dan pengaturan pelatihan model mereka yang berlaku. JoyoRogo tidak bisa mengendalikannya, jadi cek pengaturan di akunmu di sana.",
                "Log audit: kami mencatat alat yang dipakai dan rentang tanggalnya (bukan isi datanya), disimpan 90 hari, dan bisa kamu lihat di Koneksi AI.",
                "Pencabutan: kamu bisa memutuskan aplikasi kapan saja di Koneksi AI dan aksesnya berhenti seketika. Menghapus datamu di JoyoRogo memutuskan semua aplikasi yang tersambung.",
                "Penyimpanan token: token akses berlaku satu jam, dan token penyegarnya sampai 30 hari atau sampai kamu memutuskan aplikasinya, mana yang lebih dulu.",
                "Tidak pernah dibagikan: rute GPS dan data yang diimpor dari Strava.",
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Data kesehatan di sini bukan nasihat medis, dan jawaban AI bisa keliru.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Langkah menyambungkan dan rinciannya ada di{" "}
              <Link
                to="/panduan/ai"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                panduan Claude dan ChatGPT
              </Link>
              .
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5" id="hapus-akun">
            <h2 className="text-base font-bold tracking-tight">Hapus akun dan data</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kamu bisa menghapus seluruh catatan (profil, berat, makanan, olahraga, tidur,
              postingan feed, foto, lokasi, langganan notifikasi browser, latihan JoyoFit di cloud, dokumen rencana Coach, dan malam tidur untuk wawasan tidur) secara permanen lewat tombol <span className="font-semibold">Hapus semua data saya</span> di
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
              Profil menghapus akun itu sendiri: seluruh catatan, foto, lokasi, dan latihan cloud di atas,
              sambungan Strava (izinnya dicabut di Strava), tautan masuk Google dan Apple, sesi,
              nama, email, dan riwayat pembayaran. Pro tidak bisa dipulihkan setelahnya.
              Langganan App Store atau Google Play tetap harus kamu batalkan sendiri di pengaturan
              Apple atau Google.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Di aplikasi JoyoFit, tombol <span className="font-semibold">Delete JoyoRogo account</span>{" "}
              (Settings, Health Connect and cloud, atau Apple Health and cloud di iPhone, bagian
              Sinkron cloud) menghapus akun JoyoRogo yang sama beserta data JoyoFit-nya, termasuk
              latihan cloud, tautan Keluarga, dan token push. Rinciannya ada di{" "}
              <a
                href="https://fit.joyorogo.com/privasi#hapus"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                fit.joyorogo.com/privasi
              </a>
              .
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
