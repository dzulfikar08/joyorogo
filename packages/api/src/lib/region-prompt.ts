import type { Region } from "@joyorogo/i18n";

// Region context for the scan prompts. The prompts stay Indonesian (the model reads them well and the
// Indonesian text is the tuned, baselined one); a region adds what the model must know about local
// dishes. Indonesia adds nothing, so its prompts are byte-identical to before regions existed.
// The Malaysian text is checked by the eval harness's Malaysian set (docs/marketing/malaysia-plan.md).

/** What "fokus masakan ..." names in the first sentence of the photo prompt. */
export function regionFocus(region: Region): string {
  if (region === "MY") return "fokus masakan Malaysia: kedai mamak, gerai penjaja, kopitiam, dan masakan rumah Melayu, Cina, India";
  if (region === "SG") return "fokus masakan Singapura: hawker centre, kopitiam, food court, dan masakan rumah Cina, Melayu, India";
  return "fokus masakan Indonesia";
}

/** Naming and serving defaults for Malaysia, appended to the photo prompt (starts with a newline). */
const MALAYSIA_PHOTO_RULE = `
Konteks Malaysia: foto ini diambil di Malaysia. name = nama masakan Malaysia yang umum, huruf kecil, ejaan Malaysia (nasi lemak, roti canai, teh tarik, mee goreng mamak, char kuey teow, nasi kandar, laksa, satay, kuih, milo ais, cendol, ayam goreng berempah), BUKAN padanan Indonesia: nasi lemak bukan nasi uduk, roti canai bukan roti maryam, teh tarik bukan teh susu, kopi O = kopi hitam manis, kopi kosong = kopi hitam tanpa gula, teh C = teh susu evaporasi, mee goreng = mi goreng. Ini bukan nama dalam Bahasa Indonesia: aturan "name dalam Bahasa Indonesia" tidak berlaku untuk masakan Malaysia.
Hidangan kedai mamak dan gerai: nasi lemak (bungkus daun pisang atau pinggan: nasi santan, sambal, telur, ikan bilis, kacang, timun) = SATU item; lauk besar di sampingnya (ayam goreng, rendang, sambal sotong, sayur) = item sendiri. Nasi kandar = nasi putih + setiap lauk + kuah campur (banjir): nasi satu item, tiap lauk item sendiri, kuah ikut lauknya. Roti canai = satu keping per item, kuah dal atau kari = item sendiri; roti telur, roti bom, roti tisu, murtabak hitung per keping. Satay hitung per cucuk (tusuk), kuah kacang = item sendiri. Kuih hitung per biji. Laksa, mee rebus, char kuey teow, wantan mee, mee goreng mamak = satu mangkuk atau satu pinggan = SATU item.
Minuman: teh tarik, kopi, milo ais, teh ais limau, sirap bandung, air tebu, cendol, ais kacang. Susu pekat (sweetened condensed milk) dan gula sudah ikut di dalam kcal minumannya. "Kurang manis" = gula dikurangi, "kosong" atau "O kosong" = tanpa gula dan tanpa susu, "peng" = ais (teh o ais limau peng).
Babi dan alkohol: jika foto jelas berisi bak kut teh, char siu, atau babi lain, catat apa adanya sebagai makanan biasa; jangan memberi label halal atau haram.`;

/** Naming and serving defaults for Singapore, appended to the photo prompt (starts with a newline). */
const SINGAPORE_PHOTO_RULE = `
Konteks Singapura: foto ini diambil di Singapura. name = nama masakan Singapura yang umum, huruf kecil, ejaan yang dipakai di hawker centre (chicken rice, char kway teow, laksa, nasi lemak, roti prata, kaya toast, bak chor mee, fish ball noodles, wanton mee, satay, chwee kueh, kopi, kopi o, kopi c, kopi peng, teh, teh c, teh o, teh peng, milo dinosaur, bubble tea), BUKAN padanan Indonesia: chicken rice bukan nasi ayam, roti prata bukan roti canai atau roti maryam, kaya toast bukan roti bakar selai, kopi = kopi susu kental manis dan gula, kopi o = kopi hitam manis, kopi kosong atau kopi o kosong = kopi hitam tanpa gula, kopi c = kopi susu evaporasi, peng = es, "siew dai" = gula dikurangi, "gao" = lebih kental. Ini bukan nama dalam Bahasa Indonesia: aturan "name dalam Bahasa Indonesia" tidak berlaku untuk masakan Singapura.
Hidangan hawker: chicken rice (nasi minyak ayam, sayur, saus cabai dan jahe) = SATU item per piring; ayam kukus, ayam panggang, atau ayam kecap diberi nama sesuai tampilan; porsi tambahan (telur, sayur) = item sendiri. Char kway teow, laksa, bak chor mee, wanton mee, hokkien mee, fish ball noodles = satu mangkuk atau satu piring = SATU item. Nasi lemak = nasi santan, sambal, telur, ikan bilis, kacang = SATU item; ayam goreng atau otah di samping = item sendiri. Economy rice (cai png): nasi putih satu item, setiap lauk dan sayur item sendiri. Roti prata hitung per lembar (plain, egg, cheese), kuah kari = item sendiri. Kaya toast hitung per lembar atau per set. Satay hitung per tusuk, saus kacang dan ketupat = item sendiri. Chwee kueh dan kuih hitung per biji. Porsi hawker biasanya satu piring per orang, lebih kecil dari restoran.
Minuman: kopi, teh, milo dinosaur, bubble tea (cup 500 ml, es dan gula sudah ikut di dalam kcal minuman), sugarcane juice, barley, soya bean milk. Tingkat gula: "100%" normal, "50%" setengah, "siew dai" dikurangi, "kosong" tanpa gula.
Babi dan alkohol: jika foto jelas berisi bak chor mee, char siu, atau babi lain, catat apa adanya sebagai makanan biasa; jangan memberi label halal atau haram.`;

export function regionRule(region: Region): string {
  if (region === "MY") return MALAYSIA_PHOTO_RULE;
  if (region === "SG") return SINGAPORE_PHOTO_RULE;
  return "";
}

/** Same context for the text story ("tadi makan nasi lemak telur dengan teh tarik"). */
const MALAYSIA_STORY_RULE = `
- Konteks Malaysia: cerita ini ditulis di Malaysia, bisa campuran Bahasa Melayu, Inggris, dan Indonesia. name = nama masakan Malaysia yang umum, huruf awal kapital (Nasi lemak, Roti canai, Teh tarik, Mee goreng mamak, Char kuey teow), BUKAN padanan Indonesia: nasi lemak bukan nasi uduk, roti canai bukan roti maryam, teh tarik bukan teh susu. Tanpa jumlah: nasi lemak = 1 bungkus, roti canai = 1 keping, satay = 5 cucuk, kuih = 1 biji, teh tarik atau milo = 1 gelas kedai mamak. "Kurang manis" = gula dikurangi, "kosong" = tanpa gula. "Makan tengah hari" = makan_siang. Aturan "name dalam Bahasa Indonesia" tidak berlaku untuk masakan Malaysia.`;

const SINGAPORE_STORY_RULE = `
- Konteks Singapura: cerita ini ditulis di Singapura, bisa campuran Inggris (Singlish), Melayu, Mandarin, dan Indonesia. name = nama masakan Singapura yang umum, huruf awal kapital (Chicken rice, Char kway teow, Laksa, Nasi lemak, Roti prata, Kaya toast, Kopi, Teh), BUKAN padanan Indonesia: chicken rice bukan nasi ayam, roti prata bukan roti canai. Tanpa jumlah: chicken rice = 1 piring, roti prata = 1 lembar, satay = 5 tusuk, kaya toast = 1 set (2 lembar), kopi atau teh = 1 cangkir kopitiam, bubble tea = 1 gelas. "Siew dai" = gula dikurangi, "kosong" = tanpa gula, "peng" = es. "Lunch" = makan_siang. Aturan "name dalam Bahasa Indonesia" tidak berlaku untuk masakan Singapura.`;

export function storyRegionRule(region: Region): string {
  if (region === "MY") return MALAYSIA_STORY_RULE;
  if (region === "SG") return SINGAPORE_STORY_RULE;
  return "";
}
