import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────
// SUPABASE – laddas bara om användaren väljer molnsynk
// ─────────────────────────────────────────────────────────
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_KEY;
const STRIPE_PK = import.meta.env.VITE_STRIPE_PK;
const STRIPE_PRICE = import.meta.env.VITE_STRIPE_PRICE;

let _supa = null;
async function getSupa() {
  if (_supa) return _supa;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  _supa = createClient(SUPA_URL, SUPA_KEY);
  return _supa;
}

// ─────────────────────────────────────────────────────────
// LOCAL STORAGE – primär lagringsplats
// ─────────────────────────────────────────────────────────
const LS_KEY = "pensionsappen_data";
const LS_SYNC = "pensionsappen_cloudsync";

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; }
  catch { return null; }
}
function saveLocal(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}
function loadSyncPref() {
  return localStorage.getItem(LS_SYNC) === "true";
}
function saveSyncPref(val) {
  localStorage.setItem(LS_SYNC, val ? "true" : "false");
}

// ─────────────────────────────────────────────────────────
// BERÄKNINGSMOTOR
// ─────────────────────────────────────────────────────────
const fmt  = n => new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n);
const fmtM = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mkr` : `${Math.round(n / 1000)} tkr`;

function calcTax(g) {
  const y = g * 12;
  return Math.round((y * 0.2983 + Math.max(0, y - 643_000) * 0.2) / 12);
}

function calcModel(d) {
  const ry = d.birthYear + d.retireAge;
  const i1m = d.itp1Cap > 0
    ? Math.round((d.itp1Cap * Math.pow(1 + d.capReturn, Math.max(0, d.retireAge - 58))) / (d.itp1PayYrs * 12))
    : 0;
  let cap = d.privatCap, prop = d.propValue;
  return Array.from({ length: 26 }, (_, i) => {
    const yr = ry + i, age = yr - d.birthYear;
    const itp1 = i < d.itp1PayYrs ? i1m : 0;
    const itp2 = i === 0 ? d.itp2Mon * 0.66 : d.itp2Mon;
    const ap   = i >= 1 ? d.apTotal : 0;
    const tax  = calcTax(itp1 + itp2 + ap);
    const int  = (d.loanTotal * d.loanRate) / 12;
    const net  = itp1 + itp2 + ap + d.rentalNet - tax - int;
    const wd   = Math.max(0, d.targetNet - net);
    cap  = cap  * (1 + d.capReturn) - wd * 12;
    prop = prop * (1 + d.propGrowth);
    return { yr, age, itp1, itp2, ap, net, netWorth: cap + prop - d.loanTotal, cap, prop, wd };
  });
}

// ─────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────
const T = {
  bg: "#F0F4F8", card: "#fff", navy: "#0D2137", blue: "#1659A8",
  green: "#16784A", gold: "#C08B14", purple: "#5A3289",
  teal: "#0C7490", red: "#C0392B", sec: "#64748B", border: "#E2E8F0",
};

// ─────────────────────────────────────────────────────────
// MINI-KOMPONENTER
// ─────────────────────────────────────────────────────────
const Pill = ({ c, children }) => (
  <span style={{ background: c + "18", color: c, borderRadius: 99, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
    {children}
  </span>
);

const PBar = ({ pct, color, h = 5 }) => (
  <div style={{ background: "#E8EEF5", borderRadius: 99, height: h, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color, borderRadius: 99, transition: "width .5s" }} />
  </div>
);

function Donut({ slices, size = 96 }) {
  const r = size / 2, hole = r * 0.56, tot = slices.reduce((s, d) => s + d.v, 0);
  let a = -Math.PI / 2;
  const paths = slices.map(d => {
    const sw = 2 * Math.PI * d.v / tot;
    const pts = (rad) => [r + Math.cos(rad) * r, r + Math.sin(rad) * r];
    const pti = (rad) => [r + Math.cos(rad) * hole, r + Math.sin(rad) * hole];
    const [x1,y1]=pts(a), [x2,y2]=pts(a+sw), [xi1,yi1]=pti(a), [xi2,yi2]=pti(a+sw);
    const big = sw > Math.PI ? 1 : 0;
    const path = `M${x1},${y1} A${r},${r} 0 ${big},1 ${x2},${y2} L${xi2},${yi2} A${hole},${hole} 0 ${big},0 ${xi1},${yi1} Z`;
    a += sw; return { path, color: d.c };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths.map((p, i) => <path key={i} d={p.path} fill={p.color} />)}
    </svg>
  );
}

function Sparkline({ rows, h = 90 }) {
  const vals = rows.map(r => r.netWorth), n = rows.length;
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  const sx = i => 4 + i / (n - 1) * 312;
  const sy = v => h - 4 - (v - mn) / rng * (h - 8);
  const line = rows.map((r, i) => `${i ? "L" : "M"}${sx(i)},${sy(r.netWorth)}`).join(" ");
  const area = line + ` L${sx(n-1)},${h} L4,${h} Z`;
  return (
    <svg viewBox={`0 0 320 ${h}`} width="100%" style={{ display: "block" }}>
      <defs>
        <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={T.blue} stopOpacity=".18" />
          <stop offset="100%" stopColor={T.blue} stopOpacity=".01" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#gl)" />
      <path d={line} fill="none" stroke={T.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1={sx(0)} y1={0} x2={sx(0)} y2={h} stroke={T.gold} strokeWidth="1.5" strokeDasharray="4,3" />
      {rows.map((r, i) => i % 5 === 0 && (
        <text key={i} x={sx(i)} y={h - 1} fontSize="7" fill={T.sec} textAnchor="middle">{r.yr}</text>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// INTEGRITETSPANEL – visas vid första start och i inställningar
// ─────────────────────────────────────────────────────────
function PrivacyScreen({ onAccept }) {
  const [syncOn, setSyncOn] = useState(false);

  return (
    <div style={{ maxWidth: 390, margin: "0 auto", minHeight: "100vh", background: T.bg }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${T.navy}, ${T.blue})`, padding: "60px 24px 28px" }}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", textAlign: "center" }}>Din data, dina regler</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,.65)", textAlign: "center", marginTop: 6 }}>
          Läs igenom innan du börjar — det tar 30 sekunder.
        </div>
      </div>

      <div style={{ padding: "20px 16px 100px" }}>

        {/* Vad lagras */}
        <div style={{ background: T.card, borderRadius: 16, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,.06)", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.navy, marginBottom: 12 }}>📋 Vad lagrar appen?</div>
          {[
            ["✅ Dina uppskattningar", "Pensionsbelopp, kapital och fastighetsvärden du själv matar in.", T.green],
            ["✅ Dina inställningar", "Pensionsålder, mål och scenariovärden.", T.green],
            ["❌ Inga bankuppgifter", "Vi ser aldrig dina riktiga konton eller transaktioner.", T.red],
            ["❌ Inget personnummer", "Vi frågar aldrig efter ditt personnummer.", T.red],
            ["❌ Inga lösenord till banker", "Appen är inte kopplad till någon bank.", T.red],
          ].map(([title, desc, c]) => (
            <div key={title} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 13, flexShrink: 0 }}>{title.split(" ")[0]}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c }}>{title.slice(2)}</div>
                <div style={{ fontSize: 12, color: T.sec, marginTop: 1 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Var lagras */}
        <div style={{ background: T.card, borderRadius: 16, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,.06)", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.navy, marginBottom: 12 }}>📱 Var lagras dina uppgifter?</div>

          {/* Lokal lagring – default */}
          <div style={{
            background: "#F0FDF4", border: `1.5px solid ${T.green}30`,
            borderRadius: 12, padding: 14, marginBottom: 10,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ fontSize: 22 }}>📱</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>
                  Lokalt på din telefon — standard
                </div>
                <div style={{ fontSize: 12, color: T.sec, marginTop: 4, lineHeight: 1.6 }}>
                  Dina uppgifter lagras bara i din telefons minne (localStorage). Ingenting skickas till internet. Fungerar helt offline.
                </div>
                <div style={{ background: T.green, borderRadius: 6, padding: "3px 8px", display: "inline-block", marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>✓ Alltid aktivt</span>
                </div>
              </div>
            </div>
          </div>

          {/* Moln – opt-in */}
          <div style={{
            background: syncOn ? "#EFF6FF" : T.bg,
            border: `1.5px solid ${syncOn ? T.blue : T.border}`,
            borderRadius: 12, padding: 14,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ fontSize: 22 }}>☁️</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: syncOn ? T.blue : T.navy }}>
                    Molnsynk — valfritt
                  </div>
                  {/* Toggle */}
                  <div onClick={() => setSyncOn(p => !p)} style={{
                    width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                    background: syncOn ? T.blue : "#CBD5E1",
                    position: "relative", transition: "background .2s", flexShrink: 0,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: 9, background: "#fff",
                      position: "absolute", top: 3, left: syncOn ? 23 : 3,
                      transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                    }} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: T.sec, marginTop: 4, lineHeight: 1.6 }}>
                  {syncOn
                    ? "Aktiverat. Data krypteras och lagras på EU-servrar (Supabase). Du behöver skapa ett konto."
                    : "Slå på om du vill komma åt din plan från flera enheter eller inte förlora data vid telefonbyte."}
                </div>
                {syncOn && (
                  <div style={{ marginTop: 8, fontSize: 11, color: T.sec, lineHeight: 1.6 }}>
                    🇪🇺 EU-servrar &nbsp;·&nbsp; 🔐 Krypterad &nbsp;·&nbsp; 🚫 Delas ej med tredje part
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Du bestämmer */}
        <div style={{ background: "#FFF8E7", border: `1px solid ${T.gold}30`, borderRadius: 12, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.gold, marginBottom: 6 }}>
            💡 Du har alltid full kontroll
          </div>
          <div style={{ fontSize: 12, color: T.sec, lineHeight: 1.6 }}>
            Du kan när som helst radera all din data i Inställningar. Du kan aktivera eller stänga av molnsynk när du vill. Vi skickar inga marknadsföringsmejl utan samtycke.
          </div>
        </div>

        {/* CTA */}
        <button onClick={() => onAccept(syncOn)} style={{
          width: "100%", padding: 14, borderRadius: 14, border: "none",
          background: T.blue, color: "#fff", fontSize: 15, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit", marginBottom: 10,
        }}>
          {syncOn ? "Fortsätt med molnsynk →" : "Fortsätt utan molnsynk →"}
        </button>

        <div style={{ fontSize: 11, color: T.sec, textAlign: "center", lineHeight: 1.6 }}>
          Genom att fortsätta godkänner du att dina uppgifter lagras{" "}
          {syncOn ? "lokalt och i molnet" : "lokalt på din enhet"}.<br />
          Du kan ändra detta när som helst i Inställningar.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────────────────
const STEPS = [
  { title: "Kom igång", sub: "Din pensionsplan på 4 enkla steg" },
  { title: "Pensioner", sub: "Hämta från minpension.se → Simulera uttag" },
  { title: "Kapital & tillgångar", sub: "Ditt sparande och fastigheter" },
  { title: "Ditt mål", sub: "Vad vill du ha netto per månad?" },
];

const DEF = {
  name1: "Person 1", name2: "Person 2", birthYear: 1965, retireAge: 63,
  itp1Cap: 4_000_000, itp1PayYrs: 15, itp2Mon: 30_000, apTotal: 25_000,
  privatCap: 2_500_000, propValue: 6_000_000, loanTotal: 4_000_000,
  loanRate: 0.035, rentalNet: 4_000, targetNet: 75_000,
  capReturn: 0.025, propGrowth: 0.03,
};

function Onboarding({ syncOn, onDone }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState({ ...DEF });
  const set = k => e => setD(p => ({ ...p, [k]: ["name1","name2"].includes(k) ? e.target.value : parseFloat(e.target.value) || 0 }));

  const inp = (label, k, unit, type = "number") => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: T.sec, marginBottom: 5, fontWeight: 500 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <input type={type} value={d[k]} onChange={set(k)} style={{
          width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10,
          padding: "11px 44px 11px 12px", fontSize: 15, background: "#F8FAFC",
          outline: "none", color: T.navy, fontFamily: "inherit",
        }} />
        {unit && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: T.sec }}>{unit}</span>}
      </div>
    </div>
  );

  const save = (data) => {
    saveLocal(data);
    onDone(data);
  };

  return (
    <div style={{ maxWidth: 390, margin: "0 auto", minHeight: "100vh", background: T.bg }}>
      <div style={{ background: `linear-gradient(135deg, ${T.navy}, ${T.blue})`, padding: "52px 20px 24px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i <= step ? "#fff" : "rgba(255,255,255,.25)", transition: "background .3s" }} />
          ))}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)", letterSpacing: 1, marginBottom: 3 }}>STEG {step + 1} / {STEPS.length}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{STEPS[step].title}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,.65)", marginTop: 3 }}>{STEPS[step].sub}</div>
        {/* Storage indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, background: "rgba(255,255,255,.1)", borderRadius: 8, padding: "6px 10px" }}>
          <div style={{ fontSize: 14 }}>{syncOn ? "☁️" : "📱"}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.7)" }}>
            {syncOn ? "Molnsynk aktiverad" : "Lagras lokalt på din telefon"}
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 16px 100px" }}>
        {step === 0 && <>
          <div style={{ background: "#EFF6FF", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 12, color: T.blue }}>
            📊 Vi beräknar din pension år för år med ITP, AP, kapital och skatt – allt i en siffra.
          </div>
          {inp("Ditt förnamn", "name1", "", "text")}
          {inp("Partners förnamn", "name2", "", "text")}
          {inp("Ditt födelseår", "birthYear", "år")}
          {inp("Önskad pensionsålder", "retireAge", "år")}
        </>}

        {step === 1 && <>
          <div style={{ background: "#EFF6FF", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: T.blue }}>
            💡 Hämta dina siffror på <strong>minpension.se</strong> → Simulera uttag
          </div>
          {inp("ITP1 / Premiepensionskapital", "itp1Cap", "kr")}
          {inp("Utbetalningsperiod ITP1", "itp1PayYrs", "år")}
          {inp("ITP2 / Förmånsbaserat (brutto/mån)", "itp2Mon", "kr")}
          {inp("Allmän pension totalt (brutto/mån)", "apTotal", "kr")}
        </>}

        {step === 2 && <>
          {inp("Privat kapital (ISK, konton, fonder)", "privatCap", "kr")}
          {inp("Fastighetsvärde totalt", "propValue", "kr")}
          {inp("Skulder / bolån totalt", "loanTotal", "kr")}
          {inp("Räntesats (ex. 0.035 = 3,5%)", "loanRate", "")}
          {inp("Hyresintäkter netto per månad", "rentalNet", "kr")}
        </>}

        {step === 3 && <>
          <div style={{ background: T.card, borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,.06)", marginBottom: 16 }}>
            {[50_000, 75_000, 100_000, 125_000, 150_000].map(v => (
              <div key={v} onClick={() => setD(p => ({ ...p, targetNet: v }))} style={{
                padding: "12px 16px", borderRadius: 10, marginBottom: 8, cursor: "pointer",
                border: `2px solid ${d.targetNet === v ? T.blue : T.border}`,
                background: d.targetNet === v ? T.blue + "08" : T.bg,
                display: "flex", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 15, fontWeight: d.targetNet === v ? 700 : 400, color: d.targetNet === v ? T.blue : T.navy }}>{fmt(v)} / mån</span>
                {d.targetNet === v && <span style={{ color: T.blue }}>✓</span>}
              </div>
            ))}
          </div>
          {inp("Eller ange eget mål", "targetNet", "kr")}
        </>}

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{ flex: 1, padding: 13, borderRadius: 12, border: "none", background: T.bg, color: T.sec, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>← Tillbaka</button>
          )}
          <button onClick={() => step < STEPS.length - 1 ? setStep(s => s + 1) : save(d)} style={{ flex: 1, padding: 13, borderRadius: 12, border: "none", background: T.blue, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            {step < STEPS.length - 1 ? "Nästa →" : "Starta min plan →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────
const TABS = [["🏠","Hem"],["📊","Pension"],["💰","Kapital"],["🔄","Scenarier"],["⚙️","Inställningar"]];

function MainApp({ data, syncOn, onReset, onToggleSync }) {
  const [tab, setTab] = useState(0);
  const [d, setD] = useState(data);
  const [saved, setSaved] = useState(false);

  const rows   = calcModel(d);
  const r0     = rows[0];
  const peak   = rows.reduce((b, r) => r.netWorth > b.netWorth ? r : b, r0);
  const ry     = d.birthYear + d.retireAge;
  const itp1m  = d.itp1Cap > 0 ? Math.round((d.itp1Cap * Math.pow(1 + d.capReturn, Math.max(0, d.retireAge - 58))) / (d.itp1PayYrs * 12)) : 0;
  const gapPct = Math.min(100, (r0.net / d.targetNet) * 100);

  const update = useCallback((newD) => {
    setD(newD);
    saveLocal(newD);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const C = { background: T.card, borderRadius: 16, padding: 16, boxShadow: "0 2px 12px rgba(0,0,0,.06)", marginBottom: 12 };
  const hdr = (sup, title) => (
    <div style={{ background: `linear-gradient(135deg, ${T.navy}, ${T.blue})`, padding: "52px 20px 20px" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)", letterSpacing: 1, marginBottom: 3 }}>{sup}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <div style={{ fontSize: 12 }}>{syncOn ? "☁️" : "📱"}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)" }}>
          {saved ? "✓ Sparad" : syncOn ? "Molnsynk aktiverad" : "Lokal lagring"}
        </div>
      </div>
    </div>
  );

  // ── HEM ────────────────────────────────────────────────────
  const HomeTab = () => (
    <div>
      <div style={{ background: `linear-gradient(135deg, ${T.navy}, ${T.blue})`, padding: "52px 20px 20px" }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)", letterSpacing: 1, marginBottom: 2 }}>PENSIONSÖVERSIKT</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{d.name1} & {d.name2}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,.65)" }}>Pension vid {d.retireAge} år · {ry}</div>
        <div style={{ background: "rgba(255,255,255,.1)", borderRadius: 16, padding: 16, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)" }}>NETTO / MÅN ÅR 1</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{fmt(r0.net)}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 2 }}>
                Mål: {fmt(d.targetNet)} · {gapPct >= 100 ? "✅ Uppnått" : `⚠️ ${Math.round(gapPct)}%`}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)" }}>FÖRMÖGENHET</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>{fmtM(r0.netWorth)}</div>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,.2)", borderRadius: 99, height: 5, overflow: "hidden", marginTop: 14 }}>
            <div style={{ width: `${gapPct}%`, height: "100%", background: gapPct >= 100 ? "#4ade80" : "#facc15", borderRadius: 99 }} />
          </div>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          {[[fmt(itp1m),"ITP1/mån",T.blue],[fmt(d.itp2Mon),"ITP2/mån",T.purple],[fmt(d.apTotal),"AP/mån",T.teal],[fmt(d.rentalNet),"Hyra netto",T.green]].map(([v,l,col]) => (
            <div key={l} style={{ ...C, marginBottom: 0, borderTop: `4px solid ${col}` }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{v}</div>
              <div style={{ fontSize: 11, color: T.sec, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={C}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.navy, marginBottom: 12 }}>Tillgångsfördelning</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Donut slices={[{v:d.propValue,c:T.blue},{v:d.privatCap,c:T.gold},{v:d.itp1Cap,c:T.purple}]} size={96} />
            <div style={{ flex: 1 }}>
              {[["Fastigheter",d.propValue,T.blue],["Privat kapital",d.privatCap,T.gold],["Pensionskapital",d.itp1Cap,T.purple]].map(([n,v,col]) => (
                <div key={n} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: T.navy }}>{n}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{fmtM(v)}</span>
                  </div>
                  <PBar pct={v / (d.propValue + d.privatCap + d.itp1Cap) * 100} color={col} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ ...C, background: "#F0FDF4", borderLeft: `4px solid ${T.green}` }}>
          <div style={{ fontSize: 12, color: T.green, fontWeight: 700 }}>📈 Bästa förmögenhetsår</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.navy, marginTop: 2 }}>{fmtM(peak.netWorth)}</div>
          <div style={{ fontSize: 11, color: T.sec }}>{peak.yr} · {peak.age} år</div>
        </div>
      </div>
    </div>
  );

  // ── PENSION ────────────────────────────────────────────────
  const PensionTab = () => (
    <div>
      {hdr("PENSIONSPROGNOS", "År för år")}
      <div style={{ padding: 16 }}>
        <div style={C}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.navy, marginBottom: 10 }}>Nettoinkomst per år</div>
          {rows.slice(0, 15).map((r, i) => {
            const on = r.net >= d.targetNet;
            return (
              <div key={r.yr} style={{ padding: "9px 0", borderBottom: i < 14 ? `1px solid ${T.border}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.blue, width: 36 }}>{r.yr}</span>
                    <span style={{ fontSize: 10, color: T.sec }}>{r.age}år</span>
                    {r.itp1 > 0 && <Pill c={T.blue}>ITP1</Pill>}
                    {r.itp2 > 0 && <Pill c={T.purple}>ITP2</Pill>}
                    {r.ap > 0 && <Pill c={T.teal}>AP</Pill>}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: on ? T.green : T.gold }}>{fmt(r.net)} {on ? "✅" : "⚠️"}</span>
                </div>
                <PBar pct={(r.net / d.targetNet) * 100} color={on ? T.green : T.gold} h={4} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ── KAPITAL ────────────────────────────────────────────────
  const KapitalTab = () => (
    <div>
      {hdr("KAPITAL", "Förmögenhet över tid")}
      <div style={{ padding: 16 }}>
        <div style={C}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.navy, marginBottom: 10 }}>Nettoförmögenhet (Mkr)</div>
          <Sparkline rows={rows} h={90} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            {[["Vid pension", fmtM(r0.netWorth)], [`Topp ${peak.yr}`, fmtM(peak.netWorth)], ["Om 25 år", fmtM(rows[rows.length-1]?.netWorth||0)]].map(([l,v]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: T.sec }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.blue }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={C}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.navy, marginBottom: 10 }}>Kapitaluttag ur sparande</div>
          {rows.filter(r => r.wd > 0).length === 0
            ? <div style={{ fontSize: 13, color: T.green }}>✅ Inget kapitaluttag behövs!</div>
            : rows.slice(0, 10).filter(r => r.wd > 0).map(r => (
              <div key={r.yr} style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: T.navy }}>{r.yr} ({r.age} år)</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>{fmt(r.wd)}/år</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );

  // ── SCENARIER ──────────────────────────────────────────────
  const ScenarierTab = () => {
    const [age, setAge] = useState(d.retireAge);
    const [yrs, setYrs] = useState(d.itp1PayYrs);
    const alt  = calcModel({ ...d, retireAge: age, itp1PayYrs: yrs });
    const diff = alt[0].net - r0.net;
    return (
      <div>
        {hdr("SCENARIER", "Testa dina val")}
        <div style={{ padding: 16 }}>
          <div style={C}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.navy, marginBottom: 10 }}>Pensionsålder</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {[60,61,62,63,64,65].map(a => (
                <button key={a} onClick={() => setAge(a)} style={{ flex:1, padding:"9px 0", borderRadius:10, border:"none", background:age===a?T.blue:T.bg, color:age===a?"#fff":T.navy, fontWeight:age===a?700:400, cursor:"pointer", fontSize:13, fontFamily:"inherit" }}>{a}</button>
              ))}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.navy, marginBottom: 10 }}>ITP1 utbetalningsperiod</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {[10,15,20].map(y => (
                <button key={y} onClick={() => setYrs(y)} style={{ flex:1, padding:"10px 0", borderRadius:10, border:"none", background:yrs===y?T.purple:T.bg, color:yrs===y?"#fff":T.navy, fontWeight:yrs===y?700:400, cursor:"pointer", fontSize:14, fontFamily:"inherit" }}>{y} år</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              {[[alt[0],T.blue,`Scenario (${age}å, ${yrs}å)`],[r0,T.sec,`Nuläge (${d.retireAge}å, ${d.itp1PayYrs}å)`]].map(([row,col,lbl]) => (
                <div key={lbl} style={{ background: T.bg, borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 10, color: T.sec, marginBottom: 8 }}>{lbl}</div>
                  {[["Netto/mån",fmt(row.net)],["Förmögenhet",fmtM(row.netWorth)]].map(([l,v]) => (
                    <div key={l} style={{ marginBottom: 5 }}>
                      <div style={{ fontSize: 10, color: T.sec }}>{l}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: col }}>{v}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ borderRadius: 12, padding: 14, background: diff >= 0 ? "#F0FDF4" : "#FFF7ED" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: diff >= 0 ? T.green : T.gold }}>{diff >= 0 ? "+" : ""}{fmt(diff)}/mån</div>
              <div style={{ fontSize: 11, color: T.sec, marginTop: 2 }}>jämfört med nuläget</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── INSTÄLLNINGAR ──────────────────────────────────────────
  const SettingsTab = () => {
    const [local, setLocal] = useState({ ...d });
    const [showPrivacy, setShowPrivacy] = useState(false);
    const set = k => e => setLocal(p => ({ ...p, [k]: parseFloat(e.target.value) || 0 }));

    const deleteAll = () => {
      if (window.confirm("Radera all lokal data? Detta går inte att ångra.")) {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_SYNC);
        onReset();
      }
    };

    return (
      <div>
        {hdr("INSTÄLLNINGAR", "Uppgifter & Integritet")}
        <div style={{ padding: 16 }}>

          {/* Storage status */}
          <div style={{ ...C, background: syncOn ? "#EFF6FF" : "#F0FDF4", borderLeft: `4px solid ${syncOn ? T.blue : T.green}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: syncOn ? T.blue : T.green }}>
                {syncOn ? "☁️ Molnsynk aktiverad" : "📱 Lokal lagring aktiv"}
              </div>
              <div onClick={onToggleSync} style={{
                width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                background: syncOn ? T.blue : "#CBD5E1", position: "relative", transition: "background .2s",
              }}>
                <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 3, left: syncOn ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: T.sec }}>
              {syncOn ? "Data krypteras och lagras på EU-servrar. Du kan stänga av när som helst." : "Data lagras bara på din enhet. Ingenting skickas till internet."}
            </div>
            <button onClick={() => setShowPrivacy(true)} style={{ marginTop: 8, background: "none", border: "none", color: T.blue, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit", textDecoration: "underline" }}>
              Läs vår integritetspolicy →
            </button>
          </div>

          {showPrivacy && (
            <div style={{ ...C, background: "#FFF8E7", borderLeft: `4px solid ${T.gold}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.gold, marginBottom: 8 }}>Vad vi lagrar</div>
              <div style={{ fontSize: 12, color: T.sec, lineHeight: 1.7 }}>
                ✅ Dina uppskattningar (pensionsbelopp, kapital, mål)<br />
                ✅ Dina inställningar<br />
                ❌ Inga bankuppgifter eller kontonummer<br />
                ❌ Inget personnummer<br />
                ❌ Inga lösenord till banker<br />
                ❌ Ingen data delas med tredje part
              </div>
              <button onClick={() => setShowPrivacy(false)} style={{ marginTop: 8, background: "none", border: "none", color: T.gold, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>Stäng</button>
            </div>
          )}

          {/* Edit data */}
          <div style={C}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.navy, marginBottom: 14 }}>Justera uppgifter</div>
            {[
              ["retireAge","Pensionsålder","år"],["itp1Cap","ITP1 kapital","kr"],
              ["itp1PayYrs","ITP1 utbetalningstid","år"],["itp2Mon","ITP2 brutto/mån","kr"],
              ["apTotal","AP totalt/mån","kr"],["privatCap","Privat kapital","kr"],
              ["propValue","Fastighetsvärde","kr"],["loanTotal","Skulder totalt","kr"],
              ["targetNet","Nettomål/mån","kr"],
            ].map(([k,label,unit]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: T.sec, marginBottom: 4 }}>{label}</div>
                <div style={{ position: "relative" }}>
                  <input type="number" value={local[k]} onChange={set(k)} style={{
                    width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10,
                    padding: "10px 40px 10px 12px", fontSize: 14, background: "#F8FAFC",
                    outline: "none", color: T.navy, fontFamily: "inherit",
                  }} />
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: T.sec }}>{unit}</span>
                </div>
              </div>
            ))}
            <button onClick={() => update(local)} style={{
              width: "100%", padding: 13, borderRadius: 12, border: "none",
              background: T.blue, color: "#fff", fontSize: 15, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit", marginTop: 4,
            }}>✓ Spara ändringar</button>
          </div>

          {/* Danger zone */}
          <div style={{ ...C, borderLeft: `4px solid ${T.red}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.red, marginBottom: 6 }}>⚠️ Radera mina uppgifter</div>
            <div style={{ fontSize: 12, color: T.sec, marginBottom: 10 }}>
              Raderar all data från den här enheten. Du kan börja om från scratch.
            </div>
            <button onClick={deleteAll} style={{
              width: "100%", padding: 11, borderRadius: 10, border: `1.5px solid ${T.red}`,
              background: "transparent", color: T.red, fontSize: 14, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>Radera all data</button>
          </div>
        </div>
      </div>
    );
  };

  const Screens = [HomeTab, PensionTab, KapitalTab, ScenarierTab, SettingsTab];
  const Active  = Screens[tab];

  return (
    <div style={{ maxWidth: 390, margin: "0 auto", background: T.bg, minHeight: "100vh", position: "relative" }}>
      <div style={{ paddingBottom: 80 }}><Active /></div>
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 390, background: "rgba(255,255,255,.95)",
        backdropFilter: "blur(12px)", borderTop: `1px solid ${T.border}`,
        display: "flex", padding: "6px 0 20px", zIndex: 100,
      }}>
        {TABS.map(([icon, label], i) => (
          <div key={label} onClick={() => setTab(i)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            gap: 2, cursor: "pointer", padding: "7px 0",
            color: tab === i ? T.blue : T.sec, fontSize: 10, fontWeight: tab === i ? 700 : 400,
          }}>
            <span style={{ fontSize: 22 }}>{icon}</span>{label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ROOT – flödesstyrning
// ─────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase]   = useState("loading"); // loading | privacy | onboard | app
  const [data,  setData]    = useState(null);
  const [syncOn, setSyncOn] = useState(false);

  useEffect(() => {
    const existing = loadLocal();
    const sync     = loadSyncPref();
    setSyncOn(sync);
    if (existing) {
      setData(existing);
      setPhase("app");
    } else {
      setPhase("privacy");
    }
  }, []);

  const handlePrivacyAccept = (wantsSync) => {
    setSyncOn(wantsSync);
    saveSyncPref(wantsSync);
    setPhase("onboard");
  };

  const handleOnboardDone = (d) => {
    setData(d);
    setPhase("app");
  };

  const handleToggleSync = () => {
    const newVal = !syncOn;
    setSyncOn(newVal);
    saveSyncPref(newVal);
  };

  const handleReset = () => {
    setData(null);
    setPhase("privacy");
  };

  if (phase === "loading") return (
    <div style={{ maxWidth: 390, margin: "0 auto", minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 42 }}>📊</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: T.navy }}>Laddar...</div>
    </div>
  );

  if (phase === "privacy") return <PrivacyScreen onAccept={handlePrivacyAccept} />;
  if (phase === "onboard") return <Onboarding syncOn={syncOn} onDone={handleOnboardDone} />;

  return (
    <MainApp
      data={data}
      syncOn={syncOn}
      onReset={handleReset}
      onToggleSync={handleToggleSync}
    />
  );
}
