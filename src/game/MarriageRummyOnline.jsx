// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, set } from "firebase/database";

// ------------------------------
// 1. Firebase Configuration
// ------------------------------
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

// ------------------------------
// 2. Constants & Helpers
// ------------------------------
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const getRankIdx = (r) => RANKS.indexOf(r);
const getSuitIdx = (s) => SUITS.indexOf(s);

function sortHandIds(deck, handIds) {
  if (!deck || !handIds) return [];
  return [...handIds].sort((aId, bId) => {
    const cA = deck[aId];
    const cB = deck[bId];
    if (!cA || !cB) return 0;
    if (cA.suit !== cB.suit) return getSuitIdx(cA.suit) - getSuitIdx(cB.suit);
    return getRankIdx(cA.rank) - getRankIdx(cB.rank);
  });
}

function calculateMeldWeight(melds) {
  if (!Array.isArray(melds)) return 0;
  return melds.reduce((acc, m) => {
    const len = m.cards.length;
    if (len >= 9) return acc + 3;
    if (len >= 6) return acc + 2;
    if (len >= 3) return acc + 1;
    return acc;
  }, 0);
}

function getWildSuite(jokerCard) {
  if (!jokerCard) return null;
  const idx = getRankIdx(jokerCard.rank);
  return {
    rankWild: jokerCard.rank,
    papluLow: RANKS[(idx - 1 + 13) % 13],
    papluHigh: RANKS[(idx + 1) % 13],
    aceWild: "A",
    suit: jokerCard.suit
  };
}

function isCardWild(card, jokerCard, playerWeight) {
  if (!jokerCard || !card || playerWeight < 3) return false;
  const ws = getWildSuite(jokerCard);
  if (card.rank === ws.rankWild) return true;
  if (card.suit === ws.suit) {
    if (card.rank === ws.papluLow || card.rank === ws.papluHigh || card.rank === ws.aceWild) return true;
  }
  return false;
}

// ------------------------------
// 3. UI Styles
// ------------------------------
const UI = {
  felt: "#135f39",
  feltDark: "#0e4c2e",
  text: "#ecfdf5",
  cardBase: {
    width: 44, height: 64, background: '#fff', borderRadius: 5,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', userSelect: 'none', cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
  },
  btn: {
    padding: "6px 12px", border: "none", borderRadius: 4,
    cursor: "pointer", fontWeight: "bold", color: "white"
  }
};

// ------------------------------
// 4. Main Component
// ------------------------------
export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]);
  const [dragItem, setDragItem] = useState(null);

  const ROOM_ID = "global";

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${ROOM_ID}`), (snap) => {
      const val = snap.val();
      if (val) setRoom(val);
      else resetRoom();
    });
    return () => unsub();
  }, []);

  const resetRoom = async () => {
    const players = Array.from({ length: 5 }, (_, i) => ({
      seat: i, name: "", chips: 250, hand: [], melds: [], hasPicked: false
    }));
    await set(ref(db, `rooms/${ROOM_ID}`), {
      players, deck: {}, discard: [], stock: [], jokerCardId: null,
      turn: 0, phase: "LOBBY", logs: ["Welcome"]
    });
  };

  const myP = room?.players?.[meSeat];
  const isMyTurn = room?.phase === "PLAY" && room?.turn === meSeat;
  const myWeight = useMemo(() => calculateMeldWeight(myP?.melds || []), [myP?.melds]);
  const jokerRevealed = myWeight >= 3;
  const jokerCard = room?.deck?.[room?.jokerCardId];

  // Actions
  const handleSit = async (i) => {
    if (!meName) return alert("Enter name");
    localStorage.setItem("mr_name", meName);
    setMeSeat(i);
    await update(ref(db, `rooms/${ROOM_ID}/players/${i}`), { name: meName });
  };

  const handleStartGame = async () => {
    const deckArr = [];
    for (let d = 0; d < 3; d++) {
      SUITS.forEach(s => RANKS.forEach(r => {
        deckArr.push({ id: `${d}${s}${r}${Math.random().toString(36).slice(2, 5)}`, suit: s, rank: r });
      }));
    }
    for (let i = deckArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deckArr[i], deckArr[j]] = [deckArr[j], deckArr[i]];
    }

    const deckMap = {};
    deckArr.forEach(c => deckMap[c.id] = c);

    const activeSeats = room.players.filter(p => p.name).map(p => p.seat);
    if (activeSeats.length < 1) return alert("Need 1+ players to start");

    const updates = { deck: deckMap, phase: "PLAY", turn: activeSeats[0], discard: [], logs: ["Game Started"] };
    let ptr = 0;
    activeSeats.forEach(s => {
      const hand = deckArr.slice(ptr, ptr + 21).map(c => c.id);
      updates[`players/${s}/hand`] = sortHandIds(deckMap, hand);
      updates[`players/${s}/melds`] = [];
      updates[`players/${s}/hasPicked`] = false;
      ptr += 21;
    });

    updates.jokerCardId = deckArr[ptr++].id;
    updates.discard = [deckArr[ptr++].id];
    updates.stock = deckArr.slice(ptr).map(c => c.id);

    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handlePickup = async (src) => {
    if (!isMyTurn || myP.hasPicked) return;
    const cardId = src === "STOCK" ? room.stock[0] : room.discard[room.discard.length - 1];
    const updates = {
      [`players/${meSeat}/hand`]: [...(myP.hand || []), cardId],
      [`players/${meSeat}/hasPicked`]: true
    };
    if (src === "STOCK") updates.stock = room.stock.slice(1);
    else updates.discard = room.discard.slice(0, -1);
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handlePlayMeld = async () => {
    if (stage.length < 3) return alert("Select at least 3 cards");
    const newMelds = [...(myP.melds || []), { id: Date.now(), cards: [...stage] }];
    const newHand = myP.hand.filter(id => !stage.includes(id));
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand, melds: newMelds });
    setStage([]);
  };

  const handleDiscard = async () => {
    if (stage.length !== 1) return alert("Select 1 card to discard");
    const cardId = stage[0];
    const nextTurn = (meSeat + 1) % 5; // Simplified turn logic
    await update(ref(db, `rooms/${ROOM_ID}`), {
      [`players/${meSeat}/hand`]: myP.hand.filter(id => id !== cardId),
      [`players/${meSeat}/hasPicked`]: false,
      discard: [...(room.discard || []), cardId],
      turn: room.players[nextTurn].name ? nextTurn : room.players.findIndex(p => p.name)
    });
    setStage([]);
  };

  // Drag & Drop
  const onDrop = async (dropIdx) => {
    const newHand = [...myP.hand];
    const item = newHand.splice(dragItem, 1)[0];
    newHand.splice(dropIdx, 0, item);
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand });
    setDragItem(null);
  };

  if (!room) return <div style={{ background: UI.feltDark, minHeight: '100vh' }} />;

  return (
    <div style={{ minHeight: "100vh", background: UI.feltDark, color: UI.text, fontFamily: 'sans-serif', padding: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
        <div><b>Blind Justice</b> | Phase: {room.phase}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={resetRoom} style={{ ...UI.btn, background: '#ef4444' }}>Reset</button>
          {room.phase !== "PLAY" && <button onClick={handleStartGame} style={{ ...UI.btn, background: '#22c55e' }}>Deal</button>}
          {!meSeat && <input placeholder="Name" value={meName} onChange={e => setMeName(e.target.value)} />}
        </div>
      </div>

      {/* Table */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 800, height: 400, margin: '20px auto', background: UI.felt, borderRadius: 200, border: '10px solid #5d4037' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: 10 }}>
          <div onClick={() => handlePickup('STOCK')} style={{ ...UI.cardBase, background: '#1e293b' }} />
          <div style={{ ...UI.cardBase, border: '2px solid gold' }}>
            {jokerRevealed ? <CardFace card={jokerCard} /> : "🔒"}
          </div>
          <div onClick={() => handlePickup('DISCARD')} style={{ ...UI.cardBase }}>
            <CardFace card={room.deck?.[room.discard?.[room.discard?.length - 1]]} />
          </div>
        </div>
        {room.players.map((p, i) => (
          <div key={i} style={{ position: 'absolute', ...getPos(i, meSeat), padding: 5, background: room.turn === i ? 'gold' : 'transparent', borderRadius: 4, color: room.turn === i ? '#000' : '#fff' }}>
            {p.name || <button onClick={() => handleSit(i)}>Sit</button>}
          </div>
        ))}
      </div>

      {/* Player Tray */}
      {myP && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#1e293b', padding: 15 }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>Weight: {myWeight} {jokerRevealed ? "🔓" : "🔒"}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: sortHandIds(room.deck, myP.hand) })} style={{ ...UI.btn, background: '#eab308' }}>Sort</button>
                {stage.length >= 3 && <button onClick={handlePlayMeld} style={{ ...UI.btn, background: '#3b82f6' }}>Meld</button>}
                <button onClick={handleDiscard} style={{ ...UI.btn, background: '#ef4444' }} disabled={!myP.hasPicked}>Discard</button>
              </div>
            </div>

            {/* Staging Area / Hand */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {myP.hand?.map((id, idx) => {
                const isSelected = stage.includes(id);
                const isWild = isCardWild(room.deck[id], jokerCard, myWeight);
                return (
                  <div
                    key={id} draggable
                    onDragStart={() => setDragItem(idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => onDrop(idx)}
                    onClick={() => setStage(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])}
                    style={{ ...UI.cardBase, border: isWild ? '2px solid gold' : '1px solid #ccc', transform: isSelected ? 'translateY(-15px)' : 'none' }}
                  >
                    <CardFace card={room.deck[id]} />
                  </div>
                );
              })}
            </div>

            {/* Melds Area */}
            <div style={{ display: 'flex', gap: 10, marginTop: 15, borderTop: '1px solid #334155', paddingTop: 10 }}>
              {myP.melds?.map((m, mi) => (
                <div key={mi} style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.3)', padding: 3, borderRadius: 4 }}>
                  {m.cards.map(cid => <div key={cid} style={{ ...UI.cardBase, width: 25, height: 35, fontSize: 10 }}><CardFace card={room.deck[cid]} mini /></div>)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CardFace({ card, mini }) {
  if (!card) return null;
  const isRed = card.suit === '♥' || card.suit === '♦';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: isRed ? '#ef4444' : '#000' }}>
      <div style={{ fontWeight: 'bold', fontSize: mini ? 10 : 14 }}>{card.rank}</div>
      <div style={{ fontSize: mini ? 12 : 18, lineHeight: 1 }}>{card.suit}</div>
    </div>
  );
}

function getPos(i, me) {
  const p = [{ bottom: -20, left: '45%' }, { top: '40%', right: -60 }, { top: -40, right: '20%' }, { top: -40, left: '20%' }, { top: '40%', left: -60 }];
  const idx = me === null ? i : (i - me + 5) % 5;
  return p[idx];
}