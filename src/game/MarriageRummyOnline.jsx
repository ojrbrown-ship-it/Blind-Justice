// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useState } from "react";
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
  if (card.rank === ws.rankWild) return true;
  if (card.suit === ws.suit) {
    if (card.rank === ws.papluLow || card.rank === ws.papluHigh || card.rank === ws.aceWild) return true;
  }
  return false;
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

// ------------------------------
// 3. Main Component
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
      turn: 0, phase: "LOBBY", logs: ["Welcome"], winner: null
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
    if (dragItem === null || targetSeat !== meSeat) return; // Only add to own melds for now
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
        updates.logs = [...(room.logs || []), `${myP.name} has WON!`];
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
    <div style={{ minHeight: "100vh", background: UI.feltDark, color: UI.text, fontFamily: 'system-ui', padding: 10 }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 25px', background: 'rgba(0,0,0,0.4)', borderRadius: 12, marginBottom: 20 }}>
        <div>
            <h2 style={{margin:0, color: 'white'}}>Blind Justice</h2>
            {room.phase === "FINISHED" && <div style={{color: 'gold', fontWeight: 'bold', fontSize: 20}}>🏆 {room.winner} Wins!</div>}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={resetRoom} style={{ ...UI.btn, background: '#ef4444' }}>Reset Table</button>
          {room.phase !== "PLAY" && <button onClick={handleStartGame} style={{ ...UI.btn, background: '#22c55e' }}>{room.phase === "FINISHED" ? "New Round" : "Deal Cards"}</button>}
          {!meSeat && <input placeholder="Your Name" style={{padding: 8, borderRadius: 6, border: 'none'}} value={meName} onChange={e => setMeName(e.target.value)} />}
        </div>
      </div>

      {/* Table Area */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 950, height: 500, margin: '0 auto', background: UI.felt, borderRadius: 250, border: '14px solid #4e342e', boxShadow: 'inset 0 0 80px rgba(0,0,0,0.6)' }}>
        
        {/* Center Deck & Discard */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: 20 }}>
          <div onClick={() => handlePickup('STOCK')} style={{ ...UI.cardBase, background: '#1e293b', border: '1px solid #334155' }}>
            <div style={{fontSize: 9, color: '#94a3b8'}}>STOCK</div>
          </div>
          <div style={{ ...UI.cardBase, border: '2px solid gold', cursor: 'default' }}>
            {jokerRevealed ? <CardFace card={jokerCard} /> : <div style={{fontSize:24}}>🔒</div>}
          </div>
          <div onClick={() => handlePickup('DISCARD')} style={{ ...UI.cardBase }}>
            <CardFace card={room.deck?.[room.discard?.[room.discard?.length - 1]]} />
          </div>
        </div>

        {/* Global Player View */}
        {room.players.map((p, i) => {
            const isTurn = room.turn === i && room.phase === "PLAY";
            return (
                <div key={i} style={{ position: 'absolute', ...getPos(i, meSeat), width: 220, textAlign: 'center' }}>
                    <div style={{ padding: '6px 14px', background: isTurn ? '#f59e0b' : 'rgba(0,0,0,0.6)', borderRadius: 25, color: isTurn ? '#000' : '#fff', display: 'inline-block', fontSize: 14, fontWeight: 'bold', marginBottom: 8, border: isTurn ? '2px solid white' : 'none' }}>
                        {p.name || <button onClick={() => handleSit(i)} style={{fontSize: 11}}>Sit</button>}
                    </div>
                    
                    {/* Publicly Visible Melds */}
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {p.melds?.map((m, mi) => (
                            <div key={mi} 
                                 onDragOver={e => e.preventDefault()}
                                 onDrop={() => handleAddToMeld(i, mi)}
                                 style={{ display: 'flex', gap: 1, background: 'rgba(0,0,0,0.3)', padding: 3, borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)' }}>
                                {m.cards.map(cid => (
                                    <div key={cid} style={{...UI.cardBase, width: 24, height: 36, fontSize: 10, borderRadius: 2}}>
                                        <CardFace card={room.deck[cid]} mini />
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            );
        })}
      </div>

      {/* Player Dashboard */}
      {myP && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#1e293b', padding: '20px', borderTop: '3px solid #334155', zIndex: 100 }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}>
              <div style={{display:'flex', gap: 20, alignItems: 'center'}}>
                <span style={{fontSize: 18, fontWeight: 'bold'}}>{myP.name}</span>
                <div style={{ fontSize: 12, background: jokerRevealed ? '#16a34a' : '#475569', padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)' }}>
                    Meld Weight: {myWeight} {jokerRevealed ? "🔓 JOKER ACTIVE" : "🔒 LOCKED"}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: sortHandIds(room.deck, myP.hand) })} style={{ ...UI.btn, background: '#ca8a04' }}>Sort Hand</button>
                {stage.length >= 3 && <button onClick={handlePlayMeld} style={{ ...UI.btn, background: '#2563eb' }}>Play New Meld</button>}
                <button onClick={handleDiscard} style={{ ...UI.btn, background: '#dc2626' }} disabled={!myP.hasPicked}>Discard Selection</button>
              </div>
            </div>

            {/* My Hand (Staging Area) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 85, padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 10, border: '1px solid #334155' }}>
              {myP.hand?.map((id, idx) => {
                const isSelected = stage.includes(id);
                const isWild = isCardWild(room.deck[id], jokerCard, myWeight);
                return (
                  <div
                    key={id} draggable
                    onDragStart={() => setDragItem(idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                        const newHand = [...myP.hand];
                        const item = newHand.splice(dragItem, 1)[0];
                        newHand.splice(idx, 0, item);
                        update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand });
                    }}
                    onClick={() => setStage(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])}
                    style={{ ...UI.cardBase, border: isWild ? '3px solid #f59e0b' : isSelected ? '3px solid #3b82f6' : '1px solid #94a3b8', transform: isSelected ? 'translateY(-20px)' : 'none', transition: 'transform 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28)' }}
                  >
                    <CardFace card={room.deck[id]} />
                    {isWild && <div style={{position:'absolute', top:-6, right:-6, fontSize:12, filter: 'drop-shadow(0 0 2px black)'}}>⭐</div>}
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
      <div style={{ fontWeight: 'bold', fontSize: mini ? 11 : 16 }}>{card.rank}</div>
      <div style={{ fontSize: mini ? 14 : 20 }}>{card.suit}</div>
    </div>
  );
}

function getPos(i, me) {
  const p = [
    { bottom: 15, left: '50%', transform: 'translateX(-50%)' }, 
    { top: '55%', right: 25 }, 
    { top: 20, right: '22%' }, 
    { top: 20, left: '22%' }, 
    { top: '55%', left: 25 }
  ];
  const idx = me === null ? i : (i - me + 5) % 5;
  return p[idx];
}