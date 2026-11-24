import { Link, createFileRoute } from "@tanstack/react-router";

import { LegalList, LegalPage, LegalSection } from "@/components/legal-page";
import { useAppConfig } from "@/lib/app-config";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/syarat")({
  component: SyaratPage,
  head: () => pageHead("/syarat"),
});

const linkClass =
  "font-semibold text-primary underline underline-offset-4 hover:text-primary/80";

function SyaratPage() {
  return (
    <LegalPage
      title="Syarat Layanan"
      intro="Aturan main memakai JoyoRogo, ditulis ringkas."
      updated="Diperbarui 4 November 2026"
    >
      <LegalSection title="Akun dan pemakaian">
        <p>
          JoyoRogo membantu mencatat makan, olahraga, berat, dan tidur. Angka yang muncul adalah
          perkiraan untuk membantumu mengatur kebiasaan, bukan nasihat medis. Untuk kondisi
          kesehatan tertentu, tanyakan ke tenaga kesehatan.
        </p>
        <p>
          Kamu bertanggung jawab atas akunmu dan isi yang kamu bagikan ke grup atau feed. Data apa
          yang kami simpan dijelaskan di{" "}
          <Link to="/privasi" className={linkClass}>
            Privasi
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Paket gratis dan Pro">
        <p>
          Fitur dasar gratis selamanya, dengan jatah scan AI harian. Pro menambah jatah scan dan
          fitur lain yang tercantum di halaman{" "}
          <Link to="/harga" className={linkClass}>
            Harga
          </Link>
          . Isi dan harga paket bisa berubah; perubahan tidak memengaruhi periode yang sudah kamu
          bayar.
        </p>
        <p>
          Pro (Joyo Pro) adalah satu langganan per akun JoyoRogo dan berlaku untuk JoyoRogo, JoyoFit,
          dan JoyoArto (catatan keuangan keluarga). Di mana pun kamu membelinya (web, App Store, atau
          Google Play), Pro aktif di ketiga aplikasi selama kamu memakai akun yang sama. JoyoArto
          mencocokkan langgananmu lewat akun Google-mu; lihat{" "}
          <Link to="/privasi" className={linkClass}>
            Privasi
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Pembayaran rupiah di web">
        <p>
          Di web, Pro dibayar dengan QRIS atau transfer bank untuk satu periode (bulanan atau
          tahunan) di muka. Pembayaran ini tidak diperpanjang otomatis; kamu memperpanjang sendiri
          dari Profil. Membeli lagi sebelum periode habis menumpuk di atas sisa masa aktifmu.
        </p>
      </LegalSection>

      <JoyoKeluargaTerms />

      <LegalSection title="Pembelian lewat App Store dan Google Play">
        <p>
          Di aplikasi, Pro adalah langganan otomatis yang ditagih, diperpanjang, dan dibatalkan
          lewat Apple atau Google sesuai syarat toko tersebut.
        </p>
      </LegalSection>

      <LegalSection title="USD purchases (Polar)" id="usd" lang="en">
        <p>
          This section applies to Pro purchases paid in US dollars on the web. It is written in
          English because these purchases are meant for buyers outside Indonesia.
        </p>
        <LegalList
          items={[
            "Seller: Polar (polar.sh) is the merchant of record and the seller for USD purchases. Charges on your card statement appear as Polar or JoyoRogo.",
            "Renewal: a USD purchase is a subscription that renews automatically every month or every year, depending on the plan you chose, until you cancel.",
            "Cancelling: cancel any time from Profile > Manage subscription or from the Polar customer portal. Pro stays active until the end of the period you already paid for.",
            "Taxes: Polar adds VAT, GST, or sales tax at checkout where it applies to your location.",
            "Price changes: the price may change. We give notice before a new price applies to a new billing period.",
            "Refunds: see the refund policy linked below.",
          ]}
        />
        <p>
          Polar's own terms and privacy policy also apply to the payment itself. See the{" "}
          <Link to="/pengembalian-dana" hash="usd" className={linkClass}>
            refund policy
          </Link>{" "}
          and{" "}
          <Link to="/privasi" className={linkClass}>
            Privasi
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Perubahan dan kontak">
        <p>
          Kalau syarat ini berubah, tanggal di atas ikut berubah. Pertanyaan atau keluhan:{" "}
          <a href="mailto:dzulfikar@joyorogo.com" className={linkClass}>
            dzulfikar@joyorogo.com
          </a>
          . Soal uang kembali ada di{" "}
          <Link to="/pengembalian-dana" className={linkClass}>
            Pengembalian Dana
          </Link>
          .
        </p>
      </LegalSection>

      <p className="mt-10 text-center text-xs text-muted-foreground">
        JoyoRogo · dibuat di Malang, Indonesia
      </p>
    </LegalPage>
  );
}

/** Joyo Keluarga seat rules; shown only while the server sells the plan (KELUARGA_ENABLED). */
function JoyoKeluargaTerms() {
  const config = useAppConfig();
  const keluarga = config.data?.keluarga;
  if (!keluarga) return null;
  return (
    <LegalSection title="Joyo Keluarga" id="joyo-keluarga">
      <p>
        Joyo Keluarga adalah paket Pro untuk sampai {keluarga.seats} akun JoyoRogo dalam satu rumah, termasuk
        pembayarnya. Satu orang membayar, lalu mengundang anggota.
      </p>
      <LegalList
        items={[
          "Pembayar: membayar paket dan mengatur kursi. Selama keluarga ada, pembayar tidak bisa keluar; ia bisa menghapus anggota atau membiarkan masa aktif habis.",
          "Undangan: tiap tautan hanya bisa dipakai sekali dan berlaku 7 hari. Undangan yang menunggu ikut memakai kursi. Satu akun hanya bisa berada di satu keluarga.",
          "Anggota: mendapat Pro di akunnya sendiri selama masa aktif keluarga berjalan, bisa keluar kapan saja, dan Pro dari Keluarga berhenti saat itu juga. Pro yang dibayar anggota sendiri tidak terpengaruh.",
          "Masa aktif: kalau pembayar berhenti membayar, Pro dari Keluarga berhenti untuk semua anggota saat masa aktifnya habis. Di web (QRIS/transfer) paket ini tidak diperpanjang otomatis.",
          "Harga: dua kali harga Pro yang berlaku untukmu. Sisa masa Pro milikmu sendiri tidak dipindah ke Keluarga dan tidak dikembalikan; Pro-mu tetap berjalan sampai habis.",
          "Batas pergantian: satu keluarga bisa menerima paling banyak 8 anggota baru dalam 12 bulan di luar pengisian pertama. Kursi tidak boleh dijual atau dibagikan ke orang di luar rumah.",
        ]}
      />
    </LegalSection>
  );
}
