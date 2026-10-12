import { Check } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PublicHeader } from "@/components/public-header";

export const Route = createFileRoute("/privasi")({
  component: PrivasiPage,
  head: () => ({
    meta: [{ title: "Privasi — JoyoRogo" }],
  }),
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
            <h2 className="text-base font-bold tracking-tight">Foto makanan</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Foto yang kamu kirim diteruskan ke AI (Cloudflare Workers AI) hanya untuk menghitung
              kalori dan kadar gizinya. Foto asli tidak disimpan di server kami dan tidak dipakai
              untuk melatih model. Yang kami simpan hanya potongan makanannya (tanpa latar) sebagai
              stiker diari, lewat alamat acak yang tidak bisa ditebak; hapus catatan makanannya, dan
              kamu bisa minta stikernya ikut terhapus.
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
              Satu-satunya data yang bisa dilihat orang lain adalah halaman progres publik, dan itu
              hanya aktif kalau kamu menyalakannya sendiri di Profil. Isinya berat awal ke berat
              sekarang saja, tanpa email dan tanpa catatan makanan.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Hapus semua data</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Kamu bisa menghapus seluruh catatan (profil, berat, makanan, olahraga, tidur) secara
              permanen lewat tombol <span className="font-semibold">Hapus semua data saya</span> di
              halaman{" "}
              <Link
                to="/profil"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Profil
              </Link>
              . Akunmu tetap bisa dipakai, jadi kamu bisa mulai lagi dari nol kapan pun.
            </p>
          </section>

          <section className="rounded-3xl bg-card p-5">
            <h2 className="text-base font-bold tracking-tight">Kontak</h2>
            <p className="mt-3 text-sm leading-relaxed">
              Ada pertanyaan soal datamu? Kirim email ke{" "}
              <a
                href="mailto:dzul@joyorogo.dzulfikar.com"
                className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                dzul@joyorogo.dzulfikar.com
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
