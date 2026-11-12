# Pantau Banjir ESP32 (React + Blynk + Telegram)

Website monitoring real-time berbasis React dan Node.js untuk membaca kriteria status ketinggian air dari [`main.ino`](main.ino), menampilkan keterangan **Last Updated**, serta mengirim notifikasi otomatis ke **Telegram** saat status mencapai **KRITIS** (`distance <= 3 cm`).

## Kriteria Status (Sesuai `main.ino`)

| Status | Kondisi Jarak (`distance`) | Indikator LED | Buzzer | Aksi Telegram |
| :--- | :--- | :--- | :--- | :--- |
| `AMAN` | `> 10 cm` (termasuk timeout `999` / `--- cm`) | LED Hijau (`GPIO 27`) | Mati (`noTone`) | Tidak ada |
| `WASPADA` | `7 < distance <= 10 cm` | LED Kuning (`GPIO 33`) | Beep `2000 Hz` (70 ms ON / 530 ms OFF) | Pantau |
| `BAHAYA` | `3 < distance <= 7 cm` | LED Merah (`GPIO 32`) | Beep cepat adaptif (jeda 80-350 ms) | Siaga tinggi |
| `KRITIS` | `<= 3 cm` | LED Merah (`GPIO 32`) | Melodi alarm 8 nada | **Kirim notif otomatis** |

## Menjalankan Website Secara Lokal

1. Instal dependensi:
   ```bash
   npm install
   ```
2. (Opsional) Salin `.env.example` menjadi `.env` jika ingin menyimpan token via environment variable, atau isi langsung lewat tombol **Pengaturan** di UI.
3. Jalankan backend API + frontend React secara bersamaan:
   ```bash
   npm run dev
   ```
4. Buka browser ke `http://localhost:5173`.

Untuk mode produksi:
```bash
npm run build
npm start
```

## Firmware ESP32 dengan Blynk

Gunakan sketch [`firmware/esp32_blynk/esp32_blynk.ino`](firmware/esp32_blynk/esp32_blynk.ino) yang mempertahankan seluruh pin sensor, OLED, GPS, dan kriteria `main.ino`, ditambah pengiriman Virtual Pin ke Blynk Cloud (`V0` Jarak, `V1` Status, `V2` Latitude, `V3` Longitude, `V4` Satelit, `V5` Kondisi GPS).

## Pengujian Otomatis

```bash
npm test
```

