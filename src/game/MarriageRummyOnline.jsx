// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useState } from "react";

// ------------------------------
// Firebase (Realtime Database)
// ------------------------------
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, update, push, onValue } from "firebase/database";

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
// Tiny design system (inline styles)
// ------------------------------
const ui = {
  page:    { minHeight: "100vh", background: "#F5F7FB", color: "#111", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
  shell:   { maxWidth: 1200, margin: "0 auto", padding: 16 },
  h1:      { fontSize: 28, fontWeight: 800, marginBottom: 12 },
  textXs:  { fontSize: 12, color: "#6B7280" },
  textSm:  { fontSize: 14, color: "#374151" },
  panel:   { background: "#FFF", borderRadius: 16, padding: 16, boxShadow: "0 8px 24px rgba(16,24,40,.06)", border: "1px solid #EEF2F7" },
  card:    { background: "#FFF", borderRadius: 12, padding: 12, border: "1px solid #E5E7EB" },
  row:     { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  grid:    { display: "grid", gap: 12 },
  grid2:   { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 },
  grid3:   { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 },
  input:   { border: "1px solid #D1D5DB", borderRadius: 10, padding: "8px 10px", width: "100%", outline: "none" },
  number:  { border: "1px solid #D1D5DB", borderRadius: 10, padding: "8px 10px", width: 80, outline: "none" },
  btn:     { border: "0", borderRadius: 10, padding: "10px 14px", fontWeight: 600, cursor: "pointer" },
  btnDark: { background: "#111827", color: "#fff" },
  btnBlue: { background: "#2563EB", color: "#fff" },
  btnGreen:{ background: "#059669", color: "#fff" },
  btnAmber:{ background: "#D97706", color: "#fff" },
  btnGray: { background: "#E5E7EB", color: "#111827" },
  subtle:  { fontSize: 12, color:"#6B7280", marginTop: 8 },
  mono:    { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },

  pcardWrap: { display:"inline-flex", flexDirection:"column", alignItems:"center", marginRight:6, marginBottom:6 },
  pcard:  { width: 56, height: 76, borderRadius: 10, background: "#fff", border: "1px solid #E5E7EB", boxShadow:"0 2px 8px rgba(16,24,40,.06)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" },
  pS: (isRed)=>({ fontSize: 18, lineHeight:"18px", color: isRed? "#DC2626" : "#111827" }),
  pR: (isRed)=>({ fontSize: 10, lineHeight:"10px", color: isRed? "#DC2626" : "#111827" }),
  pill:   { display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:999, background:"#EEF2FF", color:"#3730A3", border:"1px solid #C7D2FE", fontSize:12, marginRight:6, marginBottom:6 },
};

// ------------------------------
// Helpers, constants & rules
// ------------------------------
const SUITS = ["♠", "♥", "♦", "♣"];              // <— suit display order
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"]; // rank order
const rankIndex = (r) => RANKS.indexOf(r);
const suitIndex = (s) => SUITS.indexOf(s);

/** Default sort: by suit (♠ ♥ ♦ ♣), then by rank (A..K) */
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
  for(let d=0; d<n; d++){
    for(const suit of SUITS){
      for(const rank of RANKS){
        out.push({
          id: `${d}-${suit}-${rank}-${Math.random().toString(36).slice(2,8)}`,
          suit, rank
        });
      }
    }
  }
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
// Room creation (initial deal sorted)
// ------------------------------
function createRoom(playersCount){
  const seed = Math.floor(Math.random()*1e9);
  const deckArr = generateDeck(3);
  const deck = Object.fromEntries(deckArr.map(c=>[c.id,c]));
  const order = shuffle(Object.keys(deck), seed);
  const hiddenJokerId = order[0];
  const stock = order.slice(1);

  const players = Array.from({length: playersCount}).map((_,i)=>({
    id:`P${i+1}`, name:`Player ${i+1}`, seat:i,
    hand:[], melds:[],
    qualifies:false, hasPeeked:false, hasPicked:false, earlyTunnelaAwarded:false,
    chips:250
  }));

  // Deal
  let t=0; for(let i=0;i<playersCount*21;i++){ players[t].hand.push(stock[i]); t=(t+1)%playersCount; }
  const remaining = stock.slice(playersCount*21);

  // 🔽 NEW: sort each player's hand by suit → rank
  for (const p of players) {
    p.hand = sortHandDefault(deck, p.hand);
  }

  return {
    id:"",
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

// ------------------------------
// Component
// ------------------------------
export default function MarriageRummyOnline(){
  const [meName, setMeName] = useState("");
  const [meSeat, setMeSeat] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [room, setRoom] = useState(null);
  const [playersCount, setPlayersCount] = useState(3);

  // Staging workspace
  const [stage, setStage] = useState([]); // staged card IDs

  // Drag state
  const [dragInfo, setDragInfo] = useState(null); // {id, from:'hand'|'stage', index}

  // Subscribe
  useEffect(()=>{
    if(!roomId) return;
    const r = ref(db, `rooms/${roomId}`);
    const unsub = onValue(r, snap => { const v = snap.val(); if (v) setRoom(v); });
    return ()=>unsub();
  },[roomId]);

  // Create / Join / Seat / Start
  function hostCreate(){
    const safeCount = Math.min(5, Math.max(2, Number(playersCount) || 3));
    const newRoom = createRoom(safeCount);
    const r = ref(db, `rooms`);
    const key = push(r).key;
    newRoom.id = key;
    if (meName.trim()) newRoom.players[0].name = meName.trim();

    console.log("[Create] Writing /rooms/"+key, newRoom);
    set(ref(db, `rooms/${key}`), newRoom)
      .then(()=>{ console.log("[Create] OK /rooms/"+key); setRoomId(key); setMeSeat(0); })
      .catch(err=> console.error("[Create] FAILED", err));
  }
  const joinRoom = (id)=> setRoomId(id);
  function takeSeat(seat){
    if(!room || room.phase!=="LOBBY") return;
    update(ref(db, `rooms/${room.id}/players/${seat}`), {
      name: meName.trim() || `Player ${seat+1}`
    });
    setMeSeat(seat);
  }
  const startGame = ()=> { if(room && meSeat===0) update(ref(db, `rooms/${room.id}`), { phase:"PLAY", lastAction:"Game started." }); };

  // Normalised lists for safe render
  const playersN = asArray(room?.players);
  const stockN   = asArray(room?.stock);
  const discardN = asArray(room?.discard);
  const currentIdx = Number.isInteger(room?.current) ? room.current : 0;
  const currentP   = playersN[currentIdx];
  const myP        = useMemo(()=> playersN[meSeat ?? -1], [playersN, meSeat]);

  function dispatchAction(partial){ if(room) update(ref(db, `rooms/${room.id}`), partial); }

  // Ledger
  function transferChips(fromSeat,toSeat,amount,reason){
    if(!room || !amount) return;
    const nextPlayers = playersN.slice();
    nextPlayers[fromSeat] = { ...nextPlayers[fromSeat], chips: (nextPlayers[fromSeat].chips||0) - amount };
    nextPlayers[toSeat]   = { ...nextPlayers[toSeat],   chips: (nextPlayers[toSeat].chips||0) + amount };
    const ledger = asArray(room.ledger);
    ledger.push({ from: fromSeat, to: toSeat, amount, reason });
    dispatchAction({ players: nextPlayers, ledger });
  }

  // Draw / Pickup
  function drawStock(){
    if(!room || meSeat!==currentIdx || stockN.length===0) return;
    const nextStock = stockN.slice(); const cardId = nextStock.shift();
    const nextPlayers = playersN.slice(); const me = nextPlayers[currentIdx];
    nextPlayers[currentIdx] = { ...me, hasPicked:true, hand:[...(me.hand||[]), cardId] };
    dispatchAction({ stock: nextStock, players: nextPlayers, lastAction: `${me.name} drew from stock.` });
  }
  function takeDiscard(){
    if(!room || meSeat!==currentIdx || discardN.length===0) return;
    const nextDiscard = discardN.slice(); const cardId = nextDiscard.pop();
    const nextPlayers = playersN.slice(); const me = nextPlayers[currentIdx];
    nextPlayers[currentIdx] = { ...me, hasPicked:true, hand:[...(me.hand||[]), cardId] };
    dispatchAction({ discard: nextDiscard, players: nextPlayers, lastAction: `${me.name} took the discard.` });
  }

  // Qualification rule
  const canQualify = (melds)=> countPureMelds(melds) >= 3;

  // Lay NEW melds (from STAGING)
  function layPure(type){
    if(!room || meSeat!==currentIdx) return;
    const me = myP; if(!me || stage.length<3) return;
    const meld = { id:`m-${Math.random()}`, type, cards:[...stage] };
    const nextPlayers = playersN.slice();
    const hand = (me.hand||[]).filter(id=>!stage.includes(id));
    const melds = [...(me.melds||[]), meld];
    const qualifies = me.qualifies || canQualify(melds);

    // AUTO-PEEK once you qualify
    let updatedMe = { ...me, hand, melds, qualifies };
    if (!me.hasPeeked && qualifies) { updatedMe = { ...updatedMe, hasPeeked: true }; }

    nextPlayers[currentIdx] = updatedMe;
    setStage([]);
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a ${type.replace("_"," ").toLowerCase()}.` });
  }

  function layImpureSet(minLen){
    if(!room) return;
    const turnSeat = room.phase==="POST_LAYOFF" ? room.postLayIndex : currentIdx;
    if(meSeat!==turnSeat) return;
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
      setStage([]); dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a set (wild‑aware).` });
    } else {
      const strictMin = Math.max(4, minLen); if(stage.length<strictMin) return;
      const r = room.deck[stage[0]].rank; if(!stage.every(id=>room.deck[id].rank===r)) return;
      const meld = { id:`m-${Math.random()}`, type:"SET", cards:[...stage] };
      const nextPlayers = playersN.slice();
      const hand = (me.hand||[]).filter(id=>!stage.includes(id));
      nextPlayers[turnSeat] = { ...me, hand, melds:[...(me.melds||[]), meld] };
      setStage([]); dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a set.` });
    }
  }

  function layTunnela(){
    if(!room || meSeat!==currentIdx || stage.length!==3) return;
    const me = myP; const [a,b,c]=stage.map(id=>room.deck[id]);
    const same=(x,y)=> x && y && x.rank===y.rank && x.suit===y.suit;
    if(!(same(a,b)&&same(b,c))) return;
    const meld = { id:`m-${Math.random()}`, type:"TUNNELA", cards:[...stage] };
    const nextPlayers = playersN.slice(); const meP = nextPlayers[currentIdx];
    const hand = (meP.hand||[]).filter(id=>!stage.includes(id));
    const melds = [...(meP.melds||[]), meld];
    const qualifies = meP.qualifies || canQualify(melds);
    let updated = { ...meP, hand, melds, qualifies };

    // AUTO-PEEK once you qualify
    if (!meP.hasPeeked && qualifies) { updated = { ...updated, hasPeeked: true }; }

    // Early Tunnela bonus
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
    if(meSeat !== turnSeat) return;        // only current layoff player
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
    const newType = (meldNow.type==="PURE_SET") ? "SET" : meldNow.type; // once wilds are used, mark as SET
    nextMelds[idx] = { ...meldNow, type: newType, cards: combined };
    nextPlayers[turnSeat] = { ...me, hand, melds: nextMelds };

    setStage([]);
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} built onto a set.` });
  }

  // Discard / End turn / Peek
  function discardCard(cardId){
    if(!room || meSeat!==currentIdx) return;
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
  const endTurn = ()=> room && dispatchAction({ current: (currentIdx+1) % playersN.length });
  const peekJoker = ()=>{
    if(!room) return; const me=myP; if(!me||!me.qualifies||me.hasPeeked) return;
    const nextPlayers = playersN.slice(); nextPlayers[me.seat] = { ...me, hasPeeked:true };
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} peeked the hidden joker.` });
  };

  // Post‑declare & settlement
  function startPostDeclare(winnerSeat, nextPlayers, lastAction){
    const nextSeat = nextNonWinnerSeat(winnerSeat, room.options.playersCount);
    dispatchAction({ players: nextPlayers, winnerSeat, postLayIndex: nextSeat, phase:"POST_LAYOFF", lastAction });
  }
  function nextNonWinnerSeat(winnerSeat, n, from){ let s=Number.isInteger(from)?from:winnerSeat; do { s=(s+1)%n; } while(s===winnerSeat); return s; }
  function doneLayoff(){ if(!room) return; const n=room.options.playersCount; let next=nextNonWinnerSeat(room.winnerSeat,n,room.postLayIndex); if(next===room.winnerSeat) performSettlement(); else dispatchAction({ postLayIndex: next }); }
  function pointsInHand(cards, hidden){ let sum=0; for(const c of cards){ if(isWild(c,hidden)) continue; if(["J","Q","K","A"].includes(c.rank)) sum+=10; else sum+=parseInt(c.rank,10)||0; } return sum; }
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
    let singletons=0; for(const tag of singles){ const [s,r]=tag.split("-"); if(r===jokerRank) singletons++; else if(s===suit && (r===low||r===up||r==="A")) singletons++; }
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
        const h=holdings[j]; const amt = h.singletons*5 + h.marriages*25;
        if(amt>0) transferChips(i, j, amt, `Wild/Value bonuses (${h.singletons}×5 + ${h.marriages}×25)`);
      }
    }
    dispatchAction({ phase:"FINISHED", lastAction:"Settlement complete." });
  }

  // ------------------------------
  // Drag & Drop helpers
  // ------------------------------
  function onDragStart(cardId, from, index){ setDragInfo({ id: cardId, from, index }); }
  function onDragOver(e){ e.preventDefault(); } // allow drop

  // Drop onto HAND (insert before targetIndex) or end
  function dropToHand(targetIndex = null){
    if(!dragInfo || !myP) return;
    const me = myP;
    let handOrder = [...(me.hand || [])];

    if (dragInfo.from === "hand") {
      const fromIdx = handOrder.indexOf(dragInfo.id);
      if (fromIdx === -1) return setDragInfo(null);
      handOrder.splice(fromIdx, 1);
      const insertAt = (targetIndex===null ? handOrder.length : Math.max(0, Math.min(targetIndex, handOrder.length)));
      handOrder.splice(insertAt, 0, dragInfo.id);

      const nextPlayers = playersN.slice();
      nextPlayers[currentIdx] = { ...me, hand: handOrder };
      dispatchAction({ players: nextPlayers });
    }
    setDragInfo(null);
  }

  // Drop onto STAGE (insert before targetIndex) or end
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

  // Reorder inside STAGE by dropping a staged card onto another staged card
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
  function clearStage(){ setStage([]); }

  // ------------------------------
  // Early guards
  // ------------------------------
  if(!roomId){
    return (
      <div style={ui.page}>
        <div style={ui.shell}>
          <h1 style={ui.h1}>Marriage Rummy — Online</h1>
          <div style={ui.panel}>
            <label style={ui.textSm}>Your name</label>
            <input style={{...ui.input, marginTop:6}} value={meName} onChange={e=>setMeName(e.target.value)} placeholder="Enter name"/>
            <div style={{...ui.grid2, marginTop:12}}>
              <div style={ui.card}>
                <div style={{...ui.textXs, marginBottom:6}}>Create room</div>
                <div style={ui.row}>
                  <input type="number" min={2} max={5} style={ui.number} value={playersCount}
                         onChange={e=>setPlayersCount(parseInt(e.target.value)||3)}/>
                  <button style={{...ui.btn, ...ui.btnBlue}} onClick={hostCreate}>Create</button>
                </div>
              </div>
              <div style={ui.card}>
                <div style={{...ui.textXs, marginBottom:6}}>Join room</div>
                <JoinBox onJoin={setRoomId}/>
              </div>
            </div>
          </div>

          <div style={{...ui.panel, marginTop:12}}>
            <HowTo/>
          </div>
        </div>
      </div>
    );
  }

  if(!room) return <Loader text="Connecting to room…" />;
  if(!Array.isArray(playersN)) return <Loader text="Preparing table…" />;
  if(room.phase==="PLAY" && (!playersN[currentIdx] || !Array.isArray(stockN) || !Array.isArray(discardN))){
    return <Loader text="Setting the deck…" />;
  }

  // ------------------------------
  // Main views
  // ------------------------------
  return (
    <div style={ui.page}>
      <div style={ui.shell}>
        {/* Header */}
        <div style={{...ui.row, marginBottom:12}}>
          <div>
            <div style={ui.textXs}>Room</div>
            <div style={{fontWeight:700, wordBreak:"break-all"}}>{room.id}</div>
          </div>
          <div style={ui.textXs}>Players: {room.options.playersCount}</div>
        </div>

        {/* Lobby */}
        {room.phase==="LOBBY" && (
          <div style={{...ui.grid2}}>
            <div style={ui.panel}>
              <div style={{fontWeight:700, marginBottom:8}}>Seats</div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:8}}>
                {playersN.map(p=>(
                  <button key={p.seat} onClick={()=>takeSeat(p.seat)} style={{
                    ...ui.card, textAlign:"left", border: meSeat===p.seat? "2px solid #2563EB":"1px solid #E5E7EB",
                    background: p.name? "#ECFDF5" : "#FFF", cursor:"pointer"
                  }}>
                    <div style={ui.textXs}>Seat {p.seat+1}</div>
                    <div style={{fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                      {p.name || "Empty"}
                    </div>
                  </button>
                ))}
              </div>
              <div style={ui.subtle}>Tap a seat to set your name there.</div>
            </div>

            <div style={ui.panel}>
              <div style={{fontWeight:700, marginBottom:8}}>Hidden Joker</div>
              <div style={ui.textSm}>
                A random card has been set as the hidden joker. You can <b>peek</b> it only after laying <b>3 pure melds</b> (pure runs or tunnela).
              </div>
              <div style={{marginTop:12}}>
                {meSeat===0 ? (
                  <button onClick={startGame} style={{...ui.btn, ...ui.btnGreen}}>Start Game</button>
                ) : (
                  <div style={ui.textXs}>Waiting for host to start…</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Play */}
        {room.phase==="PLAY" && (
          <div style={{...ui.grid, gap:12}}>
            {/* Turn Bar */}
            <div style={ui.panel}>
              <div style={ui.row}>
                <div>
                  <div style={ui.textXs}>Turn</div>
                  <div style={{fontWeight:700}}>{currentP?.name ?? "Player"}</div>
                </div>
                <div style={{display:"flex", alignItems:"center", gap:16}}>
                  <div style={ui.textSm}>Stock <b>{stockN.length}</b></div>
                  <div style={ui.textSm}>Discard <b>{discardN.length}</b></div>

                  {/* Joker & Peek Controls */}
                  <div style={{display:"flex", alignItems:"center", gap:8}}>
                    <span style={ui.textXs}>Hidden Joker</span>
                    {myP?.hasPeeked ? (<Card card={room.deck[room.hiddenJokerId]}/>) : (<CardMask/>)}
                    {!myP?.hasPeeked && (
                      <button
                        onClick={peekJoker}
                        disabled={!myP?.qualifies}
                        title="Requires 3 pure melds: Pure Runs or Tunnela. (Pure Sets don't count.)"
                        style={{...ui.btn, ...(myP?.qualifies ? ui.btnGreen : ui.btnGray)}}
                      >
                        Peek ({countPureMelds(myP?.melds)}/3)
                      </button>
                    )}
                  </div>

                  <div>
                    <button onClick={drawStock} style={{...ui.btn, ...ui.btnDark, marginRight:8}}>Draw</button>
                    <button onClick={takeDiscard} style={{...ui.btn, ...ui.btnAmber}}>Pickup</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Hand (drag to sort) */}
            <div style={ui.panel}>
              <div style={ui.row}>
                <div style={{fontWeight:700}}>
                  {(myP?.name ?? "You")}'s Hand ({(myP?.hand ?? []).length})
                </div>
                <div style={ui.textXs}>Drag to sort. Click cards to add/remove from Staging.</div>
              </div>

              <div style={{marginTop:8, display:"flex", flexWrap:"wrap"}}
                   onDragOver={onDragOver}
                   onDrop={()=>dropToHand(null)}>
                {(myP?.hand ?? []).map((id, idx)=>(
                  <div key={id}
                       onDragOver={onDragOver}
                       onDrop={()=>dropToHand(idx)}
                  >
                    <Card
                      card={room.deck[id]}
                      selected={stage.includes(id)}
                      onClick={()=>toggleStage(id)}
                      draggable
                      onDragStart={()=>onDragStart(id, "hand", idx)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Staging area */}
            <div style={ui.panel}>
              <div style={ui.row}>
                <div style={{fontWeight:700}}>Staging (drag cards here, reorder, then Lay)</div>
                <div>
                  <button onClick={clearStage} style={{...ui.btn, ...ui.btnGray}}>Clear Staging</button>
                </div>
              </div>
              <div style={{marginTop:8, display:"flex", flexWrap:"wrap"}}
                   onDragOver={onDragOver}
                   onDrop={()=>dropToStage(null)}>
                {stage.map((id, idx)=>(
                  <div key={id}
                       onDragOver={onDragOver}
                       onDrop={()=>reorderStage(idx)}
                  >
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

              {/* Lay buttons use STAGING */}
              <div style={{marginTop:10}}>
                <button onClick={()=> stage.length>=3 && layPure("PURE_RUN")} style={{...ui.btn, ...ui.btnBlue, marginRight:8}}>Lay Pure Run</button>
                <button onClick={()=> stage.length>=3 && layPure("PURE_SET")} style={{...ui.btn, ...ui.btnDark, marginRight:8}}>Lay Pure Set</button>
                <button onClick={layTunnela} style={{...ui.btn, ...ui.btnGreen, marginRight:8}}>Lay Tunnela (3)</button>
                <button onClick={()=>layImpureSet(3)} style={{...ui.btn, ...ui.btnAmber, marginRight:8}}>Lay Set (impure)</button>
              </div>
            </div>

            {/* Discard */}
            <div style={ui.panel}>
              <div style={{fontWeight:700, marginBottom:8}}>Discard (top last)</div>
              <div style={{marginBottom:8}}>
                {discardN.map(id => <Card key={id} card={room.deck[id]} />)}
              </div>
              <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                {(myP?.hand ?? []).map(id=>(
                  <button key={id} onClick={()=>discardCard(id)} style={{...ui.btn, ...ui.btnGray, padding:"6px 10px"}}>
                    Discard <span style={ui.mono}> {room.deck[id].rank}{room.deck[id].suit}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Table (shows each player's melds) */}
            <div style={ui.panel}>
              <div style={{fontWeight:700, marginBottom:8}}>Table</div>
              <div style={ui.grid3}>
                {playersN.map((p, idx)=>(
                  <div key={p.id} style={{...ui.card, border: idx===currentIdx? "2px solid #2563EB":"1px solid #E5E7EB"}}>
                    <div style={ui.row}>
                      <div style={{fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{p.name}</div>
                      <div style={{...ui.textXs}}>{idx===currentIdx? "Playing": ""}</div>
                    </div>

                    {/* Melds gallery */}
                    <div style={{marginTop:8}}>
                      {(asArray(p.melds)).length===0 && (
                        <span style={ui.textXs}>No melds yet</span>
                      )}
                      {asArray(p.melds).map(m => (
                        <div key={m.id} style={{marginBottom:6}}>
                          <span style={ui.pill}>{labelForMeld(m.type)}</span>
                          <span style={{marginLeft:6}}>
                            {asArray(m.cards).map(cid => <Card key={cid} card={room.deck[cid]} />)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div style={{...ui.textXs, marginTop:6}}>
                      Hand: {(p.hand ?? []).length} | Chips: <b>{p.chips}</b>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Post‑Declare Layoff */}
        {room.phase==="POST_LAYOFF" && (
          <div style={{...ui.grid, gap:12}}>
            <div style={ui.panel}>
              <div style={{fontWeight:700, marginBottom:6}}>Post‑Declare Layoff</div>
              <div style={ui.textXs}>Winner: {playersN[room.winnerSeat]?.name ?? "Winner"}</div>
              <div style={{fontWeight:600, marginTop:4}}>Now laying off: {playersN[room.postLayIndex]?.name ?? "Player"}</div>
            </div>

            {/* Staging to lay new sets or extend own sets */}
            <div style={ui.panel}>
              <div style={ui.row}>
                <div style={{fontWeight:700}}>
                  {(playersN[room.postLayIndex]?.name ?? "Player")}'s Hand ({(playersN[room.postLayIndex]?.hand ?? []).length})
                </div>
                <div style={ui.textXs}>Drag/click to stage, then Lay or Build</div>
              </div>
              <div style={{marginTop:8, display:"flex", flexWrap:"wrap"}}
                   onDragOver={onDragOver}
                   onDrop={()=>dropToStage(null)}>
                {(playersN[room.postLayIndex]?.hand ?? []).map((id, idx)=>(
                  <div key={id}>
                    <Card card={room.deck[id]}
                          selected={stage.includes(id)}
                          onClick={()=>toggleStage(id)}
                          draggable
                          onDragStart={()=>onDragStart(id, "hand", idx)} />
                  </div>
                ))}
              </div>

              {/* STAGING row */}
              <div style={{marginTop:10}}>
                <div style={ui.row}>
                  <div style={{fontWeight:700}}>Staging</div>
                  <button onClick={()=>setStage([])} style={{...ui.btn, ...ui.btnGray}}>Clear Staging</button>
                </div>
                <div style={{marginTop:6, display:"flex", flexWrap:"wrap"}}
                     onDragOver={onDragOver}
                     onDrop={()=>dropToStage(null)}>
                  {stage.map((id, idx)=>(
                    <div key={id} onDragOver={onDragOver} onDrop={()=>reorderStage(idx)}>
                      <Card card={room.deck[id]}
                            selected
                            onClick={()=>toggleStage(id)}
                            draggable
                            onDragStart={()=>onDragStart(id, "stage", idx)} />
                    </div>
                  ))}
                </div>

                {/* Lay new set buttons */}
                <div style={{marginTop:10}}>
                  <button
                    onClick={()=> layImpureSet(playersN[room.postLayIndex]?.qualifies? 3 : 4)}
                    style={{...ui.btn, ...ui.btnAmber, marginRight:8}}
                  >
                    Lay Set (min {playersN[room.postLayIndex]?.qualifies? 3 : 4})
                  </button>
                </div>

                {/* Build ONLY on my sets */}
                {meSeat===room.postLayIndex && (
                  <div style={{marginTop:12}}>
                    <div style={{fontWeight:700, marginBottom:6}}>Build on your sets</div>
                    {asArray(myP?.melds).filter(m=>m.type==="SET"||m.type==="PURE_SET").length===0 && (
                      <div style={ui.textXs}>You have no sets yet.</div>
                    )}
                    {asArray(myP?.melds).filter(m=>m.type==="SET"||m.type==="PURE_SET").map(m => (
                      <div key={m.id} style={{marginBottom:8}}>
                        <span style={ui.pill}>{labelForMeld(m.type)}</span>
                        <span style={{marginLeft:6}}>
                          {asArray(m.cards).map(cid => <Card key={cid} card={room.deck[cid]} />)}
                        </span>
                        <button
                          onClick={()=>extendMySet(m.id)}
                          style={{...ui.btn, ...ui.btnBlue, marginLeft:10}}
                          disabled={stage.length===0}
                          title="Add staged cards to this set (only yours)"
                        >
                          Build onto this set
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Done */}
                <div style={{marginTop:12}}>
                  <button onClick={()=>{ setStage([]); doneLayoff(); }} style={{...ui.btn, ...ui.btnGreen}}>
                    I'm Done
                  </button>
                </div>
              </div>
            </div>

            {/* Everyone's melds (read-only) */}
            <div style={ui.panel}>
              <div style={{fontWeight:700, marginBottom:8}}>Table</div>
              <div style={ui.grid3}>
                {playersN.map(p=>(
                  <div key={p.id} style={ui.card}>
                    <div style={{fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{p.name}</div>
                    <div style={{marginTop:8}}>
                      {(asArray(p.melds)).length===0 && <span style={ui.textXs}>No melds yet</span>}
                      {asArray(p.melds).map(m => (
                        <div key={m.id} style={{marginBottom:6}}>
                          <span style={ui.pill}>{labelForMeld(m.type)}</span>
                          <span style={{marginLeft:6}}>
                            {asArray(m.cards).map(cid => <Card key={cid} card={room.deck[cid]} />)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{...ui.textXs, marginTop:6}}>Chips: <b>{p.chips}</b></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Finished */}
        {room.phase==="FINISHED" && (
          <div style={{...ui.grid, gap:12}}>
            <div style={ui.panel}>
              <div style={{fontWeight:700, marginBottom:8}}>Round Finished</div>
              <div style={ui.grid3}>
                {playersN.map(p=>(
                  <div key={p.id} style={ui.card}>
                    <div style={{fontWeight:600}}>{p.name}</div>
                    <div style={{...ui.textSm, marginTop:6}}>Chips: <b>{p.chips}</b></div>
                  </div>
                ))}
              </div>
            </div>

            {(asArray(room.ledger)).length>0 && (
              <div style={ui.panel}>
                <div style={{fontWeight:700, marginBottom:8}}>Chip Ledger</div>
                <ul style={{paddingLeft:18, margin:0}}>
                  {asArray(room.ledger).map((t,i)=>(
                    <li key={i} style={{...ui.textXs, marginBottom:4}}>
                      <b>{playersN[t.from]?.name ?? `Seat ${t.from+1}`}</b> → <b>{playersN[t.to]?.name ?? `Seat ${t.to+1}`}</b>: {t.amount} ({t.reason})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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
    <div style={ui.pcardWrap}>
      <button
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onClick}
        style={{
          ...ui.pcard,
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
function CardMask(){
  return (
    <div style={ui.pcardWrap}>
      <div style={ui.pcard}>
        <div style={ui.pS(false)}>?</div>
        <div style={{height:4}}/>
        <div style={ui.pR(false)}>?</div>
      </div>
    </div>
  );
}
function JoinBox({ onJoin }){
  const [id, setId] = useState("");
  return (
    <div style={{display:"flex", gap:8}}>
      <input style={ui.input} value={id} onChange={e=>setId(e.target.value)} placeholder="Paste room id"/>
      <button style={{...ui.btn, ...ui.btnBlue}} onClick={()=> id && onJoin(id)}>Join</button>
    </div>
  );
}
function HowTo(){
  return (
    <div>
      <div style={{fontWeight:700, marginBottom:6}}>How this variant works</div>
      <ul style={{margin:0, paddingLeft:18, ...ui.textSm}}>
        <li>Each player is dealt <b>21 cards</b> from <b>3 decks</b>. Everyone starts with <b>250 chips</b>.</li>
        <li>Hidden joker (maal). You must hit <b>3 pure melds</b> (<b>Pure Runs</b> or <b>Tunnela</b>) to peek. <b>Pure Sets do not count.</b> Once you qualify, the joker auto‑reveals.</li>
        <li><b>Upper</b> & <b>Lower</b> (same suit as the joker, one rank above/below) are enabled.</li>
        <li><b>Early Tunnela:</b> If you lay a tunnela before your first pickup, each opponent pays you 10 chips.</li>
        <li><b>Post‑declare layoff:</b> Qualified players may lay <b>wild‑aware sets (3+)</b>. Not qualified: <b>strict sets (4+)</b>. You may <b>build on your own sets only</b>.</li>
        <li><b>Settlement:</b> Points → winner (Swedish rounding, 2 chips per 10; ≥100 → 25). Then pairwise wild/value bonuses: 5 per Joker/Upper/Lower/A of joker suit, <b>25</b> per complete L‑J‑U.</li>
      </ul>
    </div>
  );
}
function Loader({ text }) {
  return (
    <div style={ui.page}>
      <div style={ui.shell}>
        <div style={{...ui.panel, textAlign:"center"}}>{text}</div>
      </div>
    </div>
  );
}