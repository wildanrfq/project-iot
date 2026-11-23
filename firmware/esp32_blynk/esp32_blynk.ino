// =============================================================
// ESP32 Sistem Monitoring Banjir + Blynk Cloud
// Disinkronkan dengan konfigurasi kabel terbaru di test_ledaa_oled_gps.ino
// menggunakan koneksi WiFi/Blynk & buzzer non-blocking.
// =============================================================

#define BLYNK_PRINT Serial
#define BLYNK_TEMPLATE_ID "TMPL6iky1uD91"
#define BLYNK_TEMPLATE_NAME "Monitoring Banjir ESP32"
#define BLYNK_AUTH_TOKEN "822zu2PrHn_EmlDnv2EbZvLm0tOksJ1M"
#define BLYNK_SERVER_HOST "sgp1.blynk.cloud"

#include <WiFi.h>
#include <BlynkSimpleEsp32.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <TinyGPSPlus.h>

// ===== Kredensial WiFi (ISI SESUAI HOTSPOT / ROUTER ANDA) =====
const char* WIFI_SSID = "MAKINUL AMIN 1"; 
const char* WIFI_PASS = "h2sannyatha";

// ===== Konfigurasi Pin Sensor & Aktuator =====
#define TRIG_PIN 5
#define ECHO_PIN 6
#define BUZZER_PIN 1

// ===== Konfigurasi Pin RGB LED (1 Lampu 4 Pin: GND, R, G, B - Common Cathode) =====
// Hubungkan:
//   - Pin GND pada RGB LED -> GND ESP32
//   - Pin R pada RGB LED   -> GPIO 4 (melalui resistor 220-330 ohm jika ada)
//   - Pin G pada RGB LED   -> GPIO 3 (melalui resistor 220-330 ohm jika ada)
//   - Pin B pada RGB LED   -> GPIO 2 (melalui resistor 220-330 ohm jika ada)
#define RGB_RED_PIN   4
#define RGB_GREEN_PIN 3
#define RGB_BLUE_PIN  2

// Alias untuk kompatibilitas lama
#define LED_RED    RGB_RED_PIN
#define LED_GREEN  RGB_GREEN_PIN
#define LED_BLUE   RGB_BLUE_PIN

// ===== Konfigurasi Pin OLED & GPS berdasarkan Chip (ESP32-C3 vs ESP32 Klasik) =====
#if defined(CONFIG_IDF_TARGET_ESP32C3) || defined(ARDUINO_ESP32C3_DEV) || (defined(SOC_GPIO_PIN_COUNT) && SOC_GPIO_PIN_COUNT <= 22)
  // ESP32-C3: GPIO hanya 0 sampai 21. Default I2C: SDA=8, SCL=9. UART1: RX=20, TX=21
  #define OLED_SDA 8
  #define OLED_SCL 9
  #define GPS_RX   20  // dihubungkan ke TX GPS
  #define GPS_TX   21  // dihubungkan ke RX GPS
  #define GPS_SERIAL Serial1
#else
  // ESP32 Klasik (WROOM): GPIO 25, 26, 16, 17
  #define OLED_SDA 25
  #define OLED_SCL 26
  #define GPS_RX   16
  #define GPS_TX   17
  #define GPS_SERIAL Serial2
#endif

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
TinyGPSPlus gps;
BlynkTimer timer;

bool oledFound = false;
long duration = 0;
float distance = 999.0;
const char* status = "AMAN";
const char* prevStatus = "AMAN";
float prevDistance = 999.0;
unsigned long lastBlynkSend = 0;

// Melodi alarm untuk status KRITIS (distance <= 5 cm)
int melody[] = {
  1000, 1200, 1500, 1200,
  1000, 1500, 1800, 1500
};

int noteDuration[] = {
  120, 120, 120, 120,
  120, 120, 120, 250
};

int noteIndex = 0;
unsigned long lastNoteTime = 0;
bool playingNote = false;

// Timing non-blocking
unsigned long lastSensorTime = 0;
unsigned long lastOledTime = 0;
unsigned long lastBeepToggle = 0;
unsigned long lastBlynkAttempt = 0;
bool beepActive = false;

const char* getGpsStateString() {
  if (gps.charsProcessed() < 10 && millis() > 5000) {
    return "CEK_KABEL";
  }
  if (gps.location.isValid()) {
    return "VALID";
  }
  return "CARI_SATELIT";
}

// Fungsi pengatur warna RGB LED (Common Cathode: 0 = mati, 255 = maksimal)
void setRgbColor(uint8_t red, uint8_t green, uint8_t blue) {
  analogWrite(RGB_RED_PIN, red);
  analogWrite(RGB_GREEN_PIN, green);
  analogWrite(RGB_BLUE_PIN, blue);
}

// Buffer filter glitch dan penolakan outlier jarak
float lastValidDistance = 17.0;
int consecutiveTimeouts = 0;

float measureSingleDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Timeout 25000 mikrodetik (~4.2 meter, batas fisik HC-SR04)
  long dur = pulseIn(ECHO_PIN, HIGH, 25000);
  if (dur == 0) return -1.0;
  float cm = (float)dur * 0.0343 / 2.0;
  if (cm < 1.0 || cm > 400.0) return -1.0; // Tolak nilai noise tidak realistis
  return cm;
}

float getFilteredDistance() {
  float samples[3];
  int validCount = 0;

  for (int i = 0; i < 3; i++) {
    float s = measureSingleDistance();
    if (s > 0) {
      samples[validCount++] = s;
    }
    if (i < 2) delay(6); // Jeda singkat antar pulsa agar tidak ada interferensi gema
  }

  // Jika setidaknya ada 1 pembacaan valid, gunakan median / nilai valid
  if (validCount > 0) {
    for (int i = 0; i < validCount - 1; i++) {
      for (int j = i + 1; j < validCount; j++) {
        if (samples[i] > samples[j]) {
          float tmp = samples[i];
          samples[i] = samples[j];
          samples[j] = tmp;
        }
      }
    }
    float median = samples[validCount / 2];
    lastValidDistance = median;
    consecutiveTimeouts = 0;
    return median;
  }

  // Jika ketiga sampel gagal bersamaan (pantulan meleset sesaat):
  consecutiveTimeouts++;
  if (consecutiveTimeouts < 5) {
    // Pertahankan jarak valid terakhir agar tidak loncat ke 999 cm
    return lastValidDistance;
  }

  // Jika benar-benar kosong/timeout terus menerus >= 5 kali (> 500 ms)
  return 999.0;
}

void readUltrasonicAndEvaluate() {
  distance = getFilteredDistance();

  if (distance > 12.0) {
    status = "AMAN";
    setRgbColor(0, 255, 0); // HIJAU
    noTone(BUZZER_PIN);
    beepActive = false;
    noteIndex = 0;
    playingNote = false;
  } else if (distance > 9.0) {
    status = "WASPADA";
    setRgbColor(255, 180, 0); // KUNING (Red + Green)
    noteIndex = 0;
    playingNote = false;
  } else if (distance > 5.0) {
    status = "BAHAYA";
    setRgbColor(255, 0, 0); // MERAH
    noteIndex = 0;
    playingNote = false;
  } else {
    status = "KRITIS";
    setRgbColor(255, 0, 0); // MERAH
    beepActive = false;
  }

  Serial.print("Jarak: ");
  Serial.print(distance, 1);
  Serial.print(" cm | Status: ");
  Serial.println(status);

  // Output format telemetry standar untuk Web Serial API / Direct USB (0 ms latency)
  Serial.print("TELEMETRY:{\"distance\":");
  Serial.print(distance, 1);
  Serial.print(",\"status\":\"");
  Serial.print(status);
  Serial.println("\"}");

  // Kirim seketika ke Blynk (hanya V0 & V1 tanpa beban GPS) jika status berubah atau jarak bergeser >= 1.0 cm
  bool statusChanged = (strcmp(status, prevStatus) != 0);
  bool distanceJumped = (fabs(distance - prevDistance) >= 1.0);
  if ((statusChanged || distanceJumped) && (millis() - lastBlynkSend >= 200)) {
    sendFastTelemetryToBlynk();
  }
}

void handleBuzzerNonBlocking() {
  unsigned long now = millis();

  if (strcmp(status, "AMAN") == 0) {
    return;
  }

  if (strcmp(status, "WASPADA") == 0) {
    unsigned long waitMs = beepActive ? 70 : 530;
    if (now - lastBeepToggle >= waitMs) {
      lastBeepToggle = now;
      beepActive = !beepActive;
      if (beepActive) {
        tone(BUZZER_PIN, 2000);
      } else {
        noTone(BUZZER_PIN);
      }
    }
    return;
  }

  if (strcmp(status, "BAHAYA") == 0) {
    int interval = map((long)distance, 5, 9, 80, 350);
    interval = constrain(interval, 80, 350);
    unsigned long waitMs = beepActive ? 70 : (unsigned long)interval;
    if (now - lastBeepToggle >= waitMs) {
      lastBeepToggle = now;
      beepActive = !beepActive;
      if (beepActive) {
        tone(BUZZER_PIN, 2000);
      } else {
        noTone(BUZZER_PIN);
      }
    }
    return;
  }

  // KRITIS: melodi alarm 8 nada
  if (!playingNote) {
    tone(BUZZER_PIN, melody[noteIndex]);
    lastNoteTime = now;
    playingNote = true;
  } else if (now - lastNoteTime >= (unsigned long)noteDuration[noteIndex]) {
    noTone(BUZZER_PIN);
    noteIndex = (noteIndex + 1) % 8;
    playingNote = false;
  }
}

void updateOLED() {
  if (!oledFound) return;
  if (millis() - lastOledTime < 500) return;
  lastOledTime = millis();

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Baris jarak
  display.setTextSize(2);
  display.setCursor(0, 0);
  if (distance >= 999.0) {
    display.print("---");
  } else {
    display.print(distance, 1);
  }
  display.print(" cm");

  // Baris status + indikator koneksi Blynk
  display.setCursor(0, 20);
  display.print(status);

  display.setTextSize(1);
  display.setCursor(92, 22);
  if (Blynk.connected()) {
    display.print("BK:OK");
  } else if (WiFi.status() == WL_CONNECTED) {
    display.print("BK:..");
  } else {
    display.print("WF:--");
  }

  // Baris info GPS
  const char* gpsState = getGpsStateString();
  if (strcmp(gpsState, "CEK_KABEL") == 0) {
    display.setCursor(0, 48);
    display.print("GPS: cek kabel");
  } else if (strcmp(gpsState, "VALID") == 0) {
    display.setCursor(0, 46);
    display.print("La:");
    display.print(gps.location.lat(), 6);
    display.setCursor(0, 56);
    display.print("Lo:");
    display.print(gps.location.lng(), 6);
  } else {
    display.setCursor(0, 48);
    display.print("GPS cari sat: ");
    display.print(gps.satellites.value());
  }

  display.display();
}

void sendFastTelemetryToBlynk() {
  if (!Blynk.connected()) return;
  Blynk.virtualWrite(V0, distance);
  Blynk.virtualWrite(V1, status);
  prevStatus = status;
  prevDistance = distance;
  lastBlynkSend = millis();
}

void sendTelemetryToBlynk() {
  if (!Blynk.connected()) return;

  Blynk.virtualWrite(V0, distance);
  Blynk.virtualWrite(V1, status);
  Blynk.virtualWrite(V2, gps.location.isValid() ? gps.location.lat() : 0.0);
  Blynk.virtualWrite(V3, gps.location.isValid() ? gps.location.lng() : 0.0);
  Blynk.virtualWrite(V4, (int)gps.satellites.value());
  Blynk.virtualWrite(V5, getGpsStateString());

  prevStatus = status;
  prevDistance = distance;
  lastBlynkSend = millis();
}

BLYNK_CONNECTED() {
  Serial.println("Terhubung ke Blynk Cloud!");
  sendTelemetryToBlynk();
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RGB_RED_PIN, OUTPUT);
  pinMode(RGB_GREEN_PIN, OUTPUT);
  pinMode(RGB_BLUE_PIN, OUTPUT);
  setRgbColor(0, 0, 255); // BIRU saat sistem menyala / connecting

  // Beep singkat saat boot sebagai konfirmasi hardware buzzer & board aktif
  tone(BUZZER_PIN, 2000);
  delay(100);
  noTone(BUZZER_PIN);

  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setTimeOut(30);
  oledFound = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (!oledFound) {
    Serial.println("OLED tidak terdeteksi (atau pin berbeda). Sistem sensor & Blynk tetap berjalan.");
  } else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("Sistem Banjir C3");
    display.println("WiFi + Blynk Siap...");
    display.display();
  }

  GPS_SERIAL.setRxBufferSize(1024);
  GPS_SERIAL.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  // Koneksi WiFi & Blynk non-blocking agar sensor tetap berjalan
  Serial.print("Menghubungkan ke WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Blynk.config(BLYNK_AUTH_TOKEN, BLYNK_SERVER_HOST, 80);

  // Kirim telemetry cepat V0 & V1 tiap 350 ms saat online
  timer.setInterval(350L, sendFastTelemetryToBlynk);
  // Kirim telemetry lengkap termasuk GPS tiap 4 detik
  timer.setInterval(4000L, sendTelemetryToBlynk);
}

void loop() {
  while (GPS_SERIAL.available()) {
    gps.encode(GPS_SERIAL.read());
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (Blynk.connected()) {
      Blynk.run();
    } else if (millis() - lastBlynkAttempt >= 8000) {
      lastBlynkAttempt = millis();
      Serial.println("Menghubungkan ke Blynk Cloud...");
      Blynk.connect(4000);
    }
  }
  timer.run();

  if (millis() - lastSensorTime >= 100) {
    lastSensorTime = millis();
    readUltrasonicAndEvaluate();
  }

  handleBuzzerNonBlocking();
  updateOLED();
}
