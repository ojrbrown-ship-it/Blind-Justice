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
  return suits.size===cards.length;
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
// Room creation (5 seats, initial deal sorted, names EMPTY)
// ------------------------------
function createRoom(playersCount = 5){
  const seed = Math.floor(Math.random()*1e9);
  const deckArr = generateDeck(3);
  const deck = Object.fromEntries(deckArr.map(c=>[c.id,c]));
  const order = shuffle(Object.keys(deck), seed);
  const hiddenJokerId = order[0];
  const stock = order.slice(1);

  // Start with empty-named seats so Sit here shows
  const players = Array.from({length: playersCount}).map((_,i)=>freshPlayer(i, ""));

  // Deal 21 each (for first-time convenience). Hands will be preserved when sitting in LOBBY.
  let t=0; for(let i=0;i<playersCount*21;i++){ players[t].hand.push(stock[i]); t=(t+1)%playersCount; }
  const remaining = stock.slice(playersCount*21);

  // Sort dealt hands by suit -> rank
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

  // Load saved name
  useEffect(() => {
    try { const saved = localStorage.getItem("mr_name"); if (saved) setMeName(saved); } catch (_) {}
  }, []);

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

  // Toast helper
  function flashToast(msg){
    setToast(msg);
    window.clearTimeout(flashToast._t);
    flashToast._t = window.setTimeout(()=>setToast(""), 1400);
  }

  // ------------------------------
  // NEW: start a fresh round (re-deal) to ACTIVE seats only
  // ------------------------------
  async function startNewRound() {
    if (!room) return;

    // Build a fresh 3-deck shoe
    const deckArr = generateDeck(3);
    const deck = Object.fromEntries(deckArr.map(c => [c.id, c]));

    const seed = Math.floor(Math.random() * 1e9);
    const order = shuffle(Object.keys(deck), seed);
    const hiddenJokerId = order[0];

    // Copy current players and find active seats (with names)
    const nextPlayers = playersN.map(p => ({ ...p }));
    const activeIdxs = nextPlayers
      .map((p, i) => ((p?.name || "").trim() ? i : null))
      .filter(i => i !== null);

    // If no active seats, stay in LOBBY and hint user
    if (activeIdxs.length === 0) {
      await update(ref(db, `rooms/${room.id || ROOM_ID}`), {
        phase: "LOBBY",
        lastAction: "No active seats — enter a name and Sit here, then Start again.",
      });
      flashToast("Add players first");
      return;
    }

    // Reset round state (preserve chips)
    for (let i = 0; i < nextPlayers.length; i++) {
      nextPlayers[i] = {
        ...nextPlayers[i],
        hand: [],
        melds: [],
        qualifies: false,
        hasPeeked: false,
        hasPicked: false,
        earlyTunnelaAwarded: false,
      };
    }

    // Deal 21 to active seats round-robin
    let stock = order.slice(1);
    let t = 0;
    for (let i = 0; i < activeIdxs.length * 21; i++) {
      const seat = activeIdxs[t];
      nextPlayers[seat].hand.push(stock[i]);
      t = (t + 1) % activeIdxs.length;
    }
    stock = stock.slice(activeIdxs.length * 21);

    // Sort each active hand
    for (const i of activeIdxs) {
      nextPlayers[i].hand = sortHandDefault(deck, nextPlayers[i].hand);
    }

    // First active seat for the turn
    const first = isSeatActive(nextPlayers[room.current])
      ? room.current
      : nextActiveSeat(nextPlayers, room.current - 1);

    await update(ref(db, `rooms/${room.id || ROOM_ID}`), {
      deck,
      stock,
      discard: [],
      players: nextPlayers,
      current: first,
      phase: "PLAY",
      seed,
      hiddenJokerId,
      lastAction: "New round dealt.",
    });
  }

  // sit / rename / leave / reset seats
  async function claimSeat(seat){
    if (!room) return;
    const name = (meName || "").trim();
    if (!name) { flashToast("Enter a name first"); return; }

    const current = playersN.slice();
    const target  = current[seat] ?? freshPlayer(seat, "");

    // Preserve any dealt hand in LOBBY
    const preserveHand   = Array.isArray(target.hand)   ? target.hand   : [];
    const preserveMelds  = Array.isArray(target.melds)  ? target.melds  : [];
    const preserveChips  = Number.isFinite(target.chips)? target.chips  : 250;
    const preserveFlags  = {
      qualifies: !!target.qualifies,
      hasPeeked: !!target.hasPeeked,
      hasPicked: !!target.hasPicked,
      earlyTunnelaAwarded: !!target.earlyTunnelaAwarded
    };

    current[seat] = {
      ...target,
      id: `P${seat+1}`,
      seat,
      name,
      hand:   preserveHand,
      melds:  preserveMelds,
      chips:  preserveChips,
      ...preserveFlags
    };

    await update(ref(db, `rooms/${room.id || ROOM_ID}`), { players: current });
    setMeSeat(seat);
    flashToast("Seated ✔");
  }

  async function saveName(){
    const name = (meName || "").trim();
    try { localStorage.setItem("mr_name", name); } catch (_) {}

    if (!room) { flashToast("Saved locally"); return; }
    if (meSeat == null) { flashToast("Saved. Sit down to apply"); return; }

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

  async function resetAllSeats() {
    if (!room) return;
    const nextPlayers = playersN.map((_, i) => freshPlayer(i, "")); // 5 fresh empty seats
    await update(ref(db, `rooms/${ROOM_ID}`), {
      players: nextPlayers,
      current: 0,
      phase: "LOBBY",
      lastAction: "Seats reset",
    });
    flashToast("Seats reset");
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
   