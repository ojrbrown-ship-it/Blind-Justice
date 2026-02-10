// src/game/MarriageRummyOnline.jsx
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
      position: "relative", transition: "all 0.2s ease"
    },
    sm: { width: 34, height: 48 }, md: { width: 50, height: 72 }, lg: { width: 60, height: 84 },
  }
};

const getRankIdx = (r) => RANKS.indexOf(r);

// VALUE CONSTANTS
const VAL_WILD_BASE = 5;  // Tiplu, Paplu, or On-Suit Ace
const VAL_MARRIAGE  = 25; // Full set of 3 on-suit wilds

function getCardPointValue(rank, isJoker) {
  if (isJoker) return 0; 
  if (["J", "Q", "K", "A", "10"].includes(rank)) return 10;
  return parseInt(rank) || 0;
}

export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]);

  const ROOM_ID = "global_room_v3";

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${ROOM_ID}`), (snap) => setRoom(snap.val()));
    return () => unsub();
  }, []);

  const initRoom = async () => {
    const players = Array.from({ length: 5 }, (_, i) => ({
      seat: i, name: "", chips: 250, hand: [], melds: [], hasPicked: false, roundFinished: false
    }));
    await set(ref(db, `rooms/${ROOM_ID}`), {
      players, phase: "LOBBY", turn: 0, deck: {}, discard: [], stock: [], jokerCardId: null, transfers: []
    });
  };

  if (!room?.phase) return <div style={{background: UI.bg, height:'100vh', color:'white', padding:40}}><h2>Connecting to Table...</h2><button onClick={initRoom} style={btnStyle(UI.success)}>Reset</button></div>;

  const myP = room.players?.[meSeat];
  const isMyTurn = room.phase === "PLAY" && room.turn === meSeat;
  const jokerCard = room.deck?.[room.jokerCardId];

  const handleSit = async (i) => {
    if (!meName) return alert("Please enter your name first.");
    localStorage.setItem("mr_name", meName);
    setMeSeat(i);
    await update(ref(db, `rooms/${ROOM_ID}/players/${i}`), { name: meName });
  };

  const calculateScores = async () => {
    const active = room.players.filter(p => p.name);
    const updates = { phase: "SCORING", transfers: [] };
    const winnerSeat = room.winnerSeat;
    const joker = room.deck[room.jokerCardId];
    
    // On-Suit Definitions
    const tRank = joker.rank;
    const pHRank = RANKS[(getRankIdx(joker.rank) + 1) % 13];
    const pLRank = RANKS[(getRankIdx(joker.rank) - 1 + 13) % 13];

    // 1. HAND POINT LOSS (Losers to Winner)
    active.forEach(p => {
        if (p.seat === winnerSeat) return;
        let points = 0;
        p.hand.forEach(cid => {
            const card = room.deck[cid];
            points += getCardPointValue(card.rank, card.rank === tRank);
        });
        const chipLoss = Math.round(points / 10) * 2;
        if (chipLoss > 0) {
            updates[`players/${p.seat}/chips`] = (room.players[p.seat].chips || 250) - chipLoss;
            updates[`players/${winnerSeat}/chips`] = (updates[`players/${winnerSeat}/chips`] || room.players[winnerSeat].chips) + chipLoss;
            updates.transfers.push({ from: p.name, to: room.players[winnerSeat].name, amount: chipLoss, note: "Hand Points" });
        }
    });

    // 2. SIDE TRANSFERS (Marriage & On-Suit Bonuses)
    active.forEach(p1 => {
        const allCards = [...(p1.hand || []), ...(p1.melds?.flatMap(m => m.cards) || [])].map(id => room.deck[id]);
        
        // Count specific on-suit cards
        let countT  = allCards.filter(c => c.rank === tRank && c.suit === joker.suit).length;
        let countPH = allCards.filter(c => c.rank === pHRank && c.suit === joker.suit).length;
        let countPL = allCards.filter(c => c.rank === pLRank && c.suit === joker.suit).length;
        let countA  = allCards.filter(c => c.rank === "A" && c.suit === joker.suit).length;

        const marriages = Math.min(countT, countPH, countPL);
        const remT  = countT - marriages;
        const remPH = countPH - marriages;
        const remPL = countPL - marriages;

        // Total bonus: (Marriage set * 25) + (Individual leftovers * 5) + (On-suit Aces * 5)
        const totalBonus = (marriages * VAL_MARRIAGE) + (remT * VAL_WILD_BASE) + (remPH * VAL_WILD_BASE) + (remPL * VAL_WILD_BASE) + (countA * VAL_WILD_BASE);

        if (totalBonus > 0) {
            active.forEach(p2 => {
                if (p1.seat === p2.seat) return;
                const p2Chips = updates[`players/${p2.seat}/chips`] !== undefined ? updates[`players/${p2.seat}/chips`] : room.players[p2.seat].chips;
                const p1Chips = updates[`players/${p1.seat}/chips`] !== undefined ? updates[`players/${p1.seat}/chips`] : room.players[p1.seat].chips;
                
                updates[`players/${p2.seat}/chips`] = p2Chips - totalBonus;
                updates[`players/${p1.seat}/chips`] = p1Chips + totalBonus;
                updates.transfers.push({ from: p2.name, to: p1.name, amount: totalBonus, note: marriages > 0 ? "Marriage + On-Suit" : "On-Suit Bonus" });
            });
        }
    });

    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  // ... (Remainder of the component logic for Deal, Pickup, Discard, Confirm Hand)

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: UI.bg, color: UI.text }}>
        {/* UI and Table Rendering */}
        {room.phase === "SCORING" && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: UI.panel, padding: 30, borderRadius: 15, width: 450 }}>
                    <h2 style={{ textAlign: 'center', color: UI.accent }}>Round Summary</h2>
                    <p style={{textAlign:'center', fontSize:11, opacity:0.6}}>Aces and Jokers must be on-suit for bonuses.</p>
                    {room.transfers?.map((t, k) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #334155' }}>
                            <span style={{fontSize:12}}>{t.from} ➔ {t.to}</span>
                            <span>{t.amount} <small style={{color:UI.accent}}>{t.note}</small></span>
                        </div>
                    ))}
                    <button onClick={handleDeal} style={{ ...btnStyle(UI.success), width: '100%', marginTop: 25, padding: 15 }}>Next Round</button>
                </div>
            </div>
        )}
    </div>
  );
}

function btnStyle(bg) { return { background: bg, border: "none", color: "white", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }; }