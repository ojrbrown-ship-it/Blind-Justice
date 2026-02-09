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
    width: 42, height: 60, background: '#fff', borderRadius: 4,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', userSelect: 'none', cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)', color: '#000'
  },
  btn: {
    padding: "6px 12px", border: "none", borderRadius: 4,
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
  const [dragItem, setDragItem] = useState(null); // Index of card in hand

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

    const updates = { 
        deck: deckMap, phase: "PLAY", turn: activeSeats[0], 
        logs: ["New Round Started"], winner: null 
    };
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

  // Drag and drop onto existing meld
  const handleAddToMeld = async (meldIdx) => {
    if (dragItem === null) return;
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

    // Win Mechanic
    if (newHand.length === 0) {
        updates.phase = "FINISHED";
        updates.winner = myP.name;
        updates.logs = [...(room.logs || []), `${myP.name} has WON the round!`];
    } else {
        const nextTurn = (meSeat + 1) % 5;
        updates.turn = room.players[nextTurn].name ? nextTurn : room.players.findIndex(p => p.name);
    }

    await update(ref(db, `rooms/${ROOM_ID}`), updates);
    setStage([]);
  };

  if (!room) return <div style={{ background: UI.feltDark, minHeight: '100vh' }} />;

  return (
    <div style={{ minHeight: "100vh", background: UI.feltDark, color: UI.text, fontFamily: 'system-ui', padding: 10 }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', background: 'rgba(0,0,0,0.3)', borderRadius: 12 }}>
        <div>
            <h2 style={{margin:0}}>Blind Justice</h2>
            {room.phase === "FINISHED" && <div style={{color: 'gold', fontWeight: 'bold'}}>WINNER: {room.winner}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={resetRoom} style={{ ...UI.btn, background: '#ef4444' }}>Reset Table</button>
          {room.phase !== "PLAY" && <button onClick={handleStartGame} style={{ ...UI.btn, background: '#22c55e' }}>{room.phase === "FINISHED" ? "Next Round" : "Deal"}</button>}
          {!meSeat && <input placeholder="Your Name" style={{padding: 5, borderRadius: 4}} value={meName} onChange={e => setMeName(e.target.value)} />}
        </div>
      </div>

      {/* TABLE */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 900, height: 480, margin: '40px auto', background: UI.felt, borderRadius: 200, border: '12px solid #5d4037', boxShadow: 'inset 0 0 100px rgba(0,0,0,0.5)' }}>
        
        {/* Center Deck Area */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: 15 }}>
          <div onClick={() => handlePickup('STOCK')} style={{ ...UI.cardBase, background: '#1e293b', border: '1px solid #334155' }}>
            <div style={{fontSize: 9, color: '#94a3b8'}}>STOCK</div>
          </div>
          <div style={{ ...UI.cardBase, border: '2px solid gold' }}>
            {jokerRevealed ? <CardFace card={jokerCard} /> : <div style={{fontSize:18}}>🔒</div>}
          </div>
          <div onClick={() => handlePickup('DISCARD')} style={{ ...UI.cardBase }}>
            <CardFace card={room.deck?.[room.discard?.[room.discard?.length - 1]]} />
          </div>
        </div>

        {/* Player Seats & Public Melds */}
        {room.players.map((p, i) => {
            const isCurrent = room.turn === i && room.phase === "PLAY";
            return (
                <div key={i} style={{ position: 'absolute', ...getPos(i, meSeat), width: 180, textAlign: 'center' }}>
                    <div style={{ padding: '4px 10px', background: isCurrent ? 'gold' : 'rgba(0,0,0,0.5)', borderRadius: 20, color: isCurrent ? '#000' : '#fff', display: 'inline-block', fontSize: 13, fontWeight: 'bold', marginBottom: 5 }}>
                        {p.name || <button onClick={() => handleSit(i)} style={{fontSize: 10}}>Sit Here</button>}
                    </div>
                    {/* Visual representation of player's melds for everyone */}
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                        {p.melds?.map((m, mi) => (
                            <div key={mi} style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', padding: 2, borderRadius: 2 }}>
                                {m.cards.map(cid => (
                                    <div key={cid} style={{ width: 12, height: 18, background: '#fff', border: '0.5px solid #000', borderRadius: 1 }} />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            );
        })}
      </div>

      {/* PLAYER TRAY */}
      {myP && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#1e293b', padding: '15px 20px', borderTop: '2px solid #334155' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{display:'flex', gap: 15, alignItems: 'center'}}>
                <span style={{fontWeight: 'bold'}}>{myP.name}</span>
                <span style={{ fontSize: 11, background: jokerRevealed ? '#22c55e' : '#64748b', padding: '2px 8px', borderRadius: 4 }}>
                    Weight: {myWeight} {jokerRevealed ? "🔓" : "🔒"}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: sortHandIds(room.deck, myP.hand) })} style={{ ...UI.btn, background: '#eab308', color:'#000' }}>Sort Hand</button>
                {stage.length >= 3 && <button onClick={handlePlayMeld} style={{ ...UI.btn, background: '#3b82f6' }}>New Meld</button>}
                <button onClick={handleDiscard} style={{ ...UI.btn, background: '#ef4444' }} disabled={!myP.hasPicked}>Discard Selection</button>
              </div>
            </div>

            {/* Hand with Reordering Drop Support */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 70, padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
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
                    style={{ ...UI.cardBase, border: isWild ? '2px solid gold' : isSelected ? '2px solid #3b82f6' : '1px solid #ccc', transform: isSelected ? 'translateY(-15px)' : 'none', transition: 'transform 0.1s' }}
                  >
                    <CardFace card={room.deck[id]} />
                    {isWild && <div style={{position:'absolute', top:-4, right:-4, fontSize:10}}>⭐</div>}
                  </div>
                );
              })}
            </div>

            {/* Melds Tray with ADD Card Support */}
            <div style={{ display: 'flex', gap: 15, marginTop: 15, borderTop: '1px solid #334155', paddingTop: 10, overflowX: 'auto' }}>
              {myP.melds?.map((m, mi) => (
                <div 
                    key={mi} 
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleAddToMeld(mi)}
                    style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.05)', padding: 6, borderRadius: 6, border: '1px dashed #475569' }}
                >
                  {m.cards.map(cid => (
                    <div key={cid} style={{ ...UI.cardBase, width: 30, height: 44, fontSize: 10 }}>
                        <CardFace card={room.deck[cid]} mini />
                    </div>
                  ))}
                  <div style={{width: 20, display:'flex', alignItems:'center', justifyContent:'center', fontSize: 18, opacity: 0.3}}>+</div>
                </div>
              ))}
              {(!myP.melds || myP.melds.length === 0) && <div style={{fontSize: 11, opacity: 0.4, padding: 10}}>No melds played yet. Select cards and click "New Meld" or drag here.</div>}
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
  const p = [
    { bottom: 20, left: '50%', transform: 'translateX(-50%)' }, 
    { top: '55%', right: 30 }, 
    { top: 30, right: '20%' }, 
    { top: 30, left: '20%' }, 
    { top: '55%', left: 30 }
  ];
  const idx = me === null ? i : (i - me + 5) % 5;
  return p[idx];
}