export type Testimonial = {
  /** Original wording (Indonesian), trimmed with "…" only. */
  quote: string;
  /** Threads handle without the @. */
  handle: string;
  /** Public comment URL. Omitted for quotes shared by DM with permission. */
  url?: string;
};

export const TESTIMONIALS: readonly Testimonial[] = [
  {
    quote: "…baru aja subscribe joyorogo… Terima kasih sudah membuat aplikasi yang sangat berguna ini.",
    handle: "_fadhildj_",
  },
  {
    quote: "…Waowww aplikasinya keren bang.",
    handle: "sugiarto048",
    url: "https://www.threads.com/@sugiarto048/post/DehB-VRAe0L",
  },
];
