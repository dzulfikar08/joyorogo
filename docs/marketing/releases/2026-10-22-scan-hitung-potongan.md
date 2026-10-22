---
app: joyorogo
feature: Scan: telur, sate, nugget dan potongan lain dihitung satu per satu; angka "yakin N%" dihapus dari hasil
shipped: 2026-10-22
available: code
tier: free
post: todo
atur:
---

**Apa:** Scan foto menghitung makanan yang berupa potongan terpisah (belahan telur, sate, nugget, pangsit, bakso) satu per satu dan menulis jumlahnya di porsi, mis. "5 belahan (2,5 butir)". Beratnya dihitung dari jumlah x berat satuan, jadi sepiring telur belah tidak lagi terbaca sebagai satu telur. Teks "yakin 100%" di hasil scan dihapus; tersisa tanda "perkiraan AI".

**Kenapa orang peduli:** Penguji menscan tiga butir telur rebus yang dibelah dan hasilnya hanya satu butir kalori.

**Angle post:** Telur belah tujuh potong bukan satu telur. Scan JoyoRogo sekarang menghitung potongannya.

**Bukti visual:** Foto piring berisi telur rebus yang dibelah: hasil scan menampilkan porsi "N belahan (N/2 butir)" dengan berat dan kalori yang naik sesuai jumlahnya.

**Jangan klaim:** Jumlah potongan masih dibaca AI dari foto dan bisa meleset kalau potongan saling menempel atau menumpuk (uji: 7 belahan terbaca 4 sampai 5). Belum di build mana pun; bagian hitung butuh deploy server, teks "yakin N%" yang hilang butuh deploy web dan OTA native. Bukan klaim akurasi.
