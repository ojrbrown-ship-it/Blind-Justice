import { SUITS, RANKS, isSameCard, seqIndex, CARD_POINTS, cardToStr } from './types'

// ----- Deck & initial state -----
export function buildThreeDecks() {
  const cards = []
  for (let d = 0; d < 3; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit, id: `${rank}${suit}#${d}` })
      }
    }
  }
  return cards
}

export function shuffle(arr, seed) {
  let t = 0
  for (let i=0;i<seed.length;i++) t = (t*31 + seed.charCodeAt(i)) >>> 0
  const rand = () => {
    t += 0x6D2B79F5; let r = t
    r = Math.imul(r ^ r >>> 15, r | 1); r ^= r + Math.imul(r ^ r >>> 7, r | 61)
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
  const tiplu = deck.pop()     // hidden value; public in Grace
  const firstDiscard = deck.pop()
  const discard = [firstDiscard]
  return { deck, hands, tiplu, discard }
}

// ----- Wilds -----
export function tipluWilds(tiplu) {
  const idx = RANKS.indexOf(tiplu.rank)
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

// ----- Meld validation -----
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
  const suits = []
  for (const c of cards) {
    const suit = c.suit
    if (suits.includes(suit)) return false
    suits.push(suit)
  }
  return true
}

export function isSequence(cards, playerHasRevealed, tiplu) {
  if (cards.length < 3) return false
  const nonWild = cards.filter(c => !(playerHasRevealed && isWildCard(c, tiplu)))
  const suit = nonWild.length ? nonWild[0].suit : (playerHasRevealed ? (tiplu?.suit || 'S') : null)
  if (!suit) return false
  if (nonWild.some(c => c.suit !== suit)) return false

  const ranks = cards.map(c => (playerHasRevealed && isWildCard(c, tiplu)) ? 'W' : c.rank)
  const fits = (handRanks, target) => {
    const nonW = handRanks.filter(r => r !== 'W')
    // Use multiset comparison: for each non-wild rank, it must appear in target
    const targetPool = target.slice()
    for (const r of nonW) {
      const idx = targetPool.indexOf(r)
      if (idx === -1) return false
      targetPool.splice(idx, 1)
    }
    // Remaining target slots need to be filled by wilds
    const wilds = handRanks.length - nonW.length
    return wilds >= targetPool.length
  }
  for (let start = 0; start <= (RANKS.length - cards.length); start++) {
    const target = RANKS.slice(start, start + cards.length)
    if (fits(ranks, target)) return true
  }
  // Handle Ace-high: Q-K-A for length 3, and longer sequences ending with A
  if (cards.length >= 3) {
    if (fits(ranks, ['Q','K','A'])) return true
    // For longer sequences ending with Ace-high
    if (cards.length > 3) {
      const endIdx = RANKS.indexOf('Q')
      const startIdx = endIdx - (cards.length - 3)
      if (startIdx >= 0) {
        const target = [...RANKS.slice(startIdx, endIdx), 'Q', 'K', 'A']
        if (target.length === cards.length && fits(ranks, target)) return true
      }
    }
  }
  return false
}

export function revealCreditsForMeld(meld, playerHasRevealed) {
  if (meld.kind === 'sequence') return Math.floor(meld.cards.length / 3)
  if (meld.kind === 'identical') return 1
  if (meld.kind === 'rankset') return playerHasRevealed ? 1 : 0
  return 0
}

// ----- Scoring -----
export function swedishRound10(points) {
  const mod = points % 10
  return mod <= 4 ? points - mod : points + (10 - mod)
}

export function deadwoodPointsForPlayer(hand, tiplu) {
  return hand.reduce((sum, c) => sum + (isWildCard(c, tiplu) ? 0 : CARD_POINTS(c.rank)), 0)
}

export function chipsFromDeadwood(points) {
  if (points >= 100) return 25 // full hand cap/penalty
  const rounded = swedishRound10(points)
  return (rounded / 10) * 2
}

export function wildcardChipsForPlayer(hand, tiplu) {
  if (!tiplu) return 0
  const w = tipluWilds(tiplu)
  let chips = 0
  for (const card of hand) {
    let matched = false
    if (isSameCard(card, w.primary.tiplu)) {
      chips += 2
      matched = true
    }
    if (!matched && isSameCard(card, w.primary.high)) {
      chips += 2
      matched = true
    }
    if (!matched && isSameCard(card, w.primary.low)) {
      chips += 2
      matched = true
    }
    if (!matched && isSameCard(card, w.secondaryAce) && card.suit === tiplu.suit) {
      chips += 4
      matched = true
    }
    if (!matched && w.onRank.some(x => isSameCard(card, x))) {
      chips += 2
    }
  }
  return chips
}

// ----- Side payments -----
export function sidePayments(playersHoldings, tiplu) {
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

    for (let i=0;i<lowCount + tipCount + highCount;i++) {
      for (const o of others) payments.push({ from: o.id, to: holder.id, amount: 5, reason: 'Primary wild' })
    }
    for (let i=0;i<aceCount;i++) {
      for (const o of others) payments.push({ from: o.id, to: holder.id, amount: 5, reason: 'Ace (Tiplu suit)' })
    }
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
