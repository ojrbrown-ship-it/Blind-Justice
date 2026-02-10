import React, { useEffect, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, set } from "firebase/database";

const env = import.meta.env || {};
const FIREBASE_CONFIG = {
  apiKey:            env.VITE_FIREBASE_API_KEY,
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       env.VITE_FIREBASE_DATABASE_URL,
  projectId:         env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const UI = {
  bg: "#0f172a", felt: "#14532d", panel: "#1e293b", text: "#f1f5f9",
  accent: "#fbbf24", danger: "#ef4444", success: "#22c55e",
  card: {
    base: {
      background: "white", borderRadius: "6px", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      boxShadow: "0 2px 5px rgba(0,0,0,0.3)", userSelect: "none", cursor: "pointer",
    },
    lg: { width: 62, height: 88 }, md: { width: 50, height: 72 }
  }
};

const getRankIdx = (r) => RANKS.indexOf(r);

export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]);

  const ROOM_ID = "global_room_v3";

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${ROOM_ID}`), (snap) => {
      const data = snap.val();
      if (data) setRoom(data);
    });
    return () => unsub();
  }, []);

  // --- SAFETY GUARDS ---
  if (!room || !room.phase) {
    return (
      <div style={{ background: UI.bg, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
        <h2>Initialize Marriage Rummy</h2>
        <button onClick={() => set(ref(db, `rooms/${ROOM_ID}`), { phase: "LOBBY", players: Array(5).fill({name:"", chips:250}) })} style={btnStyle(UI.success)}>
          Create Table
        </button>
      </div>
    );
  }

  const myP = room.players?.[meSeat];
  const isMyTurn = room.phase === "PLAY" && room.turn === meSeat;
  const jokerCard = room.jokerCardId ? room.deck?.[room.jokerCardId] : null;

  // --- ACTIONS ---
  const handleSit = async (i) => {
    if (!meName) return alert("Enter name");
    localStorage.setItem("mr_name", meName);
    setMeSeat(i);
    await update(ref(db, `rooms/${ROOM_ID}/players/${i}`), { name: meName, chips: 250 });
  };

  const handleDeal = async () => {
    let dArr = [];
    for (let d=0; d<3; d++) SUITS.forEach(s => RANKS.forEach(r => dArr.push({ id: `${d}${s}${r}${Date.now()}`, suit: s, rank: r })));
    dArr.sort(() => Math.random() - 0.5);
    const deckMap = {}; dArr.forEach(c => deckMap[c.id] = c);
    const active = room.players.filter(p => p.name);
    const updates = { deck: deckMap, phase: "PLAY", turn: active[0].seat, winnerSeat: null, transfers: [] };
    let ptr = 0;
    active.forEach(p => {
      updates[`players/${p.seat}/hand`] = dArr.slice(ptr, ptr + 21).map(c => c.id);
      updates[`players/${p.seat}/hasPicked`] = false;
      updates[`players/${p.seat}/roundFinished`] = false;
      ptr += 21;
    });
    updates.jokerCardId = dArr[ptr++].id;
    updates.discard = [dArr[ptr++].id];
    updates.stock = dArr.slice(ptr).map(c => c.id);
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handlePickup = async (src) => {
    if (!isMyTurn || myP?.hasPicked) return;
    const cardId = src === "STOCK" ? room.stock[0] : room.discard[room.discard.length - 1];
    const updates = { [`players/${meSeat}/hand`]: [...(myP.hand || []), cardId], [`players/${meSeat}/hasPicked`]: true };
    if (src === "STOCK") updates.stock = room.stock.slice(1);
    else updates.discard = room.discard.slice(0, -1);
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const calculateScores = async () => {
    if (!jokerCard) return;
    const active = room.players.filter(p => p.name);
    const updates = { phase: "SCORING", transfers: [] };
    const winnerSeat = room.winnerSeat;
    const tRank = jokerCard.rank;
    const pSuit = jokerCard.suit;
    const pHRank = RANKS[(getRankIdx(tRank) + 1) % 13];
    const pLRank = RANKS[(getRankIdx(tRank) - 1 + 13) % 13];

    active.forEach(p => {
      // 1. Hand Points
      if (p.seat !== winnerSeat) {
        let pts = 0;
        (p.hand || []).forEach(id => {
          const c = room.deck[id];
          if (c.rank !== tRank) {
            if (["J", "Q", "K", "A", "10"].includes(c.rank)) pts += 10;
            else pts += parseInt(c.rank) || 0;
          }
        });
        const chips = Math.round(pts / 10) * 2;
        if (chips > 0) {
          updates[`players/${p.seat}/chips`] = (p.chips || 250) - chips;
          updates[`players/${winnerSeat}/chips`] = (updates[`players/${winnerSeat}/chips`] || room.players[winnerSeat].chips) + chips;
          updates.transfers.push({ from: p.name, to: room.players[winnerSeat].name, amount: chips, note: "Hand Points" });
        }
      }

      // 2. Side Transfers (Bonuses)
      const allCards = [...(p.hand || [])].map(id => room.deck[id]);
      const countT = allCards.filter(c => c.rank === tRank && c.suit === pSuit).length;
      const countPH = allCards.filter(c => c.rank === pHRank && c.suit === pSuit).length;
      const countPL = allCards.filter(c => c.rank === pLRank && c.suit === pSuit).length;
      const countA = allCards.filter(c => c.rank === "A" && c.suit === pSuit).length;

      const marriages = Math.min(countT, countPH, countPL);
      const bonusPerPlayer = (marriages * 25) + ((countT-marriages)*5) + ((countPH-marriages)*5) + ((countPL-marriages)*5) + (countA * 5);

      if (bonusPerPlayer > 0) {
        active.forEach(p2 => {
          if (p.seat === p2.seat) return;
          updates[`players/${p2.seat}/chips`] = (updates[`players/${p2.seat}/chips`] || room.players[p2.seat].chips) - bonusPerPlayer;
          updates[`players/${p.seat}/chips`] = (updates[`players/${p.seat}/chips`] || room.players[p.seat].chips) + bonusPerPlayer;
          updates.transfers.push({ from: p2.name, to: p.name, amount: bonusPerPlayer, note: marriages > 0 ? "Marriage" : "On-Suit Bonus" });
        });
      }
    });
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: UI.bg, color: UI.text, fontFamily: 'sans-serif' }}>
      <div style={{ padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.5)" }}>
        <h2 style={{margin:0}}>Blind Justice</h2>
        {meSeat === null && <input placeholder="Name" value={meName} onChange={e => setMeName(e.target.value)} style={{padding:5, borderRadius:4}}/>}
        <button onClick={handleDeal} style={btnStyle(UI.success)}>Deal Round</button>
      </div>

      <div style={{ flex: 1, position: "relative", background: UI.felt, overflow: 'hidden' }}>
        {/* Seats */}
        {room.players.map((p, i) => (
          <div key={i} style={{ position: "absolute", ...getPos(i, meSeat), textAlign: "center" }}>
            <div style={{ background: room.turn === i ? UI.accent : "rgba(0,0,0,0.6)", color: room.turn === i ? "black" : "white", padding: "5px 15px", borderRadius: 20, fontSize: 13, fontWeight: "bold" }}>
              {p.name || <span onClick={() => handleSit(i)} style={{cursor:'pointer'}}>Sit Here</span>} {p.name && `($${p.chips})`}
            </div>
          </div>
        ))}

        {/* Center Deck */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", display: "flex", gap: 20 }}>
          <div onClick={() => handlePickup('STOCK')} style={{ ...UI.card.base, ...UI.card.md, background: "#1e293b", color: 'white', fontWeight: 'bold' }}>STOCK</div>
          <div onClick={() => handlePickup('DISCARD')} style={{ ...UI.card.base, ...UI.card.md }}>
            <CardFace card={room.deck?.[room.discard?.[room.discard.length - 1]]} />
          </div>
          {jokerCard && <div style={{...UI.card.base, ...UI.card.md, border: `3px solid ${UI.accent}` }}><CardFace card={jokerCard} /></div>}
        </div>

        {/* Scoring Modal */}
        {room.phase === "SCORING" && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: UI.panel, padding: 30, borderRadius: 12, width: 400 }}>
              <h3 style={{textAlign:'center', color: UI.accent}}>Round Transfers</h3>
              <div style={{maxHeight: 300, overflowY:'auto'}}>
                {room.transfers?.map((t, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #334155', fontSize: 13 }}>
                    <span>{t.from} ➔ {t.to}</span>
                    <span>{t.amount} <small style={{color: UI.accent}}>{t.note}</small></span>
                  </div>
                ))}
              </div>
              <button onClick={handleDeal} style={{...btnStyle(UI.success), width:'100%', marginTop: 20}}>Next Round</button>
            </div>
          </div>
        )}
      </div>

      {/* Player Hand Controls */}
      {myP && (
        <div style={{ background: UI.panel, padding: "15px 20px", borderTop: "4px solid #334155" }}>
          <div style={{display:'flex', justifyContent:'space-between', marginBottom: 10}}>
            <span style={{fontSize: 12, opacity: 0.8}}>Your Hand ({myP.hand?.length || 0})</span>
            {/* Display Natural Rule */}
            {!myP.hasPicked && <button style={btnStyle(UI.accent)}>Show Marriage</button>}
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 10 }}>
            {myP.hand?.map(id => (
              <div key={id} onClick={() => setStage(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])}
                   style={{ ...UI.card.base, ...UI.card.lg, transform: stage.includes(id) ? "translateY(-15px)" : "none", border: stage.includes(id) ? `2px solid ${UI.accent}` : "none" }}>
                <CardFace card={room.deck[id]} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CardFace({ card }) {
  if (!card) return null;
  const isRed = ["♥", "♦"].includes(card.suit);
  return (
    <div style={{ color: isRed ? UI.danger : "black", textAlign: "center" }}>
      <div style={{ fontWeight: "bold", fontSize: 18 }}>{card.rank}</div>
      <div style={{ fontSize: 22 }}>{card.suit}</div>
    </div>
  );
}

function btnStyle(bg) { return { background: bg, border: "none", color: "white", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 13 }; }

function getPos(i, me) {
  const p = [{ bottom: 20, left: '50%', transform: 'translateX(-50%)' }, { right: 20, top: '60%' }, { right: 20, top: '20%' }, { left: 20, top: '20%' }, { left: 20, top: '60%' }];
  return p[me === null ? i : (i - me + 5) % 5];
}