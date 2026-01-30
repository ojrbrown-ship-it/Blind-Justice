// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useState } from "react";

// ------------------------------
// Firebase (Realtime Database)
// ------------------------------
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, update, push, onValue } from "firebase/database";

/**
 * Prefer build-time Vite env (import.meta.env) and fall back to a runtime
 * window.__FIREBASE_CONFIG__ (if you keep an HTML bridge) only when needed.
 */
const env = import.meta.env || {};
const FIREBASE_CONFIG = {
  apiKey:            env.VITE_FIREBASE_API_KEY        || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.apiKey : undefined),
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN     || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.authDomain : undefined),
  databaseURL:       env.VITE_FIREBASE_DATABASE_URL    || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.databaseURL : undefined),
  projectId:         env.VITE_FIREBASE_PROJECT_ID      || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.projectId : undefined),
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET  || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.storageBucket : undefined),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.messagingSenderId : undefined),
  appId:             env.VITE_FIREBASE_APP_ID          || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.appId : undefined),
  // optional
  measurementId:     env.VITE_FIREBASE_MEASUREMENT_ID  || (typeof window !== "undefined" ? window.__FIREBASE_CONFIG__?.measurementId : undefined),
};

// One-time guard to help diagnose missing envs quickly in the browser console
if (!FIREBASE_CONFIG.databaseURL || !FIREBASE_CONFIG.projectId) {
  console.error(
    "[Firebase] Missing databaseURL or projectId. " +
      "Check Vercel → Project → Settings → Environment Variables " +
      "for VITE_FIREBASE_DATABASE_URL and VITE_FIREBASE_PROJECT_ID."
  );
}

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ------------------------------
// Helpers, constants & rules
// ------------------------------
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const rankIndex = (r) => RANKS.indexOf(r);

function shuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateDeck(numDecks = 3) {
  const cards = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `${d}-${suit}-${rank}-${Math.random().toString(36).slice(2, 8)}`,
          suit,
          rank,
        });
      }
    }
  }
  return cards;
}

function isUpper(card, hidden) {
  const up = RANKS[(rankIndex(hidden.rank) + 1) % RANKS.length];
  return card.suit === hidden.suit && card.rank === up;
}
function isLower(card, hidden) {
  const low = RANKS[(rankIndex(hidden.rank) - 1 + RANKS.length) % RANKS.length];
  return card.suit === hidden.suit && card.rank === low;
}
function isWild(card, hidden) {
  return card.rank === hidden.rank || isUpper(card, hidden) || isLower(card, hidden);
}
function roundToNearest10(n) {
  return Math.round(n / 10) * 10;
}

// ------------------------------
// Wild‑aware validators
// ------------------------------
function validatePureRun(cards) {
  if (cards.length < 3) return false;
  const suit = cards[0].suit;
  if (!cards.every((c) => c.suit === suit)) return false;
  const idxs = cards.map((c) => rankIndex(c.rank)).sort((a, b) => a - b);
  for (let i = 1; i < idxs.length; i++) {
    const gap = idxs[i] - idxs[i - 1];
    if (gap !== 1 && !(idxs[i - 1] === 0 && idxs[i] === 1)) return false; // A,2 edge
  }
  return true;
}
function validatePureSet(cards) {
  if (cards.length < 3) return false;
  const r = cards[0].rank;
  if (!cards.every((c) => c.rank === r)) return false;
  const suits = new Set(cards.map((c) => c.suit));
  return suits.size === cards.length; // all suits different
}
function validateRunWithWilds(cards, hidden) {
  if (cards.length < 3) return false;
  const nonWild = cards.filter((c) => !isWild(c, hidden));
  if (nonWild.length === 0) return false; // need at least one natural
  const suit = nonWild[0].suit;
  if (!nonWild.every((c) => c.suit === suit)) return false;

  const wildCount = cards.length - nonWild.length;

  // Low‑ace mode
  const uniqLow = [...new Set(nonWild.map((c) => rankIndex(c.rank)))].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < uniqLow.length; i++) gaps += Math.max(0, uniqLow[i] - uniqLow[i - 1] - 1);
  const okLow = wildCount >= gaps;

  // High‑ace mode (map A(0) to 13)
  const uniqHigh = uniqLow.map((v) => (v === 0 ? 13 : v)).sort((a, b) => a - b);
  let gapsHigh = 0;
  for (let i = 1; i < uniqHigh.length; i++)
    gapsHigh += Math.max(0, uniqHigh[i] - uniqHigh[i - 1] - 1);
  const okHigh = wildCount >= gapsHigh;

  return okLow || okHigh;
}
function validateSetWithWilds(cards, hidden) {
  if (cards.length < 3) return false;
  const nonWild = cards.filter((c) => !isWild(c, hidden));
  if (nonWild.length === 0) return false; // at least one natural
  const r = nonWild[0].rank;
  if (!nonWild.every((c) => c.rank === r)) return false;
  const suits = new Set(nonWild.map((c) => c.suit)); // distinct natural suits
  return suits.size === nonWild.length;
}
function validateMeldWildAware(m, deck, hidden) {
  const cards = m.cards.map((id) => deck[id]);
  switch (m.type) {
    case "TUNNELA":
      if (cards.length !== 3) return false;
      return cards.every((c) => c.suit === cards[0].suit && c.rank === cards[0].rank);
    case "PURE_RUN":
      if (cards.some((c) => isWild(c, hidden))) return false;
      return validatePureRun(cards);
    case "PURE_SET":
      if (cards.some((c) => isWild(c, hidden))) return false;
      return validatePureSet(cards);
    case "RUN":
      return validateRunWithWilds(cards, hidden);
    case "SET":
      return validateSetWithWilds(cards, hidden);
    default:
      return false;
  }
}
function validatePlayerDeclarationWildAware(p, deck, hidden) {
  if (!p.melds || p.melds.length === 0) return false;
  return p.melds.every((m) => validateMeldWildAware(m, deck, hidden));
}

// ------------------------------
// Room creation (host‑authoritative)
// ------------------------------
function createRoom(playersCount) {
  const seed = Math.floor(Math.random() * 1e9);
  const deckArr = generateDeck(3);
  const deck = Object.fromEntries(deckArr.map((c) => [c.id, c]));
  const order = shuffle(Object.keys(deck), seed);
  const hiddenJokerId = order[0];
  const stock = order.slice(1);

  const players = Array.from({ length: playersCount }).map((_, i) => ({
    id: `P${i + 1}`,
    name: `Player ${i + 1}`,
    seat: i,
    hand: [],
    melds: [],
    qualifies: false,
    hasPeeked: false,
    hasPicked: false,
    earlyTunnelaAwarded: false,
    chips: 250,
  }));

  // deal 21 each (round-robin)
  let t = 0;
  for (let i = 0; i < playersCount * 21; i++) {
    players[t].hand.push(stock[i]);
    t = (t + 1) % playersCount;
  }
  const remaining = stock.slice(playersCount * 21);

  return {
    id: "",
    options: {
      playersCount,
      requireThreePure: true,
      allowPureSets: false,
      useUpperLower: true,
    },
    deck,
    stock: remaining,
    discard: [],
    players,
    current: 0,
    phase: "LOBBY", // PLAY -> POST_LAYOFF -> FINISHED
    hiddenJokerId,
    seed,
    createdAt: Date.now(),
    lastAction: "Room created. Hidden joker set. Waiting to start.",
    ledger: [],
  };
}

// ------------------------------
// Main Component
// ------------------------------
export default function MarriageRummyOnline() {
  const [meName, setMeName] = useState("");
  const [meSeat, setMeSeat] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [room, setRoom] = useState(null);
  const [playersCount, setPlayersCount] = useState(3);
  const [selected, setSelected] = useState([]);

  // Subscribe to room
  useEffect(() => {
    if (!roomId) return;
    const r = ref(db, `rooms/${roomId}`);
    const unsub = onValue(r, (snap) => {
      const v = snap.val();
      if (v) setRoom(v);
    });
    return () => unsub();
  }, [roomId]);

  // Create / Join / Seat / Start
  function hostCreate() {
    const newRoom = createRoom(playersCount);
    const r = ref(db, `rooms`);
    const key = push(r).key;
    newRoom.id = key;
    if (meName.trim()) newRoom.players[0].name = meName.trim();

    set(ref(db, `rooms/${key}`), newRoom)
      .then(() => {
        setRoomId(key);
        setMeSeat(0);
      })
      .catch((err) => {
        console.error("Create room failed:", err);
      });
  }
  function joinRoom(id) {
    setRoomId(id);
  }
  function takeSeat(seat) {
    if (!room || room.phase !== "LOBBY") return;
    update(ref(db, `rooms/${room.id}/players/${seat}`), {
      name: meName.trim() || `Player ${seat + 1}`,
    });
    setMeSeat(seat);
  }
  function startGame() {
    if (room && meSeat === 0) {
      update(ref(db, `rooms/${room.id}`), { phase: "PLAY", lastAction: "Game started." });
    }
  }

  // ------------------------------
  // Safe selectors & helpers for rendering
  // ------------------------------
  const players = Array.isArray(room?.players) ? room.players : [];
  const currentIdx = Number.isInteger(room?.current) ? room.current : 0;
  const currentP = players[currentIdx];

  const stock = Array.isArray(room?.stock) ? room.stock : [];
  const discard = Array.isArray(room?.discard) ? room.discard : [];

  function myPlayer() {
    return players[meSeat ?? -1];
  }
  function currentPlayer() {
    return currentP;
  }
  function toggleSelect(id) {
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  function dispatchAction(partial) {
    if (room) update(ref(db, `rooms/${room.id}`), partial);
  }

  // Chips ledger helpers
  function transferChips(fromSeat, toSeat, amount, reason) {
    if (!room || !amount) return;
    const nextPlayers = room.players.slice();
    nextPlayers[fromSeat] = { ...nextPlayers[fromSeat], chips: nextPlayers[fromSeat].chips - amount };
    nextPlayers[toSeat]   = { ...nextPlayers[toSeat],   chips: nextPlayers[toSeat].chips   + amount };
    const ledger = (room.ledger || []).slice();
    ledger.push({ from: fromSeat, to: toSeat, amount, reason });
    dispatchAction({ players: nextPlayers, ledger });
  }

  // Turn actions
  function drawStock() {
    if (!room || meSeat !== currentIdx || stock.length === 0) return;
    const nextStock = stock.slice();
    const cardId = nextStock.shift();
    const nextPlayers = players.slice();
    const me = nextPlayers[currentIdx];
    nextPlayers[currentIdx] = { ...me, hasPicked: true, hand: [...(me.hand || []), cardId] };
    dispatchAction({ stock: nextStock, players: nextPlayers, lastAction: `${me.name} drew from stock.` });
  }
  function takeDiscard() {
    if (!room || meSeat !== currentIdx || discard.length === 0) return;
    const nextDiscard = discard.slice();
    const cardId = nextDiscard.pop();
    const nextPlayers = players.slice();
    const me = nextPlayers[currentIdx];
    nextPlayers[currentIdx] = { ...me, hasPicked: true, hand: [...(me.hand || []), cardId] };
    dispatchAction({ discard: nextDiscard, players: nextPlayers, lastAction: `${me.name} took the discard.` });
  }

  // Qualification
  function canQualify(melds) {
    const pureCount = melds.filter((m) => m.type === "PURE_RUN" || m.type === "TUNNELA").length;
    return pureCount >= 3;
  }

  // Lay melds
  function layPure(type) {
    if (!room || meSeat !== currentIdx) return;
    const me = myPlayer();
    if (!me) return;
    if (selected.length < 3) return;

    const meld = { id: `m-${Math.random()}`, type, cards: [...selected] };
    const nextPlayers = players.slice();
    const meIdx = currentIdx;
    const hand = (me.hand || []).filter((id) => !selected.includes(id));
    const melds = [...(me.melds || []), meld];
    const qualifies = me.qualifies || canQualify(melds);
    nextPlayers[meIdx] = { ...me, hand, melds, qualifies };
    setSelected([]);
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a ${type.replace("_", " ").toLowerCase()}.` });
  }

  function layImpureSet(minLen) {
    if (!room) return;
    const turnSeat = room.phase === "POST_LAYOFF" ? room.postLayIndex : currentIdx;
    if (meSeat !== turnSeat) return;
    const me = players[turnSeat];
    if (!me) return;

    const hidden = room.deck[room.hiddenJokerId];
    const required = Math.max(3, minLen);

    if (me.qualifies) {
      // Wild‑aware sets allowed
      if (selected.length < required) return;
      const cards = selected.map((id) => room.deck[id]);
      if (!validateSetWithWilds(cards, hidden)) return;
      const meld = { id: `m-${Math.random()}`, type: "SET", cards: [...selected] };
      const nextPlayers = players.slice();
      const hand = (me.hand || []).filter((id) => !selected.includes(id));
      const melds = [...(me.melds || []), meld];
      nextPlayers[turnSeat] = { ...me, hand, melds };
      setSelected([]);
      dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a set (wild‑aware).` });
    } else {
      // Not qualified: strict same‑rank sets of 4+
      const strictMin = Math.max(4, minLen);
      if (selected.length < strictMin) return;
      const r = room.deck[selected[0]].rank;
      if (!selected.every((id) => room.deck[id].rank === r)) return;
      const meld = { id: `m-${Math.random()}`, type: "SET", cards: [...selected] };
      const nextPlayers = players.slice();
      const hand = (me.hand || []).filter((id) => !selected.includes(id));
      const melds = [...(me.melds || []), meld];
      nextPlayers[turnSeat] = { ...me, hand, melds };
      setSelected([]);
      dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a set.` });
    }
  }

  function layTunnela() {
    if (!room || meSeat !== currentIdx) return;
    const me = myPlayer();
    if (!me) return;
    if (selected.length !== 3) return;

    const [a, b, c] = selected.map((id) => room.deck[id]);
    const same = (x, y) => x.rank === y.rank && x.suit === y.suit;
    if (!(a && b && c && same(a, b) && same(b, c))) return;

    const meld = { id: `m-${Math.random()}`, type: "TUNNELA", cards: [...selected] };
    const nextPlayers = players.slice();
    const meIdx = currentIdx;
    const hand = (me.hand || []).filter((id) => !selected.includes(id));
    const melds = [...(me.melds || []), meld];
    const qualifies = me.qualifies || canQualify(melds);
    let updated = { ...me, hand, melds, qualifies };

    // Early tunnela bonus
    if (!me.hasPicked && !me.earlyTunnelaAwarded) {
      updated = { ...updated, earlyTunnelaAwarded: true };
      for (const p of nextPlayers) {
        if (p.seat !== meIdx) transferChips(p.seat, meIdx, 10, "Early Tunnela (before first pickup)");
      }
    }
    nextPlayers[meIdx] = updated;
    setSelected([]);
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} laid a tunnela.` });
  }

  // Discard (with wild‑aware declare validation)
  function discardCard(cardId) {
    if (!room || meSeat !== currentIdx) return;
    const nextPlayers = players.slice();
    const p = nextPlayers[currentIdx];
    if (!p || !(p.hand || []).includes(cardId)) return;

    const newHand = (p.hand || []).filter((id) => id !== cardId);

    // If end of hand and qualified, validate melds
    if (newHand.length === 0 && p.qualifies) {
      const hidden = room.deck[room.hiddenJokerId];
      const valid = validatePlayerDeclarationWildAware(p, room.deck, hidden);
      if (!valid) {
        dispatchAction({ lastAction: `${p.name}: invalid declare — illegal wild usage in melds.` });
        return;
      }
    }

    nextPlayers[currentIdx] = { ...p, hand: newHand };
    const lastAction = `${p.name} discarded.`;

    if (newHand.length === 0) {
      startPostDeclare(currentIdx, nextPlayers, lastAction);
    } else {
      dispatchAction({ players: nextPlayers, discard: [...discard, cardId], lastAction });
    }
  }

  function endTurn() {
    if (room) dispatchAction({ current: (currentIdx + 1) % players.length });
  }
  function peekJoker() {
    if (!room) return;
    const me = myPlayer();
    if (!me || !me.qualifies || me.hasPeeked) return;
    const nextPlayers = players.slice();
    nextPlayers[me.seat] = { ...me, hasPeeked: true };
    dispatchAction({ players: nextPlayers, lastAction: `${me.name} peeked the hidden joker.` });
  }

  // Post‑declare flow
  function startPostDeclare(winnerSeat, nextPlayers, lastAction) {
    const nextSeat = nextNonWinnerSeat(winnerSeat, room.options.playersCount);
    dispatchAction({
      players: nextPlayers,
      winnerSeat,
      postLayIndex: nextSeat,
      phase: "POST_LAYOFF",
      lastAction,
    });
  }
  function nextNonWinnerSeat(winnerSeat, n, from) {
    let s = Number.isInteger(from) ? from : winnerSeat;
    do {
      s = (s + 1) % n;
    } while (s === winnerSeat);
    return s;
  }
  function doneLayoff() {
    if (!room) return;
    const n = room.options.playersCount;
    let next = nextNonWinnerSeat(room.winnerSeat, n, room.postLayIndex);
    if (next === room.winnerSeat) performSettlement();
    else dispatchAction({ postLayIndex: next });
  }

  function pointsInHand(cards, hidden) {
    let sum = 0;
    for (const c of cards) {
      if (isWild(c, hidden)) continue; // 0
      if (["J", "Q", "K", "A"].includes(c.rank)) sum += 10;
      else sum += parseInt(c.rank, 10) || 0;
    }
    return sum;
  }
  function analyseHoldings(cards, hidden) {
    const suit = hidden.suit;
    const jokerRank = hidden.rank;
    const lowerRank = RANKS[(rankIndex(jokerRank) - 1 + RANKS.length) % RANKS.length];
    const upperRank = RANKS[(rankIndex(jokerRank) + 1) % RANKS.length];

    const count = {};
    for (const c of cards) {
      if (c.rank === jokerRank) count[`${c.suit}-${c.rank}`] = (count[`${c.suit}-${c.rank}`] || 0) + 1;
      if (c.suit === suit && (c.rank === lowerRank || c.rank === upperRank || c.rank === "A")) {
        count[`${c.suit}-${c.rank}`] = (count[`${c.suit}-${c.rank}`] || 0) + 1;
      }
    }
    const L = count[`${suit}-${lowerRank}`] || 0;
    const J = count[`${suit}-${jokerRank}`] || 0;
    const U = count[`${suit}-${upperRank}`] || 0;
    const marriages = Math.min(L, J, U);

    // Remove sets used in marriages from singles
    const singlesDetail = [];
    for (const k in count) singlesDetail.push(...Array(count[k]).fill(k));
    const removeOne = (key) => {
      const idx = singlesDetail.indexOf(key);
      if (idx >= 0) singlesDetail.splice(idx, 1);
    };
    for (let m = 0; m < marriages; m++) {
      removeOne(`${suit}-${lowerRank}`);
      removeOne(`${suit}-${jokerRank}`);
      removeOne(`${suit}-${upperRank}`);
    }

    let singletons = 0;
    for (const tag of singlesDetail) {
      const [s, r] = tag.split("-");
      if (r === jokerRank) singletons++;
      else if (s === suit && (r === lowerRank || r === upperRank || r === "A")) singletons++;
    }
    return { singletons, marriages };
  }

  function performSettlement() {
    if (!room) return;
    const hidden = room.deck[room.hiddenJokerId];
    const nextPlayers = players.slice();
    const winner = room.winnerSeat;

    // Points -> chips to winner
    for (const p of nextPlayers) {
      if (p.seat === winner) continue;
      const points = pointsInHand((p.hand || []).map((id) => room.deck[id]), hidden);
      const rounded = roundToNearest10(points);
      let chips = 0;
      if (rounded >= 100) chips = 25;
      else chips = (rounded / 10) * 2;
      if (chips > 0) transferChips(p.seat, winner, chips, `Points ${points} -> ${rounded} (to winner)`);
    }

    // Pairwise wild/value bonuses on UNMELDED holdings
    const holdings = nextPlayers.map((p) => analyseHoldings((p.hand || []).map((id) => room.deck[id]), hidden));
    for (let i = 0; i < nextPlayers.length; i++) {
      for (let j = 0; j < nextPlayers.length; j++) {
        if (i === j) continue;
        const h = holdings[j]; // j receives from i based on j's holdings
        const amount = h.singletons * 5 + h.marriages * 25;
        if (amount > 0) transferChips(i, j, amount, `Wild/Value bonuses (${h.singletons}×5 + ${h.marriages}×25)`);
      }
    }

    dispatchAction({ phase: "FINISHED", lastAction: "Settlement complete." });
  }

  // UI helpers
  const btn = "px-3 py-3 rounded-xl text-white text-sm active:scale-[.98]";

  // ------------------------------
  // Early loading/guard states
  // ------------------------------
  if (!roomId) {
    return (
      <div className="p-4 max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-bold">Marriage Rummy — Online</h1>
        <div className="p-4 bg-white rounded-2xl shadow space-y-3">
          <label className="block text-sm">Your name</label>
          <input
            className="w-full border rounded-lg px-3 py-2"
            value={meName}
            onChange={(e) => setMeName(e.target.value)}
            placeholder="Enter name"
          />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="p-3 rounded-xl bg-gray-50 border">
              <div className="text-xs text-gray-500 mb-1">Create room</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={5}
                  className="w-16 border rounded px-2 py-1"
                  value={playersCount}
                  onChange={(e) => setPlayersCount(parseInt(e.target.value) || 3)}
                />
                <button className={`${btn} bg-blue-700`} onClick={hostCreate}>
                  Create
                </button>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 border">
              <div className="text-xs text-gray-500 mb-1">Join room</div>
              <JoinBox onJoin={setRoomId} />
            </div>
          </div>
        </div>
        <HowTo />
      </div>
    );
  }

  if (!room) return <div className="p-4 max-w-md mx-auto">Connecting to room…</div>;
  if (!Array.isArray(room.players)) return <div className="p-4 max-w-md mx-auto">Preparing table…</div>;
  if (room.phase === "PLAY" && (!Array.isArray(room.stock) || !Array.isArray(room.discard) || !players[currentIdx])) {
    return <div className="p-4 max-w-md mx-auto">Setting the deck…</div>;
  }

  // ------------------------------
  // Main Views
  // ------------------------------
  return (
    <div className="p-3 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-gray-500">Room</div>
          <div className="font-semibold break-all">{room.id}</div>
        </div>
        <div className="text-right text-xs text-gray-500">Players: {room.options.playersCount}</div>
      </div>

      {/* Lobby */}
      {room.phase === "LOBBY" && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="font-semibold mb-2">Seats</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {players.map((p) => (
                <button
                  key={p.seat}
                  onClick={() => takeSeat(p.seat)}
                  className={`p-3 rounded-xl border ${
                    meSeat === p.seat ? "border-blue-600" : "border-gray-200"
                  } ${p.name ? "bg-emerald-50" : "bg-white"}`}
                >
                  <div className="text-xs text-gray-500">Seat {p.seat + 1}</div>
                  <div className="font-medium truncate">{p.name || "Empty"}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-500">Tap a seat to set your name there.</div>
          </div>
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="font-semibold mb-2">Hidden Joker</div>
            <div className="text-sm text-gray-600">
              A random card has been set as the hidden joker. You can <b>peek</b> it only after laying{" "}
              <b>3 pure melds</b> (pure runs or tunnela).
            </div>
            <div className="mt-3">
              {meSeat === 0 ? (
                <button onClick={startGame} className={`${btn} bg-emerald-700`}>
                  Start Game
                </button>
              ) : (
                <div className="text-xs text-gray-500">Waiting for host to start…</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Play */}
      {room.phase === "PLAY" && (
        <div className="space-y-3">
          <div className="p-3 rounded-2xl bg-white shadow flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500">Turn</div>
              <div className="font-semibold">{currentP?.name ?? "Player"}</div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div>Stock <b>{stock.length}</b></div>
              <div>Discard <b>{discard.length}</b></div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Hidden Joker</span>
                {myPlayer()?.hasPeeked ? (
                  <Card card={room.deck[room.hiddenJokerId]} />
                ) : (
                  <CardMask />
                )}
              </div>
              <div>
                <button onClick={drawStock} className={`${btn} bg-gray-900 mr-2`}>Draw</button>
                <button onClick={takeDiscard} className={`${btn} bg-amber-600`}>Pickup</button>
              </div>
            </div>
          </div>

          {/* My Hand */}
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">
                {(myPlayer()?.name ?? "You")}'s Hand ({(myPlayer()?.hand ?? []).length})
              </div>
              <div className="text-xs text-gray-500">Tap cards, then Lay</div>
            </div>
            <div className="flex flex-wrap">
              {(myPlayer()?.hand ?? []).map((id) => (
                <Card
                  key={id}
                  card={room.deck[id]}
                  selected={selected.includes(id)}
                  onClick={() => toggleSelect(id)}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => selected.length >= 3 && layPure("PURE_RUN")} className={`${btn} bg-sky-600`}>
                Lay Pure Run
              </button>
              <button onClick={() => selected.length >= 3 && layPure("PURE_SET")} className={`${btn} bg-indigo-600`}>
                Lay Pure Set
              </button>
              <button onClick={() => layTunnela()} className={`${btn} bg-rose-700`}>
                Lay Tunnela (3 identical)
              </button>
              <button onClick={() => layImpureSet(3)} className={`${btn} bg-purple-600`}>
                Lay Set (impure)
              </button>
              <button
                onClick={() => setSelected([])}
                className="px-3 py-3 rounded-xl bg-gray-200 text-gray-700 text-sm"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Discard */}
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="font-semibold mb-2">Discard (top last)</div>
            <div className="flex flex-wrap">{discard.map((id) => <Card key={id} card={room.deck[id]} />)}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(myPlayer()?.hand ?? []).map((id) => (
                <button
                  key={id}
                  onClick={() => discardCard(id)}
                  className="px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 rounded border"
                >
                  Discard {room.deck[id].rank}{room.deck[id].suit}
                </button>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="font-semibold mb-2">Controls</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={endTurn} className={`${btn} bg-gray-900`}>End Turn</button>
              <button onClick={() => discardCard((myPlayer()?.hand ?? [])[0])} className={`${btn} bg-emerald-700`}>
                Quick Declare (discard first card)
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-3">{room.lastAction}</div>
          </div>

          {/* Table */}
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="font-semibold mb-2">Table</div>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {players.map((p, idx) => (
                <div key={p.id} className={`p-3 rounded-xl border ${idx === currentIdx ? "border-blue-600" : "border-gray-200"}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-gray-500">{idx === currentIdx ? "Playing" : ""}</div>
                  </div>
                  <div className="mt-1 text-xs">Melds: {(p.melds ?? []).length} | Hand: {(p.hand ?? []).length}</div>
                  <div className="mt-1 text-xs">Qualifies: {p.qualifies ? "Yes" : "No"} | Peeked: {p.hasPeeked ? "Yes" : "No"}</div>
                  <div className="mt-1 text-xs">Chips: <b>{p.chips}</b></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Post‑Declare Layoff */}
      {room.phase === "POST_LAYOFF" && (
        <div className="space-y-3">
          <div className="p-3 rounded-2xl bg-white shadow flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500">
                Post‑Declare Layoff — Winner: {players[room.winnerSeat]?.name ?? "Winner"}
              </div>
              <div className="font-semibold">Now laying off: {players[room.postLayIndex]?.name ?? "Player"}</div>
            </div>
          </div>

          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">
                {(players[room.postLayIndex]?.name ?? "Player")}'s Hand ({(players[room.postLayIndex]?.hand ?? []).length})
              </div>
              <div className="text-xs text-gray-500">Tap cards, then Lay Set</div>
            </div>
            <div className="flex flex-wrap">
              {(players[room.postLayIndex]?.hand ?? []).map((id) => (
                <Card key={id} card={room.deck[id]} selected={selected.includes(id)} onClick={() => toggleSelect(id)} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => layImpureSet(players[room.postLayIndex]?.qualifies ? 3 : 4)}
                className={`${btn} bg-purple-600`}
              >
                Lay Set (min {players[room.postLayIndex]?.qualifies ? 3 : 4})
              </button>
              <button
                onClick={() => { setSelected([]); doneLayoff(); }}
                className="px-3 py-3 rounded-xl bg-emerald-700 text-white text-sm"
              >
                I'm Done
              </button>
            </div>
          </div>

          {/* Table & Chips during layoff */}
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="font-semibold mb-2">Table</div>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {players.map((p) => (
                <div key={p.id} className={`p-3 rounded-xl border border-gray-200`}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium truncate">{p.name}</div>
                  </div>
                  <div className="mt-1 text-xs">Melds: {(p.melds ?? []).length} | Hand: {(p.hand ?? []).length}</div>
                  <div className="mt-1 text-xs">Chips: <b>{p.chips}</b></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Finished */}
      {room.phase === "FINISHED" && (
        <div className="space-y-3">
          <div className="p-3 bg-white rounded-2xl shadow">
            <div className="font-semibold mb-2">Round Finished</div>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {players.map((p) => (
                <div key={p.id} className="p-3 rounded-xl border border-gray-200">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-sm">Chips: <b>{p.chips}</b></div>
                </div>
              ))}
            </div>
          </div>
          {(room.ledger || []).length > 0 && (
            <div className="p-3 bg-white rounded-2xl shadow">
              <div className="font-semibold mb-2">Chip Ledger</div>
              <ul className="text-xs list-disc pl-5">
                {(room.ledger || []).map((t, i) => (
                  <li key={i} className="mb-1">
                    <b>{players[t.from]?.name ?? `Seat ${t.from+1}`}</b> → <b>{players[t.to]?.name ?? `Seat ${t.to+1}`}</b>: {t.amount} ({t.reason})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------
// Small UI bits
// ------------------------------
function Card({ card, selected, onClick }) {
  const colour = card.suit === "♥" || card.suit === "♦" ? "text-red-600" : "text-gray-900";
  return (
    <button
      onClick={onClick}
      className={`relative w-12 h-16 md:w-14 md:h-20 rounded-xl border bg-white shadow-sm flex flex-col items-center justify-center mr-1 mb-1 ${
        selected ? "ring-2 ring-blue-500" : ""
      }`}
    >
      <span className={`text-xs ${colour}`}>{card.rank}</span>
      <span className={`text-lg ${colour}`}>{card.suit}</span>
    </button>
  );
}
function CardMask() {
  return (
    <div className="relative w-12 h-16 md:w-14 md:h-20 rounded-xl border bg-gray-100 shadow-sm flex flex-col items-center justify-center mr-1 mb-1">
      <span className="text-xs text-gray-400">?</span>
      <span className="text-lg text-gray-400">?</span>
    </div>
  );
}
function JoinBox({ onJoin }) {
  const [id, setId] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 border rounded-lg px-3 py-2"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Paste room id"
      />
      <button className="px-3 py-3 rounded-xl bg-blue-700 text-white text-sm" onClick={() => id && onJoin(id)}>
        Join
      </button>
    </div>
  );
}
function HowTo() {
  return (
    <div className="p-4 bg-white rounded-2xl shadow text-sm">
      <div className="font-semibold mb-1">How this variant works</div>
      <ul className="list-disc pl-5 space-y-1 text-gray-700">
        <li>Each player is dealt <b>21 cards</b> from <b>3 decks</b>. Everyone starts with <b>250 chips</b>.</li>
        <li>Hidden joker (maal). Peek only after laying <b>3 pure melds</b> (pure runs or tunnela). Pure sets do not count toward the threshold.</li>
        <li><b>Upper</b> and <b>Lower</b> (same suit as the joker, one rank above/below) are enabled.</li>
        <li><b>Early Tunnela:</b> If you lay a tunnela before your first pickup, each opponent pays you 10 chips.</li>
        <li><b>Declaration:</b> If you have qualified, your melds are checked with <b>wild‑aware</b> rules before the hand can end.</li>
        <li><b>Post‑declare layoff:</b> Qualified players may lay <b>wild‑aware sets (3+)</b>. Not qualified: <b>strict sets (4+)</b>.</li>
        <li><b>Settlement:</b> Points → winner (Swedish rounding, 2 chips per 10; ≥100 → 25). Then pairwise wild/value bonuses: 5 chips per Joker/Upper/Lower/A of joker suit, 25 per complete L‑J‑U set.</li>
      </ul>
    </div>
  );
}
