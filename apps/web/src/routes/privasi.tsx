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
                "Akun: nama, email, dan foto profil dari akun Google yang kamu pakai untuk masuk. JoyoRogo tidak menyimpan kata sandi.",
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
              Kamera hanya dipakai saat kamu memotret makanan untuk dihitung kalorinya atau
              memindai barcode kemasan, dan galeri hanya untuk foto yang kamu pilih sendiri (foto
              makanan, foto profil, foto cerita). Kami tidak membaca isi galerimu di luar foto yang
              kamu pilih. Untuk barcode, hanya nomor barcodenya yang dikirim lewat server kami ke
              Open Food Facts (basis data produk terbuka) untuk mengambil info gizi; nomor itu
              tidak disertai nama atau emailmu.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Foto makanan</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Foto yang kamu kirim diteruskan ke AI (Cloudflare Workers AI) untuk menghitung kalori
              dan kadar gizinya, dan tidak dipakai untuk melatih model. Foto asli tidak disimpan di
              server kami. Yang kami simpan hanya potongan tiap makanannya (tanpa latar) sebagai
              stiker diari, lewat alamat acak yang tidak bisa ditebak; hapus catatan makanannya,
              stikernya ikut terhapus.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Kalau kamu menyalakan "Simpan foto asli" di Profil, foto asli (versi kecil) dari scan
              yang kamu simpan ikut disimpan supaya bisa dilihat lagi di diari. Foto itu hanya bisa
              dibuka lewat akunmu. Mematikan pengaturan itu, atau menghapus semua data, menghapus
              semua foto asli yang tersimpan.
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
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Pembayaran</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Langganan Founder dibayar lewat halaman pembayaran di browser: QRIS melalui Pakasir
              atau transfer bank melalui DOKU (di iPhone lewat App Store). Kami menyimpan nomor
              pesanan, jumlah, status, dan waktu pembayaran. DOKU menerima namamu dan emailmu
              untuk membuat halaman pembayaran. Kami tidak menyimpan nomor kartu, rekening, atau
              data dompet digitalmu; itu ditangani penyedia pembayaran. Bukti pembayaran dikirim
              ke emailmu.
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
              daftar atau pembayaran Founder. Tanpa nama, email, atau catatan kesehatanmu.
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
              . Akunmu tetap bisa dipakai, jadi kamu bisa mulai lagi dari nol kapan pun. Riwayat
              pembayaran dan status Founder tidak ikut terhapus.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Mau menghapus akunnya juga (nama, email, dan riwayat pembayaran)? Kirim email dari
              alamat akun Google yang kamu pakai ke{" "}
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
