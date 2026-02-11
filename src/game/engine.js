import { SUITS, RANKS, cardToStr, seqIndex, CARD_POINTS, isSameCard } from './types'

// ---------- Deck & initial state ----------

export function buildThreeDecks() {
  const cards = []
  for (let d = 0; d < 3; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit, id: `${rank}${suit}#${d}` }) // tag with deck index to distinguish duplicates
      }
    }
  }
  return cards
}

export function shuffle(arr, seed) {
  // Deterministic mulberry32-like PRNG based on seed text
  let t = 0
  for (let i=0;i<seed.length;i++) t = (t*31 + seed.charCodeAt(i)) >>> 0
  const rand = () => {
    t += 0x6D2B79F5
    let r = t
    r = Math.imul(r ^ r >>> 15, r | 1)
    r ^= r + Math.imul(r ^ r >>> 7, r | 61)
    return ((r ^ r >>> 14) >>> 0) / 4294967296
  }
  const a = arr.slice()
  for (let i=a.length-1;i>0;i--) {
    const j = Math.floor(rand()*(i+1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function dealInitial(deck, playersCount) {
  const hands = Array.from({length: playersCount}, () => [])
  for (let r=0; r<21; r++) {
    for (let p=0; p<playersCount; p++) {
      hands[p].push(deck.pop())
    }
  }
  const tiplu = deck.pop()     // hidden until reveal; shown to all at Grace
  const firstDiscard = deck.pop()
  const discard = [firstDiscard]
  return { deck, hands, tiplu, discard }
}

// ---------- Wilds ----------

export function tipluWilds(tiplu) {
  const idx = RANKS.indexOf(tiplu.rank)
  // Paplus are +/- 1 rank in the same suit (wrap K->A and A->K)
  const highRank = RANKS[(idx+1) % RANKS.length]
  const lowRank  = RANKS[(idx-1+RANKS.length) % RANKS.length]
  return {
    primary: {
      tiplu: { rank: tiplu.rank, suit: tiplu.suit },
      high:  { rank: highRank,   suit: tiplu.suit },
      low:   { rank: lowRank,    suit: tiplu.suit }
    },
    secondaryAce: { rank: 'A', suit: tiplu.suit },
    onRank: SUITS.filter(s => s !== tiplu.suit).map(s => ({ rank: tiplu.rank, suit: s }))
  }
}

export function isWildCard(card, tiplu) {
  if (!tiplu) return false
  const w = tipluWilds(tiplu)
  const all = [w.primary.tiplu, w.primary.high, w.primary.low, w.secondaryAce, ...w.onRank]
  return all.some(x => isSameCard(card, x))
}

// ---------- Meld validation ----------

const ascByRank = (a,b) => seqIndex(a.rank) - seqIndex(b.rank)

export function isIdenticalSet(cards) {
  if (cards.length !== 3) return false
  const [a,b,c] = cards
  return isSameCard(a,b) && isSameCard(b,c)
}

export function isRankSet(cards, playerHasRevealed, tiplu) {
  if (!playerHasRevealed) return false
  if (cards.length < 3) return false
  const firstRank = cards[0].rank
  if (!cards.every(c => c.rank === firstRank || (playerHasRevealed && isWildCard(c, tiplu)))) return false
  // All suits must be unique (wilds may assume the missing suits; we don't need to assign suits explicitly here)
  const suits = []
  for (const c of cards) {
    const suit = c.suit
    if (suits.includes(suit)) return false
    suits.push(suit)
  }
  return true
}

// sequences: same suit, consecutive, wilds can bridge gaps post-reveal
export function isSequence(cards, playerHasRevealed, tiplu) {
  if (cards.length < 3) return false
  // Determine suit: use first non-wild card’s suit; if none and revealed, allow any suit
  const nonWild = cards.filter(c => !(playerHasRevealed && isWildCard(c, tiplu)))
  const suit = nonWild.length ? nonWild[0].suit : (playerHasRevealed ? (tiplu?.suit || 'S') : null)
  if (!suit) return false
  if (nonWild.some(c => c.suit !== suit)) return false

  // Build sorted list of ranks with wild markers
  const ranks = cards.map(c => (playerHasRevealed && isWildCard(c, tiplu)) ? 'W' : c.rank)
  // Try to fit into any contiguous rank window (no wrap except explicit Q-K-A case; A-2-3 allowed)
  // Generate candidate targets by sliding a window over the rank list
  const fitsWithWilds = (handRanks, targetRanks) => {
    const nonWilds = handRanks.filter(r => r !== 'W')
    // all non-wilds must be members of target
    if (!nonWilds.every(r => targetRanks.includes(r))) return false
    const missing = targetRanks.filter(r => !nonWilds.includes(r))
    const wildCount = handRanks.length - nonWilds.length
    return wildCount >= missing.length
  }

  // Standard windows
  for (let start = 0; start <= (RANKS.length - cards.length); start++) {
    const target = RANKS.slice(start, start + cards.length)
    if (fitsWithWilds(ranks, target)) return true
  }
  // Special cases
  if (cards.length === 3) {
    if (fitsWithWilds(ranks, ['A','2','3'])) return true
    if (fitsWithWilds(ranks, ['Q','K','A'])) return true
  }
  // No K-A-2 wrap
  return false
}

// Reveal credit per meld: floor(n/3) for sequences; 1 for identical; 1 for rankset (post-reveal)
export function revealCreditsForMeld(meld, playerHasRevealed, tiplu) {
  if (meld.kind === 'sequence') return Math.floor(meld.cards.length / 3)
  if (meld.kind === 'identical') return 1
  if (meld.kind === 'rankset') return playerHasRevealed ? 1 : 0
  return 0
}

// ---------- Scoring ----------

export function swedishRound10(points) {
  const mod = points % 10
  return mod <= 4 ? points - mod : points + (10 - mod)
}

// Wilds score 0 for everyone at end-of-round (Grace), and 0 for a revealed player any time.
export function deadwoodPointsForPlayer(hand, tiplu) {
  const pts = hand.reduce((sum, c) => sum + (isWildCard(c, tiplu) ? 0 : CARD_POINTS(c.rank)), 0)
  return pts
}

export function chipsFromDeadwood(points) {
  if (points >= 100) return 25 // full hand cap/penalty
  const rounded = swedishRound10(points)
  return (rounded / 10) * 2
}

// ---------- Side payments ----------

export function sidePayments(playersHoldings, tiplu) {
  // playersHoldings: [{id, name, holding:[cards]}]
  const payments = []
  const w = tipluWilds(tiplu)

  const isCard = (c, t) => isSameCard(c, t)

  for (const holder of playersHoldings) {
    const cards = holder.holding
    const others = playersHoldings.filter(p => p.id !== holder.id)

    const lowCount  = cards.filter(c => isCard(c, w.primary.low)).length
    const tipCount  = cards.filter(c => isCard(c, w.primary.tiplu)).length
    const highCount = cards.filter(c => isCard(c, w.primary.high)).length
    const aceCount  = cards.filter(c => isCard(c, w.secondaryAce)).length
    const marriageCount = Math.min(lowCount, tipCount, highCount)

    // Primary wilds (5 each)
    for (let i=0;i<lowCount + tipCount + highCount;i++) {
      for (const o of others) payments.push({ from: o.id, to: holder.id, amount: 5, reason: 'Primary wild' })
    }
    // Ace (Tiplu suit) (5 each)
    for (let i=0;i<aceCount;i++) {
      for (const o of others) payments.push({ from: o.id, to: holder.id, amount: 5, reason: 'Ace (Tiplu suit)' })
    }
    // Marriages (25 each)
    for (let i=0;i<marriageCount;i++) {
      for (const o of others) payments.push({ from: o.id, to: holder.id, amount: 25, reason: `Marriage (${tiplu.suit})` })
    }
  }
  return payments
}

export function flattenHoldings(playerState) {
  const laid = (playerState.melds || []).flatMap(m => m.cards)
  const inHand = playerState.hand || []
  return [...laid, ...inHand]
}