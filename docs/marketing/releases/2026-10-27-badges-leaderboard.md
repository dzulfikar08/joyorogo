---
app: joyorogo
feature: Lencana dan papan konsistensi mingguan
shipped: 2026-10-27
available: code
tier: free
post: todo
atur: JRG-462
---

**Apa:** JoyoRogo sekarang punya 12 lencana yang didapat dari kebiasaan mencatat: catatan pertama, beruntun 7/30/100 hari, minggu sempurna, scan pertama, target protein, air putih, latihan, tantangan grup, dan Ramadan konsisten. Lencana tampil di Profil (yang belum didapat abu-abu dengan cara mendapatkannya), di beranda aplikasi di samping api beruntun, di profil publik, dan bisa dibagikan sebagai cerita. Ada juga Papan konsistensi mingguan: peringkat siapa yang paling rutin mencatat (hari tercatat, hari latihan, hari protein, beruntun), untuk semua orang atau untuk satu grup. Papan itu opsional dan mati secara bawaan; kamu memilih tampil dengan nama pengguna atau nama samaran, dan bisa keluar kapan saja (datamu di papan ikut terhapus). Tidak tersedia saat hamil atau menyusui.

**Kenapa orang peduli:** Mencatat tiap hari itu membosankan; lencana dan papan memberi alasan kecil untuk kembali besok, tanpa membandingkan angka tubuh.

**Angle post:** "Papan peringkat yang tidak menanyakan berat badanmu. Yang dihitung cuma: kamu catat atau tidak."

**Bukti visual:** `docs/img/badges-shelf.png` (rak lencana di Profil), `docs/img/badges-detail.png` (detail lencana), `docs/img/badges-papan.png` (Papan konsistensi), `docs/img/badges-privacy.png` (saklar ikut papan, nama samaran), `docs/img/badges-public.png` (lencana di profil publik). Native: chip lencana di beranda dan tab Papan di halaman grup, belum dijalankan di perangkat.

**Jangan klaim:** belum ada di build mana pun (`available: code`); saat ini hanya untuk akun yang masuk daftar `BADGES_USER_IDS`. Jangan bilang papan menilai kesehatan atau penurunan berat: yang dihitung hanya hari mencatat, latihan terekam perangkat/JoyoFit, hari protein, dan beruntun. Beruntun di lencana/papan menghitung hari catat yang sah (ada kalori, ditulis paling lambat 2 hari setelah harinya), jadi bisa beda dari api di beranda.
