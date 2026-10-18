import { Link, createFileRoute } from "@tanstack/react-router";

import { LegalList, LegalPage, LegalSection } from "@/components/legal-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/pengembalian-dana")({
  component: PengembalianDanaPage,
  head: () => pageHead("/pengembalian-dana"),
});

const linkClass =
  "font-semibold text-primary underline underline-offset-4 hover:text-primary/80";

function PengembalianDanaPage() {
  return (
    <LegalPage
      title="Pengembalian Dana"
      intro="Kapan uangmu bisa kembali, tergantung di mana kamu membayar."
      updated="Diperbarui 18 Oktober 2026"
    >
      <LegalSection title="Pembayaran rupiah di web">
        <p>
          QRIS dan transfer bank dibayar di muka untuk satu periode dan tidak diperpanjang
          otomatis, jadi tidak ada tagihan susulan. Kalau ada pembayaran ganda, salah nominal, atau
          Pro tidak aktif padahal pembayaran berhasil, kirim nomor pesanan ke{" "}
          <a href="mailto:dzulfikar@joyorogo.com" className={linkClass}>
            dzulfikar@joyorogo.com
          </a>{" "}
          dan kami periksa. Di luar kasus itu, periode yang sudah dibayar tidak dikembalikan.
        </p>
      </LegalSection>

      <LegalSection title="Pembelian lewat App Store dan Google Play">
        <p>
          Pengembalian dana untuk pembelian di aplikasi mengikuti proses Apple atau Google dan
          diajukan lewat toko tersebut. Kami tidak bisa memprosesnya langsung. Kalau toko
          mengembalikan dana, Pro dari pembelian itu ikut dicabut.
        </p>
      </LegalSection>

      <LegalSection title="USD purchases (Polar)" id="usd" lang="en">
        <p>
          This section applies to Pro purchases paid in US dollars on the web. Polar is the
          merchant of record for these purchases.
        </p>
        <LegalList
          items={[
            "Window: you can request a refund within 14 days of your first charge or of a renewal.",
            "How: email dzulfikar@joyorogo.com, or use the link on your Polar order receipt.",
            "Payout: refunds are issued by Polar to the original payment method. Timing depends on your bank or card issuer.",
            "Effect: a refunded USD order revokes the Pro time it granted.",
            "Cancelling is separate from refunding: to stop future renewals, use Profile > Manage subscription or the Polar customer portal. Pro stays active until the paid period ends unless the order is refunded.",
          ]}
        />
        <p>
          See also the{" "}
          <Link to="/syarat" hash="usd" className={linkClass}>
            terms for USD purchases
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
