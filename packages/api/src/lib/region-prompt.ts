import type { Region } from "@joyorogo/i18n";

// Region context for the scan prompts. The prompts stay Indonesian (the model reads them well and the
// Indonesian text is the tuned, baselined one); a region adds what the model must know about local
// dishes. Indonesia adds nothing, so its prompts are byte-identical to before regions existed.
// The Malaysian text is checked by the eval harness's Malaysian set (docs/marketing/malaysia-plan.md).

/** What "fokus masakan ..." names in the first sentence of the photo prompt. */
export function regionFocus(region: Region): string {
  return region === "MY" ? "fokus masakan Malaysia: kedai mamak, gerai penjaja, kopitiam, dan masakan rumah Melayu, Cina, India" : "fokus masakan Indonesia";
}

/** Naming and serving defaults for Malaysia, appended to the photo prompt (starts with a newline). */
const MALAYSIA_PHOTO_RULE = `
Konteks Malaysia: foto ini diambil di Malaysia. name = nama masakan Malaysia yang umum, huruf kecil, ejaan Malaysia (nasi lemak, roti canai, teh tarik, mee goreng mamak, char kuey teow, nasi kandar, laksa, satay, kuih, milo ais, cendol, ayam goreng berempah), BUKAN padanan Indonesia: nasi lemak bukan nasi uduk, roti canai bukan roti maryam, teh tarik bukan teh susu, kopi O = kopi hitam manis, kopi kosong = kopi hitam tanpa gula, teh C = teh susu evaporasi, mee goreng = mi goreng. Ini bukan nama dalam Bahasa Indonesia: aturan "name dalam Bahasa Indonesia" tidak berlaku untuk masakan Malaysia.
Hidangan kedai mamak dan gerai: nasi lemak (bungkus daun pisang atau pinggan: nasi santan, sambal, telur, ikan bilis, kacang, timun) = SATU item; lauk besar di sampingnya (ayam goreng, rendang, sambal sotong, sayur) = item sendiri. Nasi kandar = nasi putih + setiap lauk + kuah campur (banjir): nasi satu item, tiap lauk item sendiri, kuah ikut lauknya. Roti canai = satu keping per item, kuah dal atau kari = item sendiri; roti telur, roti bom, roti tisu, murtabak hitung per keping. Satay hitung per cucuk (tusuk), kuah kacang = item sendiri. Kuih hitung per biji. Laksa, mee rebus, char kuey teow, wantan mee, mee goreng mamak = satu mangkuk atau satu pinggan = SATU item.
Minuman: teh tarik, kopi, milo ais, teh ais limau, sirap bandung, air tebu, cendol, ais kacang. Susu pekat (sweetened condensed milk) dan gula sudah ikut di dalam kcal minumannya. "Kurang manis" = gula dikurangi, "kosong" atau "O kosong" = tanpa gula dan tanpa susu, "peng" = ais (teh o ais limau peng).
Babi dan alkohol: jika foto jelas berisi bak kut teh, char siu, atau babi lain, catat apa adanya sebagai makanan biasa; jangan memberi label halal atau haram.`;

export function regionRule(region: Region): string {
  return region === "MY" ? MALAYSIA_PHOTO_RULE : "";
}

/** Same context for the text story ("tadi makan nasi lemak telur dengan teh tarik"). */
const MALAYSIA_STORY_RULE = `
- Konteks Malaysia: cerita ini ditulis di Malaysia, bisa campuran Bahasa Melayu, Inggris, dan Indonesia. name = nama masakan Malaysia yang umum, huruf awal kapital (Nasi lemak, Roti canai, Teh tarik, Mee goreng mamak, Char kuey teow), BUKAN padanan Indonesia: nasi lemak bukan nasi uduk, roti canai bukan roti maryam, teh tarik bukan teh susu. Tanpa jumlah: nasi lemak = 1 bungkus, roti canai = 1 keping, satay = 5 cucuk, kuih = 1 biji, teh tarik atau milo = 1 gelas kedai mamak. "Kurang manis" = gula dikurangi, "kosong" = tanpa gula. "Makan tengah hari" = makan_siang. Aturan "name dalam Bahasa Indonesia" tidak berlaku untuk masakan Malaysia.`;

export function storyRegionRule(region: Region): string {
  return region === "MY" ? MALAYSIA_STORY_RULE : "";
}
