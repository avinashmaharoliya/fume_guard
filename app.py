from fastapi import FastAPI
from pydantic import BaseModel
from collections import deque
import numpy as np
import os
import threading
import time

# ── Firebase ─────────────────────────────
import firebase_admin
from firebase_admin import credentials, db

try:
    from twilio.rest import Client as TwilioClient
except ImportError:
    TwilioClient = None

cred = credentials.Certificate("firebase_api.json")  # your key file
firebase_admin.initialize_app(cred, {
    "databaseURL": "https://fumeguard-ai-default-rtdb.asia-southeast1.firebasedatabase.app"
})

# ── FastAPI ──────────────────────────────
app = FastAPI()

ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "300"))
_alert_lock = threading.Lock()
_last_alert = {
    "sent_at": 0,
    "severity": None,
}

# ── Data Model ───────────────────────────
class SensorData(BaseModel):
    co2: float
    nh3: float
    smoke: float
    lpg: float

# ── History (Moving Window) ──────────────
co2_history   = deque(maxlen=20)
lpg_history   = deque(maxlen=20)
smoke_history = deque(maxlen=20)

# ── Thresholds ───────────────────────────
DANGER = {
    "co2": 500,
    "lpg": 1000,
    "smoke": 300
}

# ── Prediction Function ──────────────────
def predict(history, steps=10):
    if len(history) < 5:
        return history[-1] if history else 0

    x = np.arange(len(history))
    y = np.array(history)

    m, b = np.polyfit(x, y, 1)
    future = m * (len(history) + steps) + b

    return max(0, round(future))

# ── Time to Danger ───────────────────────
def time_to_danger(current, history, threshold):
    if len(history) < 5:
        return None
    if current < threshold * 0.6:
        return None
    
    x = np.arange(len(history))
    y = np.array(history)

    m, _ = np.polyfit(x, y, 1)

    if m <= 0:
        return None

    steps = (threshold - current) / m

    if steps < 0:
        return 0

    return int(steps * 5)

# ── Fan Decision ─────────────────────────
def decide_fan(pred_co2, pred_lpg):
    if pred_co2 > DANGER["co2"] or pred_lpg > DANGER["lpg"]:
        return 1
    return 0


def get_alert_severity(seconds_to_danger):
    if seconds_to_danger <= 0:
        return None
    if seconds_to_danger <= 60:
        return "CRITICAL"
    if seconds_to_danger <= 300:
        return "WARNING"
    return "WATCH"


def send_whatsapp_alert(payload, severity):
    enabled = os.getenv("WHATSAPP_ALERTS_ENABLED", "false").lower() == "true"
    if not enabled or TwilioClient is None:
        return

    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_WHATSAPP_FROM")
    to_number = os.getenv("ALERT_WHATSAPP_TO")

    if not all([account_sid, auth_token, from_number, to_number]):
        return

    sensors = payload["sensors"]
    predictions = payload["predictions"]

    message_body = (
        f"FumeGuard alert: {severity}\n"
        f"Time to danger: {payload['time_to_danger']}s\n"
        f"Fan: {'ON' if payload['fan'] else 'OFF'}\n"
        f"Current - CO2: {sensors['co2']}, NH3: {sensors['nh3']}, Smoke: {sensors['smoke']}, LPG: {sensors['lpg']}\n"
        f"Predicted - CO2: {predictions['co2']}, Smoke: {predictions['smoke']}, LPG: {predictions['lpg']}"
    )

    try:
        client = TwilioClient(account_sid, auth_token)
        client.messages.create(
            from_=from_number,
            to=to_number,
            body=message_body,
        )
    except Exception as exc:
        print(f"WhatsApp alert failed: {exc}")


def maybe_send_whatsapp_alert(payload):
    seconds_to_danger = payload["time_to_danger"]
    severity = get_alert_severity(seconds_to_danger)
    if severity is None:
        return

    now = int(time.time())

    with _alert_lock:
        should_send = (
            _last_alert["severity"] != severity
            or now - _last_alert["sent_at"] >= ALERT_COOLDOWN_SECONDS
        )
        if not should_send:
            return

        _last_alert["sent_at"] = now
        _last_alert["severity"] = severity

    threading.Thread(
        target=send_whatsapp_alert,
        args=(payload, severity),
        daemon=True,
    ).start()

# ── MAIN API ─────────────────────────────
@app.post("/reading")
def receive_data(data: SensorData):

    # 1. Update history
    co2_history.append(data.co2)
    lpg_history.append(data.lpg)
    smoke_history.append(data.smoke)

    # 2. Predict
    pred_co2   = predict(co2_history)
    pred_lpg   = predict(lpg_history)
    pred_smoke = predict(smoke_history)

    # 3. Time to danger
    ttd_co2   = time_to_danger(data.co2, co2_history, DANGER["co2"])
    ttd_lpg   = time_to_danger(data.lpg, lpg_history, DANGER["lpg"])
    ttd_smoke = time_to_danger(data.smoke, smoke_history, DANGER["smoke"])

    ttd_values = [t for t in [ttd_co2, ttd_lpg, ttd_smoke] if t is not None]
    seconds_to_danger = min(ttd_values) if ttd_values else 0

    # 4. Decide fan
    fan = decide_fan(pred_co2, pred_lpg)

    # 5. Save to Firebase
    payload = {
        "timestamp": int(time.time()),
        "sensors": {
            "co2": data.co2,
            "nh3": data.nh3,
            "smoke": data.smoke,
            "lpg": data.lpg
        },
        "predictions": {
            "co2": pred_co2,
            "lpg": pred_lpg,
            "smoke": pred_smoke
        },
        "time_to_danger": seconds_to_danger,
        "fan": fan
    }

    db.reference("/latest").set(payload)
    db.reference("/history").push(payload)
    maybe_send_whatsapp_alert(payload)

    # 6. Return ONLY fan signal to ESP32
    return {
        "fan": fan
    }

# ── Health Check ─────────────────────────
@app.get("/")
def home():
    return {"status": "Backend Running"}
