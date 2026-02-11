import React, { useEffect, useMemo, useState } from 'react'
import { db, auth } from '../firebase'
import {
  collection, doc, onSnapshot, setDoc, updateDoc, getDoc, runTransaction
} from 'firebase/firestore'
import { nanoid } from 'nanoid'
import {
  buildThreeDecks, shuffle, dealInitial, isIdenticalSet, isRankSet, isSequence,
  isWildCard, revealCreditsForMeld, deadwoodPointsForPlayer, chipsFromDeadwood,
  sidePayments, flattenHoldings
} from './engine'
import { suitName, suitColour } from './types'

export default function MarriageRummyOnline({ roomId, displayName }) {
  const roomRef = doc(db, 'rooms', roomId)
  const playersRef = collection(roomRef, 'players')
  const me = auth.currentUser

  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [handSel, setHandSel] = useState([])     // selected card ids from my hand
  const [message, setMessage] = useState('')

  // Subscribe to room + players
  useEffect(() => {
    const unsubRoom = onSnapshot(roomRef, (s) => setRoom(s.exists() ? s.data() : null))
    const unsubPlayers = onSnapshot(playersRef, (qs) => {
      const arr = []
      qs.forEach(d => arr.push({ id: d.id, ...d.data() }))
      arr.sort((a,b)=> (a.joinedAt||0) - (b.joinedAt||0))
      setPlayers(arr)
    })
    return () => { unsubRoom(); unsubPlayers() }
  }, [roomId])

  // Join on mount if not present
  useEffect(() => {
    if (!me || !room) return
    const ensurePlayer = async () => {
      const myRef = doc(playersRef, me.uid)
      const snap = await getDoc(myRef)
      if (!snap.exists()) {
        await setDoc(myRef, {
          name: displayName,
          joinedAt: Date.now(),
          isReady: false,
          isRevealed: false,
          hasDrawnThisTurn: false,
          melds: [],
          hand: [],
          tennalaDeclared: false,
          graceDone: false,
          chips: 0
        })
      }
    }
    ensurePlayer()
  }, [me, roomId, room, displayName])

  const iAmOwner = room && me && room.ownerId === me.uid
  const meState = players.find(p => p.id === me?.uid)

  // ---------- Lobby actions ----------
  const toggleReady = async () => {
    const myRef = doc(playersRef, me.uid)
    await updateDoc(myRef, { isReady: !meState?.isReady })
  }

  const startGame = async () => {
    if (!iAmOwner) return
    const p = players
    if (p.length < 2 || p.length > 5) { setMessage('Need 2–5 players to start.'); return }
    const deck = shuffle(buildThreeDecks(), room.deckSeed || nanoid(8))
    const { deck: remaining, hands, tiplu, discard } = dealInitial(deck, p.length)
    await runTransaction(db, async (tx) => {
      const rDoc = await tx.get(roomRef)
      if (!rDoc.exists()) throw new Error('Room missing')
      tx.update(roomRef, {
        status: 'playing',
        tiplu,
        tipluPublicAtGrace: false,
        deck: remaining,
        discard,
        turnIndex: 0,
        startedAt: Date.now(),
      })
      p.forEach((pl, idx) => {
        const ref = doc(playersRef, pl.id)
        tx.update(ref, {
          hand: hands[idx],
          melds: [],
          isRevealed: false,
          hasDrawnThisTurn: false,
          tennalaDeclared: false,
          graceDone: false
        })
      })
    })
  }

  // ---------- Helpers ----------
  const currentTurnPlayerId = useMemo(() => {
    if (!room || !players.length) return null
    const idx = room.turnIndex % players.length
    return players[idx].id
  }, [room, players])

  const isMyTurn = room?.status==='playing' && currentTurnPlayerId === me?.uid
  const tipluVisibleToAll = room?.status === 'grace' && room?.tipluPublicAtGrace

  const selectedCards = useMemo(() => {
    if (!meState) return []
    const byId = Object.fromEntries(meState.hand.map(c => [c.id, c]))
    return handSel.map(id => byId[id]).filter(Boolean)
  }, [handSel, meState])

  const addToSel = (id) => setHandSel(prev => prev.includes(id) ? prev : [...prev, id])
  const removeFromSel = (id) => setHandSel(prev => prev.filter(x => x!==id))
  const clearSel = () => setHandSel([])

  // ---------- Turn actions ----------
  const drawFrom = async (source) => {
    if (!isMyTurn) return
    await runTransaction(db, async (tx) => {
      const rDoc = await tx.get(roomRef)
      const pDoc = await tx.get(doc(playersRef, me.uid))
      const r = rDoc.data(), meD = pDoc.data()
      if (meD.hasDrawnThisTurn) return
      let card = null
      if (source==='stock') {
        const deck = r.deck.slice()
        if (!deck.length) throw new Error('Deck empty (very rare)')
        card = deck.pop()
        tx.update(roomRef, { deck })
      } else {
        const discard = r.discard.slice()
        if (!discard.length) throw new Error('No discard to take')
        card = discard.pop()
        tx.update(roomRef, { discard })
      }
      tx.update(doc(playersRef, me.uid), {
        hand: [...meD.hand, card],
        hasDrawnThisTurn: true
      })
    })
  }

  const discard = async (cardId) => {
    if (!isMyTurn) return
    await runTransaction(db, async (tx) => {
      const rDoc = await tx.get(roomRef)
      const pDoc = await tx.get(doc(playersRef, me.uid))
      const r = rDoc.data(), meD = pDoc.data()
      if (!meD.hasDrawnThisTurn) throw new Error('Must draw before discarding')
      const idx = meD.hand.findIndex(c => c.id === cardId)
      const [card] = meD.hand.splice(idx,1)
      const newDiscard = r.discard.slice()
      newDiscard.push(card)
      const imOut = meD.hand.length===0
      tx.update(roomRef, {
        discard: newDiscard,
        ...(imOut ? { status: 'grace', tipluPublicAtGrace: true, graceStartedAt: Date.now() } : {
          turnIndex: (r.turnIndex + 1) % players.length
        })
      })
      tx.update(doc(playersRef, me.uid), {
        hand: meD.hand,
        hasDrawnThisTurn: false,
        ...(imOut ? { graceDone: true } : {})
      })
    })
    clearSel()
  }

  const layMeld = async (kind) => {
    if (!meState || !selectedCards.length) return
    const cards = selectedCards
    const revealed = meState.isRevealed
    const tiplu = room.tiplu
    let ok = false
    if (kind==='identical') ok = isIdenticalSet(cards)
    if (kind==='rankset') ok = isRankSet(cards, revealed, tiplu)
    if (kind==='sequence') ok = isSequence(cards, revealed, tiplu)
    if (!ok) { setMessage('Invalid meld for the current phase.'); return }
    await runTransaction(db, async (tx) => {
      const pRef = doc(playersRef, me.uid)
      const pSnap = await tx.get(pRef)
      const meD = pSnap.data()
      // remove from hand
      const remaining = meD.hand.filter(c => !cards.some(x => x.id===c.id))
      const meld = { id: nanoid(6), kind, cards }
      const newMelds = [...meD.melds, meld]

      // compute reveal credits with R1 Option A (floor(len/3) for sequences; identical=1; rankset=1 only post-reveal)
      let willReveal = meD.isRevealed
      if (!meD.isRevealed) {
        const credits = newMelds.reduce((s, m) => s + revealCreditsForMeld(m, false, tiplu), 0)
        if (credits >= 3) willReveal = true
      }

      tx.update(pRef, {
        hand: remaining,
        melds: newMelds,
        isRevealed: willReveal
      })
    })
    clearSel()
  }

  const declareTennala = async () => {
    if (!meState || meState.tennalaDeclared) return
    // Must be before your first pickup in the hand; we assume if you haven't drawn yet this round.
    const hand = meState.hand
    const byKey = {}
    for (const c of hand) {
      const k = `${c.rank}${c.suit}`
      byKey[k] = byKey[k] || []
      byKey[k].push(c)
    }
    const entry = Object.values(byKey).find(arr => arr.length >= 3)
    if (!entry) { setMessage('You don’t hold a Tennala.'); return }
    const three = entry.slice(0,3)
    await runTransaction(db, async (tx) => {
      const pRef = doc(playersRef, me.uid)
      const meD = (await tx.get(pRef)).data()
      if (meD.tennalaDeclared) return
      const remaining = meD.hand.filter(c => !three.some(x => x.id===c.id))
      const meld = { id: nanoid(6), kind:'identical', cards: three, tag:'TENNALA' }
      tx.update(pRef, {
        hand: remaining,
        melds: [...meD.melds, meld],
        tennalaDeclared: true
      })
      // immediate chip side-payments: 10 from each other player to me
      const others = players.filter(pl => pl.id !== me.uid)
      for (const o of others) {
        const oRef = doc(playersRef, o.id)
        const oD = (await tx.get(oRef)).data()
        tx.update(oRef, { chips: (oD.chips||0) - 10 })
      }
      const meSnap = await tx.get(pRef)
      const meNow = meSnap.data()
      tx.update(pRef, { chips: (meNow.chips||0) + (others.length * 10) })
    })
  }

  // ---------- Grace handling ----------
  const inGrace = room?.status === 'grace'

  const markGraceDone = async () => {
    const pRef = doc(playersRef, me.uid)
    await updateDoc(pRef, { graceDone: true })
  }

  useEffect(() => {
    if (!inGrace) return
    const allDone = players.every(p => p.graceDone || p.hand.length===0)
    if (allDone && iAmOwner && room.status==='grace') {
      scoreRound()
    }
  }, [inGrace, players, room])

  const scoreRound = async () => {
    await runTransaction(db, async (tx) => {
      const rDoc = await tx.get(roomRef)
      const r = rDoc.data()
      if (r.status !== 'grace') return

      // Collect latest player states
      const snapPlayers = await Promise.all(players.map(pl => tx.get(doc(playersRef, pl.id))))
      const pStates = snapPlayers.map(s => ({ id: s.id, ...s.data() }))

      // Side transfers (holders include melded + in-hand)
      const holdings = pStates.map(p => ({ id: p.id, name: p.name, holding: flattenHoldings(p) }))
      const side = sidePayments(holdings, r.tiplu)

      // Ledger balances
      const balances = Object.fromEntries(pStates.map(p => [p.id, p.chips || 0]))
      for (const t of side) {
        balances[t.from] -= t.amount
        balances[t.to]   += t.amount
      }

      // Winner = the one who went out (empty hand)
      const winner = pStates.find(p => p.hand.length===0) || pStates[0]

      // Hand penalties to the winner
      for (const p of pStates) {
        if (p.id === winner.id) continue
        const points = deadwoodPointsForPlayer(p.hand, r.tiplu) // wilds=0 for all at end
        const chips = chipsFromDeadwood(points)
        balances[p.id] -= chips
        balances[winner.id] += chips
      }

      // Persist chip balances + summary
      pStates.forEach(p => tx.update(doc(playersRef, p.id), { chips: balances[p.id] }))
      tx.update(roomRef, { status: 'scored', lastSummaryAt: Date.now(), lastSide: side })
    })
  }

  // ---------- UI ----------
  if (!room) {
    return <div className="container"><p>Loading room…</p></div>
  }

  if (room.status === 'lobby') {
    return (
      <div className="container">
        <h2>Room: {roomId}</h2>
        <p className="muted">Share this code with others to join. Max 5 players.</p>
        <div className="panel">
          {players.map(p => (
            <div key={p.id} className="row" style={{justifyContent:'space-between'}}>
              <div>{p.name || p.id.slice(0,6)}</div>
              <div className={`pill ${p.isReady?'success':''}`}>{p.isReady?'Ready':'Not ready'}</div>
            </div>
          ))}
        </div>
        <div className="row" style={{marginTop:12}}>
          <button onClick={toggleReady}>{meState?.isReady ? 'Unready' : 'Ready up'}</button>
          {iAmOwner && <button onClick={startGame} disabled={!players.every(p => p.isReady)}>Start game</button>}
        </div>
      </div>
    )
  }

  if (room.status === 'scored') {
    return (
      <div className="container">
        <h2>Round summary</h2>
        <Summary room={room} players={players} />
        <div className="row" style={{marginTop:16}}>
          <button onClick={()=>updateDoc(roomRef, { status:'lobby', tiplu:null, tipluPublicAtGrace:false, deck:[], discard:[], turnIndex:0 })}>
            Back to lobby (same room)
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <Header
        room={room}
        players={players}
        meState={meState}
        currentTurnPlayerId={room.status==='playing' ? players[(room.turnIndex||0)%players.length]?.id : null}
        tipluVisibleToAll={tipluVisibleToAll}
      />

      <AllMeldsBoard players={players} tiplu={room.tiplu} />

      <MyHand
        meState={meState}
        tiplu={room.tiplu}
        showWild={meState?.isRevealed || tipluVisibleToAll}
        handSel={handSel}
        addToSel={addToSel}
        removeFromSel={removeFromSel}
      />

      <div className="panel" style={{marginTop:12}}>
        <h3>My melds</h3>
        <Melds melds={meState?.melds || []} tiplu={room.tiplu} />
      </div>

      {message && <p className="pill danger">{message}</p>}

      <div className="fixedbar">
        {room.status==='playing' && (
          <>
            <button onClick={()=>drawFrom('stock')} disabled={!isMyTurn}>Draw from deck</button>
            <button onClick={()=>drawFrom('discard')} disabled={!isMyTurn}>Take top discard</button>
            <button onClick={()=>layMeld('sequence')}>Lay Sequence</button>
            <button onClick={()=>layMeld('identical')}>Lay Identical (3)</button>
            <button onClick={()=>layMeld('rankset')} disabled={!meState?.isRevealed}>Lay Rank Set</button>
            <button onClick={declareTennala} disabled={meState?.tennalaDeclared}>Declare Tennala</button>
            <button onClick={()=>discard(handSel[0])} disabled={!isMyTurn || handSel.length!==1}>Discard selected</button>
            <button onClick={()=>setHandSel([])}>Clear selection</button>
          </>
        )}
        {room.status==='grace' && (
          <>
            <span className="pill">Grace phase — Tiplu is public</span>
            <button onClick={()=>layMeld('sequence')}>Lay Sequence (≥4 if unrevealed)</button>
            <button onClick={markGraceDone} className="success">Done</button>
            <button onClick={()=>setHandSel([])}>Clear selection</button>
          </>
        )}
      </div>
    </div>
  )
}

function Header({ room, players, meState, currentTurnPlayerId, tipluVisibleToAll }) {
  const tip = room.tiplu
  const tipluLabel = tip ? `${tip.rank}${suitName(tip.suit)}` : '—'
  const turnName = players.find(p=>p.id===currentTurnPlayerId)?.name || '—'
  return (
    <div className="panel">
      <div className="row" style={{justifyContent:'space-between', alignItems:'flex-start'}}>
        <div className="row">
          <div className="pill">Status: {room.status}</div>
          {room.status==='playing' && <div className="pill">Turn: {turnName}</div>}
          <div className="pill">Tiplu: {(meState?.isRevealed || tipluVisibleToAll) ? tipluLabel : 'Hidden'}</div>
        </div>
        <div className="row">
          {players.map(p => (
            <div key={p.id} className="pill" title={`Chips: ${p.chips||0}`}>
              {p.name} — {p.isRevealed ? 'Revealed' : 'Blind'} {room.status==='grace' && (p.graceDone ? '✓' : '')}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Everyone can see all laid melds (by player)
function AllMeldsBoard({ players, tiplu }) {
  return (
    <div className="panel">
      <h3>Table melds</h3>
      {players.map(pl => (
        <div key={pl.id} className="panel" style={{marginTop:8}}>
          <div className="row" style={{justifyContent:'space-between'}}>
            <strong>{pl.name}</strong>
            <span className="muted">Melds: {pl.melds?.length || 0}</span>
          </div>
          <Melds melds={pl.melds || []} tiplu={tiplu} />
        </div>
      ))}
    </div>
  )
}

function MyHand({ meState, tiplu, showWild, handSel, addToSel, removeFromSel }) {
  const hand = meState?.hand || []
  return (
    <div className="panel">
      <h3>My hand ({hand.length})</h3>
      <div className="row">
        {hand.map(c => {
          const isSel = handSel.includes(c.id)
          const wild = showWild && tiplu && isWildCard(c, tiplu)
          return (
            <div key={c.id}
                 className={`card ${wild?'wild':''}`}
                 onClick={()=> isSel ? removeFromSel(c.id) : addToSel(c.id)}
                 style={{ borderColor: isSel ? '#0078D4' : '#bbb' }}>
              <span style={{ color: suitColour(c.suit), fontWeight: 600 }}>{c.rank}{suitName(c.suit)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Melds({ melds, tiplu }) {
  if (!melds.length) return <div className="muted">No melds yet.</div>
  return (
    <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))'}}>
      {melds.map(m => (
        <div key={m.id} className="meld">
          <div className="muted">{m.kind.toUpperCase()} {m.tag ? `(${m.tag})` : ''}</div>
          <div className="row">
            {m.cards.map(c => (
              <div key={c.id} className={`card ${tiplu && isWildCard(c, tiplu)?'wild':''}`}>
                <span style={{ color: suitColour(c.suit), fontWeight: 600 }}>{c.rank}{suitName(c.suit)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Summary({ room, players }) {
  const side = room.lastSummaryAt ? (room.lastSide || []) : []
  // Net totals per player for display (under the hood we already applied atomic transfers)
  const nets = {}
  for (const p of players) nets[p.id] = 0
  for (const t of side) {
    nets[t.from] -= t.amount
    nets[t.to]   += t.amount
  }
  return (
    <>
      <h3>Side transfers (netted)</h3>
      <div className="panel">
        {players.map(p => (
          <div key={p.id} className="row" style={{justifyContent:'space-between'}}>
            <div>{p.name}</div>
            <div>{nets[p.id]>=0?'+':''}{nets[p.id]} chips</div>
          </div>
        ))}
      </div>
      <details style={{marginTop:8}}>
        <summary>Show atomic transfers & reasons</summary>
        <ul>
          {side.map((t, i) => (
            <li key={i}>
              {players.find(p=>p.id===t.from)?.name} → {players.find(p=>p.id===t.to)?.name}: {t.amount} ({t.reason})
            </li>
          ))}
        </ul>
      </details>
      <h3 style={{marginTop:16}}>Balances</h3>
      <div className="panel">
        {players.map(p => (
          <div key={p.id} className="row" style={{justifyContent:'space-between'}}>
            <div>{p.name}</div>
            <div>{p.chips || 0} chips</div>
          </div>
        ))}
      </div>
    </>
  )
}
