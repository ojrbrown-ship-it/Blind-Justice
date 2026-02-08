// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, update, onValue, get, child } from "firebase/database";

// ------------------------------
// Firebase Config & Init
// ------------------------------
const env = import.meta.env || {};
const FIREBASE_CONFIG = {
  apiKey:            env.VITE_FIREBASE_API_KEY        || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.apiKey : undefined),
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN     || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.authDomain : undefined),
  databaseURL:       env.VITE_FIREBASE_DATABASE_URL    || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.databaseURL : undefined),
  projectId:         env.VITE_FIREBASE_PROJECT_ID      || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.projectId : undefined),
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET  || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.storageBucket : undefined),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.messagingSenderId : undefined),
  appId:             env.VITE_FIREBASE_APP_ID          || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.appId : undefined),
};

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ------------------------------
// Assets & Constants
// ------------------------------
const SUITS = ["♠", "♣", "♥", "♦"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const getRankIdx = (r) => RANKS.indexOf(r);
const getSuitIdx = (s) => SUITS.indexOf(s);

// UI Constants
const UI = {
  felt: "#0f3d2e",
  feltDark: "#062218",
  gold: "#f59e0b",
  cardW: 56,
  cardH: 78,
};

// ------------------------------
// Logic: Wilds & Rules
// ------------------------------

// 1. Identify the "Wild Suite" based on the Main Joker
const getWildSuite = (jokerCard) => {
  if (!jokerCard) return null;
  const idx = getRankIdx(jokerCard.rank);
  // Paplu = Same suit, Rank +/- 1 (Ace wraps to K and 2)
  const lowRank  = RANKS[(idx - 1 + 13) % 13];
  const highRank = RANKS[(idx + 1) % 13];
  
  return {
    rankWild: jokerCard.rank,          // e.g. 7
    papluLow: lowRank,                 // e.g. 6
    papluHigh: highRank,               // e.g. 8
    aceWild: "A",                      // Ace of Joker Suit is always wild
    suit: jokerCard.suit
  };
};

// 2. Check if a specific card is Wild
// NOTE: Wilds only "activate" if the player has reached Weight 3 (Revealed)
const isCardWild = (card, jokerCard, playerWeight) => {
  if (!jokerCard || !card) return false;
  
  // Rule: Before Weight 3 (Blind), Wild cards act as Naturals only
  if (playerWeight < 3) return false;

  const ws = getWildSuite(jokerCard);
  
  // 1. Rank Wild (Any suit, matching Rank)
  if (card.rank === ws.rankWild) return true;

  // 2. Suit Specific Wilds (Joker Suit only)
  if (card.suit === ws.suit) {
    if (card.rank === ws.papluLow) return true;
    if (card.rank === ws.papluHigh) return true;
    if (card.rank === ws.aceWild) return true;
  }
  return false;
};

// 3. Calculate Meld Weight (Rules: 3-5 cards = +1, 6-8 = +2, 9+ = +3)
const calculateMeldWeight = (melds) => {
  if (!Array.isArray(melds)) return 0;
  return melds.reduce((acc, m) => {
    const len = m.cards.length;
    if (len >= 9) return acc + 3;
    if (len >= 6) return acc + 2;
    if (len >= 3) return acc + 1;
    return acc;
  }, 0);
};

// 4. Validate Melds (The Brain)
const validateMeld = (cards, jokerCard, playerWeight, isSettlePhase = false) => {
  // RULE: Settle Phase for Locked Players requires MIN 4 cards for Runs
  const isBlind = playerWeight < 3;
  const minLen = (isSettlePhase && isBlind) ? 4 : 3;

  if (cards.length < minLen) return { valid: false, error: `Min ${minLen} cards.` };

  // Separate Wilds vs Naturals
  const wildCards = cards.filter(c => isCardWild(c, jokerCard, playerWeight));
  const naturals = cards.filter(c => !isCardWild(c, jokerCard, playerWeight));

  // If all wild (rare but valid in Revealed), it's a valid run/set
  if (naturals.length === 0) return { valid: true, type: "WILD_MELD" };

  // Check Set (Same Rank)
  const firstRank = naturals[0].rank;
  const isRankSet = naturals.every(c => c.rank === firstRank);

  if (isRankSet) {
    if (isBlind) {
      // BLIND RULE: Sets must be IDENTICAL (Rank + Suit)
      const firstSuit = naturals[0].suit;
      const isIdentical = naturals.every(c => c.suit === firstSuit);
      if (!isIdentical) return { valid: false, error: "Blind: Sets must be Identical." };
      return { valid: true, type: "IDENTICAL_SET" };
    } else {
      // REVEALED RULE: Rainbow Sets allowed (No duplicate suits)
      const suits = new Set(naturals.map(c => c.suit));
      if (suits.size !== naturals.length) return { valid: false, error: "Rainbow Set: No duplicate suits." };
      return { valid: true, type: "SET" };
    }
  }

  // Check Run (Same Suit, Sequence)
  const firstSuit = naturals[0].suit;
  const isSuitRun = naturals.every(c => c.suit === firstSuit);

  if (isSuitRun) {
    // Sort indices
    const indices = naturals.map(c => getRankIdx(c.rank)).sort((a,b) => a-b);
    
    // Check for duplicates
    if (new Set(indices).size !== indices.length) return { valid: false, error: "Run: Duplicates found." };

    // Check gaps logic
    // We allow Ace High (Q-K-A) or Ace Low (A-2-3)
    // Simple gap check: (Max - Min + 1) <= Total Cards (including Wilds)
    const span = (indices[indices.length - 1] - indices[0]) + 1;
    
    // Standard check
    if (span <= cards.length) return { valid: true, type: "RUN" };

    // Ace Wrap check (if Ace is present at index 0)
    if (indices[0] === 0) {
      const highIndices = indices.map(i => i === 0 ? 13 : i).sort((a,b)=>a-b);
      const highSpan = (highIndices[highIndices.length-1] - highIndices[0]) + 1;
      if (highSpan <= cards.length) return { valid: true, type: "RUN" };
    }

    return { valid: false, error: "Run: Gaps too big for Wilds." };
  }

  return { valid: false, error: "Invalid Combination." };
};

// ------------------------------
// Helper: Deck Generation
// ------------------------------
function generateDeck(numDecks = 3) {
  let deck = [];
  for (let d = 0; d < numDecks; d++) {
    for (let s of SUITS) {
      for (let r of RANKS) {
        deck.push({ id: `${d}_${s}_${r}_${Math.random().toString(36).substr(2,5)}`, suit: s, rank: r });
      }
    }
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ------------------------------
// MAIN COMPONENT
// ------------------------------
export default function MarriageRummyOnline() {
  // Local State
  const [meName, setMeName] = useState(localStorage.getItem("mr_name") || "");
  const [meSeat, setMeSeat] = useState(null); // 0-4
  const [room, setRoom] = useState(null);
  const [stage, setStage] = useState([]); // Card IDs in staging
  const [buildMode, setBuildMode] = useState(false); // For adding to melds
  const [showScoreModal, setShowScoreModal] = useState(false);
  
  const ROOM_ID = "global";

  // Connect to Firebase
  useEffect(() => {
    const roomRef = ref(db, `rooms/${ROOM_ID}`);
    const unsub = onValue(roomRef, (snap) => {
      const val = snap.val();
      if (val) setRoom(val);
      else createRoom();
    });
    return () => unsub();
  }, []);

  // Sync Score Modal
  useEffect(() => {
    if (room?.phase === "FINISHED") setShowScoreModal(true);
    else setShowScoreModal(false);
  }, [room?.phase]);

  // Create Room if missing
  const createRoom = async () => {
    const players = Array.from({length: 5}, (_, i) => ({
      seat: i, name: "", chips: 250, hand: [], melds: [], 
      hasPicked: false, hasRevealed: false
    }));
    await set(ref(db, `rooms/${ROOM_ID}`), {
      players,
      deck: [],
      discard: [],
      stock: [],
      jokerCard: null,
      turn: 0,
      phase: "LOBBY", // LOBBY, PLAY, SETTLE, FINISHED
      settleIndex: null, // Who is settling
      winnerIndex: null,
      logs: []
    });
  };

  // ------------------------------
  // Derived State
  // ------------------------------
  const myP = room?.players?.[meSeat];
  const isMyTurn = room?.phase === "PLAY" && room?.turn === meSeat;
  const isMySettle = room?.phase === "SETTLE" && room?.settleIndex === meSeat;
  const jokerCard = room?.jokerCard;
  const myWeight = useMemo(() => calculateMeldWeight(myP?.melds || []), [myP?.melds]);
  const hasRevealed = myWeight >= 3;

  // ------------------------------
  // Actions
  // ------------------------------

  const sit = async (seat) => {
    if (!meName) return alert("Enter name first");
    localStorage.setItem("mr_name", meName);
    setMeSeat(seat);
    await update(ref(db, `rooms/${ROOM_ID}/players/${seat}`), { name: meName });
  };

  const dealGame = async () => {
    // 1. Setup Deck
    const rawDeck = generateDeck(3);
    const shuffled = shuffle(rawDeck);
    
    // 2. Identify Active Players
    const activeSeats = room.players.filter(p => p.name).map(p => p.seat);
    if (activeSeats.length < 2) return alert("Need 2+ players");

    // 3. Deal 21 Cards
    const hands = {};
    activeSeats.forEach(seat => {
      hands[seat] = shuffled.splice(0, 21);
    });

    // 4. Joker & Piles
    const joker = shuffled.shift();
    const discard = [shuffled.shift()];
    
    // 5. Update DB
    const updates = {
      phase: "PLAY",
      deck: shuffled,
      discard: discard,
      jokerCard: joker,
      turn: activeSeats[0],
      logs: [`New Game Dealt. Joker is ${joker.rank}${joker.suit}`]
    };

    // Reset players
    room.players.forEach(p => {
      updates[`players/${p.seat}/hand`] = hands[p.seat] || [];
      updates[`players/${p.seat}/melds`] = [];
      updates[`players/${p.seat}/hasPicked`] = false;
      updates[`players/${p.seat}/hasRevealed`] = false;
    });

    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handlePickup = async (source) => {
    if (!isMyTurn || myP.hasPicked) return;
    
    let card;
    let updates = {};

    if (source === "STOCK") {
      card = room.deck[0];
      updates["deck"] = room.deck.slice(1);
    } else {
      card = room.discard[room.discard.length - 1];
      updates["discard"] = room.discard.slice(0, -1);
    }

    const newHand = [...(myP.hand || []), card];
    updates[`players/${meSeat}/hand`] = newHand;
    updates[`players/${meSeat}/hasPicked`] = true;
    updates[`logs`] = [...(room.logs || []).slice(-4), `${myP.name} picked from ${source}`];

    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handleMeld = async () => {
    if (!stage.length) return;
    
    // Validation
    const cards = stage.map(s => s.card);
    // Settle Phase Check: If settling and NOT revealed, run must be 4 cards
    const isSettle = room.phase === "SETTLE";
    const res = validateMeld(cards, jokerCard, myWeight, isSettle);

    if (!res.valid) return alert(res.error);

    // Update
    const newMeld = { type: res.type, cards: cards };
    const newHand = myP.hand.filter(c => !stage.some(s => s.id === c.id));
    const newMelds = [...(myP.melds || []), newMeld];

    // Calc weight update
    const newWeight = calculateMeldWeight(newMelds);
    
    const updates = {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${meSeat}/melds`]: newMelds,
      [`players/${meSeat}/hasRevealed`]: newWeight >= 3
    };

    setStage([]);
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handleBuild = async (meldIdx) => {
    if (!stage.length) return;
    
    // Build Rule: In Settle Phase, can only build if Revealed (Weight >= 3)
    if (room.phase === "SETTLE" && myWeight < 3) return alert("Must unlock Joker (Weight 3) to build.");

    const targetMeld = myP.melds[meldIdx];
    const newCards = [...targetMeld.cards, ...stage.map(s => s.card)];
    
    const res = validateMeld(newCards, jokerCard, myWeight, room.phase === "SETTLE");
    if (!res.valid) return alert(`Build Invalid: ${res.error}`);

    const newHand = myP.hand.filter(c => !stage.some(s => s.id === c.id));
    const updatedMelds = [...myP.melds];
    updatedMelds[meldIdx] = { ...targetMeld, cards: newCards, type: res.type };

    const updates = {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${meSeat}/melds`]: updatedMelds
    };

    setStage([]);
    setBuildMode(false);
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handleTennala = async () => {
    if (myP.hasPicked) return alert("Only before pickup!");
    if (stage.length !== 3) return alert("Select 3 cards");
    
    // Tennala = 3 Identical Cards
    const c1 = stage[0].card;
    const isIdentical = stage.every(s => s.card.rank === c1.rank && s.card.suit === c1.suit);
    if (!isIdentical) return alert("Must be 3 Identical Cards");

    // Chips Transfer logic could go here (simple version just logs it)
    const newMeld = { type: "TENNALA", cards: stage.map(s => s.card) };
    const newHand = myP.hand.filter(c => !stage.some(s => s.id === c.id));
    
    // Award Chips (+10 from everyone logic would be here)
    // For now, just lay it down
    const updates = {
      [`players/${meSeat}/hand`]: newHand,
      [`players/${meSeat}/melds`]: [...(myP.melds || []), newMeld],
      [`logs`]: [...(room.logs||[]), `${myP.name} declared Tennala!`]
    };
    
    setStage([]);
    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  const handleDiscard = async () => {
    if (!isMyTurn || !myP.hasPicked || stage.length !== 1) return alert("Select 1 card to discard");

    const card = stage[0].card;
    const newHand = myP.hand.filter(c => c.id !== card.id);
    const newDiscard = [...room.discard, card];

    // Win Condition: Hand empty after discard
    if (newHand.length === 0) {
      // WINNER! Trigger Settlement
      const nextSeat = getNextActiveSeat(meSeat);
      await update(ref(db, `rooms/${ROOM_ID}`), {
        phase: "SETTLE",
        winnerIndex: meSeat,
        settleIndex: nextSeat, // Next person gets to settle
        [`players/${meSeat}/hand`]: newHand,
        discard: newDiscard,
        logs: [...(room.logs||[]), `${myP.name} WINS! Settle Phase Started.`]
      });
    } else {
      // Next Turn
      const nextSeat = getNextActiveSeat(meSeat);
      await update(ref(db, `rooms/${ROOM_ID}`), {
        turn: nextSeat,
        [`players/${meSeat}/hand`]: newHand,
        [`players/${meSeat}/hasPicked`]: false,
        discard: newDiscard
      });
    }
    setStage([]);
  };

  const handleSettleDone = async () => {
    if (!isMySettle) return;
    
    // Move to next settler
    let nextSeat = getNextActiveSeat(meSeat);
    
    // If next is Winner, everyone is done -> Calc Scores
    if (nextSeat === room.winnerIndex) {
      finalizeScores();
    } else {
      await update(ref(db, `rooms/${ROOM_ID}`), { settleIndex: nextSeat });
    }
  };

  const finalizeScores = async () => {
    const players = room.players;
    const winner = room.winnerIndex;
    const ws = getWildSuite(room.jokerCard);

    let transfers = Array(5).fill(0); // Net chip change
    let logs = [];

    // 1. Asset Calculation (Everyone pays Everyone)
    players.forEach(p => {
      if (!p.name) return;
      const allCards = [...(p.hand||[]), ...(p.melds||[]).flatMap(m=>m.cards)];
      
      const hasLow = allCards.some(c => c.rank === ws.papluLow && c.suit === ws.suit);
      const hasRank = allCards.some(c => c.rank === ws.rankWild && c.suit === ws.suit);
      const hasHigh = allCards.some(c => c.rank === ws.papluHigh && c.suit === ws.suit);
      const hasAce = allCards.some(c => c.rank === ws.aceWild && c.suit === ws.suit);

      let gainPerOpp = 0;
      if (hasLow && hasRank && hasHigh) {
        gainPerOpp += 25; // Marriage
        logs.push(`${p.name}: Marriage (+25)`);
      } else {
        if (hasLow) { gainPerOpp += 5; logs.push(`${p.name}: Low Paplu (+5)`); }
        if (hasRank) { gainPerOpp += 5; logs.push(`${p.name}: Rank Wild (+5)`); }
        if (hasHigh) { gainPerOpp += 5; logs.push(`${p.name}: High Paplu (+5)`); }
      }
      if (ws.rankWild !== "A" && hasAce) {
         gainPerOpp += 5; 
         logs.push(`${p.name}: Ace Wild (+5)`);
      }

      if (gainPerOpp > 0) {
        const activeCount = players.filter(pl=>pl.name).length;
        const totalGain = gainPerOpp * (activeCount - 1);
        transfers[p.seat] += totalGain;
        players.forEach(opp => {
          if (opp.seat !== p.seat && opp.name) transfers[opp.seat] -= gainPerOpp;
        });
      }
    });

    // 2. Penalty Calculation (Losers pay Winner)
    let totalPot = 0;
    players.forEach(p => {
      if (!p.name || p.seat === winner) return;
      
      // Calculate Deadwood
      const deadwood = p.hand || [];
      // Value: Sum of naturals (Wilds = 0)
      const value = deadwood.reduce((acc, c) => {
        if (isCardWild(c, room.jokerCard, 3)) return acc; // Assuming full reveal for penalty calc
        const v = ["10","J","Q","K","A"].includes(c.rank) ? 10 : parseInt(c.rank);
        return acc + v;
      }, 0);

      // Rule: (Val / 10) rounded * 2. Cap at 25 chips.
      let chips = Math.round(value / 10) * 2;
      if (value >= 96) chips = 25;

      transfers[p.seat] -= chips;
      totalPot += chips;
      logs.push(`${p.name}: Penalty -${chips} (Hand Value: ${value})`);
    });

    transfers[winner] += totalPot;
    logs.push(`${players[winner].name}: Won Pot +${totalPot}`);

    // Update DB
    const updates = {
      phase: "FINISHED",
      logs: logs,
      results: transfers // store for modal
    };
    players.forEach(p => {
        if(p.name) updates[`players/${p.seat}/chips`] = (p.chips || 0) + transfers[p.seat];
    });

    await update(ref(db, `rooms/${ROOM_ID}`), updates);
  };

  // Helpers
  const getNextActiveSeat = (current) => {
    let next = (current + 1) % 5;
    while (!room.players[next].name) {
      next = (next + 1) % 5;
    }
    return next;
  };

  // ------------------------------
  // UI RENDER
  // ------------------------------
  if (!room) return <div style={{color:'#fff'}}>Loading...</div>;

  return (
    <div style={{ minHeight: "100vh", background: UI.feltDark, color: "white", padding: 20, fontFamily: 'sans-serif' }}>
      {/* Header */}
      <div style={{display:'flex', justifyContent:'space-between', marginBottom: 20}}>
         <h2>Blind Justice Online</h2>
         <div>
            {meName ? (
               <span>Playing as <b>{meName}</b> (Seat {meSeat})</span>
            ) : (
                <div style={{display:'flex', gap: 10}}>
                   <input placeholder="Name" value={meName} onChange={e=>setMeName(e.target.value)} style={{padding:5, borderRadius:4}}/>
                </div>
            )}
         </div>
      </div>

      {/* Main Table Area */}
      <div style={{ position: 'relative', height: 400, background: UI.felt, borderRadius: 20, border: '8px solid #3e2723', boxShadow: 'inset 0 0 50px #000' }}>
         
         {/* Center Deck/Piles */}
         <div style={{position:'absolute', top:'50%', left:'50%', transform:'translate(-50%, -50%)', display:'flex', gap: 20}}>
            {/* Stock */}
            <div onClick={()=>handlePickup('STOCK')} style={{width: UI.cardW, height: UI.cardH, background: '#1e293b', border: '2px solid #fff', borderRadius: 6, display:'flex', alignItems:'center', justifyContent:'center', cursor: isMyTurn && !myP.hasPicked ? 'pointer' : 'default'}}>
               Stock
            </div>
            
            {/* Joker */}
            <div style={{width: UI.cardW, height: UI.cardH, background: '#fff', borderRadius: 6, color: '#000', display:'flex', alignItems:'center', justifyContent:'center', transform:'rotate(90deg)'}}>
                {hasRevealed ? `${jokerCard?.rank}${jokerCard?.suit}` : (myP?.melds?.length ? "🔒" : "?")}
            </div>

            {/* Discard */}
            <div onClick={()=>handlePickup('DISCARD')} style={{width: UI.cardW, height: UI.cardH, background: '#fff', borderRadius: 6, color: '#000', display:'flex', alignItems:'center', justifyContent:'center', cursor: isMyTurn && !myP.hasPicked ? 'pointer' : 'default'}}>
                {room.discard?.[room.discard.length-1] ? `${room.discard[room.discard.length-1].rank}${room.discard[room.discard.length-1].suit}` : "Empty"}
            </div>
         </div>

         {/* Seats */}
         {room.players.map((p, i) => {
             const pos = getSeatPos(i, meSeat); // Helper to rotate table visually
             return (
                 <div key={i} style={{position:'absolute', ...pos, width: 150, background: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 8, border: room.turn===i ? '2px solid #fbbf24' : '1px solid #ffffff44'}}>
                    {p.name ? (
                        <>
                           <div style={{fontWeight:'bold'}}>{p.name} {i === room.winnerIndex && "👑"}</div>
                           <div style={{fontSize: 12}}>Chips: {p.chips}</div>
                           <div style={{fontSize: 12}}>Cards: {p.hand?.length || 0}</div>
                           <div style={{display:'flex', flexWrap:'wrap', gap: 2, marginTop: 4}}>
                              {p.melds?.map((m, mi) => (
                                  <div key={mi} style={{background:'#fff', padding:'1px 3px', borderRadius:2, color:'#000', fontSize: 10}}>
                                      {m.type}
                                  </div>
                              ))}
                           </div>
                        </>
                    ) : (
                        <button onClick={()=>sit(i)} disabled={meSeat !== null}>Sit</button>
                    )}
                 </div>
             );
         })}
      </div>

      {/* Logs */}
      <div style={{height: 60, overflowY:'scroll', background:'rgba(0,0,0,0.3)', marginTop: 10, fontSize: 12, padding: 5}}>
          {room.logs?.slice().reverse().map((l, i) => <div key={i}>{l}</div>)}
      </div>

      {/* Player Controls (Bottom) */}
      {meSeat !== null && (
         <div style={{marginTop: 20}}>
            {/* Status Bar */}
            <div style={{display:'flex', justifyContent:'space-between', marginBottom: 10}}>
                <div>
                   Weight: <span style={{color: hasRevealed ? '#4ade80' : '#f87171'}}>{myWeight}</span> 
                   {hasRevealed ? " (Revealed)" : " (Blind)"}
                </div>
                <div>{room.phase === "SETTLE" && "SETTLEMENT PHASE"}</div>
            </div>

            {/* Hand */}
            <div style={{display:'flex', flexWrap:'wrap', gap: 8, background: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 10, minHeight: 100}}>
               {myP?.hand?.map((c, i) => {
                   const isSel = stage.some(s => s.id === c.id);
                   const isWild = hasRevealed && isCardWild(c, jokerCard, myWeight);
                   return (
                       <div key={c.id} 
                            onClick={() => {
                                if(isSel) setStage(prev => prev.filter(s => s.id !== c.id));
                                else setStage(prev => [...prev, {id: c.id, card: c}]);
                            }}
                            style={{
                                width: 40, height: 56, background: '#fff', borderRadius: 4, 
                                color: (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black',
                                display:'flex', alignItems:'center', justifyContent:'center',
                                border: isSel ? '3px solid #60a5fa' : isWild ? '2px solid #fbbf24' : '1px solid #ccc',
                                cursor: 'pointer', position: 'relative'
                            }}>
                           {c.rank}{c.suit}
                           {isWild && <div style={{position:'absolute', top:-4, right:-4}}>⭐</div>}
                       </div>
                   );
               })}
            </div>

            {/* Buttons */}
            <div style={{marginTop: 15, display:'flex', gap: 10}}>
               {(isMyTurn || isMySettle) && (
                 <>
                    <button onClick={handleMeld} style={btnStyle}>Meld Selected</button>
                    <button onClick={() => setBuildMode(!buildMode)} style={btnStyle}>Build {buildMode ? "(ON)" : ""}</button>
                    {!myP.hasPicked && <button onClick={handleTennala} style={{...btnStyle, background:'#d97706'}}>Tennala</button>}
                 </>
               )}
               
               {isMyTurn && myP.hasPicked && (
                   <button onClick={handleDiscard} style={{...btnStyle, background:'#dc2626'}}>Discard & End</button>
               )}

               {isMySettle && (
                   <button onClick={handleSettleDone} style={{...btnStyle, background:'#16a34a'}}>Done Settling</button>
               )}
            </div>

            {/* Melds (Click to Build) */}
            <div style={{marginTop: 15, display:'flex', gap: 15, overflowX:'auto'}}>
                {myP?.melds?.map((m, i) => (
                    <div key={i} onClick={() => buildMode && handleBuild(i)} style={{background:'#1e293b', padding: 5, borderRadius: 5, border: buildMode ? '2px dashed #a855f7' : 'none', cursor: buildMode ? 'pointer' : 'default'}}>
                        <div style={{fontSize:10, color:'#94a3b8', marginBottom:2}}>{m.type}</div>
                        <div style={{display:'flex', gap: 2}}>
                           {m.cards.map((c, ci) => (
                               <div key={ci} style={{background:'#fff', width:20, height:28, fontSize:10, display:'flex', alignItems:'center', justifyContent:'center', color: (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black'}}>
                                   {c.rank}{c.suit}
                               </div>
                           ))}
                        </div>
                    </div>
                ))}
            </div>
         </div>
      )}

      {/* Score Modal */}
      {showScoreModal && (
          <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              <div style={{background:'#1e293b', padding: 30, borderRadius: 10, width: 400}}>
                  <h2 style={{marginTop:0}}>Round Results</h2>
                  {/* Assuming result logs are stored in logs or separately */}
                  <div style={{maxHeight: 300, overflowY:'auto', fontSize: 14, marginBottom: 20}}>
                      {room.logs.filter(l => l.includes("Penalty") || l.includes("Won") || l.includes("Marriage")).map((l, i) => (
                          <div key={i} style={{marginBottom: 4, borderBottom:'1px solid #334155'}}>{l}</div>
                      ))}
                  </div>
                  <button onClick={dealGame} style={{...btnStyle, width:'100%', background:'#16a34a'}}>Start Next Round</button>
              </div>
          </div>
      )}

      {/* Admin Start (if lobby) */}
      {room.phase === "LOBBY" && meSeat === 0 && (
          <button onClick={dealGame} style={{position:'absolute', top: 20, right: 20, padding: "10px 20px", background: '#16a34a', color:'#fff', border:'none', borderRadius: 5, cursor:'pointer'}}>
              Start Game
          </button>
      )}
    </div>
  );
}

// Simple positioning helper
function getSeatPos(seatIdx, meSeat) {
    // If I am seated, rotate so I am at bottom (index 2 in visual grid)
    // Map seats 0-4 to Top, Right, Bottom-Right, Bottom-Left, Left
    // This is a simple absolute positioning map
    const positions = [
        { top: 10, left: '50%', transform: 'translateX(-50%)' }, // Top
        { top: '30%', right: 10 }, // Right
        { bottom: '15%', right: '20%' }, // Bottom Right
        { bottom: '15%', left: '20%' }, // Bottom Left
        { top: '30%', left: 10 }, // Left
    ];
    
    // Rotate logic if needed, for now static
    return positions[seatIdx] || { top: 0, left: 0 };
}

const btnStyle = {
    padding: "8px 16px",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: "bold"
};