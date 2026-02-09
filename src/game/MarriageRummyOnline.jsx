// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, set } from "firebase/database";

// ... (Firebase Config & Helpers remain the same as previous) ...
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

function isCardWild(card, jokerCard, playerWeight) {
  if (!jokerCard || !card || playerWeight < 3) return false;
  const idx = getRankIdx(jokerCard.rank);
  const ws = {
    rankWild: jokerCard.rank,
    papluLow: RANKS[(idx - 1 + 13) % 13],
    papluHigh: RANKS[(idx + 1) % 13],
    aceWild: "A",
    suit: jokerCard.suit
  };
  return card.rank === ws.rankWild || (card.suit === ws.suit && (card.rank === ws.papluLow || card.rank === ws.papluHigh || card.rank === ws.aceWild));
}

const UI = {
  felt: "#135f39",
  feltDark: "#0e4c2e",
  text: "#ecfdf5",
  cardBase: {
    width: 44, height: 64, background: '#fff', borderRadius: 4,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', userSelect: 'none', cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)', color: '#000'
  },
  btn: {
    padding: "6px 14px", border: "none", borderRadius: 4,
    cursor: "pointer", fontWeight: "bold", color: "white"
  }
};

export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]);
  const [dragItem, setDragItem] = useState(null);

  const ROOM_ID = "global";

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${ROOM_ID}`), (snap) => setRoom(snap.val()));
    return () => unsub();
  }, []);

  const resetRoom = async () => {
    const players = Array.from({ length: 5 }, (_, i) => ({
      seat: i, name: "", chips: 250, hand: [], melds: [], hasPicked: false
    }));
    await set(ref(db, `rooms/${ROOM_ID}`), {
      players, deck: {}, discard: [], stock: [], jokerCardId: null,
      turn: 0, phase: "LOBBY", logs: ["Welcome"], winner: null
    });
  };

  const myP = room?.players?.[meSeat];
  const isMyTurn = room?.phase === "PLAY" && room?.turn === meSeat;
  const myWeight = useMemo(() => calculateMeldWeight(myP?.melds || []), [myP?.melds]);
  const jokerRevealed = myWeight >= 3;
  const jokerCard = room?.deck?.[room?.jokerCardId];

  // Logic Handlers
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
        deckArr.push({ id: `${d}${s}${r}${Math.random().toString(36).slice(2, 6)}`, suit: s, rank: r });
      }));
    }
    for (let i = deckArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deckArr[i], deckArr[j]] = [deckArr[j], deckArr[i]];
    }
    const deckMap = {};
    deckArr.forEach(c => deckMap[c.id] = c);
    const activeSeats = room.players.filter(p => p.name).map(p => p.seat);
    if (activeSeats.length < 1) return alert("No players seated");

    const updates = { deck: deckMap, phase: "PLAY", turn: activeSeats[0], logs: ["New Round Started"], winner: null };
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
    if (stage.length < 3) return alert("Select 3+ cards");
    const newMelds = [...(myP.melds || []), { cards: [...stage] }];
    const newHand = myP.hand.filter(id => !stage.includes(id));
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand, melds: newMelds });
    setStage([]);
  };

  const handleAddToMeld = async (targetSeat, meldIdx) => {
    if (dragItem === null || targetSeat !== meSeat) return;
    const cardId = myP.hand[dragItem];
    const newHand = myP.hand.filter((_, i) => i !== dragItem);
    const newMelds = [...myP.melds];
    newMelds[meldIdx].cards.push(cardId);
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand, melds: newMelds });
    setDragItem(null);
  };

  const handleDiscard = async () => {
    if (stage.length !== 1) return alert("Select 1 card to discard");
    const cardId = stage[0];
    const newHand = myP.hand.filter(id => id !== cardId);
    const updates = {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${meSeat}/hasPicked`]: false,
      discard: [...(room.discard || []), cardId],
    };
    if (newHand.length === 0) {
      updates.phase = "FINISHED";
      updates.winner = myP.name;
    } else {
      let nextTurn = (meSeat + 1) % 5;
      while (!room.players[nextTurn].name) nextTurn = (nextTurn + 1) % 5;
      updates.turn = nextTurn;
    }
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
    setStage([]);
  };

  if (!room) return <div style={{ background: UI.feltDark, minHeight: '100vh' }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: UI.feltDark, color: UI.text, fontFamily: 'system-ui', overflow: 'hidden' }}>
      
      {/* 1. HEADER SECTION */}
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', padding: '10px 20px', background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid #334155' }}>
        <div>
          <h3 style={{margin:0}}>Blind Justice</h3>
          {room.phase === "FINISHED" && <span style={{color: 'gold', fontSize: 12}}>Winner: {room.winner}</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={resetRoom} style={{ ...UI.btn, background: '#ef4444', padding: '4px 10px' }}>Reset</button>
          {room.phase !== "PLAY" && <button onClick={handleStartGame} style={{ ...UI.btn, background: '#22c55e', padding: '4px 10px' }}>Deal</button>}
          {!meSeat && <input placeholder="Name" style={{width: 80, padding: 4}} value={meName} onChange={e => setMeName(e.target.value)} />}
        </div>
      </div>

      {/* 2. TABLE SECTION (Middle) */}
      <div style={{ flex: 1, position: 'relative', overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 850, height: 450, background: UI.felt, borderRadius: 220, border: '12px solid #4e342e', boxShadow: 'inset 0 0 80px rgba(0,0,0,0.5)' }}>
          
          {/* Deck Area */}
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: 15 }}>
            <div onClick={() => handlePickup('STOCK')} style={{ ...UI.cardBase, background: '#1e293b' }} />
            <div style={{ ...UI.cardBase, border: '2px solid gold' }}>
              {jokerRevealed ? <CardFace card={jokerCard} /> : <div style={{fontSize:20}}>🔒</div>}
            </div>
            <div onClick={() => handlePickup('DISCARD')} style={{ ...UI.cardBase }}>
              <CardFace card={room.deck?.[room.discard?.[room.discard?.length - 1]]} />
            </div>
          </div>

          {/* Player Seats */}
          {room.players.map((p, i) => {
            const isTurn = room.turn === i && room.phase === "PLAY";
            return (
              <div key={i} style={{ position: 'absolute', ...getPos(i, meSeat), width: 180, textAlign: 'center' }}>
                <div style={{ padding: '4px 12px', background: isTurn ? '#f59e0b' : 'rgba(0,0,0,0.6)', borderRadius: 20, fontSize: 12, fontWeight: 'bold' }}>
                  {p.name || <button onClick={() => handleSit(i)} style={{fontSize: 9}}>Sit</button>}
                </div>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 5 }}>
                  {p.melds?.map((m, mi) => (
                    <div key={mi} onDragOver={e => e.preventDefault()} onDrop={() => handleAddToMeld(i, mi)} style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: 2, borderRadius: 3 }}>
                      {m.cards.map(cid => <div key={cid} style={{...UI.cardBase, width: 18, height: 28, fontSize: 8}}><CardFace card={room.deck[cid]} mini /></div>)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. PLAYER TRAY (Bottom) */}
      {myP && (
        <div style={{ flexShrink: 0, background: '#1e293b', padding: '15px 20px', borderTop: '2px solid #334155' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{fontSize: 14}}><b>{myP.name}</b> | Weight: {myWeight} {jokerRevealed ? "🔓" : "🔒"}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: sortHandIds(room.deck, myP.hand) })} style={{ ...UI.btn, background: '#ca8a04', padding: '4px 10px' }}>Sort</button>
                {stage.length >= 3 && <button onClick={handlePlayMeld} style={{ ...UI.btn, background: '#2563eb', padding: '4px 10px' }}>Meld</button>}
                <button onClick={handleDiscard} style={{ ...UI.btn, background: '#dc2626', padding: '4px 10px' }} disabled={!myP.hasPicked}>Discard</button>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
              {myP.hand?.map((id, idx) => {
                const isSelected = stage.includes(id);
                return (
                  <div key={id} draggable onDragStart={() => setDragItem(idx)} onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                      const newHand = [...myP.hand];
                      const item = newHand.splice(dragItem, 1)[0];
                      newHand.splice(idx, 0, item);
                      update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand });
                    }}
                    onClick={() => setStage(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])}
                    style={{ ...UI.cardBase, border: isSelected ? '2px solid #3b82f6' : '1px solid #94a3b8', transform: isSelected ? 'translateY(-10px)' : 'none' }}
                  >
                    <CardFace card={room.deck[id]} />
                    {isCardWild(room.deck[id], jokerCard, myWeight) && <div style={{position:'absolute', top:-4, right:-4}}>⭐</div>}
                  </div>
                );
              })}
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: isRed ? '#dc2626' : '#1e293b', lineHeight: 1 }}>
      <div style={{ fontWeight: 'bold', fontSize: mini ? 10 : 14 }}>{card.rank}</div>
      <div style={{ fontSize: mini ? 12 : 18 }}>{card.suit}</div>
    </div>
  );
}

function getPos(i, me) {
  const p = [
    { bottom: -20, left: '50%', transform: 'translateX(-50%)' }, 
    { top: '50%', right: -40, transform: 'translateY(-50%)' }, 
    { top: -30, right: '15%' }, 
    { top: -30, left: '15%' }, 
    { top: '50%', left: -40, transform: 'translateY(-50%)' }
  ];
  const idx = me === null ? i : (i - me + 5) % 5;
  return p[idx];
}