import React, { useEffect, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, set } from "firebase/database";
import { motion, Reorder } from "framer-motion";

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
      boxShadow: "0 2px 5px rgba(0,0,0,0.3)", userSelect: "none", cursor: "grab",
    },
    lg: { width: 62, height: 88 }, md: { width: 50, height: 72 }
  }
};

const getRankIdx = (r) => RANKS.indexOf(r);

export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [localHand, setLocalHand] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);

  const ROOM_ID = "global_room_v3";

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${ROOM_ID}`), (snap) => {
      const data = snap.val();
      if (data) {
        setRoom(data);
        if (meSeat !== null && data.players[meSeat]?.hand) {
          if (data.players[meSeat].hand.length !== localHand.length) {
            setLocalHand(data.players[meSeat].hand);
          }
        }
      }
    });
    return () => unsub();
  }, [meSeat, localHand.length]);

  if (!room || !room.phase) {
    return (
      <div style={{ background: UI.bg, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
        <h2>Blind Justice Online</h2>
        <button onClick={() => set(ref(db, `rooms/${ROOM_ID}`), { phase: "LOBBY", players: Array(5).fill({name:"", chips:250}) })} style={btnStyle(UI.success)}>Create Table</button>
      </div>
    );
  }

  const myP = room.players?.[meSeat];
  const isMyTurn = room.phase === "PLAY" && room.turn === meSeat;

  const handleSort = () => {
    const sorted = [...localHand].sort((a, b) => {
      const cardA = room.deck[a];
      const cardB = room.deck[b];
      if (cardA.suit !== cardB.suit) return SUITS.indexOf(cardA.suit) - SUITS.indexOf(cardB.suit);
      return getRankIdx(cardA.rank) - getRankIdx(cardB.rank);
    });
    setLocalHand(sorted);
  };

  const updateRemoteHand = async (newOrder) => {
    setLocalHand(newOrder);
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newOrder });
  };

  const handleDiscard = async () => {
    if (!isMyTurn || !myP?.hasPicked || !selectedCard) return;
    const newHand = localHand.filter(id => id !== selectedCard);
    const newDiscard = [...(room.discard || []), selectedCard];
    const nextTurn = (meSeat + 1) % 5;
    
    setSelectedCard(null);
    await update(ref(db, `rooms/${ROOM_ID}`), {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${meSeat}/hasPicked`]: false,
      discard: newDiscard,
      turn: nextTurn
    });
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: UI.bg, color: UI.text }}>
      <div style={{ padding: "10px 20px", display: "flex", justifyContent: "space-between", background: "rgba(0,0,0,0.5)" }}>
        <h2 style={{margin:0}}>Blind Justice</h2>
        <div style={{display:'flex', gap: 10}}>
            <button onClick={handleSort} style={btnStyle(UI.accent)}>Sort Hand</button>
            {isMyTurn && myP?.hasPicked && (
                <button onClick={handleDiscard} disabled={!selectedCard} style={btnStyle(selectedCard ? UI.danger : "#475569")}>
                    Discard Selected
                </button>
            )}
        </div>
      </div>

      <div style={{ flex: 1, position: "relative", background: UI.felt }}>
         {/* Seats and Center Deck Area logic here... */}
      </div>

      {myP && (
        <div style={{ background: UI.panel, padding: "15px 20px", borderTop: "4px solid #334155" }}>
          <Reorder.Group axis="x" values={localHand} onReorder={updateRemoteHand} style={{ display: "flex", gap: 8, listStyle: 'none', padding: 0, overflowX: "auto", minHeight: '120px' }}>
            {localHand.map(id => (
              <Reorder.Item key={id} value={id}>
                <motion.div 
                  onClick={() => setSelectedCard(selectedCard === id ? null : id)}
                  animate={{ y: selectedCard === id ? -20 : 0 }}
                  style={{ ...UI.card.base, ...UI.card.lg, border: selectedCard === id ? `3px solid ${UI.accent}` : "none" }}>
                  <CardFace card={room.deck[id]} />
                </motion.div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      )}
    </div>
  );
}

function CardFace({ card }) {
  if (!card) return null;
  const isRed = ["♥", "♦"].includes(card.suit);
  return (
    <div style={{ color: isRed ? "#ef4444" : "#0f172a", textAlign: "center" }}>
      <div style={{ fontWeight: "bold", fontSize: 18 }}>{card.rank}</div>
      <div style={{ fontSize: 22 }}>{card.suit}</div>
    </div>
  );
}

function btnStyle(bg) { return { background: bg, border: "none", color: "white", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }; }