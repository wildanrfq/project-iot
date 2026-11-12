#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <TinyGPSPlus.h>   // versi library terbaru

// ===== Pin lama (tidak diubah) =====
#define TRIG_PIN 5
#define ECHO_PIN 18
#define BUZZER_PIN 21

#define LED_RED 22
#define LED_YELLOW 23
#define LED_GREEN 19

// ===== Pin baru =====
// OLED I2C (pakai pin custom karena GPIO 21 & 22 sudah dipakai buzzer & LED)
#define OLED_SDA 25
#define OLED_SCL 26

// GPS (UART2 ESP32)
#define GPS_RX 15   // dihubungkan ke TX GPS
#define GPS_TX 34   // dihubungkan ke RX GPS

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDRESS 0x3C   // kalau tidak nyala, coba 0x3D

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
TinyGPSPlus gps;

long duration;
float distance;
const char* status = "AMAN";

// Nada untuk melodi alarm
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

// Untuk update OLED
unsigned long lastOledTime = 0;

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(LED_RED, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);

  // OLED
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(400000);  // I2C lebih cepat supaya layar tidak mengganggu buzzer
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("OLED tidak ditemukan, cek kabel / alamat");
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Sistem Banjir");
  display.println("Memulai...");
  display.display();

  // GPS (buffer diperbesar supaya data tidak hilang saat delay)
  Serial2.setRxBufferSize(1024);
  Serial2.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
}

void updateOLED() {
  // Update tiap 500 ms saja
  if (millis() - lastOledTime < 500) return;
  lastOledTime = millis();

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Jarak (huruf besar)
  display.setTextSize(2);
  display.setCursor(0, 0);
  if (distance >= 999) {
    display.print("---");
  } else {
    display.print(distance, 1);
  }
  display.print(" cm");

  // Status (huruf besar)
  display.setCursor(0, 20);
  display.print(status);

  // Info GPS (huruf kecil)
  display.setTextSize(1);
  if (gps.charsProcessed() < 10 && millis() > 5000) {
    display.setCursor(0, 48);
    display.print("GPS: cek kabel");
  } else if (gps.location.isValid()) {
    display.setCursor(0, 46);
    display.print("La:");
    display.print(gps.location.lat(), 6);
    display.setCursor(0, 56);
    display.print("Lo:");
    display.print(gps.location.lng(), 6);

    Serial.print("Lokasi: ");
    Serial.print(gps.location.lat(), 6);
    Serial.print(", ");
    Serial.println(gps.location.lng(), 6);
  } else {
    display.setCursor(0, 48);
    display.print("GPS cari sat: ");
    display.print(gps.satellites.value());
  }

  display.display();
}

void loop() {
  // Baca data GPS yang masuk
  while (Serial2.available()) {
    gps.encode(Serial2.read());
  }

  // Membaca sensor ultrasonik
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    distance = 999;
  } else {
    distance = duration * 0.0343 / 2;
  }

  Serial.print("Jarak: ");
  Serial.print(distance);
  Serial.println(" cm");

  // Kondisi aman
  if (distance > 10) {
    status = "AMAN";
    digitalWrite(LED_GREEN, HIGH);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED, LOW);

    noTone(BUZZER_PIN);

    noteIndex = 0;
    playingNote = false;
    updateOLED();
    delay(100);
  }

  // Kondisi waspada
  else if (distance > 7) {
    status = "WASPADA";
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_YELLOW, HIGH);
    digitalWrite(LED_RED, LOW);

    updateOLED();
    tone(BUZZER_PIN, 2000);
    delay(70);
    noTone(BUZZER_PIN);
    delay(530);
  }

  // Kondisi bahaya
  else if (distance > 3) {
    status = "BAHAYA";
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED, HIGH);

    int interval = map(distance, 3, 7, 80, 350);
    interval = constrain(interval, 80, 350);

    updateOLED();
    tone(BUZZER_PIN, 2000);
    delay(70);
    noTone(BUZZER_PIN);
    delay(interval);
  }

  // Kondisi sangat dekat: memainkan melodi
  else {
    status = "KRITIS";
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_RED, HIGH);

    updateOLED();

    unsigned long currentTime = millis();

    if (!playingNote) {
      tone(BUZZER_PIN, melody[noteIndex]);
      lastNoteTime = currentTime;
      playingNote = true;
    }

    if (playingNote &&
        currentTime - lastNoteTime >= noteDuration[noteIndex]) {

      noTone(BUZZER_PIN);

      noteIndex++;

      if (noteIndex >= 8) {
        noteIndex = 0;
      }

      playingNote = false;
    }
  }
}
