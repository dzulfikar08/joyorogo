export type Testimonial = {
  /** Original wording (Indonesian), trimmed with "…" only. */
  quote: string;
  /** Threads handle without the @. */
  handle: string;
  /** Public comment URL. Omitted for quotes shared by DM with permission. */
  url?: string;
  /** Which app the quote is about. */
  app: "JoyoRogo" | "JoyoFit";
  /**
   * Their public Threads profile photo, self-hosted at /testimonials/<handle>.webp (96 px) because the Threads CDN
   * links expire. Absent when they have no photo: the card shows their initial.
   */
  avatar?: boolean;
};

export const TESTIMONIALS: readonly Testimonial[] = [
  {
    quote:
      "Yang paling menarik buat aku fitur hitung kalori lewat foto dan suara, karena biasanya malasnya itu justru di input manual. … aplikasi begini bantu banget buat yang lagi pengen lebih sadar kalori harian 🙌",
    handle: "simamalut",
    url: "https://www.threads.com/@simamalut/post/De9pWsAkkJP",
    app: "JoyoRogo",
    avatar: true,
  },
  {
    quote: "…baru aja subscribe joyorogo… Terima kasih sudah membuat aplikasi yang sangat berguna ini.",
    handle: "_fadhildj_",
    app: "JoyoRogo",
    avatar: true,
  },
  {
    quote: "…thank you kak udah buat apk sekeren ini 👏🏻",
    handle: "syahrulsyah_",
    url: "https://www.threads.com/@syahrulsyah_/post/De-uDDXGYIi",
    app: "JoyoRogo",
    avatar: true,
  },
  {
    quote: "…Waowww aplikasinya keren bang.",
    handle: "sugiarto048",
    url: "https://www.threads.com/@sugiarto048/post/DehB-VRAe0L",
    app: "JoyoRogo",
    avatar: true,
  },
  {
    quote:
      "Pakai huawei band 11 pro tersambung baik, mantep josjis buat data kesehatan ala2 whoop. Kalo untuk lari oke datanya meski harus nunggu lama GPS lock.",
    handle: "abdalailisro",
    url: "https://www.threads.com/@abdalailisro/post/DezB_UhifZ4",
    app: "JoyoFit",
  },
  {
    quote: "mantap ini, udah ga perlu whoop, cukup huawei watch 😂",
    handle: "febilous",
    url: "https://www.threads.com/@febilous/post/DeluZFlE2EN",
    app: "JoyoFit",
    avatar: true,
  },
  {
    quote: "…lagi saya coba coba nih Huawei watch gt 2, lebih sat set ternyata dari Huawei health",
    handle: "sempuolayam",
    url: "https://www.threads.com/@sempuolayam/post/DemTF0sibOB",
    app: "JoyoFit",
  },
  {
    quote: "Wow… ngga nyangka secepet ini, terimakasih banyak mas 👍🏻",
    handle: "ashfyz",
    url: "https://www.threads.com/@ashfyz/post/DeviyZ3Eorw",
    app: "JoyoFit",
    avatar: true,
  },
];
