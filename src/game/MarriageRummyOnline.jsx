// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, get, child, set } from "firebase/database";

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
// 2. Constants & Styles
// ------------------------------
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const getRankIdx = (r) => RANKS.indexOf(r);
const getSuitIdx = (s) => SUITS.indexOf(s);

const UI = {
  felt: "#135f39",
  feltDark: "#0e4c2e",
  gold: "#f59e0b",
  text: "#ecfdf5",
  cardW: 50,
  cardH: 70,
};

// ------------------------------
// 3. Logic Helpers
// ------------------------------

// Sorts an array of Card IDs by looking them up in the master deck
function sortHandIds(deck, handIds) {
  if (!deck || !handIds) return [];
  return [...handIds].sort((aId, bId) => {
    const cA = deck[aId];
    const cB = deck[bId];
    if (!cA || !cB) return 0;
    
    // Sort by Suit first, then Rank
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

// Checks if a card is wild, BUT ONLY if the player has unlocked the joker (weight >= 3)
function isCardWild(card, jokerCard, playerWeight) {
  if (!jokerCard || !card) return false;
  
  // RULE: Wilds are inactive/invisible if weight < 3
  if (playerWeight < 3) return false;

  const ws = getWildSuite(jokerCard);
  if (card.rank === ws.rankWild) return true;
  if (card.suit === ws.suit) {
    if (card.rank === ws.papluLow) return true;
    if (card.rank === ws.papluHigh) return true;
    if (card.rank === ws.aceWild) return true;
  }
  return false;
}

// ------------------------------
// 4. Main Component
// ------------------------------
export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null);
  const [room, setRoom] = useState(null);
  
  // Selection / UI State
  const [stage, setStage] = useState([]); // Array of Card IDs
  const [dragItem, setDragItem] = useState(null);

  const ROOM_ID = "global";

  // --- Sync Room ---
  useEffect(() => {
    const roomRef = ref(db, `rooms/${ROOM_ID}`);
    const unsub = onValue(roomRef, (snap) => {
      const val = snap.val();
      if (val) setRoom(val);
      else createRoom();
    });
    return () => unsub();
  }, []);

  const createRoom = async () => {
    const players = Array.from({length: 5}, (_, i) => ({
      seat: i, name: "", chips: 250, hand: [], melds: [], 
      hasPicked: false
    }));
    await set(ref(db, `rooms/${ROOM_ID}`), {
      players, deck: {}, discard: [], stock: [], jokerCardId: null,
      turn: 0, phase: "LOBBY", logs: ["Waiting for players..."]
    });
  };

  // --- Derived State ---
  const myP = room?.players?.[meSeat];
  const isMyTurn = room?.phase === "PLAY" && room?.turn === meSeat;
  const myWeight = useMemo(() => calculateMeldWeight(myP?.melds || []), [myP?.melds]);
  
  // RULE: Joker is only visible if weight >= 3
  const jokerRevealed = myWeight >= 3;
  
  const jokerCard = room?.deck?.[room?.jokerCardId];

  // --- Actions ---

  const handleSit = async (seat) => {
    if (!meName) return alert("Enter name first");
    localStorage.setItem("mr_name", meName);
    setMeSeat(seat);
    await update(ref(db, `rooms/${ROOM_ID}/players/${seat}`), { name: meName });
  };

  const handleStartGame = async () => {
    const deckArr = [];
    // Generate 3 decks
    for(let d=0; d<3; d++) {
      for(let s of SUITS) {
        for(let r of RANKS) {
          deckArr.push({ id:`${d}${s}${r}${Math.random().toString(36).slice(2)}`, suit:s, rank:r });
        }
      }
    }
    // Shuffle
    for (let i = deckArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckArr[i], deckArr[j]] = [deckArr[j], deckArr[i]];
    }

    const deckMap = {};
    deckArr.forEach(c => deckMap[c.id] = c);

    const activeSeats = room.players.filter(p => p.name).map(p => p.seat);
    if(activeSeats.length < 2) return alert("Need 2+ players");

    const updates = {};
    updates[`rooms/${ROOM_ID}/deck`] = deckMap;
    
    // Distribute
    let ptr = 0;
    activeSeats.forEach(seat => {
        const handIds = deckArr.slice(ptr, ptr+21).map(c=>c.id);
        updates[`rooms/${ROOM_ID}/players/${seat}/hand`] = handIds;
        updates[`rooms/${ROOM_ID}/players/${seat}/melds`] = [];
        updates[`rooms/${ROOM_ID}/players/${seat}/hasPicked`] = false;
        ptr += 21;
    });

    const jokerId = deckArr[ptr].id; 
    ptr++;
    const firstDiscardId = deckArr[ptr].id; 
    ptr++;
    const stockIds = deckArr.slice(ptr).map(c=>c.id);

    updates[`rooms/${ROOM_ID}/jokerCardId`] = jokerId;
    updates[`rooms/${ROOM_ID}/discard`] = [firstDiscardId];
    updates[`rooms/${ROOM_ID}/stock`] = stockIds;
    updates[`rooms/${ROOM_ID}/phase`] = "PLAY";
    updates[`rooms/${ROOM_ID}/turn`] = activeSeats[0];
    updates[`rooms/${ROOM_ID}/logs`] = ["Game Started"];

    await update(ref(db), updates);
  };

  // --- FIXED SORT HAND ---
  const handleSortHand = async () => {
    if (!myP || !myP.hand || !room.deck) return;

    // 1. Sort locally using the deck map
    const sortedIds = sortHandIds(room.deck, myP.hand);

    // 2. Push result to Firebase
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), {
        hand: sortedIds
    });
  };

  const handlePickup = async (source) => {
    if (!isMyTurn || myP.hasPicked) return;
    
    let cardId;
    let updates = {};
    
    if (source === "STOCK") {
      if(room.stock.length === 0) return;
      cardId = room.stock[0];
      updates[`stock`] = room.stock.slice(1);
    } else {
      if(room.discard.length === 0) return;
      cardId = room.discard[room.discard.length - 1];
      updates[`discard`] = room.discard.slice(0, -1);
    }

    const newHand = [...(myP.hand || []), cardId];
    updates[`players/${meSeat}/hand`] = newHand;
    updates[`players/${meSeat}/hasPicked`] = true;
    updates[`logs`] = [...(room.logs||[]).slice(-4), `${myP.name} picked`];

    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handleDiscard = async () => {
    if (!isMyTurn || !myP.hasPicked || stage.length !== 1) return alert("Select 1 card to discard");
    const cardId = stage[0];
    
    const newHand = myP.hand.filter(id => id !== cardId);
    const newDiscard = [...(room.discard||[]), cardId];
    
    // Pass turn
    let nextSeat = (meSeat + 1) % 5;
    while (!room.players[nextSeat].name) nextSeat = (nextSeat + 1) % 5;

    const updates = {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${meSeat}/hasPicked`]: false,
      [`discard`]: newDiscard,
      [`turn`]: nextSeat,
      [`logs`]: [...(room.logs||[]).slice(-4), `${myP.name} discarded`]
    };
    
    setStage([]);
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  // --- Drag & Drop ---
  const onDragStart = (e, index) => {
    setDragItem(index);
  };
  
  const onDragEnter = (e, index) => {
    e.preventDefault();
  };

  const onDrop = async (e, dropIndex) => {
    if (dragItem === null) return;
    const newHand = [...myP.hand];
    const item = newHand.splice(dragItem, 1)[0];
    newHand.splice(dropIndex, 0, item);
    
    setDragItem(null);
    // Optimistic update locally? Better to just push to DB
    await update(ref(db, `rooms/${ROOM_ID}/players/${meSeat}`), { hand: newHand });
  };


  if (!room) return <div style={{padding:20, color:'#fff'}}>Loading...</div>;

  return (
    <div style={{ minHeight: "100vh", background: UI.feltDark, color: UI.text, fontFamily: 'sans-serif', overflowX:'hidden' }}>
      
      {/* HEADER */}
      <div style={{padding: 15, background: 'rgba(0,0,0,0.3)', display:'flex', justifyContent:'space-between'}}>
         <div>
            <h2 style={{margin:0}}>Blind Justice</h2>
            <small>Room: {ROOM_ID}</small>
         </div>
         <div style={{display:'flex', gap: 10}}>
             {room.phase === "LOBBY" && <button onClick={handleStartGame} style={btnStyle}>Deal Game</button>}
             {!meName && (
               <div style={{display:'flex', gap:5}}>
                 <input style={{borderRadius:4, border:'none', padding:5}} placeholder="Name" value={meName} onChange={e=>setMeName(e.target.value)} />
               </div>
             )}
         </div>
      </div>

      {/* TABLE */}
      <div style={{position:'relative', width: '100%', maxWidth: 1000, height: 450, margin: '20px auto', background: UI.felt, borderRadius: 100, border: '12px solid #5d4037', boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5)'}}>
         
         {/* Center Area */}
         <div style={{position:'absolute', top:'50%', left:'50%', transform:'translate(-50%, -50%)', display:'flex', gap: 15}}>
             
             {/* STOCK */}
             <div onClick={()=>handlePickup('STOCK')} style={{...cardBaseStyle, background:'#1e293b', cursor: isMyTurn && !myP?.hasPicked ? 'pointer':'default'}}>
                <div style={{fontSize:10, color:'#94a3b8'}}>Stock</div>
             </div>

             {/* JOKER - HIDDEN LOGIC */}
             <div style={{...cardBaseStyle, border: '2px solid gold', background: jokerRevealed ? '#fff' : '#334155'}}>
                 {jokerRevealed && jokerCard ? (
                     <CardFace card={jokerCard} />
                 ) : (
                     <div style={{textAlign:'center', fontSize: 10, color:'#fff'}}>
                        <div>🔒</div>
                        <div>Joker</div>
                        {myWeight < 3 && <div style={{fontSize:9, opacity:0.7}}>(Req: 3)</div>}
                     </div>
                 )}
             </div>

             {/* DISCARD */}
             <div onClick={()=>handlePickup('DISCARD')} style={{...cardBaseStyle, cursor: isMyTurn && !myP?.hasPicked ? 'pointer':'default'}}>
                {room.discard?.length > 0 ? (
                    <CardFace card={room.deck[room.discard[room.discard.length-1]]} />
                ) : (
                    <div style={{fontSize:10, color:'#ccc'}}>Empty</div>
                )}
             </div>
         </div>

         {/* SEATS */}
         {room.players.map((p, i) => {
             const pos = getSeatPos(i, meSeat);
             const isActive = room.turn === i;
             return (
                 <div key={i} style={{position:'absolute', ...pos, width: 140, padding: 8, background: isActive ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.4)', borderRadius: 8, border: isActive ? '1px solid gold' : '1px solid transparent', textAlign:'center'}}>
                    {p.name ? (
                        <>
                          <div style={{fontWeight:'bold', fontSize:14}}>{p.name}</div>
                          <div style={{fontSize:11}}>Cards: {p.hand?.length||0}</div>
                          <div style={{fontSize:11}}>Melds: {p.melds?.length||0}</div>
                        </>
                    ) : (
                        <button onClick={()=>handleSit(i)} disabled={meSeat!==null} style={{fontSize:10}}>Sit</button>
                    )}
                 </div>
             )
         })}
      </div>

      {/* PLAYER TRAY */}
      {meSeat !== null && myP && (
          <div style={{position:'fixed', bottom:0, left:0, right:0, background:'#1e293b', padding: 15, borderTop:'1px solid #334155'}}>
             <div style={{maxWidth: 1000, margin: '0 auto'}}>
                
                {/* Controls */}
                <div style={{display:'flex', justifyContent:'space-between', marginBottom: 10}}>
                   <div style={{display:'flex', alignItems:'center', gap: 10}}>
                      <span style={{fontWeight:'bold'}}>{myP.name}</span>
                      <span style={{fontSize: 12, background: jokerRevealed ? '#22c55e' : '#ef4444', padding:'2px 6px', borderRadius:4}}>
                        Weight: {myWeight} {jokerRevealed ? "(Joker Unlocked)" : "(Blind)"}
                      </span>
                   </div>
                   <div style={{display:'flex', gap: 8}}>
                      <button onClick={handleSortHand} style={{...btnStyle, background:'#eab308', color:'#000'}}>Sort Hand</button>
                      {isMyTurn && myP.hasPicked && <button onClick={handleDiscard} style={{...btnStyle, background:'#ef4444'}}>Discard</button>}
                   </div>
                </div>

                {/* Hand */}
                <div style={{display:'flex', flexWrap:'wrap', gap: 6, minHeight: 80}}>
                    {myP.hand?.map((cardId, idx) => {
                        const card = room.deck[cardId];
                        const isSelected = stage.includes(cardId);
                        const isWild = jokerRevealed && isCardWild(card, jokerCard, myWeight);
                        
                        return (
                            <div 
                              key={cardId}
                              draggable
                              onDragStart={(e) => onDragStart(e, idx)}
                              onDragEnter={(e) => onDragEnter(e, idx)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => onDrop(e, idx)}
                              onClick={() => {
                                  if(isSelected) setStage(stage.filter(id=>id!==cardId));
                                  else setStage([...stage, cardId]);
                              }}
                              style={{
                                  ...cardBaseStyle,
                                  border: isSelected ? '3px solid #3b82f6' : isWild ? '2px solid gold' : '1px solid #94a3b8',
                                  transform: isSelected ? 'translateY(-10px)' : 'none',
                                  cursor: 'grab'
                              }}
                            >
                                <CardFace card={card} />
                                {isWild && <div style={{position:'absolute', top: -5, right: -5, fontSize:10}}>⭐</div>}
                            </div>
                        )
                    })}
                </div>
             </div>
          </div>
      )}

      {/* Logs */}
      <div style={{position:'absolute', bottom: 150, left: 20, width: 200, maxHeight: 100, overflowY:'auto', fontSize: 10, opacity: 0.6}}>
         {room.logs?.slice().reverse().map((l,i) => <div key={i}>{l}</div>)}
      </div>

    </div>
  );
}

// ------------------------------
// Sub-Components & Styles
// ------------------------------

function CardFace({ card }) {
    if (!card) return null;
    const isRed = card.suit === '♥' || card.suit === '♦';
    return (
        <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', color: isRed ? '#ef4444' : '#000'}}>
            <div style={{fontWeight:'bold', fontSize:14}}>{card.rank}</div>
            <div style={{fontSize:18, lineHeight:1}}>{card.suit}</div>
        </div>
    );
}

const cardBaseStyle = {
    width: 44, height: 64, 
    background: '#fff', 
    borderRadius: 5, 
    display: 'flex', alignItems: 'center', justifyContent: 'center', 
    position: 'relative',
    userSelect: 'none'
};

const btnStyle = {
    padding: "6px 12px", background: "#3b82f6", color: "white", 
    border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold"
};

function getSeatPos(i, meSeat) {
    // Rotates seats so "me" is always at bottom (index 0 relative visual)
    const positions = [
        { bottom: 10, left: '50%', transform: 'translateX(-50%)' }, // Me
        { top: '40%', right: 10 },
        { top: 10, right: '25%' },
        { top: 10, left: '25%' },
        { top: '40%', left: 10 },
    ];
    if (meSeat === null) return positions[i];
    const offset = i - meSeat;
    const idx = (offset + 5) % 5;
    return positions[idx];
}