// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

// ------------------------------
// Firebase (Realtime Database)
// ------------------------------
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, update, onValue, get, child } from "firebase/database";

const env = import.meta.env || {};
const FIREBASE_CONFIG = {
  apiKey:            env.VITE_FIREBASE_API_KEY        || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.apiKey : undefined),
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN     || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.authDomain : undefined),
  databaseURL:       env.VITE_FIREBASE_DATABASE_URL    || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.databaseURL : undefined),
  projectId:         env.VITE_FIREBASE_PROJECT_ID      || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.projectId : undefined),
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET  || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.storageBucket : undefined),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.messagingSenderId : undefined),
  appId:             env.VITE_FIREBASE_APP_ID          || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.appId : undefined),
};

if (!FIREBASE_CONFIG.databaseURL || !FIREBASE_CONFIG.projectId) {
  console.error("[Firebase] Missing databaseURL or projectId.");
}

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ------------------------------
// Design system + Table styles
// ------------------------------
const FELT = "#135f39";
const FELT_DARK = "#0e4c2e";
const ui = {
  viewport: { minHeight: "100vh", background: "radial-gradient(1000px 600px at 50% -100px, #196a42, #0c3d27)", color: "#0c1b12", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
  shell:    { position: "relative", maxWidth: 1280, margin: "0 auto", padding: 16, minHeight: "100vh" },
  tableWrap:   { position: "relative", margin: "60px auto 220px", width: "100%", maxWidth: 1100, height: 540 },
  tableSurface:{ position: "absolute", inset: 0, borderRadius: 520, background: `radial-gradient(1200px 600px at 50% 30%, ${FELT}, ${FELT_DARK})`, boxShadow: "0 60px 140px rgba(0,0,0,.45), inset 0 8px 20px rgba(255,255,255,.12), inset 0 -8px 24px rgba(0,0,0,.25)", border: "10px solid #3e2b18", outline: "1px solid rgba(255,255,255,.04)" },
  seatPlaque:  { position:"absolute", minWidth: 220, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.09)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,.12)", color:"#eafff0" },
  seatTitle:   { fontSize: 14, fontWeight: 700 },
  seatMeta:    { fontSize: 12, opacity:.9, marginTop: 4 },
  topSeat:     { top:-36, left:"50%", transform:"translateX(-50%)" },
  rightTop:    { right:-10, top:"20%", transform:"translateY(-50%)" },
  rightBottom: { right:-10, top:"70%", transform:"translateY(-50%)" },
  bottomSeat:  { bottom:-36, left:"50%", transform:"translateX(-50%)" },
  leftMid:     { left:-10, top:"45%", transform:"translateY(-50%)" },
  belt:        { display:"flex", flexWrap:"wrap", gap:8, marginTop:8 },
  tray:        { position:"fixed", left:"50%", bottom: 16, transform:"translateX(-50%)", width:"min(1180px, 96vw)", background:"rgba(255,255,255,.96)", border:"1px solid #e6ece8", borderRadius:16, padding:12, boxShadow:"0 18px 80px rgba(0,0,0,.25)" },
  trayTitleRow:{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:6 },
  textXs:      { fontSize: 12, color:"#344e3e" },
  actionsRow:  { display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" },
  btn:         { border:"0", borderRadius:10, padding:"10px 14px", fontWeight:700, cursor:"pointer" },
  btnDark:     { background:"#13251b", color:"#fff" },
  btnBlue:     { background:"#2563EB", color:"#fff" },
  btnGreen:    { background:"#059669", color:"#fff" },
  btnAmber:    { background:"#D97706", color:"#fff" },
  btnGray:     { background:"#E5E7EB", color:"#0f1f17" },
  cardWrap:    { display:"inline-flex", flexDirection:"column", alignItems:"center", marginRight:6, marginBottom:6 },
  cardBox:     { width: 56, height: 76, borderRadius: 10, background:"#fff", border:"1px solid #dbe3dd", boxShadow: "0 2px 8px rgba(16,24,40,.10)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" },
  pS:(red)=>({ fontSize: 18, lineHeight:"18px", color:red? "#e11d48":"#0f172a" }),
  pR:(red)=>({ fontSize: 10, lineHeight:"10px", color:red? "#e11d48":"#0f172a" }),
  pill:       { display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:999, background:"#eef2ff", color:"#3730a3", border:"1px solid #c7d2fe", fontSize:12 },
  namePanel:  { position:"fixed", left:"50%", top: 28, transform:"translateX(-50%)", background:"rgba(255,255,255,.96)", border:"1px solid #e6ece8", borderRadius:14, padding:"10px 12px", boxShadow:"0 10px 40px rgba(0,0,0,.2)", display:"flex", alignItems:"center", gap:8, zIndex:1000, pointerEvents:"auto" },
  input:      { border:"1px solid #d1d5db", borderRadius:10, padding:"8px 10px", outline:"none" },
  mono:       { fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }
};

// ------------------------------
// Helpers, constants & rules
// ------------------------------
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const rankIndex = (r) => RANKS.indexOf(r);
const suitIndex = (s) => SUITS.indexOf(s);

const CARD_W = 56;
const CARD_G = 6;
const SLOT_W = CARD_W + CARD_G;

function sortHandDefault(deck, handIds) {
  return [...handIds].sort((aId, bId) => {
    const a = deck[aId], b = deck[bId];
    const sc = suitIndex(a.suit) - suitIndex(b.suit);
    if (sc !== 0) return sc;
    return rankIndex(a.rank) - rankIndex(b.rank);
  });
}

function shuffle(arr, seed){
  const a = arr.slice();
  let s = seed;
  const rnd = () => (s = (s*1664525 + 1013904223) % 4294967296)/4294967296;
  for(let i=a.length-1; i>0; i--){ const j = Math.floor(rnd()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}

function generateDeck(n=3){
  const out = [];
  for(let d=0; d<n; d++)
    for(const suit of SUITS)
      for(const rank of RANKS)
        out.push({ id:`${d}-${suit}-${rank}-${Math.random().toString(36).slice(2,8)}`, suit, rank });
  return out;
}

const isUpper=(c,h)=> c.suit===h.suit && c.rank===RANKS[(rankIndex(h.rank)+1)%RANKS.length];
const isLower=(c,h)=> c.suit===h.suit && c.rank===RANKS[(rankIndex(h.rank)-1+RANKS.length)%RANKS.length];
const isWild =(c,h)=> c.rank===h.rank || isUpper(c,h) || isLower(c,h);
const roundToNearest10 = (n)=> Math.round(n/10)*10;

const asArray = (v) =>
  Array.isArray(v) ? v :
  (v && typeof v === "object") ? Object.values(v) : [];

const countPureMelds = (melds) =>
  asArray(melds).filter(m => m.type === "PURE_RUN" || m.type === "TUNNELA").length;

function nextActiveSeat(players, start) {
  if (!Array.isArray(players) || players.length === 0) return 0;
  let s = start;
  for (let i = 0; i < players.length; i++) {
    s = (s + 1) % players.length;
    if ((players[s]?.name || "").trim()) return s;
  }
  return 0;
}

function isSeatActive(p) {
  return !!((p?.name || "").trim());
}

// ------------------------------
// Component
// ------------------------------
export default function MarriageRummyOnline(){
  const [meName, setMeName] = useState("");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]);
  const [dragInfo, setDragInfo] = useState(null);
  const [toast, setToast] = useState("");
  const handRef = useRef(null);

  useEffect(() => {
    try { const saved = localStorage.getItem("mr_name"); if (saved) setMeName(saved); } catch (_) {}
  }, []);

  const ROOM_ID = "global";

  useEffect(() => {
    (async () => {
      const snap = await get(child(ref(db), `rooms/${ROOM_ID}`));
      if (!snap.exists()) {
        const newRoom = createRoom(5);
        await set(ref(db, `rooms/${ROOM_ID}`), newRoom);
      }
      const unsub = onValue(ref(db, `rooms/${ROOM_ID}`), s => s.val() && setRoom(s.val()));
      return () => unsub();
    })();
  }, []);

  const playersN = asArray(room?.players);
  const stockN   = asArray(room?.stock);
  const discardN = asArray(room?.discard);
  const currentIdx = Number.isInteger(room?.current) ? room.current : 0;
  const currentP   = playersN[currentIdx];
  const myP        = useMemo(()=> playersN[meSeat ?? -1], [playersN, meSeat]);

  function dispatchAction(partial){ if(room) update(ref(db, `rooms/${ROOM_ID}`), partial); }

  function flashToast(msg){
    setToast(msg);
    window.clearTimeout(flashToast._t);
    flashToast._t = window.setTimeout(()=>setToast(""), 1400);
  }

  // --- NEW: Hand Sort Handler ---
  async function handleSortHand() {
    if (!myP || !room || meSeat === null) return;
    const sortedHandIds = sortHandDefault(room.deck, myP.hand || []);
    const nextPlayers = [...playersN];
    nextPlayers[meSeat] = { ...myP, hand: sortedHandIds };
    await update(ref(db, `rooms/${ROOM_ID}`), { players: nextPlayers });
    flashToast("Hand sorted ♠♥");
  }

  // Round/Seat management
  async function startNewRound() {
    if (!room) return;
    const deckArr = generateDeck(3);
    const deck = Object.fromEntries(deckArr.map(c => [c.id, c]));
    const seed = Math.floor(Math.random() * 1e9);
    const order = shuffle(Object.keys(deck), seed);
    const hiddenJokerId = order[0];
    const nextPlayers = playersN.map(p => ({ ...p }));
    const activeIdxs = nextPlayers.map((p, i) => ((p?.name || "").trim() ? i : null)).filter(i => i !== null);

    if (activeIdxs.length === 0) {
      await update(ref(db, `rooms/${ROOM_ID}`), { phase: "LOBBY", lastAction: "No active seats." });
      flashToast("Add players first");
      return;
    }

    for (let i = 0; i < nextPlayers.length; i++) {
      nextPlayers[i] = { ...nextPlayers[i], hand: [], melds: [], qualifies: false, hasPeeked: false, hasPicked: false };
    }

    let stock = order.slice(1);
    let t = 0;
    for (let i = 0; i < activeIdxs.length * 21; i++) {
      nextPlayers[activeIdxs[t]].hand.push(stock[i]);
      t = (t + 1) % activeIdxs.length;
    }
    stock = stock.slice(activeIdxs.length * 21);

    for (const i of activeIdxs) {
      nextPlayers[i].hand = sortHandDefault(deck, nextPlayers[i].hand);
    }

    const first = isSeatActive(nextPlayers[room.current]) ? room.current : nextActiveSeat(nextPlayers, room.current - 1);
    await update(ref(db, `rooms/${ROOM_ID}`), { deck, stock, discard: [], players: nextPlayers, current: first, phase: "PLAY", seed, hiddenJokerId, lastAction: "New round dealt." });
  }

  async function claimSeat(seat){
    if (!room) return;
    const name = (meName || "").trim();
    if (!name) { flashToast("Enter a name first"); return; }
    const current = playersN.slice();
    current[seat] = { ...current[seat], seat, name };
    await update(ref(db, `rooms/${ROOM_ID}`), { players: current });
    setMeSeat(seat);
    flashToast("Seated ✔");
  }

  async function saveName(){
    const name = (meName || "").trim();
    try { localStorage.setItem("mr_name", name); } catch (_) {}
    if (meSeat !== null) {
      await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { name: name || `Player ${meSeat+1}` });
      flashToast("Saved ✔");
    }
  }

  // Turn Logic
  function drawStock(){
    if(!room || meSeat!==currentIdx || stockN.length===0) return;
    const nextStock = stockN.slice(); const cardId = nextStock.shift();
    const nextPlayers = playersN.slice();
    nextPlayers[currentIdx] = { ...myP, hasPicked:true, hand:[...(myP.hand||[]), cardId] };
    dispatchAction({ stock: nextStock, players: nextPlayers, lastAction: `${myP.name} drew.` });
  }

  function takeDiscard(){
    if(!room || meSeat!==currentIdx || discardN.length===0) return;
    const nextDiscard = discardN.slice(); const cardId = nextDiscard.pop();
    const nextPlayers = playersN.slice();
    nextPlayers[currentIdx] = { ...myP, hasPicked:true, hand:[...(myP.hand||[]), cardId] };
    dispatchAction({ discard: nextDiscard, players: nextPlayers, lastAction: `${myP.name} took discard.` });
  }

  function discardCard(cardId){
    if(!room || meSeat!==currentIdx) return;
    const nextPlayers = playersN.slice();
    const newHand = (myP.hand||[]).filter(id=>id!==cardId);
    nextPlayers[currentIdx] = { ...myP, hand:newHand, hasPicked: false };
    const nextTurn = nextActiveSeat(playersN, currentIdx);
    dispatchAction({ players: nextPlayers, discard:[...discardN, cardId], current: nextTurn, lastAction: `${myP.name} discarded.` });
  }

  function toggleStage(cardId){
    setStage(prev => prev.includes(cardId) ? prev.filter(id => id!==cardId) : [...prev, cardId]);
  }

  // Render
  if(!room) return <div style={ui.viewport}><div style={ui.shell}>Loading...</div></div>;

  return (
    <div style={ui.viewport}>
      <form style={ui.namePanel} onSubmit={(e)=>{ e.preventDefault(); saveName(); }}>
        <input style={ui.input} placeholder="Name" value={meName} onChange={e=>setMeName(e.target.value)} />
        <button type="submit" style={{...ui.btn, ...ui.btnGreen}}>Save</button>
        {toast && <span style={{marginLeft:8, fontSize:12}}>{toast}</span>}
      </form>

      <div style={ui.shell}>
        <div style={ui.tableWrap}>
          <div style={ui.tableSurface} />
          {playersN.map((p, idx) => (
            <div key={idx} style={{...ui.seatPlaque, ...seatPos(idx)}}>
              <div style={ui.seatTitle}>{p.name || `Seat ${idx+1}`} {idx===room.current && "• turn"}</div>
              <div style={ui.seatMeta}>Hand: {(p.hand||[]).length} | Chips: {p.chips}</div>
              {meSeat === null && !p.name && <button onClick={()=>claimSeat(idx)} style={{...ui.btn, ...ui.btnBlue, marginTop:8}}>Sit</button>}
            </div>
          ))}

          <div style={{position:"absolute", left:"50%", top:"50%", transform:"translate(-50%,-50%)", textAlign:"center", color:"#fff"}}>
            {room.phase === "LOBBY" ? (
              <button onClick={startNewRound} style={{...ui.btn, ...ui.btnGreen}}>Start Round</button>
            ) : (
              <div style={{display:"flex", gap:10}}>
                <button onClick={drawStock} style={{...ui.btn, ...ui.btnDark}}>Stock ({stockN.length})</button>
                <button onClick={takeDiscard} style={{...ui.btn, ...ui.btnAmber}}>Discard ({discardN.length})</button>
              </div>
            )}
            <div style={{marginTop:10, fontSize:12}}>{room.lastAction}</div>
          </div>
        </div>

        <div style={ui.tray}>
          <div style={ui.trayTitleRow}>
            <div style={{fontWeight:800}}>{myP?.name || "Your Hand"} ({(myP?.hand || []).length})</div>
            <button onClick={handleSortHand} style={{...ui.btn, ...ui.btnAmber}}>Sort Hand</button>
          </div>

          <div style={{display:"flex", flexWrap:"wrap", minHeight: 86}}>
            {(myP?.hand || []).map(id => (
              <Card key={id} card={room.deck[id]} selected={stage.includes(id)} onClick={()=>toggleStage(id)} />
            ))}
          </div>

          <div style={{...ui.actionsRow, marginTop:10}}>
            {stage.length === 1 && meSeat === currentIdx && myP?.hasPicked && (
              <button onClick={()=>discardCard(stage[0])} style={{...ui.btn, ...ui.btnGreen}}>Discard Selected</button>
            )}
            <button onClick={()=>setStage([])} style={{...ui.btn, ...ui.btnGray}}>Clear Selection</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function seatPos(idx) {
  const pos = [ui.topSeat, ui.rightTop, ui.rightBottom, ui.bottomSeat, ui.leftMid];
  return pos[idx % 5];
}

function Card({ card, selected, onClick }) {
  const isRed = card.suit === "♥" || card.suit === "♦";
  return (
    <div style={ui.cardWrap} onClick={onClick}>
      <div style={{...ui.cardBox, outline: selected ? "2px solid #2563EB" : "none"}}>
        <div style={ui.pS(isRed)}>{card.suit}</div>
        <div style={ui.pR(isRed)}>{card.rank}</div>
      </div>
    </div>
  );
}

function createRoom(playersCount = 5){
  return {
    players: Array.from({length: playersCount}).map((_,i)=>({ id: i, name: "", hand: [], melds: [], chips: 250, seat: i })),
    current: 0,
    phase: "LOBBY",
    lastAction: "Waiting for players...",
    deck: {},
    stock: [],
    discard: []
  };
} 