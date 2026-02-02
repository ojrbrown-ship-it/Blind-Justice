// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

// ------------------------------
// Firebase (Realtime Database)
// ------------------------------
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, update, onValue, get, child } from "firebase/database";

/**
 * Prefer build-time Vite env (import.meta.env). Fall back to window.__FIREBASE_CONFIG__
 * only if envs are missing.
 */
const env = import.meta.env || {};
const FIREBASE_CONFIG = {
  apiKey:            env.VITE_FIREBASE_API_KEY        || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.apiKey : undefined),
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN     || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.authDomain : undefined),
  databaseURL:       env.VITE_FIREBASE_DATABASE_URL    || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.databaseURL : undefined),
  projectId:         env.VITE_FIREBASE_PROJECT_ID      || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.projectId : undefined),
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET  || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.storageBucket : undefined),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.messagingSenderId : undefined),
  appId:             env.VITE_FIREBASE_APP_ID          || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.appId : undefined),
  // optional
  measurementId:     env.VITE_FIREBASE_MEASUREMENT_ID  || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.measurementId : undefined),
};

if (!FIREBASE_CONFIG.databaseURL || !FIREBASE_CONFIG.projectId) {
  console.error(
    "[Firebase] Missing databaseURL or projectId. " +
    "Check Vercel → Project → Settings → Environment Variables."
  );
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

  // Table surface
  tableWrap:   { position: "relative", margin: "60px auto 220px", width: "100%", maxWidth: 1100, height: 540 },
  tableSurface:{ position: "absolute", inset: 0, borderRadius: 520, background: `radial-gradient(1200px 600px at 50% 30%, ${FELT}, ${FELT_DARK})`, boxShadow: "0 60px 140px rgba(0,0,0,.45), inset 0 8px 20px rgba(255,255,255,.12), inset 0 -8px 24px rgba(0,0,0,.25)", border: "10px solid #3e2b18", outline: "1px solid rgba(255,255,255,.04)" },

  // Seat plaques
  seatPlaque:  { position:"absolute", minWidth: 220, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,.09)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,.12)", color:"#eafff0" },
  seatTitle:   { fontSize: 14, fontWeight: 700 },
  seatMeta:    { fontSize: 12, opacity:.9, marginTop: 4 },

  // Seat positions (5 seats around oval)
  topSeat:     { top:-36, left:"50%", transform:"translateX(-50%)" },
  rightTop:    { right:-10, top:"20%", transform:"translateY(-50%)" },
  rightBottom: { right:-10, top:"70%", transform:"translateY(-50%)" },
  bottomSeat:  { bottom:-36, left:"50%", transform:"translateX(-50%)" },
  leftMid:     { left:-10, top:"45%", transform:"translateY(-50%)" },

  // Meld belts near each seat
  belt:        { display:"flex", flexWrap:"wrap", gap:8, marginTop:8 },

  // Hand tray + staging
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

  // Card visuals
  cardWrap:    { display:"inline-flex", flexDirection:"column", alignItems:"center", marginRight:6, marginBottom:6 },
  cardBox:     { width: 56, height: 76, borderRadius: 10, background:"#fff", border:"1px solid #dbe3dd", boxShadow:"0 2px 8px rgba(16,24,40,.10)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" },
  pS:(red)=>({ fontSize: 18, lineHeight:"18px", color:red? "#e11d48":"#0f172a" }),
  pR:(red)=>({ fontSize: 10, lineHeight:"10px", color:red? "#e11d48":"#0f172a" }),
  pill:       { display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:999, background:"#eef2ff", color:"#3730a3", border:"1px solid #c7d2fe", fontSize:12 },

  // Name prompt (raised above felt)
  namePanel:  { position:"fixed", left:"50%", top: 28, transform:"translateX(-50%)", background:"rgba(255,255,255,.96)", border:"1px solid #e6ece8", borderRadius:14, padding:"10px 12px", boxShadow:"0 10px 40px rgba(0,0,0,.2)", display:"flex", alignItems:"center", gap:8, zIndex:1000, pointerEvents:"auto" },
  input:      { border:"1px solid #d1d5db", borderRadius:10, padding:"8px 10px", outline:"none" },
  mono:       { fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }
};

// ------------------------------
// Helpers, constants & rules
// ------------------------------
const SUITS = ["♠", "♥", "♦", "♣"]; // suit order for sort/display
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const rankIndex = (r) => RANKS.indexOf(r);
const suitIndex = (s) => SUITS.indexOf(s);

// card slot metrics for pixel-accurate DnD
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

/** Normalise Firebase list-like objects to arrays */
const asArray = (v) =>
  Array.isArray(v) ? v :
  (v && typeof v === "object") ? Object.values(v) : [];

/** Count pure melds (Pure Run or Tunnela) for qualification */
const countPureMelds = (melds) =>
  asArray(melds).filter(m => m.type === "PURE_RUN" || m.type === "TUNNELA").length;

/** Next seat with a non-empty name */
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
// Wild-aware validators
// ------------------------------
function validatePureRun(cards){
  if(cards.length<3) return false;
  const suit = cards[0].suit;
  if(!cards.every(c=>c.suit===suit)) return false;
  const idxs = cards.map(c=>rankIndex(c.rank)).sort((a,b)=>a-b);
  for(let i=1;i<idxs.length;i++){
    const gap = idxs[i]-idxs[i-1];
    if(gap!==1 && !(idxs[i-1]===0 && idxs[i]===1)) return false; // A,2 edge
  }
  return true;
}
function validatePureSet(cards){
  if(cards.length<3) return false;
  const r = cards[0].rank;
  if(!cards.every(c=>c.rank===r)) return false;
  const suits = new Set(cards.map(c=>c.suit));
  return suits.size===cards.length;
}
function validateRunWithWilds(cards, hidden){
  if(cards.length<3) return false;
  const nonWild = cards.filter(c=>!isWild(c,hidden));
  if(nonWild.length===0) return false;
  const suit = nonWild[0].suit;
  if(!nonWild.every(c=>c.suit===suit)) return false;
  const wilds = cards.length-nonWild.length;

  const low = [...new Set(nonWild.map(c=>rankIndex(c.rank)))].sort((a,b)=>a-b);
  let gaps=0; for(let i=1;i<low.length;i++) gaps+=Math.max(0,low[i]-low[i-1]-1);
  const okLow = wilds>=gaps;

  const high = low.map(v=>v===0?13:v).sort((a,b)=>a-b);
  let gapsH=0; for(let i=1;i<high.length;i++) gapsH+=Math.max(0,high[i]-high[i-1]-1);
  return okLow || wilds>=gapsH;
}
function validateSetWithWilds(cards, hidden){
  if(cards.length<3) return false;
  const nonWild = cards.filter(c=>!isWild(c,hidden));
  if(nonWild.length===0) return false;
  const r = nonWild[0].rank;
  if(!nonWild.every(c=>c.rank===r)) return false;
  const suits = new Set(nonWild.map(c=>c.suit));
  return suits.size===nonWild.length;
}
function validateMeldWildAware(m, deck, hidden){
  const cards = asArray(m.cards).map(id=>deck[id]);
  switch(m.type){
    case "TUNNELA":  return cards.length===3 && cards.every(c=>c.suit===cards[0].suit && c.rank===cards[0].rank);
    case "PURE_RUN": return !cards.some(c=>isWild(c,hidden)) && validatePureRun(cards);
    case "PURE_SET": return !cards.some(c=>isWild(c,hidden)) && validatePureSet(cards);
    case "RUN":      return validateRunWithWilds(cards, hidden);
    case "SET":      return validateSetWithWilds(cards, hidden);
    default:         return false;
  }
}
const validatePlayerDeclarationWildAware = (p, deck, hidden) =>
  asArray(p?.melds).length>0 && asArray(p.melds).every(m=>validateMeldWildAware(m, deck, hidden));

// ------------------------------
// Player factory & seat reset
// ------------------------------
function freshPlayer(seat, name = "") {
  return {
    id: `P${seat + 1}`,
    name,
    seat,
    hand: [],
    melds: [],
    qualifies: false,
    hasPeeked: false,
    hasPicked: false,
    earlyTunnelaAwarded: false,
    chips: 250,
  };
}
function leaveSeatAndReset(room, seatIndex) {
  const players = asArray(room.players).slice();
  players[seatIndex] = freshPlayer(seatIndex, ""); // empty == open seat
  return players;
}

// ------------------------------
// Room creation (5 seats, initial deal sorted)
// ------------------------------
function createRoom(playersCount = 5){
  const seed = Math.floor(Math.random()*1e9);
  const deckArr = generateDeck(3);
  const deck = Object.fromEntries(deckArr.map(c=>[c.id,c]));
  const order = shuffle(Object.keys(deck), seed);
  const hiddenJokerId = order[0];
  const stock = order.slice(1);

  const players = Array.from({length: playersCount}).map((_,i)=>freshPlayer(i, `Player ${i+1}`));

  // deal 21 each
  let t=0; for(let i=0;i<playersCount*21;i++){ players[t].hand.push(stock[i]); t=(t+1)%playersCount; }
  const remaining = stock.slice(playersCount*21);

  // sort hands by suit -> rank
  for (const p of players) p.hand = sortHandDefault(deck, p.hand);

  return {
    id:"global",
    options: { playersCount, requireThreePure:true, allowPureSets:false, useUpperLower:true },
    deck,
    stock: remaining,
    discard: [],
    players,
    current: 0,
    phase: "LOBBY", // PLAY -> POST_LAYOFF -> FINISHED
    hiddenJokerId,
    seed,
    createdAt: Date.now(),
    lastAction: "Room created. Hidden joker set. Waiting to start.",
    ledger: [],
  };
}

// Seat positions around the oval for 5 seats (0..4)
function seatPos(idx) {
  switch ((idx % 5 + 5) % 5) {
    case 0: return ui.topSeat;      // top
    case 1: return ui.rightTop;     // right-top
    case 2: return ui.rightBottom;  // right-bottom
    case 3: return ui.bottomSeat;   // bottom
    case 4: return ui.leftMid;      // left-mid
    default: return ui.topSeat;
  }
}

// ------------------------------
// Component
// ------------------------------
export default function MarriageRummyOnline(){
  const [meName, setMeName] = useState("");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]);                 // staging area
  const [dragInfo, setDragInfo] = useState(null);         // { id, from:'hand'|'stage', index }
  const [toast, setToast] = useState("");                 // small UX hint on save
  const handRef = useRef(null);

  // Load saved name on first render
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mr_name");
      if (saved) setMeName(saved);
    } catch (_) {}
  }, []);

  // Always-live room ID
  const ROOM_ID = "global";

  // bootstrap: create global room if missing, then subscribe
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

  // sit / rename / leave
  async function claimSeat(seat){
    if (!room) return;
    const name = (meName || "").trim();
    if (!name) { setToast("Enter a name first"); return; }

    const nextPlayers = playersN.slice();
    // Always fresh player with 250 chips
    nextPlayers[seat] = freshPlayer(seat, name);

    await update(ref(db, `rooms/${ROOM_ID}`), { players: nextPlayers });
    setMeSeat(seat);
    flashToast("Seated ✔");
  }

  async function saveName(){
    const name = (meName || "").trim();

    // persist locally (works even when not seated yet)
    try { localStorage.setItem("mr_name", name); } catch (_) {}

    if (!room) { flashToast("Saved locally"); return; }

    // If not seated, we just persist locally (it will apply on Sit here)
    if (meSeat == null) { flashToast("Saved. Sit down to apply"); return; }

    // ✅ Targeted partial update (robust)
    try {
      await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), {
        name: name || `Player ${meSeat+1}`
      });
      flashToast("Saved ✔");
    } catch (err) {
      console.error("[Save name] FAILED", err);
      flashToast("Save failed");
    }
  }

  async function leaveTable(){
    if (!room || meSeat==null) return;
    const nextPlayers = leaveSeatAndReset(room, meSeat);

    let nextCurrent = room.current;
    if (meSeat === room.current) {
      nextCurrent = nextActiveSeat(nextPlayers, room.current);
    }
    await update(ref(db, `rooms/${ROOM_ID}`), {
      players: nextPlayers,
      current: nextCurrent,
      lastAction: `${(myP?.name || `Seat ${meSeat+1}`)} left the table`,
    });
    setStage([]);
    setMeSeat(null);
    flashToast("Left table");
  }

  function flashToast(msg){
    setToast(msg);
    window.clearTimeout((flashToast._t));
    flashToast._t = window.setTimeout(()=>setToast(""), 1400);
  }

  // Turn actions
  function drawStock(){
    if(!room || meSeat==null || meSeat!==currentIdx || stockN.length===0) return;
    const nextStock = stockN.slice(); const cardId = nextStock.shift();
    const nextPlayers = playersN.slice(); const me = nextPlayers[currentIdx];
    nextPlayers[currentIdx] = { ...me, hasPicked:true, hand:[...(me.hand||[]), cardId] };
    dispatchAction({ stock: nextStock, players: nextPlayers, lastAction: `${me.name} drew from stock.` });
  }
  function takeDiscard(){
    if(!room || meSeat==null || meSeat!==currentIdx || discardN.length===0) return;
    const nextDiscard = discardN.slice(); const cardId = nextDiscard.pop();
    const nextPlayers = playersN.slice(); const me = nextPlayers[currentIdx];
    nextPlayers[currentIdx] = { ...me, hasPicked:true, hand:[...(me.hand||[]), cardId] };
    dispatchAction({ discard: nextDiscard, players: nextPlayers, lastAction: `${me.name} took the discard.` });
  }

  // chips ledger
  function transferChips(fromSeat,toSeat,amount,reason){
    if(!room || !amount) return;
    const nextPlayers = playersN.slice();
    nextPlayers[fromSeat] = { ...nextPlayers[fromSeat], chips: (nextPlayers[fromSeat].chips||0) - amount };
    nextPlayers[toSeat]   = { ...nextPlayers[toSeat],   chips: (nextPlayers[toSeat].chips||0) + amount };
    const ledger = asArray(room.ledger); ledger.push({ from: fromSeat, to: toSeat, amount, reason });
    dispatchAction({ players: nextPlayers, ledger });
  }

  // qualification rule
  const canQualify = (melds)=> countPureMelds(melds) >= 3;

  // lay helpers (from STAGING)
  function layPure(type){
    if(!room || meSeat==null || meSeat!==currentIdx) return;
    const me = myP; if(!me || stage.length<3) return;
    const meld = { id:`m-${Math.random()}`, type, cards:[...stage] };
    const nextPlayers = playersN.slice();
    const hand = (me.hand||[]).filter(id=>!stage.includes(id));
    const melds = [...(me.melds||[]), meld];
    const qualifies = me.qualifies || canQualify(melds);
    let updatedMe = { ...me, hand, melds, qualifies };
    if (!me.hasPeeked && qualifies) { updatedMe = { ...updatedMe, hasPeeked:true }; }
    nextPlayers[currentIdx] = updatedMe;
    setStage([]);
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a ${type.replace("_"," ").toLowerCase()}.` });
  }
  function layImpureSet(minLen){
    if(!room) return;
    const turnSeat = room.phase==="POST_LAYOFF" ? room.postLayIndex : currentIdx;
    if(meSeat==null || meSeat!==turnSeat) return;
    const me = playersN[turnSeat]; if(!me) return;

    const hidden = room.deck[room.hiddenJokerId];
    const required = Math.max(3, minLen);

    if(me.qualifies){
      if(stage.length<required) return;
      const cards = stage.map(id=>room.deck[id]); if(!validateSetWithWilds(cards, hidden)) return;
      const meld = { id:`m-${Math.random()}`, type:"SET", cards:[...stage] };
      const nextPlayers = playersN.slice();
      const hand = (me.hand||[]).filter(id=>!stage.includes(id));
      nextPlayers[turnSeat] = { ...me, hand, melds:[...(me.melds||[]), meld] };
      setStage([]);
      dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a set (wild‑aware).` });
    } else {
      const strictMin = Math.max(4, minLen); if(stage.length<strictMin) return;
      const r = room.deck[stage[0]].rank; if(!stage.every(id=>room.deck[id].rank===r)) return;
      const meld = { id:`m-${Math.random()}`, type:"SET", cards:[...stage] };
      const nextPlayers = playersN.slice();
      const hand = (me.hand||[]).filter(id=>!stage.includes(id));
      nextPlayers[turnSeat] = { ...me, hand, melds:[...(me.melds||[]), meld] };
      setStage([]);
      dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a set.` });
    }
  }
  function layTunnela(){
    if(!room || meSeat==null || meSeat!==currentIdx || stage.length!==3) return;
    const me = myP; const [a,b,c]=stage.map(id=>room.deck[id]);
    const same=(x,y)=> x && y && x.rank===y.rank && x.suit===y.suit;
    if(!(same(a,b)&&same(b,c))) return;
    const meld = { id:`m-${Math.random()}`, type:"TUNNELA", cards:[...stage] };
    const nextPlayers = playersN.slice(); const meP = nextPlayers[currentIdx];
    const hand = (meP.hand||[]).filter(id=>!stage.includes(id));
    const melds = [...(meP.melds||[]), meld];
    const qualifies = meP.qualifies || canQualify(melds);
    let updated = { ...meP, hand, melds, qualifies };
    if (!meP.hasPeeked && qualifies) { updated = { ...updated, hasPeeked:true }; }
    if(!meP.hasPicked && !meP.earlyTunnelaAwarded){
      updated = { ...updated, earlyTunnelaAwarded: true };
      for(const p of nextPlayers){ if(p.seat!==currentIdx) transferChips(p.seat, currentIdx, 10, "Early Tunnela (before first pickup)"); }
    }
    nextPlayers[currentIdx] = updated;
    setStage([]); dispatchAction({ players: nextPlayers, lastAction: `${meP.name} laid a tunnela.` });
  }

  // Build (extend) my own SET during POST_LAYOFF
  function extendMySet(meldId){
    if(!room || room.phase!=="POST_LAYOFF") return;
    const turnSeat = room.postLayIndex;
    if(meSeat == null || meSeat !== turnSeat) return;
    const me = playersN[turnSeat]; if(!me) return;
    if(stage.length===0) return;

    const myMelds = asArray(me.melds);
    const idx = myMelds.findIndex(m => m.id === meldId && (m.type==="SET" || m.type==="PURE_SET"));
    if (idx === -1) return;

    const hidden = room.deck[room.hiddenJokerId];
    const meldNow = myMelds[idx];
    const combined = [...asArray(meldNow.cards), ...stage];

    let ok=false;
    if (me.qualifies) {
      const cards = combined.map(id=>room.deck[id]);
      ok = validateSetWithWilds(cards, hidden);
    } else {
      const baseRank = room.deck[meldNow.cards[0]].rank;
      ok = combined.every(id => room.deck[id].rank === baseRank) && combined.length >= 4;
    }
    if (!ok) return;

    const nextPlayers = playersN.slice();
    const hand = (me.hand || []).filter(id => !stage.includes(id));
    const nextMelds = myMelds.slice();
    const newType = (meldNow.type==="PURE_SET") ? "SET" : meldNow.type; // if wilds used, mark as SET
    nextMelds[idx] = { ...meldNow, type: newType, cards: combined };
    nextPlayers[turnSeat] = { ...me, hand, melds: nextMelds };

    setStage([]);
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} built onto a set.` });
  }

  // Discard / End turn / Peek
  function discardCard(cardId){
    if(!room || meSeat==null || meSeat!==currentIdx) return;
    const nextPlayers = playersN.slice(); const p = nextPlayers[currentIdx];
    if(!(p?.hand||[]).includes(cardId)) return;
    const newHand = (p.hand||[]).filter(id=>id!==cardId);
    if(newHand.length===0 && p.qualifies){
      const hidden=room.deck[room.hiddenJokerId]; const valid=validatePlayerDeclarationWildAware(p, room.deck, hidden);
      if(!valid){ dispatchAction({ lastAction: `${p.name}: invalid declare — illegal wild usage in melds.` }); return; }
    }
    nextPlayers[currentIdx] = { ...p, hand:newHand };
    const lastAction = `${p.name} discarded.`;
    if(newHand.length===0) startPostDeclare(currentIdx, nextPlayers, lastAction);
    else dispatchAction({ players: nextPlayers, discard:[...discardN, cardId], lastAction });
  }
  const endTurn = ()=> {
    if (!room) return;
    const next = nextActiveSeat(playersN, currentIdx);
    dispatchAction({ current: next });
  };
  const peekJoker = ()=>{
    if(!room) return; const me=myP; if(!me||!me.qualifies||me.hasPeeked) return;
    const nextPlayers = playersN.slice(); nextPlayers[me.seat] = { ...me, hasPeeked:true };
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} peeked the hidden joker.` });
  };

  // Post‑declare & settlement
  function startPostDeclare(winnerSeat, nextPlayers, lastAction){
    const nextSeat = nextActiveSeat(nextPlayers, winnerSeat);
    dispatchAction({ players: nextPlayers, winnerSeat, postLayIndex: nextSeat, phase:"POST_LAYOFF", lastAction });
  }
  function doneLayoff(){
    if(!room) return;
    const next = nextActiveSeat(playersN, room.postLayIndex);
    if (next === room.winnerSeat) performSettlement();
    else dispatchAction({ postLayIndex: next });
  }
  function pointsInHand(cards, hidden){
    let sum=0;
    for(const c of cards){
      if(isWild(c,hidden)) continue;
      if(["J","Q","K","A"].includes(c.rank)) sum+=10;
      else sum+=parseInt(c.rank,10)||0;
    }
    return sum;
  }
  function analyseHoldings(cards, hidden){
    const suit=hidden.suit, jokerRank=hidden.rank;
    const low = RANKS[(rankIndex(jokerRank)-1+RANKS.length)%RANKS.length];
    const up  = RANKS[(rankIndex(jokerRank)+1)%RANKS.length];
    const count={};
    for(const c of cards){
      if(c.rank===jokerRank) count[`${c.suit}-${c.rank}`]=(count[`${c.suit}-${c.rank}`]||0)+1;
      if(c.suit===suit && (c.rank===low || c.rank===up || c.rank==="A")) count[`${c.suit}-${c.rank}`]=(count[`${c.suit}-${c.rank}`]||0)+1;
    }
    const L=count[`${suit}-${low}`]||0, J=count[`${suit}-${jokerRank}`]||0, U=count[`${suit}-${up}`]||0;
    const marriages=Math.min(L,J,U);
    const singles=[]; for(const k in count) singles.push(...Array(count[k]).fill(k));
    const rm=k=>{ const i=singles.indexOf(k); if(i>=0) singles.splice(i,1); };
    for(let m=0;m<marriages;m++){ rm(`${suit}-${low}`); rm(`${suit}-${jokerRank}`); rm(`${suit}-${up}`); }
    let singletons=0;
    for(const tag of singles){
      const [s,r]=tag.split("-");
      if(r===jokerRank) singletons++;
      else if(s===suit && (r===low||r===up||r==="A")) singletons++;
    }
    return { singletons, marriages };
  }
  function performSettlement(){
    if(!room) return;
    const hidden = room.deck[room.hiddenJokerId];
    const nextPlayers = playersN.slice();
    const winner = room.winnerSeat;

    for(const p of nextPlayers){
      if(p.seat===winner) continue;
      const points = pointsInHand((p.hand||[]).map(id=>room.deck[id]), hidden);
      const rounded = roundToNearest10(points);
      const chips = rounded>=100 ? 25 : (rounded/10)*2;
      if(chips>0) transferChips(p.seat, winner, chips, `Points ${points} -> ${rounded} (to winner)`);
    }
    const holdings = nextPlayers.map(p=>analyseHoldings((p.hand||[]).map(id=>room.deck[id]), hidden));
    for(let i=0;i<nextPlayers.length;i++){
      for(let j=0;j<nextPlayers.length;j++){
        if(i===j) continue;
        const h=holdings[j];
        const amt = h.singletons*5 + h.marriages*25;
        if(amt>0) transferChips(i, j, amt, `Wild/Value bonuses (${h.singletons}×5 + ${h.marriages}×25)`);
      }
    }
    dispatchAction({ phase:"FINISHED", lastAction:"Settlement complete." });
  }

  // ------------------------------
  // Pixel-accurate Drag & Drop
  // ------------------------------
  function onDragStart(cardId, from, index){ setDragInfo({ id: cardId, from, index }); }
  function onDragOver(e){ e.preventDefault(); } // allow drop

  // Drop anywhere along the hand row (compute index from pointer x)
  function dropToHandAtPointer(e){
    if(!dragInfo || dragInfo.from!=="hand" || !myP) return;
    const me = myP;
    const hand = [...(me.hand||[])];
    const fromIdx = hand.indexOf(dragInfo.id);
    if (fromIdx === -1) { setDragInfo(null); return; }

    const rect = handRef.current?.getBoundingClientRect();
    if (!rect) { setDragInfo(null); return; }
    const localX = e.clientX - rect.left;
    // Estimate slot index from pointer; clamp
    let toIdx = Math.round(localX / SLOT_W);
    toIdx = Math.max(0, Math.min(toIdx, hand.length));
    // Remove origin, adjust target if origin before target
    hand.splice(fromIdx, 1);
    if (toIdx > fromIdx) toIdx -= 1;
    hand.splice(toIdx, 0, dragInfo.id);

    // persist order
    const nextPlayers = playersN.slice();
    nextPlayers[currentIdx] = { ...me, hand };
    dispatchAction({ players: nextPlayers });

    setDragInfo(null);
  }

  // Stage DnD (insert/reorder)
  function dropToStage(targetIndex = null){
    if(!dragInfo) return;
    let s = [...stage];
    if (!s.includes(dragInfo.id)) {
      const insertAt = (targetIndex===null ? s.length : Math.max(0, Math.min(targetIndex, s.length)));
      s.splice(insertAt, 0, dragInfo.id);
      setStage(s);
    }
    setDragInfo(null);
  }
  function reorderStage(targetIndex){
    if(!dragInfo || dragInfo.from!=="stage") return;
    const fromIdx = stage.indexOf(dragInfo.id);
    if (fromIdx === -1) return setDragInfo(null);
    const s = [...stage];
    s.splice(fromIdx, 1);
    const insertAt = Math.max(0, Math.min(targetIndex, s.length));
    s.splice(insertAt, 0, dragInfo.id);
    setStage(s);
    setDragInfo(null);
  }
  function toggleStage(cardId){
    setStage(prev => prev.includes(cardId) ? prev.filter(id => id!==cardId) : [...prev, cardId]);
  }
  const clearStage = ()=> setStage([]);

  // ------------------------------
  // Early guards
  // ------------------------------
  if(!room) {
    return (
      <div style={ui.viewport}>
        <div style={ui.shell}>
          <div style={{position:"absolute", inset:0, display:"grid", placeItems:"center", color:"#d9f7e5"}}>
            Loading the table…
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------
  // MAIN RENDER (Real Table, 5 seats)
  // ------------------------------
  return (
    <div style={ui.viewport}>
      {/* Name prompt (form to support Enter) */}
      <form
        style={ui.namePanel}
        onSubmit={(e)=>{ e.preventDefault(); saveName(); }}
      >
        <span style={{fontWeight:700}}>Your name</span>
        <input
          style={ui.input}
          placeholder="Type your name"
          value={meName}
          onChange={e=>setMeName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!meName.trim()}
          style={{...ui.btn, ...(meName.trim() ? ui.btnGreen : ui.btnGray)}}
          title={meName.trim() ? "Save name" : "Enter a name first"}
        >
          Save
        </button>
        {toast && (
          <span style={{marginLeft:8, fontSize:12, color:"#0f5132"}}>{toast}</span>
        )}
      </form>

      <div style={ui.shell}>
        {/* Felt table */}
        <div style={ui.tableWrap}>
          <div style={ui.tableSurface} />

          {/* Seat plaques around table (5 seats) */}
          {playersN.slice(0,5).map((p, idx) => (
            <div key={p.id} style={{...ui.seatPlaque, ...seatPos(idx)}}>
              <div style={ui.seatTitle}>
                {p.name || `Seat ${idx+1}`} {idx===room.current && <span style={ui.mono}>• turn</span>}
              </div>
              <div style={ui.seatMeta}>
                Hand: {(p.hand||[]).length} &nbsp;|&nbsp; Chips: <b>{p.chips}</b> &nbsp;|&nbsp; Has seen Joker: {p.hasPeeked ? "Yes" : "No"}
              </div>

              {/* Sit here */}
              {!p.name && meSeat==null && (
                <button onClick={()=>claimSeat(idx)} style={{...ui.btn, ...ui.btnBlue, marginTop:8}}>
                  Sit here
                </button>
              )}

              {/* Meld belt near seat */}
              <div style={ui.belt}>
                {asArray(p.melds).map(m => (
                  <div key={m.id} style={{display:"inline-flex", alignItems:"center", gap:6, padding:"4px 6px", borderRadius:12, background:"rgba(255,255,255,.12)", border:"1px solid rgba(255,255,255,.18)"}}>
                    <span style={ui.pill}>{labelForMeld(m.type)}</span>
                    {asArray(m.cards).map(cid => <MiniCard key={cid} card={room.deck[cid]} />)}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Centre: hidden joker + stock/discard + start/game controls */}
          <div style={{position:"absolute", left:"50%", top:"50%", transform:"translate(-50%,-50%)", textAlign:"center", color:"#e9fff4"}}>
            <div style={{marginBottom:8, fontWeight:800, letterSpacing:.4}}>Hidden Joker</div>
            <div style={{display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:10}}>
              {myP?.hasPeeked ? <Card card={room.deck[room.hiddenJokerId]}/> : <CardMask/>}
              {!myP?.hasPeeked && (
                <button onClick={peekJoker} disabled={!myP?.qualifies} style={{...ui.btn, ...(myP?.qualifies ? ui.btnGreen : ui.btnGray)}}>
                  Peek ({countPureMelds(myP?.melds)}/3)
                </button>
              )}
            </div>

            <div style={{display:"flex", gap:14, justifyContent:"center"}}>
              <div>Stock <b>{stockN.length}</b></div>
              <div>Discard <b>{discardN.length}</b></div>
            </div>

            <div style={{marginTop:10}}>
              {room.phase === "LOBBY" ? (
                <>
                  {meSeat === 0 ? (
                    <button
                      onClick={()=>{
                        const first = isSeatActive(playersN[room.current]) ? room.current : nextActiveSeat(playersN, room.current - 1);
                        update(ref(db, `rooms/${ROOM_ID}`), { phase:"PLAY", current:first, lastAction:"Game started." });
                      }}
                      style={{...ui.btn, ...ui.btnGreen}}
                    >
                      Start Game
                    </button>
                  ) : (
                    <div style={{opacity:.85}}>Waiting to start… (host is Seat 1)</div>
                  )}
                </>
              ) : (
                <>
                  <button onClick={drawStock} style={{...ui.btn, ...ui.btnDark, marginRight:8}}>Draw</button>
                  <button onClick={takeDiscard} style={{...ui.btn, ...ui.btnAmber}}>Pickup</button>
                </>
              )}
            </div>

            <div style={{marginTop:10, fontSize:12, opacity:.9}}>{room.lastAction}</div>
          </div>
        </div>

        {/* Hand tray (bottom, sticky) */}
        <div style={ui.tray}>
          <div style={ui.trayTitleRow}>
            <div style={{fontWeight:800}}>{(myP?.name ?? "You")}'s Hand ({(myP?.hand ?? []).length})</div>
            <div style={ui.textXs}>Drag a card and drop <b>anywhere</b> along the row to reorder</div>
          </div>

          {/* Your hand: pixel-accurate drop area (one container computes index) */}
          <div
            ref={handRef}
            style={{display:"flex", flexWrap:"wrap", minHeight: 86}}
            onDragOver={(e)=>{ e.preventDefault(); }}
            onDrop={(e)=>dropToHandAtPointer(e)}
          >
            {(myP?.hand ?? []).map((id, idx)=>(
              <Card
                key={id}
                card={room.deck[id]}
                selected={stage.includes(id)}
                onClick={()=>toggleStage(id)}
                draggable
                onDragStart={()=>onDragStart(id, "hand", idx)}
              />
            ))}
          </div>

          {/* Staging */}
          <div style={{marginTop:10, display:"flex", alignItems:"center", justifyContent:"space-between"}}>
            <div style={{fontWeight:700}}>Staging</div>
            <div className="actions">
              <button onClick={clearStage} style={{...ui.btn, ...ui.btnGray}}>Clear Staging</button>
            </div>
          </div>
          <div
            style={{marginTop:6, display:"flex", flexWrap:"wrap"}}
            onDragOver={(e)=>{ e.preventDefault(); }}
            onDrop={()=>dropToStage(null)}
          >
            {stage.map((id, idx)=>(
              <div key={id} onDragOver={(e)=>{ e.preventDefault(); }} onDrop={()=>reorderStage(idx)}>
                <Card
                  card={room.deck[id]}
                  selected
                  onClick={()=>toggleStage(id)}
                  draggable
                  onDragStart={()=>onDragStart(id, "stage", idx)}
                />
              </div>
            ))}
          </div>

          {/* Lay controls */}
          <div style={{...ui.actionsRow, marginTop:10}}>
            <button onClick={()=> stage.length>=3 && layPure("PURE_RUN")} style={{...ui.btn, ...ui.btnBlue}}>Lay Pure Run</button>
            <button onClick={()=> stage.length>=3 && layPure("PURE_SET")} style={{...ui.btn, ...ui.btnDark}}>Lay Pure Set</button>
            <button onClick={layTunnela} style={{...ui.btn, ...ui.btnGreen}}>Lay Tunnela (3)</button>
            <button onClick={()=>layImpureSet(3)} style={{...ui.btn, ...ui.btnAmber}}>Lay Set (impure)</button>
            <button onClick={endTurn} style={{...ui.btn, ...ui.btnDark}}>End Turn</button>
            {(myP?.hand ?? []).slice(0,1).map(id => (
              <button key={id} onClick={()=>discardCard(id)} style={{...ui.btn, ...ui.btnGreen}}>Quick Declare (discard first)</button>
            ))}
            {meSeat!=null && (
              <button onClick={leaveTable} style={{...ui.btn, ...ui.btnGray}}>Leave Table</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------
// Small UI bits
// ------------------------------
function labelForMeld(type){
  switch(type){
    case "PURE_RUN": return "Pure Run";
    case "PURE_SET": return "Pure Set";
    case "RUN":      return "Run";
    case "SET":      return "Set";
    case "TUNNELA":  return "Tunnela";
    default:         return type;
  }
}
function Card({ card, selected, onClick, draggable=false, onDragStart }) {
  const isRed = card.suit === "♥" || card.suit === "♦";
  return (
    <div style={ui.cardWrap}>
      <button
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onClick}
        style={{
          ...ui.cardBox,
          outline: selected ? "2px solid #2563EB" : "none",
          transform: selected ? "translateY(-1px)" : "none",
          cursor: (onClick || draggable) ? "pointer" : "default",
          userSelect: "none"
        }}
      >
        <div style={ui.pS(isRed)}>{card.suit}</div>
        <div style={{height:4}}/>
        <div style={ui.pR(isRed)}>{card.rank}</div>
      </button>
    </div>
  );
}
function MiniCard({ card }) {
  const isRed = card.suit === "♥" || card.suit === "♦";
  return (
    <div style={{...ui.cardBox, width:34, height:46}}>
      <div style={{...ui.pS(isRed), fontSize:14}}>{card.suit}</div>
      <div style={{height:2}}/>
      <div style={{...ui.pR(isRed), fontSize:9}}>{card.rank}</div>
    </div>
  );
}
function CardMask(){
  return (
    <div style={ui.cardWrap}>
      <div style={ui.cardBox}>
        <div style={ui.pS(false)}>?</div>
        <div style={{height:4}}/>
        <div style={ui.pR(false)}>?</div>
      </div>
    </div>
  );
}