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

// ===== Konfigurasi Pin Terbaru (sama persis dengan test_ledaa_oled_gps.ino) =====
#define TRIG_PIN 5
#define ECHO_PIN 18
#define BUZZER_PIN 21

#define LED_RED 32
#define LED_YELLOW 33
#define LED_GREEN 27

// OLED I2C (pin custom karena GPIO 21 & 22 dipakai buzzer & LED)
#define OLED_SDA 25
#define OLED_SCL 26
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDRESS 0x3C

// GPS (UART2 ESP32)
#define GPS_RX 16  // dihubungkan ke TX GPS
#define GPS_TX 17   // dihubungkan ke RX GPS

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
TinyGPSPlus gps;
BlynkTimer timer;

long duration = 0;
float distance = 999.0;
const char* status = "AMAN";

// Melodi alarm untuk status KRITIS (distance <= 3 cm)
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

void readUltrasonicAndEvaluate() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) {
    distance = 999.0;
  } else {
    distance = duration * 0.0343 / 2.0;
  }

  Serial.print("Jarak: ");
  Serial.print(distance);
  Serial.println(" cm");

  if (distance > 10.0) {
    status = "AMAN";
    digitalWrite(LED_GREEN, HIGH);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED, LOW);
    noTone(BUZZER_PIN);
    beepActive = false;
    noteIndex = 0;
    playingNote = false;
  } else if (distance > 7.0) {
    status = "WASPADA";
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_YELLOW, HIGH);
    digitalWrite(LED_RED, LOW);
    noteIndex = 0;
    playingNote = false;
  } else if (distance > 3.0) {
    status = "BAHAYA";
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED, HIGH);
    noteIndex = 0;
    playingNote = false;
  } else {
    status = "KRITIS";
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED, HIGH);
    beepActive = false;
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
    int interval = map((long)distance, 3, 7, 80, 350);
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

void sendTelemetryToBlynk() {
  if (!Blynk.connected()) return;

  Blynk.virtualWrite(V0, distance);
  Blynk.virtualWrite(V1, status);
  Blynk.virtualWrite(V2, gps.location.isValid() ? gps.location.lat() : 0.0);
  Blynk.virtualWrite(V3, gps.location.isValid() ? gps.location.lng() : 0.0);
  Blynk.virtualWrite(V4, (int)gps.satellites.value());
  Blynk.virtualWrite(V5, getGpsStateString());
}

BLYNK_CONNECTED() {
  Serial.println("Terhubung ke Blynk Cloud!");
  sendTelemetryToBlynk();
}

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);

  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(400000);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("OLED tidak ditemukan, cek kabel / alamat");
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Sistem Banjir");
  display.println("WiFi + Blynk Siap...");
  display.display();

  Serial2.setRxBufferSize(1024);
  Serial2.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  // Koneksi WiFi & Blynk non-blocking agar sensor tetap berjalan
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Blynk.config(BLYNK_AUTH_TOKEN, BLYNK_SERVER_HOST, 80);

  // Kirim telemetry ke Blynk setiap 1 detik saat online
  timer.setInterval(1000L, sendTelemetryToBlynk);
}

void loop() {
  while (Serial2.available()) {
    gps.encode(Serial2.read());
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (Blynk.connected()) {
      Blynk.run();
    } else if (millis() - lastBlynkAttempt >= 10000) {
      lastBlynkAttempt = millis();
      Serial.println("Menghubungkan ke Blynk Cloud...");
      Blynk.connect(1500);
    }
  }
  timer.run();

  if (millis() - lastSensorTime >= 150) {
    lastSensorTime = millis();
    readUltrasonicAndEvaluate();
  }

  handleBuzzerNonBlocking();
  updateOLED();
}
