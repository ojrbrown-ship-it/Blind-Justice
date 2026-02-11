export const SUITS = ['S', 'H', 'D', 'C']          // Spades, Hearts, Diamonds, Clubs
export const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K']

export const suitName = (s) => ({S:'♠',H:'♥',D:'♦',C:'♣'}[s])
export const suitColour = (s) => (s==='H'||s==='D') ? 'crimson' : '#111'

export const cardToStr = (c) => `${c.rank}${c.suit}` // e.g. '7H'
export const parseCard = (str) => ({ rank: str.slice(0, str.length-1), suit: str.slice(-1) })

export const isSameCard = (a,b) => a.rank===b.rank && a.suit===b.suit
export const seqIndex = (rank) => RANKS.indexOf(rank)

export const CARD_POINTS = (rank) => {
  if (rank==='A' || rank==='K' || rank==='Q' || rank==='J' || rank==='10') return 10
  return parseInt(rank,10)
}

export const deepClone = (x) => JSON.parse(JSON.stringify(x))