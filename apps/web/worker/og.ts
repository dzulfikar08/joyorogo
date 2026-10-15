// Link-preview copy for /gabung/<kode>, /p/<id> and /u/<handle>. Pure: takes
// the minimal JSON from the API's /og/* routes (apps/server/src/og.ts) and
// returns the tags to write into the page; index.ts does the HTMLRewriter part.

export type OgTags = {
  /** <title> and the search-engine headline. */
  title: string;
  /** og:title and twitter:title; shorter than the <title> where it can be. */
  ogTitle: string;
  description: string;
  /** Absolute page URL the preview belongs to (og:url, canonical). */
  url: string;
  /** Own image; absent = keep the page's default share card (og.png). */
  image?: { url: string; alt: string; card: "summary_large_image" | "summary" };
};

export type GroupOg = { name: string; memberCount: number };
export type PostOg = {
  kind: string;
  title: string | null;
  caption: string | null;
  authorName: string | null;
  hasPhoto: boolean;
};
export type ProfileOg = { name: string | null; bio: string | null; image: string | null };

export function groupTags(data: GroupOg, url: string): OgTags {
  return {
    title: `Undangan grup ${data.name} | JoyoRogo`,
    ogTitle: `Kamu diundang ke grup ${data.name}`,
    description: `${data.memberCount} anggota. Pantau kalori bareng, colek yang malas catat, dan intip perut lewat VAR di JoyoRogo.`,
    url,
  };
}

export function postTags(data: PostOg, url: string, id: string, apiUrl: string): OgTags {
  const who = data.authorName ?? "Pengguna JoyoRogo";
  const headline = data.title ? `${who} di JoyoRogo: ${data.title}` : `Postingan ${who} di JoyoRogo`;
  return {
    title: `${headline} | JoyoRogo`,
    ogTitle: headline,
    description:
      data.caption ?? `${who} membagikan satu momen sehat: makanan, latihan, atau progres berat.`,
    url,
    image: data.hasPhoto
      ? {
          url: `${apiUrl}/post-photo/${id}`,
          alt: data.title ? `Foto: ${data.title}` : `Foto dari ${who}`,
          card: "summary_large_image",
        }
      : undefined,
  };
}

export function profileTags(data: ProfileOg, handle: string, url: string): OgTags {
  const who = data.name ?? `@${handle}`;
  const headline = `${who} (@${handle}) di JoyoRogo`;
  return {
    title: `${headline} | JoyoRogo`,
    ogTitle: headline,
    description:
      data.bio ??
      `Perjalanan sehat ${who}: progres berat, makanan, dan latihan yang dibagikan di JoyoRogo.`,
    url,
    image: data.image
      ? { url: data.image, alt: `Foto profil ${who}`, card: "summary" }
      : undefined,
  };
}
