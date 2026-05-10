import { useState, useRef, useEffect, useMemo } from "react";

// ─── Kommuner (urval) ─────────────────────────────────────
const KOMMUNER = [
  ["Ale",32.37],["Alingsås",33.17],["Borlänge",33.23],["Borås",32.28],
  ["Botkyrka",31.57],["Danderyd",29.29],["Ekerö",30.38],["Enköping",32.56],
  ["Eskilstuna",33.08],["Falun",33.48],["Gävle",33.78],["Göteborg",32.35],
  ["Halmstad",31.37],["Haninge",31.67],["Helsingborg",31.17],["Huddinge",31.27],
  ["Järfälla",30.37],["Jönköping",32.28],["Kalmar",33.18],["Karlstad",33.05],
  ["Kristianstad",31.27],["Kungsbacka",31.17],["Lidingö",30.38],["Linköping",32.23],
  ["Lomma",30.47],["Luleå",33.18],["Lund",31.47],["Malmö",32.35],
  ["Mölndal",31.47],["Nacka",29.87],["Norrköping",32.73],["Norrtälje",32.56],
  ["Nyköping",32.58],["Sigtuna",31.57],["Skellefteå",33.21],["Sollentuna",30.27],
  ["Solna",29.17],["Stockholm",29.83],["Strängnäs",32.58],["Sundbyberg",29.97],
  ["Sundsvall",33.48],["Södertälje",31.67],["Täby",29.47],["Umeå",32.91],
  ["Upplands Väsby",30.87],["Uppsala",31.86],["Vallentuna",30.57],["Varberg",31.47],
  ["Värmdö",31.07],["Västerås",31.81],["Växjö",32.48],["Örebro",33.23],
  ["Österåker",28.98],["Östersund",33.46],
].sort((a,b)=>a[0].localeCompare(b[0]));

// ─── Skatt ────────────────────────────────────────────────
function calcTax(mon, komRate) {
  const yr = mon * 12;
  const gr = yr < 200000 ? yr*0.35 : yr < 400000 ? 70000 : Math.max(13900, yr*0.05);
  const stat = Math.max(0, yr - 643100) * 0.2;
  return Math.max(0, Math.round(((yr-gr)*komRate/100 + stat)/12));
}

// ─── Beräkningsmotor ─────────────────────────────────────
const kr  = n => new Intl.NumberFormat("sv-SE",{style:"currency",currency:"SEK",maximumFractionDigits:0}).format(n);
const mkr = n => Math.abs(n)>=1e6 ? `${(n/1e6).toFixed(1)} Mkr` : `${Math.round(n/1e3)} tkr`;

function berakna(d) {
  const { p1, p2, hushall, fastigheter, mal, kapRet, propRet } = d;
  const startAr = p1.fodelsear + p1.pensionsalder;

  let kapital = (p1.kapital||0) + (hushall ? (p2.kapital||0) : 0);
  let fastVal  = fastigheter.reduce((s,f)=>s+(f.varde||0), 0);
  const skulder = fastigheter.reduce((s,f)=>s+(f.lan||0), 0);

  return Array.from({length:26}, (_,i) => {
    const ar  = startAr + i;
    const ald = ar - p1.fodelsear;

    // ── Person 1 ──────────────────────────────────────────────
    // Tjänstepension: startar direkt, löper utbetAr år
    const tjanst1 = i < (p1.utbetAr||15) ? (p1.tjanstMon||0) : 0;

    // AP: startar vid apStartAlder (default = pensionsalder)
    // Viktigt: beloppet från minpension.se är för valt uttags-år
    const apStart1 = p1.apStartAlder || p1.pensionsalder;
    const ap1 = ald >= apStart1 ? (p1.apMon||0) : 0;

    const brutto1 = tjanst1 + ap1;
    const netto1  = brutto1 - calcTax(brutto1, p1.komSkatt||29.83);

    // ── Person 2 ──────────────────────────────────────────────
    let netto2 = 0, tjanst2 = 0, ap2 = 0;
    if (hushall && p2) {
      // P2 kan ha annan pensionsålder — räkna från P2s startår
      const p2Start = p2.fodelsear + p2.pensionsalder;
      const p2Aktiv = ar >= p2Start; // P2 har gått i pension
      tjanst2 = p2Aktiv && (ar - p2Start) < (p2.utbetAr||15) ? (p2.tjanstMon||0) : 0;
      const apStart2 = p2.apStartAlder || p2.pensionsalder;
      const ald2 = ar - p2.fodelsear;
      ap2 = p2Aktiv && ald2 >= apStart2 ? (p2.apMon||0) : 0;
      const brutto2 = tjanst2 + ap2;
      netto2 = brutto2 - calcTax(brutto2, p2.komSkatt||29.83);
    }

    // ── Fastigheter ───────────────────────────────────────────
    // Hyra: 40 000 kr/år (3 333/mån) skattefritt, resten 30%
    const hyra = fastigheter.reduce((s,f) => {
      const brH = (f.hyra||0) - (f.avgift||0);
      if (brH <= 0) return s;
      const skattefri = 3333; // 40 000/12
      const skattbar  = Math.max(0, brH - skattefri);
      return s + brH - skattbar * 0.3;
    }, 0);

    // Räntekostnad och ränteavdrag 30%
    const ranta  = fastigheter.reduce((s,f) => s + (f.lan||0)*(f.ranta||0.035)/12, 0);
    const avdrag = ranta * 0.3; // 30% ränteavdrag

    // ── Netto & kapitaluttag ──────────────────────────────────
    const netto = netto1 + netto2 + hyra + avdrag - ranta;

    // Om pension < mål: ta ur sparkapital för att nå målet
    const uttag = Math.max(0, mal - netto); // kr/mån från sparkapital

    // Kapital: växer med kapRet, minskar med årsuttag
    kapital = kapital * (1 + kapRet) - uttag * 12;
    fastVal = fastVal * (1 + propRet);

    return {
      ar, ald,
      tjanst1, ap1, brutto1, netto1,
      tjanst2, ap2, netto2,
      hyra, ranta, avdrag,
      netto, uttag,
      kapital,
      nettoformogenhet: kapital + fastVal - skulder,
      fastVal
    };
  });
}

// ─── Lagring ──────────────────────────────────────────────
const LKEY = "pv7";
const ladda = () => { try { return JSON.parse(localStorage.getItem(LKEY))||null; } catch { return null; }};
const spara = d => { try { localStorage.setItem(LKEY, JSON.stringify(d)); } catch {} };

// ─── NI: Inmatningsfält (okontrollerat — inga fokusproblem) ──
function NI({ val, set, enhet, liten }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current)
      ref.current.value = val || "";
  }, [val]);
  return (
    <div style={{ position:"relative" }}>
      <input
        ref={ref}
        type="number"
        defaultValue={val||""}
        onBlur={e => { const n=parseFloat(e.target.value); set(isNaN(n)?0:n); }}
        style={liten
          ? { width:"100%", padding:"8px 10px", fontSize:14, border:`1px solid #E2E8F0`, borderRadius:8, background:"#F8FAFC", outline:"none", fontFamily:"inherit" }
          : { width:"100%", padding:`12px ${enhet?"44px":"14px"} 12px 14px`, fontSize:16, border:`1.5px solid #E2E8F0`, borderRadius:12, background:"#F8FAFC", outline:"none", fontFamily:"inherit" }
        }
      />
      {enhet && !liten && (
        <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:12, color:"#64748B", pointerEvents:"none" }}>{enhet}</span>
      )}
    </div>
  );
}

// ─── Kommunsök ────────────────────────────────────────────
function Kommunsok({ val, skatt, onChange }) {
  const [q, setQ] = useState(val||"");
  const [open, setOpen] = useState(false);
  const hits = q.length > 1 ? KOMMUNER.filter(([n])=>n.toLowerCase().includes(q.toLowerCase())).slice(0,6) : [];
  return (
    <div style={{ position:"relative" }}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Sök din kommun..."
        style={{ width:"100%", padding:"12px 14px", fontSize:15, border:`1.5px solid ${open?"#1659A8":"#E2E8F0"}`, borderRadius:12, background:"#F8FAFC", outline:"none", fontFamily:"inherit" }}
      />
      {skatt > 0 && (
        <div style={{ fontSize:12, color:"#16784A", marginTop:4 }}>
          Kommunalskatt <b>{skatt}%</b> · Statlig skatt 20% på inkomst över 643 100 kr/år
        </div>
      )}
      {open && hits.length > 0 && (
        <div style={{ position:"absolute", zIndex:999, top:"105%", left:0, right:0, background:"#fff", border:"1px solid #E2E8F0", borderRadius:12, boxShadow:"0 8px 24px rgba(0,0,0,.12)", overflow:"hidden" }}>
          {hits.map(([n,r]) => (
            <div key={n} onClick={() => { setQ(n); onChange(n, r); setOpen(false); }}
              style={{ padding:"11px 16px", cursor:"pointer", display:"flex", justifyContent:"space-between", borderBottom:"1px solid #F0F4F8", fontSize:14 }}>
              <span>{n}</span>
              <b style={{ color:"#16784A" }}>{r}%</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Liten progressbar ───────────────────────────────────
const Pbar = ({pct, col}) => (
  <div style={{ height:4, background:"#E2E8F0", borderRadius:99, overflow:"hidden", marginTop:4 }}>
    <div style={{ height:"100%", width:`${Math.min(100,Math.max(0,pct))}%`, background:col, borderRadius:99 }}/>
  </div>
);

// ─── Sparkline ───────────────────────────────────────────
function Spark({ rows }) {
  const h=80, vals=rows.map(r=>r.nettoformogenhet), n=rows.length;
  const mn=Math.min(...vals), mx=Math.max(...vals), rng=mx-mn||1;
  const x=i=>8+i/(n-1)*304, y=v=>h-4-(v-mn)/rng*(h-8);
  const line=rows.map((r,i)=>`${i?"L":"M"}${x(i)},${y(r.nettoformogenhet)}`).join(" ");
  const area=`${line} L${x(n-1)},${h} L8,${h} Z`;
  return (
    <svg viewBox={`0 0 320 ${h}`} width="100%" style={{display:"block"}}>
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1659A8" stopOpacity=".18"/>
          <stop offset="100%" stopColor="#1659A8" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#g1)"/>
      <path d={line} fill="none" stroke="#1659A8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {rows.map((r,i)=>i%5===0&&(
        <text key={i} x={x(i)} y={h} fontSize="7" fill="#64748B" textAnchor="middle">{r.ar}</text>
      ))}
    </svg>
  );
}

// ─── Toggle ──────────────────────────────────────────────
function Toggle({ on, set }) {
  return (
    <div onClick={()=>set(!on)} style={{ width:44, height:24, borderRadius:12, cursor:"pointer", background:on?"#1659A8":"#CBD5E1", position:"relative", transition:"background .2s", flexShrink:0 }}>
      <div style={{ width:18, height:18, borderRadius:9, background:"#fff", position:"absolute", top:3, left:on?23:3, transition:"left .2s", boxShadow:"0 1px 4px rgba(0,0,0,.2)" }}/>
    </div>
  );
}

// ─── Fält-wrapper ────────────────────────────────────────
function Falt({ label, hint, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:13, fontWeight:600, color:"#0D2137", marginBottom:4 }}>{label}</div>
      {hint && <div style={{ fontSize:11, color:"#0C7490", marginBottom:6, lineHeight:1.5 }}>{hint}</div>}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// INTEGRITETSSKÄRM
// ═══════════════════════════════════════════════════════════
function Integritet({ onKlar }) {
  const [sync, setSync] = useState(false);
  return (
    <div style={{ maxWidth:390, margin:"0 auto", minHeight:"100vh", background:"#F0F4F8" }}>
      <div style={{ background:"linear-gradient(135deg,#0D2137,#1659A8)", padding:"60px 24px 32px", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:26, fontWeight:700, color:"#fff" }}>PensionsAppen</div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,.65)", marginTop:6 }}>Sverige bästa pensionskalkyl</div>
      </div>
      <div style={{ padding:"20px 16px 80px" }}>

        <div style={{ background:"#fff", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,.06)" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#0D2137", marginBottom:14 }}>📋 Vad lagrar appen?</div>
          {[
            ["✅", "Pensionsbelopp och kapital du matar in", "#16784A"],
            ["✅", "Dina inställningar och mål", "#16784A"],
            ["❌", "Inga bankuppgifter", "#C0392B"],
            ["❌", "Inget personnummer", "#C0392B"],
            ["❌", "Delas aldrig med tredje part", "#C0392B"],
          ].map(([ico,txt,col]) => (
            <div key={txt} style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:16, lineHeight:1.4 }}>{ico}</span>
              <span style={{ fontSize:14, color:col, lineHeight:1.4 }}>{txt}</span>
            </div>
          ))}
        </div>

        <div style={{ background:"#fff", borderRadius:16, padding:20, marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,.06)" }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#0D2137", marginBottom:14 }}>📱 Var lagras data?</div>

          <div style={{ background:"#F0FDF4", border:"1.5px solid #86EFAC", borderRadius:12, padding:14, marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:"#16784A" }}>📱 Lokalt på din enhet</div>
                <div style={{ fontSize:12, color:"#64748B", marginTop:3 }}>Standard — ingenting skickas till internet</div>
              </div>
              <div style={{ background:"#16784A", borderRadius:6, padding:"3px 10px", fontSize:12, color:"#fff", fontWeight:700 }}>PÅ</div>
            </div>
          </div>

          <div style={{ background:sync?"#EFF6FF":"#F8FAFC", border:`1.5px solid ${sync?"#1659A8":"#E2E8F0"}`, borderRadius:12, padding:14, transition:"all .2s" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:sync?8:0 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:sync?"#1659A8":"#0D2137" }}>☁️ Molnsynk — valfritt</div>
                <div style={{ fontSize:12, color:"#64748B", marginTop:3 }}>Åtkomst från flera enheter</div>
              </div>
              <Toggle on={sync} set={setSync}/>
            </div>
            {sync && <div style={{ fontSize:12, color:"#1659A8" }}>🇪🇺 EU-servrar · 🔐 Krypterat · GDPR-kompatibel</div>}
          </div>
        </div>

        <button
          onClick={() => onKlar(sync)}
          style={{ width:"100%", padding:16, borderRadius:14, border:"none", background:"#1659A8", color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}
        >
          {sync ? "Fortsätt med molnsynk →" : "Fortsätt utan molnsynk →"}
        </button>
        <div style={{ fontSize:12, color:"#64748B", textAlign:"center", marginTop:10 }}>
          Du kan ändra lagringsinställning när som helst under Inställningar
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ONBOARDING — 5 enkla steg
// ═══════════════════════════════════════════════════════════
const TOM_P = { namn:"", fodelsear:1967, pensionsalder:63, apStartAlder:63, tjanstMon:0, utbetAr:15, apMon:0, kapital:0, lon:0, kom:"Stockholm", komSkatt:29.83 };

function Onboarding({ onKlar }) {
  const [steg, setSteg] = useState(0);
  const [hushall, setHushall] = useState(false);
  const [p1, setP1] = useState({...TOM_P});
  const [p2, setP2] = useState({...TOM_P, fodelsear:1967});
  const [fastigheter, setFast] = useState([]);
  const [malTyp, setMalTyp] = useState("individuell"); // "individuell" | "hushall"
  const [mal, setMal] = useState(75000);

  const u1 = (k,v) => setP1(p=>({...p,[k]:v}));
  const u2 = (k,v) => setP2(p=>({...p,[k]:v}));

  const STEG = hushall
    ? ["Välkommen","Om dig","Din pension","Om partner","Partnerns pension","Fastigheter","Ditt mål"]
    : ["Välkommen","Om dig","Din pension","Fastigheter","Ditt mål"];

  const total = STEG.length;
  const sistaSteget = steg === total - 1;

  const klar = () => {
    const effMal = malTyp==="individuell" && hushall ? mal*2 : mal;
    const data = { p1, p2: hushall?p2:null, hushall, fastigheter, mal:effMal, malDisplay:mal, malTyp, kapRet:0.025, propRet:0.035 };
    spara(data);
    onKlar(data);
  };

  // Minpension-guide
  const MinpGuide = ({ utbetAr }) => (
    <div style={{ background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:12, padding:14, marginBottom:16 }}>
      <div style={{ fontSize:14, fontWeight:700, color:"#1659A8", marginBottom:8 }}>📱 Hämta från minpension.se</div>
      <div style={{ fontSize:13, color:"#0D2137", lineHeight:1.8 }}>
        1. Gå till <b>minpension.se</b> och logga in med BankID<br/>
        2. Klicka <b>"Simulera uttag"</b><br/>
        3. Välj <b>ålder {p1.pensionsalder} år</b> och <b>{utbetAr} år utbetalningstid</b><br/>
        4. Mata in beloppet <b>brutto (före skatt)</b> nedan
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth:390, margin:"0 auto", minHeight:"100vh", background:"#F0F4F8" }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#0D2137,#1659A8)", padding:"52px 20px 24px" }}>
        {steg > 0 && (
          <div style={{ display:"flex", gap:4, marginBottom:16 }}>
            {Array.from({length:total}).map((_,i) => (
              <div key={i} style={{ flex:1, height:3, borderRadius:99, background:i<steg?"#fff":i===steg?"rgba(255,255,255,.6)":"rgba(255,255,255,.2)" }}/>
            ))}
          </div>
        )}
        <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", letterSpacing:1, marginBottom:4 }}>
          {steg===0 ? "VÄLKOMMEN" : `STEG ${steg} AV ${total-1}`}
        </div>
        <div style={{ fontSize:22, fontWeight:700, color:"#fff" }}>{STEG[steg]}</div>
      </div>

      <div style={{ padding:"20px 16px 100px" }}>

        {/* STEG 0 — Välj solo eller hushåll */}
        {steg===0 && (
          <div>
            <div style={{ fontSize:14, color:"#64748B", marginBottom:20, lineHeight:1.6 }}>
              Appen beräknar din pension år för år med korrekt skatt, pensionssystem och fastigheter.
            </div>
            {[
              { id:false, ico:"👤", titel:"Bara mig", text:"Beräknar min individuella pension" },
              { id:true,  ico:"👫", titel:"Vi i hushållet", text:"Beräknar för mig och min partner tillsammans" },
            ].map(o => (
              <div key={String(o.id)} onClick={()=>{setHushall(o.id);setSteg(1);}}
                style={{ background:"#fff", borderRadius:16, padding:20, marginBottom:12, cursor:"pointer", border:"2px solid #E2E8F0", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                <div style={{ fontSize:32, marginBottom:8 }}>{o.ico}</div>
                <div style={{ fontSize:17, fontWeight:700, color:"#0D2137" }}>{o.titel}</div>
                <div style={{ fontSize:13, color:"#64748B", marginTop:4 }}>{o.text}</div>
              </div>
            ))}
          </div>
        )}

        {/* STEG 1 — Om dig */}
        {steg===1 && (
          <div>
            <Falt label="Ditt förnamn">
              <input value={p1.namn} onChange={e=>u1("namn",e.target.value)} placeholder="Namn"
                style={{ width:"100%", padding:"12px 14px", fontSize:16, border:"1.5px solid #E2E8F0", borderRadius:12, background:"#F8FAFC", outline:"none", fontFamily:"inherit" }}/>
            </Falt>
            <Falt label="Födelseår">
              <NI val={p1.fodelsear} set={v=>u1("fodelsear",v)} enhet="år"/>
            </Falt>
            <Falt label="Pensionsålder" hint={`Pensioneras ${p1.fodelsear+p1.pensionsalder} — om ${Math.max(0,p1.fodelsear+p1.pensionsalder-2024)} år`}>
              <NI val={p1.pensionsalder} set={v=>u1("pensionsalder",v)} enhet="år"/>
            </Falt>
            <Falt label="Din kommun">
              <Kommunsok val={p1.kom} skatt={p1.komSkatt} onChange={(n,r)=>setP1(p=>({...p,kom:n,komSkatt:r}))}/>
            </Falt>
          </div>
        )}

        {/* STEG 2 — Din pension */}
        {steg===2 && (
          <div>
            <Falt label="Utbetalningstid">
              <div style={{ display:"flex", gap:10, marginBottom:4 }}>
                {[15,20].map(ar => (
                  <div key={ar} onClick={()=>u1("utbetAr",ar)}
                    style={{ flex:1, padding:"12px", borderRadius:12, cursor:"pointer", textAlign:"center",
                      border:`2px solid ${p1.utbetAr===ar?"#1659A8":"#E2E8F0"}`,
                      background:p1.utbetAr===ar?"#EFF6FF":"#F8FAFC" }}>
                    <div style={{ fontSize:18, fontWeight:700, color:p1.utbetAr===ar?"#1659A8":"#0D2137" }}>{ar} år</div>
                    <div style={{ fontSize:11, color:"#64748B" }}>t.o.m. {p1.fodelsear+p1.pensionsalder+ar} år</div>
                  </div>
                ))}
              </div>
            </Falt>
            <MinpGuide utbetAr={p1.utbetAr}/>
            <Falt label={`Tjänstepension (${p1.utbetAr} år) — brutto/mån`}
              hint="Det belopp du ser i minpension.se under 'Simulera uttag'">
              <NI val={p1.tjanstMon} set={v=>u1("tjanstMon",v)} enhet="kr"/>
            </Falt>
            <Falt label="Allmän pension (AP) — brutto/mån"
              hint="Hämta från minpension.se · Ange beloppet för din valda pensionsålder">
              <NI val={p1.apMon} set={v=>u1("apMon",v)} enhet="kr"/>
            </Falt>
            <Falt label="AP börjar betalas ut vid ålder"
              hint={`Default: samma år som du pensioneras (${p1.pensionsalder} år). Ändra om du väljer att ta ut AP senare.`}>
              <NI val={p1.apStartAlder||p1.pensionsalder} set={v=>u1("apStartAlder",v)} enhet="år"/>
            </Falt>
            <Falt label="Privat kapital (ISK, fonder, konton)">
              <NI val={p1.kapital} set={v=>u1("kapital",v)} enhet="kr"/>
            </Falt>
            <Falt label="Nuvarande månadslön brutto"
              hint="Används för löneväxlingsberäkning">
              <NI val={p1.lön} set={v=>u1("lön",v)} enhet="kr"/>
            </Falt>
          </div>
        )}

        {/* STEG 3 — Partner info (hushåll) */}
        {steg===3 && hushall && (
          <div>
            <Falt label="Partners förnamn">
              <input value={p2.namn} onChange={e=>u2("namn",e.target.value)} placeholder="Namn"
                style={{ width:"100%", padding:"12px 14px", fontSize:16, border:"1.5px solid #E2E8F0", borderRadius:12, background:"#F8FAFC", outline:"none", fontFamily:"inherit" }}/>
            </Falt>
            <Falt label="Födelseår">
              <NI val={p2.fodelsear} set={v=>u2("fodelsear",v)} enhet="år"/>
            </Falt>
            <Falt label="Pensionsålder" hint={`Pensioneras ${p2.fodelsear+p2.pensionsalder}`}>
              <NI val={p2.pensionsalder} set={v=>u2("pensionsalder",v)} enhet="år"/>
            </Falt>
            <Falt label="Partners kommun">
              <Kommunsok val={p2.kom} skatt={p2.komSkatt} onChange={(n,r)=>setP2(p=>({...p,kom:n,komSkatt:r}))}/>
            </Falt>
          </div>
        )}

        {/* STEG 4 — Partners pension (hushåll) */}
        {steg===4 && hushall && (
          <div>
            <Falt label="Utbetalningstid — partner">
              <div style={{ display:"flex", gap:10, marginBottom:4 }}>
                {[15,20].map(ar => (
                  <div key={ar} onClick={()=>u2("utbetAr",ar)}
                    style={{ flex:1, padding:"12px", borderRadius:12, cursor:"pointer", textAlign:"center",
                      border:`2px solid ${p2.utbetAr===ar?"#5A3289":"#E2E8F0"}`,
                      background:p2.utbetAr===ar?"#F5F3FF":"#F8FAFC" }}>
                    <div style={{ fontSize:18, fontWeight:700, color:p2.utbetAr===ar?"#5A3289":"#0D2137" }}>{ar} år</div>
                  </div>
                ))}
              </div>
            </Falt>
            <div style={{ background:"#F5F3FF", border:"1px solid #DDD6FE", borderRadius:12, padding:14, marginBottom:16 }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#5A3289", marginBottom:6 }}>📱 Partners minpension.se</div>
              <div style={{ fontSize:13, color:"#0D2137" }}>
                Gå till minpension.se → Simulera uttag → ålder {p2.pensionsalder} år → {p2.utbetAr} år
              </div>
            </div>
            <Falt label={`Partners tjänstepension (${p2.utbetAr} år) — brutto/mån`}>
              <NI val={p2.tjanstMon} set={v=>u2("tjanstMon",v)} enhet="kr"/>
            </Falt>
            <Falt label="Partners AP — brutto/mån">
              <NI val={p2.apMon} set={v=>u2("apMon",v)} enhet="kr"/>
            </Falt>
            <Falt label="Partners AP börjar vid ålder" hint={`Default: ${p2.pensionsalder} år`}>
              <NI val={p2.apStartAlder||p2.pensionsalder} set={v=>u2("apStartAlder",v)} enhet="år"/>
            </Falt>
            <Falt label="Partners privata kapital">
              <NI val={p2.kapital} set={v=>u2("kapital",v)} enhet="kr"/>
            </Falt>
          </div>
        )}

        {/* STEG 3/5 — Fastigheter */}
        {((steg===3 && !hushall) || (steg===5 && hushall)) && (
          <div>
            <div style={{ fontSize:13, color:"#64748B", marginBottom:16 }}>
              Valfritt — lägg till fastigheter för att se hyresintäkter och ränteavdrag. Hoppa över om du inte äger.
            </div>
            {fastigheter.map((f,i) => (
              <div key={i} style={{ background:"#fff", borderRadius:14, padding:16, marginBottom:12, border:"1px solid #E2E8F0" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <div style={{ fontSize:15, fontWeight:700, color:"#0D2137" }}>{f.namn||`Fastighet ${i+1}`}</div>
                  <button onClick={()=>setFast(fs=>fs.filter((_,j)=>j!==i))}
                    style={{ background:"none", border:"none", color:"#C0392B", fontSize:20, cursor:"pointer", lineHeight:1 }}>×</button>
                </div>
                {[
                  ["Namn",f.namn,v=>setFast(fs=>fs.map((x,j)=>j===i?{...x,namn:v}:x)),"text",""],
                  ["Marknadsvärde",f.varde,v=>setFast(fs=>fs.map((x,j)=>j===i?{...x,varde:+v}:x)),"num","kr"],
                  ["Hyresintäkt brutto/mån",f.hyra,v=>setFast(fs=>fs.map((x,j)=>j===i?{...x,hyra:+v}:x)),"num","kr"],
                  ["Månadsavgift/driftkostnad",f.avgift,v=>setFast(fs=>fs.map((x,j)=>j===i?{...x,avgift:+v}:x)),"num","kr"],
                  ["Lån",f.lan,v=>setFast(fs=>fs.map((x,j)=>j===i?{...x,lan:+v}:x)),"num","kr"],
                  ["Ränta (ex: 0.035 = 3.5%)",f.ranta,v=>setFast(fs=>fs.map((x,j)=>j===i?{...x,ranta:+v}:x)),"num",""],
                ].map(([lbl,val,fn,typ]) => (
                  <div key={lbl} style={{ marginBottom:10 }}>
                    <div style={{ fontSize:12, color:"#64748B", marginBottom:4 }}>{lbl}</div>
                    {typ==="text"
                      ? <input value={val||""} onChange={e=>fn(e.target.value)}
                          style={{ width:"100%", padding:"8px 12px", fontSize:14, border:"1px solid #E2E8F0", borderRadius:8, background:"#F8FAFC", outline:"none", fontFamily:"inherit" }}/>
                      : <NI val={val} set={fn} liten/>
                    }
                  </div>
                ))}
              </div>
            ))}
            <button
              onClick={() => setFast(fs=>[...fs,{namn:`Fastighet ${fs.length+1}`,varde:0,hyra:0,avgift:0,lan:0,ranta:0.035}])}
              style={{ width:"100%", padding:13, borderRadius:12, border:"2px dashed #1659A8", background:"transparent", color:"#1659A8", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              + Lägg till fastighet
            </button>
          </div>
        )}

        {/* SISTA STEGET — Ditt mål */}
        {sistaSteget && (
          <div>
            {/* Hushåll vs individ — tydlig fråga */}
            {hushall && (
              <div style={{ background:"#FFF8E7", border:"2px solid #C08B14", borderRadius:14, padding:16, marginBottom:20 }}>
                <div style={{ fontSize:15, fontWeight:700, color:"#C08B14", marginBottom:12 }}>
                  ⚠️ Avser ditt mål dig eller hushållet?
                </div>
                {[
                  { id:"individuell", ico:"👤", titel:`Bara mig (${p1.namn||"Person 1"})`, sub:"Min personliga nettoinkomst" },
                  { id:"hushall",     ico:"👫", titel:"Hushållet", sub:`${p1.namn||"P1"} och ${p2.namn||"P2"} tillsammans` },
                ].map(o => (
                  <div key={o.id} onClick={()=>setMalTyp(o.id)}
                    style={{ padding:"12px 14px", borderRadius:10, marginBottom:8, cursor:"pointer",
                      border:`2px solid ${malTyp===o.id?"#1659A8":"#E2E8F0"}`,
                      background:malTyp===o.id?"#EFF6FF":"#F8FAFC",
                      display:"flex", alignItems:"center", gap:12 }}>
                    <span style={{ fontSize:24 }}>{o.ico}</span>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:malTyp===o.id?"#1659A8":"#0D2137" }}>{o.titel}</div>
                      <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>{o.sub}</div>
                    </div>
                    {malTyp===o.id && <span style={{ marginLeft:"auto", color:"#1659A8", fontSize:18 }}>✓</span>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ background:"#fff", borderRadius:14, padding:16, boxShadow:"0 2px 8px rgba(0,0,0,.06)", marginBottom:16 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#0D2137", marginBottom:4 }}>
                Önskad nettoinkomst per månad
              </div>
              <div style={{ fontSize:13, color:"#64748B", marginBottom:14 }}>
                {hushall
                  ? malTyp==="individuell"
                    ? `För ${p1.namn||"dig"} personligen (ej hushållet)`
                    : `För ${p1.namn||"P1"} och ${p2.namn||"P2"} tillsammans`
                  : "Din personliga nettoinkomst efter skatt"
                }
              </div>
              {[50000,75000,100000,125000,150000].map(v => (
                <div key={v} onClick={()=>setMal(v)}
                  style={{ padding:"13px 16px", borderRadius:10, marginBottom:8, cursor:"pointer",
                    border:`2px solid ${mal===v?"#1659A8":"#E2E8F0"}`,
                    background:mal===v?"#EFF6FF":"#F8FAFC",
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:16, fontWeight:mal===v?700:400, color:mal===v?"#1659A8":"#0D2137" }}>{kr(v)}/mån</span>
                  {hushall && (
                    <span style={{ fontSize:11, color:"#64748B" }}>
                      {malTyp==="hushall" ? `≈ ${kr(Math.round(v/2))}/pers` : `= ${kr(v*2)} hushåll`}
                    </span>
                  )}
                  {mal===v && <span style={{ color:"#1659A8" }}>✓</span>}
                </div>
              ))}
              <Falt label="Eget belopp">
                <NI val={mal} set={setMal} enhet="kr"/>
              </Falt>
            </div>
          </div>
        )}

        {/* Navigationsknappar */}
        {steg > 0 && (
          <div style={{ display:"flex", gap:10, marginTop:8 }}>
            <button onClick={()=>setSteg(s=>s-1)}
              style={{ flex:1, padding:14, borderRadius:12, border:"none", background:"#E8EEF5", color:"#64748B", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              ← Tillbaka
            </button>
            <button onClick={sistaSteget?klar:()=>setSteg(s=>s+1)}
              style={{ flex:2, padding:14, borderRadius:12, border:"none", background:"#1659A8", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              {sistaSteget ? "Visa min pensionsplan 🚀" : "Nästa →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// HUVUDAPP — 4 flikar: Hem · Prognos · Tips · Indata
// ═══════════════════════════════════════════════════════════
const FLIKAR = [["🏠","Hem"],["📊","Prognos"],["💡","Tips"],["⚙️","Indata"]];

function Huvudapp({ data, setData, sync, setSync, onReset }) {
  const [flik, setFlik] = useState(0);
  const [sparad, setSparad] = useState(false);
  const rader = useMemo(()=>berakna(data),[data]);
  const r0 = rader[0]||{};
  const peak = rader.reduce((b,r)=>r.nettoformogenhet>b.nettoformogenhet?r:b, r0);
  const ry = data.p1.fodelsear + data.p1.pensionsalder;
  const gap = data.mal - (r0.netto||0);
  const pct = Math.min(100, (r0.netto||0)/data.mal*100);
  const tomAr = rader.find(r=>r.kapital<0);

  const uppdatera = nd => { setData(nd); spara(nd); setSparad(true); setTimeout(()=>setSparad(false),2000); };

  const Kort = ({children, stil={}}) => (
    <div style={{ background:"#fff", borderRadius:16, padding:16, boxShadow:"0 2px 10px rgba(0,0,0,.06)", marginBottom:12, ...stil }}>{children}</div>
  );

  const Hdr = ({rubrik, under}) => (
    <div style={{ background:"linear-gradient(135deg,#0D2137,#1659A8)", padding:"52px 20px 20px" }}>
      <div style={{ fontSize:22, fontWeight:700, color:"#fff" }}>{rubrik}</div>
      {under && <div style={{ fontSize:13, color:"rgba(255,255,255,.6)", marginTop:4 }}>{under}</div>}
      {sparad && <div style={{ fontSize:11, color:"rgba(255,255,255,.4)", marginTop:6 }}>✓ Sparad</div>}
    </div>
  );

  // ── HEM ─────────────────────────────────────────────────
  const Hem = () => (
    <div>
      <div style={{ background:"linear-gradient(135deg,#0D2137,#1659A8)", padding:"52px 20px 20px" }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", letterSpacing:1, marginBottom:4 }}>
          {data.hushall?"HUSHÅLLSÖVERSIKT":"PENSIONSÖVERSIKT"}
        </div>
        <div style={{ fontSize:22, fontWeight:700, color:"#fff" }}>
          {data.hushall ? `${data.p1.namn||"P1"} & ${data.p2?.namn||"P2"}` : (data.p1.namn||"Min plan")}
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,.6)", marginTop:2 }}>
          Pension {data.p1.pensionsalder} år · {ry} · {data.p1.kom} ({data.p1.komSkatt}%)
        </div>

        {/* Stor netto-ruta */}
        <div style={{ background:"rgba(255,255,255,.1)", borderRadius:16, padding:16, marginTop:16 }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", marginBottom:4 }}>
            NETTO / MÅN — {data.hushall ? (data.malTyp==="hushall"?"HUSHÅLLET":"PERSON 1") : "DIN PENSION"}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
            <div>
              <div style={{ fontSize:30, fontWeight:700, color:"#fff", lineHeight:1 }}>{kr(r0.netto||0)}</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,.6)", marginTop:6 }}>
                Mål ({data.malTyp==="hushall"?"hushåll":"individuellt"}): {kr(data.malDisplay||data.mal)}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>FÖRMÖGENHET</div>
              <div style={{ fontSize:20, fontWeight:700, color:"#fff" }}>{mkr(r0.nettoformogenhet||0)}</div>
            </div>
          </div>
          <div style={{ marginTop:14 }}>
            <div style={{ height:6, background:"rgba(255,255,255,.2)", borderRadius:99, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${pct}%`, background:pct>=100?"#4ade80":pct>=70?"#fbbf24":"#f87171", borderRadius:99, transition:"width .8s" }}/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
              <span style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>{Math.round(pct)}% av mål</span>
              <span style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>{pct>=100?"✅ Uppnått":kr(gap)+" saknas"}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding:16 }}>
        {/* Varning om kapital tar slut */}
        {tomAr && (
          <div onClick={()=>setFlik(2)} style={{ background:"#FFF1F2", border:"1.5px solid #FCA5A5", borderRadius:12, padding:14, marginBottom:12, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#C0392B" }}>⚠️ Kapital tar slut {tomAr.ar} ({tomAr.ald} år)</div>
              <div style={{ fontSize:12, color:"#64748B" }}>Se åtgärder under Tips →</div>
            </div>
            <span style={{ fontSize:22, color:"#C0392B" }}>›</span>
          </div>
        )}
        {!tomAr && gap<=0 && (
          <Kort stil={{ background:"#F0FDF4", border:"1.5px solid #86EFAC" }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#16784A" }}>✅ Du uppnår ditt mål!</div>
            <div style={{ fontSize:13, color:"#64748B", marginTop:4 }}>Pensionen täcker {kr(data.malDisplay||data.mal)}/mån till minst 85 år</div>
          </Kort>
        )}
        {!tomAr && gap>0 && (
          <div onClick={()=>setFlik(2)} style={{ background:"#FFF8E7", border:"1.5px solid #FCD34D", borderRadius:12, padding:14, marginBottom:12, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#C08B14" }}>Gap mot mål: {kr(gap)}/mån</div>
              <div style={{ fontSize:12, color:"#64748B" }}>Se hur du når ditt mål →</div>
            </div>
            <span style={{ fontSize:22, color:"#C08B14" }}>›</span>
          </div>
        )}

        {/* Inkomstkällor */}
        <Kort>
          <div style={{ fontSize:15, fontWeight:700, color:"#0D2137", marginBottom:14 }}>Inkomstkällor år {ry}</div>
          {/* ── Person 1 ── */}
          {data.hushall && <div style={{ fontSize:12, fontWeight:600, color:"#1659A8", marginBottom:10 }}>👤 {data.p1.namn||"Person 1"} · {data.p1.kom}</div>}
          {r0.tjanst1>0 && (
            <div style={{ marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span style={{ fontSize:13, color:"#64748B" }}>Tjänstepension (brutto)</span>
                <span style={{ fontSize:14, color:"#1659A8" }}>{kr(r0.tjanst1)}/mån</span>
              </div>
              <Pbar pct={(r0.tjanst1/data.mal)*100} col="#1659A8"/>
            </div>
          )}
          {r0.ap1>0 && (
            <div style={{ marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span style={{ fontSize:13, color:"#64748B" }}>Allmän pension AP (brutto)</span>
                <span style={{ fontSize:14, color:"#0C7490" }}>{kr(r0.ap1)}/mån</span>
              </div>
              <Pbar pct={(r0.ap1/data.mal)*100} col="#0C7490"/>
            </div>
          )}
          {r0.brutto1>0 && (
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10, paddingBottom:10, borderBottom:"1px solid #F0F4F8" }}>
              <span style={{ fontSize:13, color:"#64748B" }}>varav skatt {data.p1.komSkatt}%</span>
              <span style={{ fontSize:13, color:"#C0392B" }}>−{kr(r0.brutto1 - r0.netto1)}/mån</span>
            </div>
          )}
          {/* ── Person 2 — samma struktur som P1 ── */}
          {data.hushall && data.p2 && (r0.tjanst2>0||r0.ap2>0) && (
            <>
              <div style={{ fontSize:12, fontWeight:600, color:"#5A3289", margin:"4px 0 10px" }}>👤 {data.p2?.namn||"Person 2"} · {data.p2?.kom}</div>
              {r0.tjanst2>0 && (
                <div style={{ marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:13, color:"#64748B" }}>Tjänstepension (brutto)</span>
                    <span style={{ fontSize:14, color:"#5A3289" }}>{kr(r0.tjanst2)}/mån</span>
                  </div>
                  <Pbar pct={(r0.tjanst2/data.mal)*100} col="#5A3289"/>
                </div>
              )}
              {r0.ap2>0 && (
                <div style={{ marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:13, color:"#64748B" }}>Allmän pension AP (brutto)</span>
                    <span style={{ fontSize:14, color:"#5A3289" }}>{kr(r0.ap2)}/mån</span>
                  </div>
                  <Pbar pct={(r0.ap2/data.mal)*100} col="#5A3289"/>
                </div>
              )}
              {r0.netto2>0 && (
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10, paddingBottom:10, borderBottom:"1px solid #F0F4F8" }}>
                  <span style={{ fontSize:13, color:"#64748B" }}>varav skatt {data.p2?.komSkatt}%</span>
                  <span style={{ fontSize:13, color:"#C0392B" }}>−{kr((r0.tjanst2||0)+(r0.ap2||0) - r0.netto2)}/mån</span>
                </div>
              )}
            </>
          )}
          {r0.hyra>0 && (
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
              <span style={{ fontSize:13, color:"#64748B" }}>Hyresintäkt (netto efter skatt)</span>
              <span style={{ fontSize:14, fontWeight:600, color:"#16784A" }}>{kr(r0.hyra)}/mån</span>
            </div>
          )}
          <div style={{ borderTop:"2px solid #E2E8F0", paddingTop:12, marginTop:4, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#0D2137" }}>Totalt netto</div>
              <div style={{ fontSize:11, color:"#64748B" }}>efter skatt, ränteavdrag och kostnader</div>
            </div>
            <span style={{ fontSize:20, fontWeight:700, color:(r0.netto||0)>=data.mal?"#16784A":"#C08B14" }}>{kr(r0.netto||0)}</span>
          </div>
        </Kort>

        {/* Nyckeltal */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          {[
            ["Toppår",mkr(peak.nettoformogenhet),peak.ar+"","#16784A"],
            ["75 år",mkr(rader[12]?.nettoformogenhet||0),(data.p1.fodelsear+75)+"","#1659A8"],
            ["85 år",mkr(rader[22]?.nettoformogenhet||0),(data.p1.fodelsear+85)+"",tomAr?"#C0392B":"#5A3289"],
          ].map(([l,v,ar,c]) => (
            <div key={l} style={{ background:"#fff", borderRadius:12, padding:12, boxShadow:"0 2px 8px rgba(0,0,0,.05)", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#64748B" }}>{l}</div>
              <div style={{ fontSize:14, fontWeight:700, color:c, marginTop:4 }}>{v}</div>
              <div style={{ fontSize:10, color:"#94A3B8", marginTop:2 }}>{ar}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── PROGNOS ─────────────────────────────────────────────
  const Prognos = () => (
    <div>
      <Hdr rubrik="Prognos år för år" under={`${data.p1.kom} ${data.p1.komSkatt}% · ${data.hushall?"Hushållets":"Din"} nettoinkomst`}/>
      <div style={{ padding:16 }}>
        <Kort>
          {/* Förklaring av kapitaluttag */}
          <div style={{ background:"#EFF6FF", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color:"#1659A8", lineHeight:1.6 }}>
            <b>Så fungerar prognosen:</b> Pension + hyra = inkomst. Om inkomsten är lägre än ditt mål tas mellanskillnaden ur ditt privata sparkapital. Räcker inte sparkapitalet visas <b style={{color:"#C0392B"}}>Kap.tomt</b> — det privata sparkapitalet är slut det året. Pension betalas ändå ut.
          </div>
          {rader.slice(0,18).map((r,i) => {
            const ok=r.netto>=data.mal, nara=r.netto>=data.mal*0.85;
            const pensionNetto = r.netto1 + r.netto2;
            const kapUttag = r.uttag > 0 ? Math.round(r.uttag) : 0;
            const kapUrSpar = kapUttag > 0;
            return (
              <div key={r.ar} style={{ padding:"12px 0", borderBottom:i<17?"1px solid #F0F4F8":"none" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                  <div>
                    <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:"#1659A8", minWidth:36 }}>{r.ar}</span>
                      <span style={{ fontSize:11, color:"#64748B" }}>{r.ald} år</span>
                      {r.tjanst1>0 && <span style={{ background:"#EFF6FF", color:"#1659A8", borderRadius:99, padding:"1px 6px", fontSize:9 }}>Tjänst</span>}
                      {r.ap1>0    && <span style={{ background:"#F0FDFA", color:"#0C7490", borderRadius:99, padding:"1px 6px", fontSize:9 }}>AP</span>}
                      {tomAr && r.ar>=tomAr.ar && (
                        <span style={{ background:"#FFF1F2", color:"#C0392B", borderRadius:99, padding:"1px 6px", fontSize:9 }}>
                          ⚠️ Kapital slut
                        </span>
                      )}
                    </div>
                    {/* Inkomstkällor */}
                    <div style={{ fontSize:11, color:"#64748B" }}>
                      Pension netto: {kr(pensionNetto)}
                      {r.hyra>0 && ` · Hyra: ${kr(r.hyra)}`}
                      {kapUrSpar && !( tomAr && r.ar>=tomAr.ar) && (
                        <span style={{ color:"#C08B14" }}> · Kapitaluttag: {kr(kapUttag)}/mån</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0, marginLeft:8 }}>
                    <div style={{ fontSize:15, fontWeight:700, color:ok?"#16784A":nara?"#C08B14":"#C0392B" }}>
                      {kr(r.netto)} netto
                    </div>
                    <div style={{ fontSize:10, color:"#94A3B8" }}>
                      brutto {kr((r.tjanst1||0)+(r.ap1||0))}
                    </div>
                  </div>
                </div>
                <Pbar pct={(r.netto/data.mal)*100} col={ok?"#16784A":nara?"#C08B14":"#C0392B"}/>
                {/* Kapital kvar — liten indikator */}
                {kapUrSpar && r.kapital > 0 && !(tomAr && r.ar>=tomAr.ar) && (
                  <div style={{ fontSize:10, color:"#C08B14", marginTop:3 }}>
                    Sparkapital kvar: {mkr(r.kapital)} · Täcker ca {Math.round(r.kapital/(kapUttag*12))} år
                  </div>
                )}
              </div>
            );
          })}
        </Kort>
      </div>
    </div>
  );

  // ── TIPS ────────────────────────────────────────────────
  const Tips = () => {
    const [lv, setLv] = useState(5000);
    const yrs = Math.max(1, data.yearsLeft || Math.max(1,(data.p1.fodelsear+data.p1.pensionsalder)-2024));
    const marg = (data.p1.lön||0)*12>643100 ? 0.52 : Math.min(0.56,(data.p1.komSkatt||30)/100+0.03);
    const lvSkatt = Math.round(lv*marg);
    const lvPen   = Math.round(lv*12*((Math.pow(1.025,yrs)-1)/0.025)/(15*12));

    return (
      <div>
        <Hdr rubrik="Tips & åtgärder" under={gap>0?`Gap mot mål: ${kr(gap)}/mån`:"Du är i mål!"}/>
        <div style={{ padding:16 }}>

          {/* Status */}
          <Kort stil={{ background:gap<=0?"#F0FDF4":"#FFF8E7", borderLeft:`4px solid ${gap<=0?"#16784A":"#C08B14"}` }}>
            <div style={{ fontSize:15, fontWeight:700, color:gap<=0?"#16784A":"#C08B14" }}>
              {gap<=0 ? "✅ Du uppnår ditt mål!" : "Möjliga åtgärder"}
            </div>
            <div style={{ display:"flex", gap:20, marginTop:8, fontSize:13, color:"#64748B" }}>
              <span>Prognos: <b style={{color:"#0D2137"}}>{kr(r0.netto||0)}</b></span>
              <span>Mål: <b style={{color:"#0D2137"}}>{kr(data.malDisplay||data.mal)}</b></span>
            </div>
          </Kort>

          {/* Hur kapital används */}
          {rader.some(r=>r.uttag>0) && (
            <Kort stil={{ background:"#FFFBEB", borderLeft:"4px solid #C08B14" }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#C08B14", marginBottom:8 }}>💰 Hur sparkapitalet används</div>
              <div style={{ fontSize:13, color:"#64748B", lineHeight:1.7, marginBottom:10 }}>
                När pensionen är lägre än ditt mål på <b>{kr(data.malDisplay||data.mal)}/mån</b> tas mellanskillnaden 
                automatiskt ur ditt privata sparkapital (ISK/fonder). Kapitalet växer med {(data.kapRet*100).toFixed(1)}%/år 
                men minskar när uttag görs.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div style={{ background:"#fff", borderRadius:10, padding:10 }}>
                  <div style={{ fontSize:11, color:"#64748B" }}>Kapital vid pension</div>
                  <div style={{ fontSize:15, fontWeight:700, color:"#1659A8", marginTop:3 }}>{mkr(rader[0]?.kapital||0)}</div>
                </div>
                <div style={{ background:"#fff", borderRadius:10, padding:10 }}>
                  <div style={{ fontSize:11, color:"#64748B" }}>Snitt uttag/mån</div>
                  <div style={{ fontSize:15, fontWeight:700, color:"#C08B14", marginTop:3 }}>
                    {kr(Math.round(rader.filter(r=>r.uttag>0).reduce((s,r)=>s+r.uttag,0)/Math.max(1,rader.filter(r=>r.uttag>0).length)))}
                  </div>
                </div>
              </div>
            </Kort>
          )}
          {/* Kapital tar slut */}
          {tomAr && (
            <Kort stil={{ borderLeft:"4px solid #C0392B" }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#C0392B", marginBottom:8 }}>⚠️ Kapital tar slut {tomAr.ar} ({tomAr.ald} år)</div>
              <div style={{ fontSize:13, color:"#64748B", lineHeight:1.7, marginBottom:10 }}>
                Det privata sparkapitalet beräknas vara slut vid {tomAr.ald} år. <b>Din pension betalas ändå ut</b> — det är bara 
                möjligheten att ta extra från sparkapitalet som upphör.
              </div>
              <div style={{ fontSize:13, color:"#0D2137", fontWeight:600, marginBottom:6 }}>Möjliga åtgärder:</div>
              {[
                "Gå i pension 1–2 år senare (+8% AP per år)",
                "Löneväxla mer nu → mer kapital vid pension",
                "Hyr ut fastighet för extra kassaflöde",
                "Sänk nettomålet något de första åren",
              ].map(t=>(
                <div key={t} style={{ display:"flex", gap:8, marginBottom:6, fontSize:13, color:"#64748B" }}>
                  <span style={{ color:"#1659A8", flexShrink:0 }}>→</span>{t}
                </div>
              ))}
            </Kort>
          )}

          {/* Pensionsålderjämförelse */}
          <Kort>
            <div style={{ fontSize:15, fontWeight:700, color:"#0D2137", marginBottom:12 }}>⏳ Vad händer om du väntar?</div>
            {[0,1,2,3].map(x => {
              // AP ökar ~8%/år vid senareläggning (schablon Pensionsmyndigheten)
              // Tjänstepension är fast (från minpension.se, väljs av användaren)
              const apJusterat = Math.round((data.p1.apMon||0) * Math.pow(1.08, x));
              const tjanstJusterat = data.p1.tjanstMon || 0; // fast belopp
              const td = {...data, p1:{...data.p1, pensionsalder:data.p1.pensionsalder+x, apMon:apJusterat, tjanstMon:tjanstJusterat}};
              const tr = berakna(td)[0];
              const diff = (tr.netto||0)-(r0.netto||0);
              return (
                <div key={x} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:x<3?"1px solid #F0F4F8":"none" }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:x===0?700:400, color:"#0D2137" }}>
                      {data.p1.pensionsalder+x} år{x===0?" (din plan)":""}
                    </div>
                    <div style={{ fontSize:11, color:"#64748B" }}>
                      {data.p1.fodelsear+data.p1.pensionsalder+x}
                      {x>0&&data.p1.apMon>0 && <span style={{color:"#0C7490"}}> · AP +{Math.round((Math.pow(1.08,x)-1)*100)}%</span>}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:15, fontWeight:700, color:(tr.netto||0)>=data.mal?"#16784A":"#C08B14" }}>{kr(tr.netto||0)}/mån</div>
                    {x>0 && <div style={{ fontSize:12, color:"#16784A" }}>+{kr(diff)}/mån</div>}
                  </div>
                </div>
              );
            })}
          <div style={{ fontSize:11, color:"#64748B", marginTop:10, padding:"8px 12px", background:"#F8FAFC", borderRadius:8 }}>
            AP ökar ~8% per år du väntar (schablon). Tjänstepension är fast enligt minpension.se.
          </div>
          </Kort>

          {/* Löneväxling */}
          {(data.p1.lön||0)>0 && (
            <Kort>
              <div style={{ fontSize:15, fontWeight:700, color:"#0D2137", marginBottom:6 }}>💼 Löneväxlingskalkylator</div>
              <div style={{ fontSize:13, color:"#64748B", marginBottom:16, lineHeight:1.5 }}>
                Byt lön mot pension — spara {Math.round(marg*100)}% i marginalskatt idag.
              </div>
              <div style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:13, color:"#64748B" }}>Löneväxla per månad</span>
                  <span style={{ fontSize:16, fontWeight:700, color:"#1659A8" }}>{kr(lv)}</span>
                </div>
                <input type="range" min={500} max={15000} step={500} value={lv}
                  onChange={e=>setLv(+e.target.value)}
                  style={{ width:"100%", accentColor:"#1659A8" }}/>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div style={{ background:"#F0FDF4", borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:12, color:"#64748B" }}>Skattelättnad nu</div>
                  <div style={{ fontSize:16, fontWeight:700, color:"#16784A", marginTop:4 }}>{kr(lvSkatt)}/mån</div>
                </div>
                <div style={{ background:"#EFF6FF", borderRadius:10, padding:12 }}>
                  <div style={{ fontSize:12, color:"#64748B" }}>Mer i pension</div>
                  <div style={{ fontSize:16, fontWeight:700, color:"#1659A8", marginTop:4 }}>{kr(lvPen)}/mån</div>
                </div>
              </div>
            </Kort>
          )}

          {/* Sparande */}
          <Kort>
            <div style={{ fontSize:15, fontWeight:700, color:"#0D2137", marginBottom:12 }}>💰 Förmögenhet över tid</div>
            <Spark rows={rader}/>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, fontSize:12, color:"#64748B" }}>
              <span>Start: <b style={{color:"#0D2137"}}>{mkr(r0.nettoformogenhet||0)}</b></span>
              <span>Topp: <b style={{color:"#16784A"}}>{mkr(peak.nettoformogenhet)}</b></span>
              <span>85år: <b style={{color:tomAr?"#C0392B":"#5A3289"}}>{mkr(rader[22]?.nettoformogenhet||0)}</b></span>
            </div>
          </Kort>

          {/* Skattetips */}
          {[
            (data.p1.kapital||0)>500000 && ["📊","ISK-konto","ISK-schablonsskatt (0,888%) är lägre än 30% reavinstskatt. Förmånligare om du inte tar ut kapital ofta."],
            data.hushall && ["⚖️","Optimera uttag","Ta ut pension från den med lägst inkomst först — undviker statlig skatt (20%) på inkomst över 643 100 kr/år."],
            data.fastigheter?.length>0 && ["🏠","Ränteavdrag","Du drar av 30% av räntekostnaderna. Se till att detta är korrekt i deklarationen."],
          ].filter(Boolean).map(([ico,tit,desc]) => (
            <Kort key={tit} stil={{ borderLeft:"4px solid #0C7490" }}>
              <div style={{ display:"flex", gap:12 }}>
                <span style={{ fontSize:24, flexShrink:0 }}>{ico}</span>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:"#0D2137", marginBottom:4 }}>{tit}</div>
                  <div style={{ fontSize:13, color:"#64748B", lineHeight:1.6 }}>{desc}</div>
                </div>
              </div>
            </Kort>
          ))}
        </div>
      </div>
    );
  };

  // ── INDATA ──────────────────────────────────────────────
  const Indata = () => {
    const [lok, setLok] = useState({...data});
    const F = ({label,val,set,enhet,hint}) => (
      <Falt label={label} hint={hint}>
        <NI val={val} set={set} enhet={enhet}/>
      </Falt>
    );
    return (
      <div>
        <Hdr rubrik="Justera uppgifter"/>
        <div style={{ padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:16, boxShadow:"0 2px 10px rgba(0,0,0,.06)", marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#64748B", letterSpacing:1, marginBottom:14 }}>PERSON 1 — {lok.p1.namn}</div>
            <F label="Pensionsålder" val={lok.p1.pensionsalder} set={v=>setLok(l=>({...l,p1:{...l.p1,pensionsalder:v}}))} enhet="år" hint={`Pensioneras ${lok.p1.fodelsear+lok.p1.pensionsalder}`}/>
            <Falt label="Utbetalningstid">
              <div style={{ display:"flex", gap:8 }}>
                {[15,20].map(ar=>(
                  <div key={ar} onClick={()=>setLok(l=>({...l,p1:{...l.p1,utbetAr:ar}}))}
                    style={{ flex:1, padding:"10px", borderRadius:10, cursor:"pointer", textAlign:"center",
                      border:`2px solid ${lok.p1.utbetAr===ar?"#1659A8":"#E2E8F0"}`,
                      background:lok.p1.utbetAr===ar?"#EFF6FF":"#F8FAFC" }}>
                    <span style={{ fontSize:14, fontWeight:700, color:lok.p1.utbetAr===ar?"#1659A8":"#0D2137" }}>{ar} år</span>
                  </div>
                ))}
              </div>
            </Falt>
            <F label="Tjänstepension (brutto/mån)" val={lok.p1.tjanstMon} set={v=>setLok(l=>({...l,p1:{...l.p1,tjanstMon:v}}))} enhet="kr" hint="Från minpension.se"/>
            <F label="AP (brutto/mån)" val={lok.p1.apMon} set={v=>setLok(l=>({...l,p1:{...l.p1,apMon:v}}))} enhet="kr" hint="Från minpension.se — brutto före skatt"/>
            <F label="AP börjar vid ålder" val={lok.p1.apStartAlder||lok.p1.pensionsalder} set={v=>setLok(l=>({...l,p1:{...l.p1,apStartAlder:v}}))} enhet="år" hint={`Om du tar ut AP samma år som du pensioneras: ${lok.p1.pensionsalder} år`}/>
            <F label="Privat kapital" val={lok.p1.kapital} set={v=>setLok(l=>({...l,p1:{...l.p1,kapital:v}}))} enhet="kr"/>
            <F label="Lön brutto/mån (för löneväxling)" val={lok.p1.lön} set={v=>setLok(l=>({...l,p1:{...l.p1,lön:v}}))} enhet="kr"/>
            <Falt label="Kommun">
              <Kommunsok val={lok.p1.kom} skatt={lok.p1.komSkatt} onChange={(n,r)=>setLok(l=>({...l,p1:{...l.p1,kom:n,komSkatt:r}}))}/>
            </Falt>

            {lok.hushall && lok.p2 && <>
              <div style={{ fontSize:12, fontWeight:700, color:"#64748B", letterSpacing:1, margin:"20px 0 14px", paddingTop:16, borderTop:"1px solid #F0F4F8" }}>PERSON 2 — {lok.p2.namn}</div>
              <F label="Pensionsålder" val={lok.p2.pensionsalder} set={v=>setLok(l=>({...l,p2:{...l.p2,pensionsalder:v}}))} enhet="år"/>
              <F label="Tjänstepension (brutto/mån)" val={lok.p2.tjanstMon} set={v=>setLok(l=>({...l,p2:{...l.p2,tjanstMon:v}}))} enhet="kr" hint="Från minpension.se"/>
              <F label="AP (brutto/mån)" val={lok.p2.apMon} set={v=>setLok(l=>({...l,p2:{...l.p2,apMon:v}}))} enhet="kr"/>
              <F label="AP börjar vid ålder" val={lok.p2.apStartAlder||lok.p2.pensionsalder} set={v=>setLok(l=>({...l,p2:{...l.p2,apStartAlder:v}}))} enhet="år"/>
              <F label="Privat kapital" val={lok.p2.kapital} set={v=>setLok(l=>({...l,p2:{...l.p2,kapital:v}}))} enhet="kr"/>
              <Falt label="Kommun">
                <Kommunsok val={lok.p2.kom} skatt={lok.p2.komSkatt} onChange={(n,r)=>setLok(l=>({...l,p2:{...l.p2,kom:n,komSkatt:r}}))}/>
              </Falt>
            </>}

            <div style={{ borderTop:"1px solid #F0F4F8", paddingTop:16, marginTop:4 }}>
              <F label="Nettomål per månad" val={lok.malDisplay||lok.mal} enhet="kr"
                set={v=>{const n=lok.malTyp==="individuell"&&lok.hushall?v*2:v;setLok(l=>({...l,mal:n,malDisplay:v}));}}/>
            </div>
          </div>

          {/* Sync toggle */}
          <div style={{ background:"#fff", borderRadius:14, padding:16, boxShadow:"0 2px 8px rgba(0,0,0,.05)", marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:sync?"#1659A8":"#0D2137" }}>{sync?"☁️ Molnsynk aktiverad":"📱 Lokal lagring"}</div>
                <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>{sync?"EU-servrar · Krypterat":"Bara på denna enhet"}</div>
              </div>
              <Toggle on={sync} set={v=>{setSync(v);try{localStorage.setItem("pv7sync",v?"1":"0");}catch{}}}/>
            </div>
          </div>

          <button onClick={()=>uppdatera(lok)} style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:"#1659A8", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit", marginBottom:10 }}>
            ✓ Spara ändringar
          </button>
          <button onClick={()=>{if(window.confirm("Radera allt och börja om?")) onReset();}}
            style={{ width:"100%", padding:12, borderRadius:10, border:"1px solid #E2E8F0", background:"#fff", color:"#64748B", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
            Nollställ — börja om från start
          </button>
        </div>
      </div>
    );
  };

  const SKARMAR = [Hem, Prognos, Tips, Indata];
  const Aktiv = SKARMAR[flik];

  return (
    <div style={{ maxWidth:390, margin:"0 auto", background:"#F0F4F8", minHeight:"100vh" }}>
      <div style={{ paddingBottom:70 }}><Aktiv/></div>
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:390, background:"rgba(255,255,255,.96)", backdropFilter:"blur(12px)", borderTop:"1px solid #E2E8F0", display:"flex", padding:"6px 0 16px", zIndex:100 }}>
        {FLIKAR.map(([ico,lbl],i) => (
          <div key={lbl} onClick={()=>setFlik(i)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2, cursor:"pointer", padding:"6px 0", color:flik===i?"#1659A8":"#64748B", fontSize:10, fontWeight:flik===i?700:400 }}>
            <span style={{ fontSize:22 }}>{ico}</span>
            {lbl}
            {flik===i && <div style={{ width:18, height:2, background:"#1659A8", borderRadius:99, marginTop:2 }}/>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════
export default function App() {
  // Nollställ all sparad data vid start — ren slate
  useEffect(() => {
    ["pv7","pv7sync","pv7w","pv6","pa5","pa5sync","pa5w","pa6","pa6sync","pa6w",
     "pensionsappen_v5","pensionsappen_sync","pensionsappen_welcomed",
     "pensionsappen_v4","pensionsappen_data"].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
  }, []);

  const [data, setData]       = useState(null);
  const [sync, setSync]       = useState(false);
  const [välkommen, setVälk]  = useState(false);

  const hanteraIntegritet = (wantsSync) => {
    setSync(wantsSync);
    try { localStorage.setItem("pv7sync", wantsSync?"1":"0"); } catch {}
    setVälk(true);
  };

  const nollstall = () => {
    ["pv7","pv7sync","pv7w"].forEach(k=>{ try{localStorage.removeItem(k);}catch{} });
    setData(null); setSync(false); setVälk(false);
  };

  if (!välkommen) return <Integritet onKlar={hanteraIntegritet}/>;
  if (!data)      return <Onboarding onKlar={d=>{spara(d);setData(d);}}/>;
  return <Huvudapp data={data} setData={setData} sync={sync} setSync={setSync}
    onReset={nollstall}/>;
}
