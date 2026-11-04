// Words and URL fragments that Indonesian Threads users put in their hidden words to mute affiliate spam, link-in-bio
// funnels and bait openers (list shared by the owner, 2026-11-03). A post or reply containing one is hidden for them,
// so nothing we publish on Threads may contain one: docs/marketing/social-playbook.md section 3.1. Checked by
// docs/marketing/content/check-threads.ts (captions) and the bot reply tests. Add new entries here, lowercase.

export const THREADS_HIDDEN_WORDS: readonly string[] = [
  // Marketplaces and their short links
  "shopee", "shopee.co.id", "shp.ee", "id.shp.ee", "s.shopee.co.id", "sv.shopee.co.id", "spf.shopee.co.id",
  "ss.shopee.co.id", "shope.ee", "an_redir", "origin_link=", "tokopedia", "tokopedia.com", "tokopedia.net", "toped",
  "blibli", "blibli.com", "lazada", "lazada.co.id", "lazada.com", "bukalapak", "bukalapak.com", "zalora", "zalora.co.id",
  "bhinneka", "bhinneka.com", "ralali", "ralali.com", "indonetwork", "indonetwork.co.id", "gramedia", "gramedia.com",
  "tiktok shop", "tiktokshop", "tiktok.com", "vt.tiktok.com", "shop.tiktok.com",
  // Tracking and affiliate query parameters: UTM tags count, so Threads links carry none (docs/utm.md)
  "affiliate_id=", "sub_id=", "subid=", "aff_id=", "click_id=", "offer_id=", "campaign_id=", "tracking_id=",
  "utm_source=", "utm_medium=affiliate", "utm_campaign=", "referral=", "referrer=", "ref=", "tag=", "uls_trackid=",
  "affiliate", "affiliate link", "affiliate program",
  // Link-in-bio pages, shorteners, creator storefronts
  "lynk.id", "mayar.id", "scalev.id", "linktr.ee", "beacons.ai", "taplink.cc", "taplink.io", "bio.site", "msha.ke",
  "campsite.bio", "linkpop.com", "s.id", "bit.ly", "tinyurl.com", "cutt.ly", "rebrand.ly", "dub.co", "linkfly.to",
  "pranala.click", "lakara.id", "avora.id", "tokoanda.com", "sociabuzz.com", "karyakarsa.com", "trakteer.id",
  "saweria.co", "gumroad.com", "payhip.com", "shopmy.us",
  // Selling phrases
  "link racun", "link di bio", "cek bio", "aku taruh link", "klik link", "link produk", "beli lewat link",
  "checkout lewat link", "promo produk", "komisi", "bantu larisin", "bantu ramaiin", "izin kak", "yg mau cek komen",
  "sebutin dong", "share pengalaman", "cek keranjang", "keranjang kuning", "cek komen",
  // Bait openers and engagement phrases
  "stop", "normalisasi", "boikot", "larisin", "nyepam", "nyampah", "in this economy", "jujur kenapa baru tau",
  "ternyata selama ini", "akhirnya nemu", "penemuan terbaik", "aku spill", "spill", "hidden gem", "maaf norak",
  "maaf norakkk", "maaf kalau norak", "hasil nurut warga threads", "nurut sama warga threads", "makasih warga threads",
  "penyesalan terbesarku", "baru tau ternyata selama ini sifat aslinya", "katanya si anu pake",
  "tolong liat hasil kakek aku sebentar", "disitu gue diem", "di situ gue diem", "jujur", "takbir", "ternyata si",
  // Products and topics people mute
  "zhi wu", "glycolic", "gelang pandora", "start 50rban", "dior rouge", "sungkem", "0.001 pk",
  // Off-topic and fake-story markers
  "maaf curhat", "oot", "foto ai", "cerita ai", "cerita palsu", "ngarang cerita",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

// Case-insensitive. An entry that starts or ends with a letter or digit must start or end at a word edge, so "oot"
// does not flag "Bluetooth" and "s.id" does not flag "joyorogos.id"; punctuation ends ("ref=") match anywhere.
// Threads' own matching is not documented and may be looser: treat inflected forms ("kejujuran") as hidden too.
const PATTERNS = THREADS_HIDDEN_WORDS.map((word) => {
  const body = word.split(/\s+/).map(escape).join("\\s+");
  const head = isWordChar(word[0]!) ? "(?<![\\p{L}\\p{N}])" : "";
  const tail = isWordChar(word.at(-1)!) ? "(?![\\p{L}\\p{N}])" : "";
  return { word, re: new RegExp(head + body + tail, "iu") };
});

/** The hidden-words entries `text` contains, in list order; empty when it is safe to post on Threads. */
export function findThreadsHiddenWords(text: string): string[] {
  return PATTERNS.filter(({ re }) => re.test(text)).map(({ word }) => word);
}
