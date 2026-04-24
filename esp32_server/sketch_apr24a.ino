#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── WIFI ─────────────────────────────
const char* ssid = "CMF2";
const char* password = "ASDFGHJKL";

// ── API ──────────────────────────────
const char* serverURL = "http://10.158.165.208:8000/reading";

// ── PINS ─────────────────────────────
#define MQ135_PIN 34
#define MQ2_PIN   35
#define FAN_PIN   4

// ── SETUP ────────────────────────────
void setup() {
  Serial.begin(115200);

  pinMode(FAN_PIN, OUTPUT);

  analogSetPinAttenuation(MQ135_PIN, ADC_11db);
  analogSetPinAttenuation(MQ2_PIN,   ADC_11db);

  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nConnected!");
}

// ── LOOP ─────────────────────────────
void loop() {

  // ── READ RAW SENSOR VALUES ─────────
  int mq135_raw = analogRead(MQ135_PIN);
  int mq2_raw   = analogRead(MQ2_PIN);

  // ── SIMPLE SCALING (for backend) ───
  float co2   = map(mq135_raw, 0, 4095, 0, 1000);
  float nh3   = map(mq135_raw, 0, 4095, 0, 200);
  float smoke = map(mq2_raw,   0, 4095, 0, 500);
  float lpg   = map(mq2_raw,   0, 4095, 0, 1000);

  Serial.println("Sending Data...");
  Serial.print("CO2: "); Serial.println(co2);

  // ── SEND TO API ────────────────────
  if (WiFi.status() == WL_CONNECTED) {

    HTTPClient http;
    http.begin(serverURL);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<200> doc;

    doc["co2"]   = co2;
    doc["nh3"]   = nh3;
    doc["smoke"] = smoke;
    doc["lpg"]   = lpg;

    String requestBody;
    serializeJson(doc, requestBody);

    int httpResponseCode = http.POST(requestBody);

    // ── HANDLE RESPONSE ──────────────
    if (httpResponseCode == 200) {

      String response = http.getString();
      Serial.println("Response: " + response);

      StaticJsonDocument<100> res;
      deserializeJson(res, response);

      int fan = res["fan"];

      // ── FAN CONTROL ────────────────
      if (fan == 1) {
        digitalWrite(FAN_PIN, HIGH);
        Serial.println("FAN ON");
      } else {
        digitalWrite(FAN_PIN, LOW);
        Serial.println("FAN OFF");
      }

    } else {
      Serial.print("Error: ");
      Serial.println(httpResponseCode);
    }

    http.end();
  }

  delay(5000); // send every 5 seconds
}