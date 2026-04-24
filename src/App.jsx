import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db, limitToLast, onValue, query, ref } from "./firebase";

const THRESHOLD = 500;

const EMPTY_LATEST = {
  timestamp: 0,
  sensors: {
    co2: 0,
    nh3: 0,
    smoke: 0,
    lpg: 0,
  },
  predictions: {
    co2: 0,
    lpg: 0,
    smoke: 0,
  },
  time_to_danger: 0,
  fan: 0,
};

function formatTime(timestamp) {
  if (!timestamp) return "--:--:--";
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildEvents(latest) {
  const sensors = latest?.sensors ?? {};
  const predictions = latest?.predictions ?? {};
  const rows = [
    { label: "CO2", actual: sensors.co2 ?? 0, predicted: predictions.co2 ?? 0, threshold: 500 },
    { label: "LPG", actual: sensors.lpg ?? 0, predicted: predictions.lpg ?? 0, threshold: 1000 },
    { label: "Smoke", actual: sensors.smoke ?? 0, predicted: predictions.smoke ?? 0, threshold: 300 },
    { label: "NH3", actual: sensors.nh3 ?? 0, predicted: sensors.nh3 ?? 0, threshold: 100 },
  ];

  return rows
    .map((row) => {
      const ratio = Math.max(row.actual, row.predicted) / row.threshold;
      let sev = "SAFE";
      let color = "#00C9A7";

      if (ratio >= 1) {
        sev = "DANGER";
        color = "#EF4444";
      } else if (ratio >= 0.75) {
        sev = "WARNING";
        color = "#F59E0B";
      }

      return {
        time: formatTime(latest?.timestamp),
        type: `${row.label} ${sev === "SAFE" ? "Stable" : "Rise"}`,
        conf: Math.min(99, Math.max(60, Math.round(ratio * 100))),
        sev,
        color,
      };
    })
    .sort((a, b) => {
      const rank = { DANGER: 3, WARNING: 2, SAFE: 1 };
      return rank[b.sev] - rank[a.sev];
    });
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: "rgba(10,22,40,0.96)",
        border: "1px solid #00C9A7",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 12,
      }}
    >
      <div style={{ color: "#94A3B8", marginBottom: 4 }}>{label}</div>
      {payload.map((point) => (
        <div key={point.dataKey} style={{ color: point.color, fontWeight: 600 }}>
          {point.name}: {point.value} PPM
        </div>
      ))}
    </div>
  );
};

function RingGauge({ value, max = 1000, label }) {
  const pct = Math.min(value / max, 1);
  const r = 52;
  const cx = 64;
  const cy = 64;
  const circumference = 2 * Math.PI * r;
  const dash = pct * circumference * 0.75;
  const rotation = -225;
  const riskColor = value > max * 0.7 ? "#EF4444" : value > max * 0.4 ? "#F59E0B" : "#00C9A7";

  return (
    <div style={{ position: "relative", width: 128, height: 128 }}>
      <svg width={128} height={128} style={{ transform: `rotate(${rotation}deg)` }}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#1E3A5F"
          strokeWidth={10}
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeLinecap="round"
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={riskColor}
          strokeWidth={10}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          style={{
            transition: "stroke-dasharray 0.8s ease, stroke 0.5s ease",
            filter: `drop-shadow(0 0 8px ${riskColor}88)`,
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: riskColor,
            fontFamily: "'DM Mono', monospace",
            textShadow: `0 0 12px ${riskColor}66`,
          }}
        >
          {Math.round(value)}
        </span>
        <span style={{ fontSize: 9, color: "#64748B", letterSpacing: 2, marginTop: 1 }}>PPM</span>
        <span style={{ fontSize: 8, color: "#94A3B8", marginTop: 2 }}>{label}</span>
      </div>
    </div>
  );
}

function FanViz({ speed }) {
  const angle = useRef(0);
  const [rot, setRot] = useState(0);

  useEffect(() => {
    let frame;

    const animate = () => {
      angle.current += speed / 18;
      setRot(angle.current % 360);
      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [speed]);

  const blades = [0, 72, 144, 216, 288];

  return (
    <svg
      width={80}
      height={80}
      viewBox="0 0 80 80"
      style={{
        transform: `rotate(${rot}deg)`,
        filter: speed > 0 ? "drop-shadow(0 0 8px #00C9A788)" : "none",
        transition: "filter 0.5s",
      }}
    >
      {blades.map((deg) => (
        <ellipse
          key={deg}
          cx={40}
          cy={22}
          rx={8}
          ry={18}
          fill="#00C9A7"
          opacity={0.85}
          transform={`rotate(${deg} 40 40)`}
        />
      ))}
      <circle cx={40} cy={40} r={7} fill="#0D1B2A" stroke="#00C9A7" strokeWidth={2} />
    </svg>
  );
}

function Countdown({ seconds }) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  const urgent = safeSeconds > 0 && safeSeconds < 120;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 3, marginBottom: 4 }}>TIME TO DANGER</div>
      <div
        style={{
          fontSize: 38,
          fontWeight: 900,
          fontFamily: "'DM Mono', monospace",
          color: urgent ? "#EF4444" : "#F59E0B",
          textShadow: `0 0 20px ${urgent ? "#EF444466" : "#F59E0B66"}`,
          animation: urgent ? "pulse 1s ease-in-out infinite" : "none",
        }}
      >
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </div>
      <div style={{ fontSize: 9, color: urgent ? "#EF4444" : "#F59E0B", letterSpacing: 1, marginTop: 2 }}>
        {safeSeconds === 0 ? "NO ACTIVE ALERT" : urgent ? "IMMINENT DANGER" : "PREDICTED ETA"}
      </div>
    </div>
  );
}

export default function FumeGuardDashboard() {
  const [latest, setLatest] = useState(EMPTY_LATEST);
  const [data, setData] = useState([]);

  useEffect(() => {
    const latestRef = ref(db, "/latest");
    const historyRef = query(ref(db, "/history"), limitToLast(30));

    const unsubscribeLatest = onValue(latestRef, (snapshot) => {
      const value = snapshot.val();

      if (!value) {
        setLatest(EMPTY_LATEST);
        return;
      }

      setLatest({
        ...EMPTY_LATEST,
        ...value,
        sensors: { ...EMPTY_LATEST.sensors, ...(value.sensors ?? {}) },
        predictions: { ...EMPTY_LATEST.predictions, ...(value.predictions ?? {}) },
        time_to_danger: value.time_to_danger ?? 0,
      });
    });

    const unsubscribeHistory = onValue(historyRef, (snapshot) => {
      const raw = snapshot.val();

      if (!raw) {
        setData([]);
        return;
      }

      const rows = Object.values(raw)
        .filter(Boolean)
        .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
        .map((row) => ({
          time: formatTime(row?.timestamp),
          actual: Number(row?.sensors?.co2 ?? 0),
          predicted: Number(row?.predictions?.co2 ?? 0),
        }));

      setData(rows);
    });

    return () => {
      unsubscribeLatest();
      unsubscribeHistory();
    };
  }, []);

  const actual = Number(latest.sensors.co2 ?? 0);
  const predicted = Number(latest.predictions.co2 ?? 0);
  const gasEvents = buildEvents(latest);
  const fanSpeed = latest.fan ? 100 : 0;
  const countdown = latest.time_to_danger ?? 0;
  const riskLevel = actual > 700 ? "DANGER" : actual > 400 ? "WARNING" : "SAFE";
  const riskColor = actual > 700 ? "#EF4444" : actual > 400 ? "#F59E0B" : "#00C9A7";
  const lastUpdate = formatTime(latest.timestamp);

  return (
    <div
      style={{
        background: "#070F1A",
        minHeight: "100vh",
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
        color: "#E2E8F0",
        padding: 0,
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes glow { 0%,100%{box-shadow:0 0 8px #00C9A744} 50%{box-shadow:0 0 20px #00C9A788} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0D1B2A; }
        ::-webkit-scrollbar-thumb { background: #00C9A7; border-radius: 2px; }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 50,
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,201,167,0.015) 2px, rgba(0,201,167,0.015) 4px)",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          background: "linear-gradient(90deg, #0A1628 0%, #0D1F3C 50%, #0A1628 100%)",
          borderBottom: "1px solid #1E3A5F",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: "linear-gradient(180deg, #00C9A7, #0EA5E9)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "linear-gradient(135deg, #00C9A7, #0EA5E9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              boxShadow: "0 0 16px #00C9A744",
            }}
          >
            F
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.5, color: "#fff" }}>
              FumeGuard <span style={{ color: "#00C9A7" }}>AI</span>
            </div>
            <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 3 }}>PROACTIVE AIR QUALITY SYSTEM</div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: `${riskColor}14`,
            border: `1px solid ${riskColor}44`,
            borderRadius: 20,
            padding: "6px 16px",
            boxShadow: `0 0 16px ${riskColor}22`,
            animation: riskLevel === "DANGER" ? "glow 1s ease-in-out infinite" : "none",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: riskColor,
              boxShadow: `0 0 8px ${riskColor}`,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, color: riskColor, letterSpacing: 2 }}>{riskLevel}</span>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#00C9A7" }}>MaverickTech</div>
          <div style={{ fontSize: 9, color: "#64748B", fontFamily: "'DM Mono', monospace" }}>
            {lastUpdate} · FIREBASE
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr 220px",
          gridTemplateRows: "auto auto",
          gap: 0,
          height: "calc(100vh - 61px)",
        }}
      >
        <div
          style={{
            background: "linear-gradient(180deg, #0A1628 0%, #08121E 100%)",
            borderRight: "1px solid #1E3A5F",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              background: "#0D1B2A",
              borderRadius: 12,
              padding: "14px 10px",
              border: "1px solid #1E3A5F",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 2, marginBottom: 8 }}>MQ-135 SENSOR</div>
            <RingGauge value={latest.sensors.co2} max={1000} label="CO2 / NH3" />
            <div style={{ marginTop: 8, width: "100%" }}>
              {[
                ["CO2", latest.sensors.co2, 1000, "#00C9A7"],
                ["NH3", latest.sensors.nh3, 100, "#0EA5E9"],
              ].map(([gas, value, max, color]) => (
                <div key={gas} style={{ marginBottom: 5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 9,
                      color: "#64748B",
                      marginBottom: 2,
                    }}
                  >
                    <span>{gas}</span>
                    <span style={{ color, fontFamily: "'DM Mono'" }}>{Math.round(value)} ppm</span>
                  </div>
                  <div style={{ height: 3, background: "#1E3A5F", borderRadius: 2 }}>
                    <div
                      style={{
                        height: 3,
                        width: `${Math.min((value / max) * 100, 100)}%`,
                        background: `linear-gradient(90deg, ${color}, #0EA5E9)`,
                        borderRadius: 2,
                        transition: "width 0.8s ease",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              background: "#0D1B2A",
              borderRadius: 12,
              padding: "14px 10px",
              border: "1px solid #1E3A5F",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 2, marginBottom: 8 }}>MQ-2 SENSOR</div>
            <RingGauge value={latest.sensors.lpg} max={1000} label="LPG / Smoke" />
            <div style={{ marginTop: 8, width: "100%" }}>
              {[
                ["LPG", latest.sensors.lpg, 1000, "#F59E0B"],
                ["Smoke", latest.sensors.smoke, 500, "#EF4444"],
              ].map(([gas, value, max, color]) => (
                <div key={gas} style={{ marginBottom: 5 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 9,
                      color: "#64748B",
                      marginBottom: 2,
                    }}
                  >
                    <span>{gas}</span>
                    <span style={{ color, fontFamily: "'DM Mono'" }}>{Math.round(value)} ppm</span>
                  </div>
                  <div style={{ height: 3, background: "#1E3A5F", borderRadius: 2 }}>
                    <div
                      style={{
                        height: 3,
                        width: `${Math.min((value / max) * 100, 100)}%`,
                        background: `linear-gradient(90deg, ${color}, #EF4444)`,
                        borderRadius: 2,
                        transition: "width 0.8s ease",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "#0D1B2A", borderRadius: 12, padding: "12px", border: "1px solid #1E3A5F" }}>
            <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 2, marginBottom: 8 }}>LIVE SNAPSHOT</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                ["CO2", latest.sensors.co2],
                ["NH3", latest.sensors.nh3],
                ["Smoke", latest.sensors.smoke],
                ["LPG", latest.sensors.lpg],
              ].map(([label, value]) => (
                <div key={label} style={{ background: "#08121E", borderRadius: 8, padding: "10px 8px" }}>
                  <div style={{ fontSize: 8, color: "#64748B", letterSpacing: 1 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#E2E8F0", fontFamily: "'DM Mono'" }}>
                    {Math.round(value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", background: "#070F1A", borderRight: "1px solid #1E3A5F" }}>
          <div style={{ flex: 1, padding: "16px 20px 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>CO2 Trend - Actual vs Predicted</div>
                <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>
                  Reads `/history` from Firebase using `sensors.co2` and `predictions.co2`
                </div>
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                {[
                  ["#00C9A7", "Actual PPM"],
                  ["#F59E0B", "Predicted PPM"],
                  ["#EF4444", "Danger Threshold"],
                ].map(([color, label]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, color: "#94A3B8" }}>
                    <div style={{ width: 20, height: 2, background: color, borderRadius: 1 }} />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00C9A7" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#00C9A7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" strokeOpacity={0.6} />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#64748B", fontSize: 9 }}
                  tickLine={false}
                  axisLine={{ stroke: "#1E3A5F" }}
                  interval={4}
                />
                <YAxis tick={{ fill: "#64748B", fontSize: 9 }} tickLine={false} axisLine={false} domain={[0, 1000]} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine
                  y={THRESHOLD}
                  stroke="#EF4444"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{ value: "DANGER 500ppm", position: "insideTopRight", fill: "#EF4444", fontSize: 9 }}
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke="#00C9A7"
                  strokeWidth={2.5}
                  fill="url(#actualGrad)"
                  dot={false}
                  style={{ filter: "drop-shadow(0 0 4px #00C9A788)" }}
                />
                <Area
                  type="monotone"
                  dataKey="predicted"
                  name="Predicted"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  fill="url(#predGrad)"
                  dot={false}
                  style={{ filter: "drop-shadow(0 0 4px #F59E0B66)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              borderTop: "1px solid #1E3A5F",
              background: "#0A1628",
            }}
          >
            {[
              { label: "CURRENT CO2", value: actual, unit: "ppm", color: "#00C9A7" },
              { label: "PREDICTED CO2", value: predicted, unit: "ppm", color: "#F59E0B" },
              { label: "ABOVE THRESHOLD", value: Math.max(predicted - THRESHOLD, 0), unit: "ppm", color: "#EF4444" },
              { label: "DATA POINTS", value: data.length, unit: "readings", color: "#A78BFA" },
            ].map((item, index) => (
              <div key={item.label} style={{ padding: "12px 16px", borderRight: index < 3 ? "1px solid #1E3A5F" : "none" }}>
                <div style={{ fontSize: 8, color: "#64748B", letterSpacing: 2, marginBottom: 4 }}>{item.label}</div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: item.color,
                    fontFamily: "'DM Mono', monospace",
                    textShadow: `0 0 12px ${item.color}44`,
                  }}
                >
                  {Math.round(item.value)}
                </div>
                <div style={{ fontSize: 8, color: "#475569" }}>{item.unit}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(180deg, #0A1628 0%, #08121E 100%)",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              background: "#0D1B2A",
              borderRadius: 12,
              padding: "16px 10px",
              border: `1px solid ${countdown > 0 && countdown < 120 ? "#EF444444" : "#F59E0B44"}`,
              boxShadow: countdown > 0 && countdown < 120 ? "0 0 20px #EF444422" : "0 0 12px #F59E0B11",
            }}
          >
            <Countdown seconds={countdown} />
          </div>

          <div style={{ background: "#0D1B2A", borderRadius: 12, padding: "14px 10px", border: "1px solid #1E3A5F" }}>
            <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 2, marginBottom: 10, textAlign: "center" }}>FAN CONTROL</div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <FanViz speed={fanSpeed} />
              <div style={{ fontSize: 9, color: "#64748B" }}>Current fan state</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#00C9A7", fontFamily: "'DM Mono'" }}>
                {fanSpeed}%
              </div>
              <div style={{ width: "100%", height: 6, background: "#1E3A5F", borderRadius: 3 }}>
                <div
                  style={{
                    height: 6,
                    width: `${fanSpeed}%`,
                    background: "linear-gradient(90deg, #00C9A7, #0EA5E9)",
                    borderRadius: 3,
                    transition: "width 0.5s ease",
                    boxShadow: "0 0 8px #00C9A766",
                  }}
                />
              </div>
              <div style={{ fontSize: 9, color: "#00C9A7" }}>{latest.fan ? "ON" : "OFF"}</div>
              <div style={{ fontSize: 8, color: "#475569", textAlign: "center" }}>Driven directly by Firebase `fan`</div>
            </div>
          </div>

          <div style={{ background: "#0D1B2A", borderRadius: 12, padding: "12px", border: "1px solid #1E3A5F" }}>
            <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 2, marginBottom: 10 }}>PREDICTION SNAPSHOT</div>
            {[
              ["CO2", latest.predictions.co2],
              ["LPG", latest.predictions.lpg],
              ["Smoke", latest.predictions.smoke],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: label !== "Smoke" ? "1px solid #1E3A5F" : "none",
                }}
              >
                <span style={{ fontSize: 10, color: "#94A3B8" }}>{label}</span>
                <span style={{ fontSize: 14, color: "#F59E0B", fontWeight: 700, fontFamily: "'DM Mono'" }}>
                  {Math.round(value)} ppm
                </span>
              </div>
            ))}
          </div>

          <div style={{ background: "#0D1B2A", borderRadius: 12, padding: "12px", border: "1px solid #1E3A5F", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#64748B", letterSpacing: 2 }}>EVENT LOG</div>
              <div style={{ fontSize: 8, color: "#00C9A7" }}>Live</div>
            </div>
            {gasEvents.map((event, index) => (
              <div
                key={`${event.type}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: index < gasEvents.length - 1 ? "1px solid #1E3A5F" : "none",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: event.color,
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${event.color}`,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: "#E2E8F0",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {event.type}
                  </div>
                  <div style={{ fontSize: 8, color: "#475569" }}>{event.time} · {event.conf}% conf</div>
                </div>
                <div
                  style={{
                    fontSize: 7,
                    color: event.color,
                    background: `${event.color}18`,
                    borderRadius: 3,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  {event.sev}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
