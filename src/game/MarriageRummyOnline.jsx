// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { db } from '../firebase'
import {
  collection, doc, onSnapshot, setDoc, updateDoc, getDoc, getDocs, deleteDoc, runTransaction, enableNetwork
} from 'firebase/firestore'
import { nanoid } from 'nanoid'
import {
  buildThreeDecks, shuffle, dealInitial, isIdenticalSet, isRankSet, isSequence,
  isWildCard, revealCreditsForMeld, deadwoodPointsForPlayer, chipsFromDeadwood,
  sidePayments, flattenHoldings, tipluWilds
} from './engine'
import { suitName, suitColour, RANKS } from './types'

// ===================== HELPERS =====================

function seatPosition(index, total, isMe) {
  // Place seats around an ellipse. "Me" is always at the bottom center.
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2
  const x = 50 + 42 * Math.cos(angle)
  const y = 50 + 40 * Math.sin(angle)
  return { top: `${y}%`, left: `${x}%` }
}

function meldCreditsTotal(melds) {
  return (melds || []).reduce((s, m) => s + revealCreditsForMeld(m, false), 0)
}

function sortHand(hand, tiplu, isRevealed) {
  const suitOrder = { S: 0, H: 1, D: 2, C: 3 }
  const rankOrder = RANKS.reduce((acc, r, i) => { acc[r] = i; return acc }, {})
  return [...hand].sort((a, b) => {
    const sa = suitOrder[a.suit] ?? 4
    const sb = suitOrder[b.suit] ?? 4
    if (sa !== sb) return sa - sb
    return (rankOrder[a.rank] ?? 0) - (rankOrder[b.rank] ?? 0)
  })
}

// ===================== CARD COMPONENT =====================

function PlayingCard({ card, selected, wild, onClick, mini, faceDown }) {
  if (faceDown) {
    return <div className={`playing-card card-back ${mini ? 'mini' : ''}`} />
  }
  const cls = [
    'playing-card',
    `suit-${card.suit}`,
    selected ? 'selected' : '',
    wild ? 'wild-card' : '',
    mini ? 'mini' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={cls} onClick={onClick} role="button" tabIndex={0} aria-label={`${card.rank} of ${suitName(card.suit)}`}>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{suitName(card.suit)}</span>
    </div>
  )
}

// ===================== MELDS DISPLAY =====================

function MeldsDisplay({ melds, tiplu, showWild }) {
  if (!melds || !melds.length) return <span className="muted" style={{ fontSize: '0.8rem' }}>No melds yet.</span>
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {melds.map(m => (
        <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="meld-label">{m.kind}</span>
            {m.tag === 'TENNALA' && <span className="tennala-badge">TENNALA</span>}
          </div>
          <div className="meld-group">
            {m.cards.map(c => (
              <PlayingCard
                key={c.id}
                card={c}
                wild={showWild && tiplu && isWildCard(c, tiplu)}
                mini
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ===================== PLAYER SEAT =====================

function PlayerSeat({ player, isMe, isCurrentTurn, position }) {
  const credits = meldCreditsTotal(player.melds)
  const revealLabel = player.isRevealed ? 'Revealed' : `${credits}/3`
  return (
    <div
      className={`seat ${isMe ? 'me' : ''} ${isCurrentTurn ? 'active-turn' : ''}`}
      style={{ left: position.left, top: position.top }}
    >
      <div className="avatar">
        {(player.name || '?').slice(0, 2).toUpperCase()}
      </div>
      <div className="seat-info">
        <div className="seat-name">{player.name || player.id.slice(0, 6)}</div>
        <div className="seat-meta">
          <span className="seat-chips">{player.chips ?? 250}</span>
          <span className="seat-status" style={{ color: player.isRevealed ? 'var(--ok)' : 'var(--muted)' }}>
            {revealLabel}
          </span>
        </div>
      </div>
      {(player.hand?.length > 0) && (
        <span className="seat-hand-count">{player.hand.length} cards</span>
      )}
    </div>
  )
}

// ===================== MAIN COMPONENT =====================

export default function MarriageRummyOnline({ roomId, displayName, defaultChips = 250, playerId }) {
  const roomRef = doc(db, 'rooms', roomId)
  const playersRef = collection(roomRef, 'players')

  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [handSel, setHandSel] = useState([])
  const [message, setMessage] = useState('')
  const [bootMsg, setBootMsg] = useState('Connecting to table...')
  const [bootError, setBootError] = useState('')
  const [nameDraft, setNameDraft] = useState(displayName)
  const [showSettings, setShowSettings] = useState(false)

  const creatingRoom = useRef(false)

  useEffect(() => setNameDraft(displayName), [displayName])

  // Keep Firestore online
  useEffect(() => {
    const onUp = async () => { try { await enableNetwork(db) } catch {} }
    window.addEventListener('online', onUp)
    return () => window.removeEventListener('online', onUp)
  }, [])

  // Create/subscribe to room
  useEffect(() => {
    setBootMsg('Connecting to table...')
    setBootError('')
    const unsub = onSnapshot(
      roomRef,
      async (snap) => {
        if (!snap.exists()) {
          if (!creatingRoom.current) {
            creatingRoom.current = true
            setBootMsg('Table not found - creating it now...')
            try {
              await setDoc(roomRef, {
                createdAt: Date.now(),
                ownerId: playerId,
                status: 'idle',
                tiplu: null,
                tipluPublicAtGrace: false,
                maxPlayers: 5,
                deckSeed: nanoid(10),
                deck: [],
                discard: [],
                turnIndex: 0
              })
              setBootMsg('Table created.')
            } catch (e) {
              console.error('[Room create error]', e)
              setBootError((e?.message || 'Failed to create table.') +
                (String(e?.message || '').includes('offline')
                  ? ' (hint: check your network connection and refresh)'
                  : ''))
            } finally {
              creatingRoom.current = false
            }
          }
          setRoom(null)
        } else {
          setRoom(snap.data())
          setBootMsg('')
          setBootError('')
        }
      },
      (err) => {
        console.error('[Room snapshot error]', err)
        setBootError(err?.message || 'Failed to read table document.')
        setRoom(null)
      }
    )
    return () => unsub()
  }, [roomId, playerId])

  // Subscribe to players
  useEffect(() => {
    const unsub = onSnapshot(
      playersRef,
      (qs) => {
        const arr = []
        qs.forEach(d => arr.push({ id: d.id, ...d.data() }))
        arr.sort((a, b) => (b.seatedAt > 0) - (a.seatedAt > 0) || (a.joinedAt || 0) - (b.joinedAt || 0))
        setPlayers(arr)
      },
      (err) => {
        console.error('[Players snapshot error]', err)
        setBootError(err?.message || 'Failed to read players collection.')
      }
    )
    return () => unsub()
  }, [roomId])

  // Sit down — only create the player doc if it doesn't already exist
  const hasSatDown = useRef(false)
  useEffect(() => {
    if (!playerId || !room) return
    if (hasSatDown.current) return
    const sitDown = async () => {
      try {
        const existing = await getDoc(doc(playersRef, playerId))
        if (existing.exists()) {
          // Player doc already exists — just update the name if needed, don't touch hand/melds
          await setDoc(doc(playersRef, playerId), {
            name: displayName,
            seatedAt: existing.data().seatedAt || Date.now()
          }, { merge: true })
        } else {
          // First time — create fresh player doc
          await setDoc(doc(playersRef, playerId), {
            name: displayName,
            joinedAt: Date.now(),
            isRevealed: false,
            hasDrawnThisTurn: false,
            melds: [],
            hand: [],
            tennalaDeclared: false,
            graceDone: false,
            chips: defaultChips,
            seatedAt: Date.now()
          })
        }
        hasSatDown.current = true
      } catch (e) {
        console.error('[Sit down error]', e)
        setBootError((e?.message || 'Failed to seat player.'))
      }
    }
    sitDown()
  }, [playerId, room, displayName, defaultChips])

  const saveName = async () => {
    try {
      localStorage.setItem('bj_name', nameDraft)
      await setDoc(doc(playersRef, playerId), { name: nameDraft }, { merge: true })
      setMessage('Name saved.')
      setTimeout(() => setMessage(''), 2000)
    } catch (e) {
      setMessage('Failed to save name: ' + (e?.message || e))
    }
  }

  const sitSeat = async () => {
    try {
      await setDoc(doc(playersRef, playerId), {
        name: nameDraft || displayName,
        chips: defaultChips,
        seatedAt: Date.now()
      }, { merge: true })
      setMessage('')
    } catch (e) {
      setMessage('Failed to sit: ' + (e?.message || e))
    }
  }

  const leaveSeat = async () => {
    try {
      await setDoc(doc(playersRef, playerId), {
        hand: [], melds: [], isRevealed: false, hasDrawnThisTurn: false,
        tennalaDeclared: false, graceDone: false, seatedAt: 0
      }, { merge: true })
      setMessage('')
    } catch (e) {
      setMessage('Failed to leave: ' + (e?.message || e))
    }
  }

  const resetTable = async () => {
    if (!window.confirm('Reset the entire table? This will clear all games, players, and hands.')) return
    try {
      // Delete all player docs
      const snap = await getDocs(playersRef)
      const deletes = []
      snap.forEach(d => deletes.push(deleteDoc(d.ref)))
      await Promise.all(deletes)
      // Reset room doc to idle state
      await setDoc(roomRef, {
        createdAt: Date.now(),
        ownerId: playerId,
        status: 'idle',
        tiplu: null,
        tipluPublicAtGrace: false,
        maxPlayers: 5,
        deckSeed: nanoid(10),
        deck: [],
        discard: [],
        turnIndex: 0
      })
      setHandSel([])
      hasSatDown.current = false
      setMessage('Table has been reset.')
      setTimeout(() => setMessage(''), 3000)
    } catch (e) {
      setMessage('Reset failed: ' + (e?.message || e))
    }
  }

  const meState = players.find(p => p.id === playerId)

  // ---------- AUTO-DEAL ----------
  useEffect(() => {
    if (!room) return
    const seated = players.filter(p => p.seatedAt > 0)
    if (seated.length < 1) return
    if (room.status === 'playing') return

    const autoStart = async () => {
      try {
        const deck = shuffle(buildThreeDecks(), room.deckSeed || nanoid(8))
        const { deck: remaining, hands, tiplu, discard } = dealInitial(deck, seated.length)
        await runTransaction(db, async (tx) => {
          tx.update(roomRef, {
            status: 'playing',
            tiplu,
            tipluPublicAtGrace: false,
            deck: remaining,
            discard,
            turnIndex: 0,
            startedAt: Date.now(),
          })
          seated.forEach((pl, idx) => {
            tx.update(doc(playersRef, pl.id), {
              hand: hands[idx],
              melds: [],
              isRevealed: false,
              hasDrawnThisTurn: false,
              tennalaDeclared: false,
              graceDone: false
            })
          })
        })
      } catch (e) {
        console.error('[Auto-start error]', e)
        setMessage('Failed to start round: ' + (e?.message || e))
      }
    }
    autoStart()
  }, [room, players])

  const newRound = async () => {
    try {
      const seated = players.filter(p => p.seatedAt > 0)
      if (seated.length < 1) { setMessage('Need at least 1 player to deal.'); return }
      const deck = shuffle(buildThreeDecks(), nanoid(8))
      const { deck: remaining, hands, tiplu, discard } = dealInitial(deck, seated.length)
      await runTransaction(db, async (tx) => {
        tx.update(roomRef, {
          status: 'playing',
          tiplu,
          tipluPublicAtGrace: false,
          deck: remaining,
          discard,
          turnIndex: 0,
          startedAt: Date.now(),
          deckSeed: nanoid(10),
        })
        seated.forEach((pl, idx) => {
          tx.update(doc(playersRef, pl.id), {
            hand: hands[idx],
            melds: [],
            isRevealed: false,
            hasDrawnThisTurn: false,
            tennalaDeclared: false,
            graceDone: false
          })
        })
      })
    } catch (e) {
      setMessage('Failed to start a new round: ' + (e?.message || e))
    }
  }

  // ---------- Turn helpers ----------
  const seatedPlayers = useMemo(() => players.filter(p => p.seatedAt > 0), [players])

  const currentTurnPlayerId = useMemo(() => {
    if (!room || !seatedPlayers.length) return null
    const idx = room.turnIndex % seatedPlayers.length
    return seatedPlayers[idx]?.id
  }, [room, seatedPlayers])

  const isMyTurn = room?.status === 'playing' && currentTurnPlayerId === playerId
  const tipluVisibleToMe = meState?.isRevealed || (room?.status === 'grace' && room?.tipluPublicAtGrace)

  const selectedCards = useMemo(() => {
    if (!meState) return []
    const byId = Object.fromEntries((meState.hand || []).map(c => [c.id, c]))
    return handSel.map(id => byId[id]).filter(Boolean)
  }, [handSel, meState])

  const toggleSel = useCallback((id) => {
    setHandSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }, [])
  const clearSel = useCallback(() => setHandSel([]), [])

  const drawFrom = async (source) => {
    if (!isMyTurn) return
    try {
      await runTransaction(db, async (tx) => {
        const r = (await tx.get(roomRef)).data()
        const meD = (await tx.get(doc(playersRef, playerId))).data()
        if (meD.hasDrawnThisTurn) { setMessage('Already drawn this turn.'); return }
        let card = null
        if (source === 'stock') {
          let deck = r.deck.slice()
          if (!deck.length) {
            // Reshuffle discard pile (keep top card)
            const disc = r.discard.slice()
            if (disc.length <= 1) throw new Error('No cards left to draw')
            const topDiscard = disc.pop()
            deck = shuffle(disc, nanoid(8))
            tx.update(roomRef, { discard: [topDiscard] })
          }
          card = deck.pop()
          tx.update(roomRef, { deck })
        } else {
          const discard = r.discard.slice()
          if (!discard.length) throw new Error('No discard to take')
          card = discard.pop()
          tx.update(roomRef, { discard })
        }
        tx.update(doc(playersRef, playerId), {
          hand: [...meD.hand, card],
          hasDrawnThisTurn: true
        })
      })
    } catch (e) {
      setMessage('Draw failed: ' + (e?.message || e))
    }
  }

  const discardCard = async (cardId) => {
    if (!isMyTurn && room?.status !== 'grace') return
    try {
      await runTransaction(db, async (tx) => {
        const r = (await tx.get(roomRef)).data()
        const meSnap = await tx.get(doc(playersRef, playerId))
        const meD = meSnap.data()
        if (r.status === 'playing' && !meD.hasDrawnThisTurn) throw new Error('Must draw before discarding')
        const idx = meD.hand.findIndex(c => c.id === cardId)
        if (idx === -1) throw new Error('Card not in hand')
        const newHand = meD.hand.slice()
        const [card] = newHand.splice(idx, 1)
        const newDiscard = r.discard.slice()
        newDiscard.push(card)
        const imOut = newHand.length === 0
        tx.update(roomRef, {
          discard: newDiscard,
          ...(imOut ? { status: 'grace', tipluPublicAtGrace: true, graceStartedAt: Date.now() } : {
            turnIndex: (r.turnIndex + 1) % seatedPlayers.length
          })
        })
        tx.update(doc(playersRef, playerId), {
          hand: newHand,
          hasDrawnThisTurn: false,
          ...(imOut ? { graceDone: true } : {})
        })
      })
      clearSel()
    } catch (e) {
      setMessage('Discard failed: ' + (e?.message || e))
    }
  }

  const layMeld = async (kind) => {
    if (!meState || !selectedCards.length) return
    const cards = selectedCards
    const revealed = meState.isRevealed
    const tiplu = room.tiplu
    const inGrace = room.status === 'grace'

    // Validate meld
    let ok = false
    if (kind === 'identical') ok = isIdenticalSet(cards)
    if (kind === 'rankset') ok = isRankSet(cards, revealed, tiplu)
    if (kind === 'sequence') ok = isSequence(cards, revealed, tiplu)
    if (!ok) { setMessage('Invalid meld for the current phase.'); return }

    // Grace constraints for unrevealed players
    if (inGrace && !revealed) {
      if (kind !== 'sequence') { setMessage('Unrevealed players can only lay sequences in Grace.'); return }
      if (cards.length < 4) { setMessage('Unrevealed players need sequences of 4+ in Grace.'); return }
    }

    try {
      await runTransaction(db, async (tx) => {
        const pRef = doc(playersRef, playerId)
        const meD = (await tx.get(pRef)).data()
        const remaining = meD.hand.filter(c => !cards.some(x => x.id === c.id))
        const meld = { id: nanoid(6), kind, cards }
        const newMelds = [...meD.melds, meld]
        let willReveal = meD.isRevealed
        if (!meD.isRevealed) {
          const credits = newMelds.reduce((s, m) => s + revealCreditsForMeld(m, false), 0)
          if (credits >= 3) willReveal = true
        }
        tx.update(pRef, { hand: remaining, melds: newMelds, isRevealed: willReveal })
      })
      clearSel()
      setMessage('')
    } catch (e) {
      setMessage('Lay meld failed: ' + (e?.message || e))
    }
  }

  const addToMeld = async (meldId) => {
    if (!meState || !selectedCards.length) return
    const cards = selectedCards
    const tiplu = room.tiplu
    try {
      await runTransaction(db, async (tx) => {
        const pRef = doc(playersRef, playerId)
        const meD = (await tx.get(pRef)).data()
        const meldIdx = meD.melds.findIndex(m => m.id === meldId)
        if (meldIdx === -1) throw new Error('Meld not found')
        const meld = meD.melds[meldIdx]
        const newCards = [...meld.cards, ...cards]
        // Validate extended meld
        let ok = false
        if (meld.kind === 'sequence') ok = isSequence(newCards, meD.isRevealed, tiplu)
        if (meld.kind === 'rankset') ok = isRankSet(newCards, meD.isRevealed, tiplu)
        // Identical sets are always exactly 3 - can't add to them
        if (!ok) throw new Error('Adding these cards creates an invalid meld')
        const newMelds = [...meD.melds]
        newMelds[meldIdx] = { ...meld, cards: newCards }
        const remaining = meD.hand.filter(c => !cards.some(x => x.id === c.id))
        tx.update(pRef, { hand: remaining, melds: newMelds })
      })
      clearSel()
      setMessage('')
    } catch (e) {
      setMessage('Add to meld: ' + (e?.message || e))
    }
  }

  const declareTennala = async () => {
    if (!meState || meState.tennalaDeclared) return
    if (meState.hasDrawnThisTurn) { setMessage('Tennala must be declared before your first pickup.'); return }
    const hand = meState.hand
    const byKey = {}
    for (const c of hand) {
      const k = `${c.rank}${c.suit}`
      byKey[k] = byKey[k] || []
      byKey[k].push(c)
    }
    const entry = Object.values(byKey).find(arr => arr.length >= 3)
    if (!entry) { setMessage('No Tennala found in your hand.'); return }
    const three = entry.slice(0, 3)
    try {
      await runTransaction(db, async (tx) => {
        const pRef = doc(playersRef, playerId)
        const meD = (await tx.get(pRef)).data()
        if (meD.tennalaDeclared) return
        const remaining = meD.hand.filter(c => !three.some(x => x.id === c.id))
        const meld = { id: nanoid(6), kind: 'identical', cards: three, tag: 'TENNALA' }
        const newMelds = [...meD.melds, meld]
        let willReveal = meD.isRevealed
        if (!meD.isRevealed) {
          const credits = newMelds.reduce((s, m) => s + revealCreditsForMeld(m, false), 0)
          if (credits >= 3) willReveal = true
        }
        tx.update(pRef, { hand: remaining, melds: newMelds, tennalaDeclared: true, isRevealed: willReveal })
        const others = players.filter(pl => pl.id !== playerId && pl.seatedAt > 0)
        for (const o of others) {
          const oRef = doc(playersRef, o.id)
          const oD = (await tx.get(oRef)).data()
          tx.update(oRef, { chips: (oD.chips || 0) - 10 })
        }
        const meNow = (await tx.get(pRef)).data()
        tx.update(pRef, { chips: (meNow.chips || 0) + (others.length * 10) })
      })
      setMessage('Tennala declared! Each opponent pays 10 chips.')
      setTimeout(() => setMessage(''), 3000)
    } catch (e) {
      setMessage('Tennala failed: ' + (e?.message || e))
    }
  }

  // Grace
  const inGrace = room?.status === 'grace'
  useEffect(() => {
    if (!inGrace) return
    const allDone = players.every(p => p.graceDone || (p.hand || []).length === 0)
    if (allDone && room.status === 'grace') {
      scoreRound()
    }
  }, [inGrace, players, room])

  const markGraceDone = async () => {
    await updateDoc(doc(playersRef, playerId), { graceDone: true })
  }

  const scoreRound = async () => {
    try {
      await runTransaction(db, async (tx) => {
        const r = (await tx.get(roomRef)).data()
        if (r.status !== 'grace') return
        const snaps = await Promise.all(seatedPlayers.map(pl => tx.get(doc(playersRef, pl.id))))
        const pStates = snaps.map(s => ({ id: s.id, ...s.data() }))
        const holdings = pStates.map(p => ({ id: p.id, name: p.name, holding: flattenHoldings(p) }))
        const side = sidePayments(holdings, r.tiplu)
        const balances = Object.fromEntries(pStates.map(p => [p.id, p.chips || 0]))
        for (const t of side) { balances[t.from] -= t.amount; balances[t.to] += t.amount }
        const winner = pStates.find(p => (p.hand || []).length === 0) || pStates[0]
        const deadwoodInfo = []
        for (const p of pStates) {
          if (p.id === winner.id) continue
          const points = deadwoodPointsForPlayer(p.hand || [], r.tiplu)
          const chips = chipsFromDeadwood(points)
          balances[p.id] -= chips
          balances[winner.id] += chips
          deadwoodInfo.push({ id: p.id, name: p.name, points, chips })
        }
        pStates.forEach(p => tx.update(doc(playersRef, p.id), { chips: balances[p.id] }))
        tx.update(roomRef, {
          status: 'scored',
          lastSummaryAt: Date.now(),
          lastSide: side,
          lastWinner: { id: winner.id, name: winner.name },
          lastDeadwood: deadwoodInfo
        })
      })
    } catch (e) {
      console.error('[Score error]', e)
    }
  }

  // ---------- Derived ----------
  const sortedHand = useMemo(() => {
    if (!meState?.hand) return []
    return sortHand(meState.hand, room?.tiplu, meState.isRevealed)
  }, [meState?.hand, room?.tiplu, meState?.isRevealed])

  const topDiscard = room?.discard?.length ? room.discard[room.discard.length - 1] : null
  const deckCount = room?.deck?.length || 0

  const currentTurnName = useMemo(() => {
    if (!currentTurnPlayerId) return null
    const p = players.find(pl => pl.id === currentTurnPlayerId)
    return p?.name || 'Unknown'
  }, [currentTurnPlayerId, players])

  // Tiplu info for display
  const tipluDisplay = useMemo(() => {
    if (!room?.tiplu) return null
    if (!tipluVisibleToMe) return null
    return room.tiplu
  }, [room?.tiplu, tipluVisibleToMe])

  // ===================== RENDER =====================
  return (
    <div className="container">
      {/* TOP BAR */}
      <div className="top-bar">
        <div className="top-bar-left">
          <span className="game-title">Blind Justice</span>
          <span className="pill">
            {room?.status === 'playing' ? 'In Play' :
             room?.status === 'grace' ? 'Grace Phase' :
             room?.status === 'scored' ? 'Round Over' : 'Lobby'}
          </span>
          {room?.status === 'playing' && currentTurnName && (
            <span className={`pill ${currentTurnPlayerId === playerId ? 'accent' : ''}`}>
              {currentTurnPlayerId === playerId ? 'Your Turn' : `${currentTurnName}'s Turn`}
            </span>
          )}
          {room?.status === 'grace' && <span className="pill accent">Tiplu is public</span>}
        </div>
        <div className="top-bar-right">
          {tipluDisplay && (
            <span className="pill accent" title="Tiplu card">
              Tiplu: {tipluDisplay.rank}{suitName(tipluDisplay.suit)}
            </span>
          )}
          {!tipluVisibleToMe && room?.tiplu && (
            <span className="pill">Tiplu: Hidden</span>
          )}
          {meState && (
            <span className="pill ok">
              {meState.chips ?? 250} chips
            </span>
          )}
          <button onClick={resetTable} className="btn-danger" style={{ padding: '6px 10px' }}>
            Reset Table
          </button>
          <button onClick={() => setShowSettings(!showSettings)} style={{ padding: '6px 10px' }}>
            {showSettings ? 'Close' : 'Settings'}
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="panel" style={{ marginBottom: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder="Your name" style={{ minWidth: 180 }} />
            <button onClick={saveName}>Save Name</button>
            <div className="divider" style={{ width: 1, height: 28, background: 'var(--border-strong)' }} />
            <button onClick={sitSeat}>Sit Down</button>
            <button onClick={leaveSeat} className="btn-danger">Leave Seat</button>
            <div className="divider" style={{ width: 1, height: 28, background: 'var(--border-strong)' }} />
            <span className="pill" title={playerId}>ID: {playerId.slice(0, 10)}...</span>
          </div>
        </div>
      )}

      {/* Boot messages */}
      {(bootMsg || bootError) && (
        <div className={`pill ${bootError ? 'danger' : ''}`} style={{ marginBottom: 8, display: 'block' }}>
          {bootError ? `Error: ${bootError}` : bootMsg}
          {bootError && (
            <button style={{ marginLeft: 8 }} onClick={async () => { try { await enableNetwork(db) } catch {} }}>
              Retry
            </button>
          )}
        </div>
      )}

      {/* THE TABLE */}
      <div className="tableWrap">
        <div className="table">
          {/* Player seats around the table */}
          {seatedPlayers.map((p, idx) => {
            const pos = seatPosition(idx, Math.max(seatedPlayers.length, 3))
            return (
              <PlayerSeat
                key={p.id}
                player={p}
                isMe={p.id === playerId}
                isCurrentTurn={room?.status === 'playing' && currentTurnPlayerId === p.id}
                position={pos}
              />
            )
          })}
          {/* Table center: deck + discard */}
          <div className="table-center">
            <div className="deck-area">
              <div
                className="playing-card card-back"
                onClick={() => drawFrom('stock')}
                style={{ cursor: isMyTurn && !meState?.hasDrawnThisTurn ? 'pointer' : 'default' }}
                role="button"
                aria-label="Draw from stock"
              />
              <span className="deck-label">{deckCount} left</span>
            </div>
            <div className="discard-area">
              {topDiscard ? (
                <PlayingCard
                  card={topDiscard}
                  onClick={() => drawFrom('discard')}
                  wild={tipluVisibleToMe && room?.tiplu && isWildCard(topDiscard, room.tiplu)}
                />
              ) : (
                <div className="playing-card" style={{ opacity: 0.3, cursor: 'default' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Empty</span>
                </div>
              )}
              <span className="discard-label">Discard</span>
            </div>
          </div>
        </div>
      </div>

      {/* ALL PLAYERS' MELDS */}
      <div className="panel" style={{ marginTop: 8 }}>
        <h3>Table Melds</h3>
        <div className="melds-section">
          {seatedPlayers.map(pl => {
            const credits = meldCreditsTotal(pl.melds)
            return (
              <div key={pl.id} className="player-melds-row">
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 100 }}>
                  <span className="player-melds-name" style={{ color: pl.id === playerId ? 'var(--accent)' : 'var(--ink)' }}>
                    {pl.name || pl.id.slice(0, 6)}
                  </span>
                  <span className="player-melds-credits">
                    {pl.isRevealed ? 'Revealed' : `${credits}/3 credits`}
                  </span>
                </div>
                <MeldsDisplay melds={pl.melds || []} tiplu={room?.tiplu} showWild={tipluVisibleToMe} />
              </div>
            )
          })}
          {!seatedPlayers.length && <span className="muted" style={{ fontSize: '0.85rem' }}>No players seated.</span>}
        </div>
      </div>

      {/* MY HAND */}
      <div className="panel" style={{ marginTop: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h3>Your Hand ({sortedHand.length})</h3>
          {handSel.length > 0 && (
            <div className="row" style={{ gap: 4 }}>
              <span className="pill accent">{handSel.length} selected</span>
              <button onClick={clearSel} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>Clear</button>
            </div>
          )}
        </div>
        <div className="hand-area">
          {sortedHand.map(c => (
            <PlayingCard
              key={c.id}
              card={c}
              selected={handSel.includes(c.id)}
              wild={tipluVisibleToMe && room?.tiplu && isWildCard(c, room.tiplu)}
              onClick={() => toggleSel(c.id)}
            />
          ))}
          {!sortedHand.length && <span className="muted" style={{ fontSize: '0.85rem' }}>No cards in hand.</span>}
        </div>
        {/* Add to existing meld buttons */}
        {meState?.melds?.length > 0 && handSel.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginRight: 6 }}>Add to meld:</span>
            {meState.melds.filter(m => m.kind !== 'identical').map(m => (
              <button key={m.id} onClick={() => addToMeld(m.id)} style={{ padding: '4px 8px', fontSize: '0.75rem', marginRight: 4 }}>
                {m.kind} ({m.cards.map(c => c.rank + suitName(c.suit)).join(', ')})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      {!!message && (
        <div className={`pill ${message.includes('failed') || message.includes('Invalid') || message.includes('Must') ? 'danger' : 'accent'}`} style={{ marginTop: 8, display: 'block' }}>
          {message}
        </div>
      )}

      {/* SCORED OVERLAY */}
      {room?.status === 'scored' && (
        <div className="score-overlay" style={{ marginTop: 12 }}>
          <h2 style={{ color: 'var(--accent)', marginBottom: 12 }}>Round Complete</h2>
          {room.lastWinner && (
            <p style={{ marginBottom: 12 }}>Winner: <strong style={{ color: 'var(--accent)' }}>{room.lastWinner.name}</strong></p>
          )}
          <table className="score-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Deadwood Pts</th>
                <th>Penalty Chips</th>
                <th>Total Chips</th>
              </tr>
            </thead>
            <tbody>
              {seatedPlayers.map(p => {
                const dw = (room.lastDeadwood || []).find(d => d.id === p.id)
                const isWinner = p.id === room.lastWinner?.id
                return (
                  <tr key={p.id} className={isWinner ? 'winner' : ''}>
                    <td>{p.name || p.id.slice(0, 6)} {isWinner ? '(Winner)' : ''}</td>
                    <td>{isWinner ? '-' : (dw?.points ?? '?')}</td>
                    <td>{isWinner ? '-' : (dw?.chips ?? '?')}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{p.chips ?? '?'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {room.lastSide?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3>Side Payments</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.8rem' }}>
                {room.lastSide.map((s, i) => {
                  const fromName = players.find(p => p.id === s.from)?.name || s.from.slice(0, 8)
                  const toName = players.find(p => p.id === s.to)?.name || s.to.slice(0, 8)
                  return (
                    <div key={i} style={{ color: 'var(--ink-secondary)' }}>
                      {fromName} pays {s.amount} to {toName} ({s.reason})
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ACTION BAR */}
      <div className="action-bar">
        {room?.status === 'playing' && (
          <>
            <button
              className="btn-primary"
              onClick={() => drawFrom('stock')}
              disabled={!isMyTurn || meState?.hasDrawnThisTurn}
            >
              Draw Stock
            </button>
            <button
              onClick={() => drawFrom('discard')}
              disabled={!isMyTurn || meState?.hasDrawnThisTurn}
            >
              Take Discard
            </button>
            <div className="divider" />
            <button onClick={() => layMeld('sequence')} disabled={handSel.length < 3}>
              Lay Sequence
            </button>
            <button onClick={() => layMeld('identical')} disabled={handSel.length !== 3}>
              Lay Identical
            </button>
            <button
              onClick={() => layMeld('rankset')}
              disabled={handSel.length < 3 || !meState?.isRevealed}
              title={!meState?.isRevealed ? 'Must reveal first' : ''}
            >
              Lay Rank Set
            </button>
            <div className="divider" />
            <button
              onClick={declareTennala}
              disabled={meState?.tennalaDeclared || meState?.hasDrawnThisTurn}
              title={meState?.tennalaDeclared ? 'Already declared' : 'Declare before drawing'}
            >
              Tennala
            </button>
            <div className="divider" />
            <button
              className="btn-danger"
              onClick={() => discardCard(handSel[0])}
              disabled={!isMyTurn || handSel.length !== 1 || !meState?.hasDrawnThisTurn}
            >
              Discard
            </button>
          </>
        )}
        {room?.status === 'grace' && (
          <>
            <span className="pill accent">Grace Phase</span>
            <button onClick={() => layMeld('sequence')} disabled={handSel.length < 3}>
              Lay Sequence {!meState?.isRevealed ? '(4+ required)' : ''}
            </button>
            {meState?.isRevealed && (
              <>
                <button onClick={() => layMeld('identical')} disabled={handSel.length !== 3}>
                  Lay Identical
                </button>
                <button onClick={() => layMeld('rankset')} disabled={handSel.length < 3}>
                  Lay Rank Set
                </button>
              </>
            )}
            <div className="divider" />
            <button className="btn-primary" onClick={markGraceDone}>
              Done
            </button>
          </>
        )}
        {room?.status === 'scored' && (
          <button className="btn-primary" onClick={newRound}>
            Deal New Round
          </button>
        )}
        {(!room || room?.status === 'idle') && (
          <button className="btn-primary" onClick={newRound}>
            Start Game
          </button>
        )}
      </div>
    </div>
  )
}
