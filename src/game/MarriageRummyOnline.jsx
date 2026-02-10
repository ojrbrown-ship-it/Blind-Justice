// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, set } from "firebase/database";

// ==========================================
// 1. CONFIGURATION
// ==========================================

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
  bg: "#0f172a",
  felt: "#14532d",
  panel: "#1e293b",
  text: "#f1f5f9",
  accent: "#eab308",
  danger: "#ef4444",
  success: "#22c55e",
  card: {
    base: {
      background: "white", borderRadius: "6px", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      boxShadow: "0 2px 5px rgba(0,0,0,0.3)", userSelect: "none", cursor: "pointer",
      position: "relative", transition: "transform 0.1s"
    },
    sm: { width: 34, height: 48, fontSize: 12 },
    md: { width: 50, height: 72, fontSize: 18 },
    lg: { width: 60, height: 84, fontSize: 24 },
  }
};

// ==========================================
// 2. LOGIC HELPERS
// ==========================================

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

function getCardPointValue(rank) {
  if (["J", "Q", "K", "A", "10"].includes(rank)) return 10;
  return parseInt(rank) || 0;
}

function isCardWild(card, jokerCard, playerWeight) {
  if (!jokerCard || !card || playerWeight < 3) return false;
  const idx = getRankIdx(jokerCard.rank);
  if (card.rank === jokerCard.rank) return true; // Tiplu
  if (card.suit === jokerCard.suit) {
    // Paplu (Same suit, +/- 1)
    const low = RANKS[(idx - 1 + 13) % 13];
    const high = RANKS[(idx + 1) % 13];
    if (card.rank === low || card.rank === high || card.rank === "A") return true;
  }
  return false;
}

// ==========================================
// 3. MAIN COMPONENT
// ==========================================

export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]); // Selected cards for action
  const [dragIdx, setDragIdx] = useState(null);

  const ROOM_ID = "global_room_v2";

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${ROOM_ID}`), (snap) => {
      const val = snap.val();
      if (val) setRoom(val);
      else initRoom();
    });
    return () => unsub();
  }, []);

  const initRoom = async () => {
    const players = Array.from({ length: 5 }, (_, i) => ({
      seat: i, name: "", chips: 1000, hand: [], melds: [], hasPicked: false, roundFinished: false
    }));
    await set(ref(db, `rooms/${ROOM_ID}`), {
      players, phase: "LOBBY", turn: 0, deck: {}, discard: [], stock: [], 
      jokerCardId: null, winnerSeat: null, transfers: []
    });
  };

  const myP = room?.players?.[meSeat];
  const isMyTurn = room?.phase === "PLAY" && room?.turn === meSeat;
  const myWeight = useMemo(() => calculateMeldWeight(myP?.melds || []), [myP?.melds]);
  const jokerRevealed = myWeight >= 3;
  const jokerCard = room?.deck?.[room?.jokerCardId];

  // --- Actions ---

  const handleSit = async (i) => {
    if (!meName) return alert("Enter Name");
    localStorage.setItem("mr_name", meName);
    setMeSeat(i);
    await update(ref(db, `rooms/${ROOM_ID}/players/${i}`), { name: meName });
  };

  const handleDeal = async () => {
    let dArr = [];
    for (let d=0; d<3; d++) {
      SUITS.forEach(s => RANKS.forEach(r => dArr.push({ id: `${d}${s}${r}${Date.now()}`, suit: s, rank: r })));
    }
    for (let i = dArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dArr[i], dArr[j]] = [dArr[j], dArr[i]];
    }

    const deckMap = {};
    dArr.forEach(c => deckMap[c.id] = c);
    const active = room.players.filter(p => p.name);
    
    const updates = {
      deck: deckMap, phase: "PLAY", turn: active[0].seat, winnerSeat: null, transfers: []
    };
    
    let ptr = 0;
    active.forEach(p => {
      const hand = dArr.slice(ptr, ptr + 21).map(c => c.id);
      updates[`players/${p.seat}/hand`] = sortHandIds(deckMap, hand);
      updates[`players/${p.seat}/melds`] = [];
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

  const handleMeld = async () => {
    if (stage.length < 3) return alert("Need 3+ cards");
    const newMelds = [...(myP.melds || []), { cards: [...stage] }];
    const newHand = myP.hand.filter(id => !stage.includes(id));
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand, melds: newMelds });
    setStage([]);
  };

  const handleAddToMeld = async (targetSeat, mIdx) => {
    // Only drag-drop adds to meld for now (UI simplicity)
    if (dragIdx === null) return;
    const cardId = myP.hand[dragIdx];
    const newHand = myP.hand.filter((_, i) => i !== dragIdx);
    const targetMelds = [...room.players[targetSeat].melds];
    targetMelds[mIdx].cards.push(cardId);

    const updates = {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${targetSeat}/melds`]: targetMelds
    };
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
    setDragIdx(null);
  };

  const handleDiscard = async () => {
    if (stage.length !== 1) return alert("Select 1 card");
    const cardId = stage[0];
    const newHand = myP.hand.filter(id => id !== cardId);
    
    const updates = {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${meSeat}/hasPicked`]: false,
      discard: [...(room.discard || []), cardId],
    };

    // WIN CONDITION
    if (newHand.length === 0) {
      updates.phase = "ROUND_END";
      updates.winnerSeat = meSeat;
      updates[`players/${meSeat}/roundFinished`] = true; // Winner is automatically finished
    } else {
      let next = (meSeat + 1) % 5;
      while (!room.players[next].name) next = (next + 1) % 5;
      updates.turn = next;
    }
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
    setStage([]);
  };

  // --- Round End Logic ---

  const handleConfirmHand = async () => {
    // Player is done melding in ROUND_END phase
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { roundFinished: true });
    
    // Check if everyone is finished
    // Need to read fresh state to be safe, but simplistic here:
    const active = room.players.filter(p => p.name);
    const allDone = active.every(p => p.seat === meSeat ? true : p.roundFinished); // local optimisitc check
    
    if (allDone) {
        calculateScores();
    }
  };

  const calculateScores = async () => {
    const active = room.players.filter(p => p.name);
    const updates = { phase: "SCORING", transfers: [] };
    const winner = room.players[room.winnerSeat];

    active.forEach(p => {
        if (p.seat === room.winnerSeat) return;

        // Calculate penalty
        let penalty = 0;
        p.hand.forEach(cid => {
            const card = room.deck[cid];
            // If it's a wild card remaining in hand, maybe 0 points? 
            // Standard Rummy: Face Value.
            penalty += getCardPointValue(card.rank);
        });

        if (penalty > 0) {
            updates[`players/${p.seat}/chips`] = (p.chips || 0) - penalty;
            updates[`players/${room.winnerSeat}/chips`] = (room.players[room.winnerSeat].chips || winner.chips || 0) + penalty; // Accumulate locally for update
            
            // Note: In real firebase atomic updates, we'd use transaction. 
            // Here we just push the logic.
            updates.transfers.push({
                from: p.name,
                to: winner.name,
                amount: penalty
            });
            
            // Update local variable for next iteration loop
            winner.chips = (winner.chips || 0) + penalty;
        }
    });
    
    updates[`players/${room.winnerSeat}/chips`] = winner.chips;
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  if (!room) return <div style={{color:'white'}}>Loading...</div>;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: UI.bg, fontFamily: "sans-serif", overflow: "hidden" }}>
      
      {/* HEADER */}
      <div style={{ padding: "10px 20px", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{color: UI.text}}>
            <b>Blind Justice</b> | {room.phase === "PLAY" ? `Turn: ${room.players[room.turn].name}` : room.phase}
        </div>
        <div style={{display:'flex', gap:10}}>
            <button onClick={initRoom} style={btnStyle(UI.danger)}>Reset</button>
            {room.phase === "LOBBY" && <button onClick={handleDeal} style={btnStyle(UI.success)}>Deal</button>}
            {!meSeat && <input placeholder="Name" value={meName} onChange={e=>setMeName(e.target.value)} style={{padding:5}} />}
        </div>
      </div>

      {/* TABLE */}
      <div style={{ flex: 1, position: 'relative', background: UI.felt }}>
        
        {/* Center Deck */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: 15, zIndex: 10 }}>
            <div onClick={() => room.phase === "PLAY" && handlePickup('STOCK')} style={{...UI.card.base, ...UI.card.md, background: '#334155'}} />
            <div style={{...UI.card.base, ...UI.card.md, border: '2px solid gold'}}>
                {jokerRevealed ? <CardFace card={jokerCard} size="md"/> : "🔒"}
            </div>
            <div onClick={() => room.phase === "PLAY" && handlePickup('DISCARD')} style={{...UI.card.base, ...UI.card.md}}>
                <CardFace card={room.deck?.[room.discard?.[room.discard.length-1]]} size="md"/>
            </div>
        </div>

        {/* Players */}
        {room.players.map((p, i) => {
            const isTurn = room.phase === "PLAY" && room.turn === i;
            const isWinner = room.winnerSeat === i;
            return (
                <div key={i} style={{ position: 'absolute', ...getPos(i, meSeat), width: 220, textAlign: 'center' }}>
                    <div style={{ 
                        background: isWinner ? UI.success : isTurn ? UI.accent : 'rgba(0,0,0,0.6)', 
                        color: (isTurn||isWinner) ? '#000' : '#fff', padding: '4px 10px', borderRadius: 15, display: 'inline-block', fontWeight: 'bold' 
                    }}>
                        {p.name || <button onClick={()=>handleSit(i)}>Sit</button>} (${p.chips})
                        {p.roundFinished && room.phase === "ROUND_END" && " ✅"}
                    </div>
                    {/* Melds */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 5 }}>
                        {p.melds?.map((m, mi) => (
                            <div key={mi} 
                                 onDragOver={e=>e.preventDefault()} 
                                 onDrop={()=>handleAddToMeld(i, mi)}
                                 style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: 3, borderRadius: 4 }}>
                                {m.cards.map(cid => <div key={cid} style={{...UI.card.base, ...UI.card.sm}}><CardFace card={room.deck[cid]} size="sm"/></div>)}
                            </div>
                        ))}
                    </div>
                </div>
            )
        })}

        {/* SCORING SUMMARY OVERLAY */}
        {room.phase === "SCORING" && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: UI.panel, padding: 30, borderRadius: 12, width: 400, color: 'white' }}>
                    <h2 style={{ textAlign: 'center', color: UI.accent }}>Round Complete!</h2>
                    <h3 style={{ textAlign: 'center' }}>Winner: {room.players[room.winnerSeat].name}</h3>
                    <hr style={{ borderColor: '#334155', margin: '15px 0' }} />
                    <div style={{ marginBottom: 20 }}>
                        {room.transfers?.map((t, k) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #334155' }}>
                                <span>🟥 {t.from}</span>
                                <span style={{color: UI.danger}}>➡ {t.amount} chips ➡</span>
                                <span style={{color: UI.success}}>{t.to} 🟩</span>
                            </div>
                        ))}
                        {(!room.transfers || room.transfers.length === 0) && <div style={{textAlign:'center', opacity:0.5}}>No transfers (Perfect Game?)</div>}
                    </div>
                    <button onClick={handleDeal} style={{ width: '100%', padding: 12, background: UI.success, border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>
                        Start Next Round
                    </button>
                </div>
            </div>
        )}
      </div>

      {/* PLAYER TRAY */}
      {myP && (
        <div style={{ background: UI.panel, padding: 15, borderTop: '4px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, color: 'white' }}>
                <div>
                    Weight: <b>{myWeight}</b> {jokerRevealed ? "🔓" : "🔒"} 
                    {room.phase === "ROUND_END" && <span style={{color: UI.accent, marginLeft: 10}}> ROUND ENDING - FIX HAND</span>}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: sortHandIds(room.deck, myP.hand) })} style={btnStyle('#64748b')}>Sort</button>
                    {stage.length >= 3 && <button onClick={handleMeld} style={btnStyle('#3b82f6')}>Meld ({stage.length})</button>}
                    
                    {room.phase === "PLAY" && (
                        <button onClick={handleDiscard} disabled={!myP.hasPicked} style={btnStyle(UI.danger)}>Discard</button>
                    )}
                    
                    {room.phase === "ROUND_END" && !myP.roundFinished && (
                        <button onClick={handleConfirmHand} style={btnStyle(UI.success)}>Confirm Hand & Finish</button>
                    )}
                    {room.phase === "ROUND_END" && myP.roundFinished && (
                        <span style={{color: '#94a3b8', padding: '5px'}}>Waiting for others...</span>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 10 }}>
                {myP.hand?.map((id, idx) => {
                    const isSel = stage.includes(id);
                    const isWild = isCardWild(room.deck[id], jokerCard, myWeight);
                    return (
                        <div key={id} 
                            draggable={room.phase !== "SCORING"}
                            onDragStart={() => setDragIdx(idx)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => {
                                const newH = [...myP.hand];
                                const item = newH.splice(dragIdx, 1)[0];
                                newH.splice(idx, 0, item);
                                update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newH });
                            }}
                            onClick={() => setStage(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id])}
                            style={{
                                ...UI.card.base, ...UI.card.lg,
                                border: isWild ? '3px solid gold' : isSel ? '3px solid #3b82f6' : '1px solid #94a3b8',
                                transform: isSel ? 'translateY(-20px)' : 'none'
                            }}>
                            <CardFace card={room.deck[id]} size="lg"/>
                            {isWild && <div style={{position:'absolute', top:0, right:0}}>⭐</div>}
                        </div>
                    )
                })}
            </div>
        </div>
      )}
    </div>
  );
}

function CardFace({ card, size }) {
  if (!card) return null;
  const isRed = ["♥", "♦"].includes(card.suit);
  return (
    <div style={{ color: isRed ? "#dc2626" : "#0f172a", textAlign: "center", lineHeight: 1 }}>
        <div style={{ fontSize: size==="sm"?10:14, fontWeight:'bold' }}>{card.rank}</div>
        <div style={{ fontSize: size==="sm"?12:20 }}>{card.suit}</div>
    </div>
  );
}

function btnStyle(bg) {
    return { background: bg, border: 'none', padding: '6px 14px', color: 'white', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold' };
}

function getPos(i, me) {
    const p = [
        { bottom: 20, left: '50%', transform: 'translateX(-50%)' },
        { right: 20, top: '60%' }, { right: 20, top: '20%' },
        { left: 20, top: '20%' }, { left: 20, top: '60%' }
    ];
    return p[me === null ? i : (i - me + 5) % 5];
}