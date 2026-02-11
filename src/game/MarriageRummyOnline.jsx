// src/game/MarriageRummyOnline.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../firebase'
import {
  collection, doc, onSnapshot, setDoc, updateDoc, getDoc, runTransaction, enableNetwork
} from 'firebase/firestore'
import { nanoid } from 'nanoid'
import {
  buildThreeDecks, shuffle, dealInitial, isIdenticalSet, isRankSet, isSequence,
  isWildCard, revealCreditsForMeld, deadwoodPointsForPlayer, chipsFromDeadwood,
  sidePayments, flattenHoldings
} from './engine'
import { suitName, suitColour } from './types'

// ---------- Helpers for seat geometry ----------
function seatPosition(index, total) {
  // Return top/left (percent) for player i around a circle
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2
  const r = 42 // radius offset (% of half-table)
  const cx = 50, cy = 50
  // scale to fit the circle nicely
  const x = cx + 35 * Math.cos(angle)
  const y = cy + 35 * Math.sin(angle)
  return { top: `${y}%`, left: `${x}%` }
}

export default function MarriageRummyOnline({ roomId, displayName, defaultChips = 250, playerId }) {
  const roomRef = doc(db, 'rooms', roomId)
  const playersRef = collection(roomRef, 'players')

  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [handSel, setHandSel] = useState([])
  const [message, setMessage] = useState('')
  const [bootMsg, setBootMsg] = useState('Connecting to table…')
  const [bootError, setBootError] = useState('')
  const [nameDraft, setNameDraft] = useState(displayName)

  const creatingRoom = useRef(false)

  useEffect(() => setNameDraft(displayName), [displayName])

  // Keep Firestore online when browser regains network
  useEffect(() => {
    const onUp = async () => { try { await enableNetwork(db) } catch {} }
    window.addEventListener('online', onUp)
    return () => window.removeEventListener('online', onUp)
  }, [])

  // Create/subscribe to room
  useEffect(() => {
    setBootMsg('Connecting to table…')
    setBootError('')

    const unsub = onSnapshot(
      roomRef,
      async (snap) => {
        if (!snap.exists()) {
          if (!creatingRoom.current) {
            creatingRoom.current = true
            setBootMsg('Table not found — creating it now…')
            try {
              await setDoc(roomRef, {
                createdAt: Date.now(),
                ownerId: playerId,          // not used, but kept
                status: 'idle',             // idle | playing | grace | scored
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
                  ? ' (hint: we use HTTP long‑polling and queue writes; refresh or check ad‑block/firewall)'
                  : '')
              )
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
        const msg = err?.message || 'Failed to read table document.'
        const hint = msg.includes('offline')
          ? ' (hint: using HTTP long‑polling; refresh or check firewall/ad‑block if it persists)'
          : ''
        setBootError(msg + hint)
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
        // show seated first (seatedAt > 0), then others by joined time
        arr.sort((a,b)=> (b.seatedAt>0) - (a.seatedAt>0) || (a.joinedAt||0) - (b.joinedAt||0))
        setPlayers(arr)
      },
      (err) => {
        console.error('[Players snapshot error]', err)
        setBootError(err?.message || 'Failed to read players collection.')
      }
    )
    return () => unsub()
  }, [roomId])

  // Sit down (write without reading; resilient even if SDK is briefly "offline")
  useEffect(() => {
    if (!playerId || !room) return
    const sitDown = async () => {
      try {
        const myRef = doc(playersRef, playerId)
        await setDoc(myRef, {
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
        }, { merge: true })
      } catch (e) {
        console.error('[Sit down error]', e)
        setBootError((e?.message || 'Failed to seat player.') +
          (String(e?.message || '').includes('offline')
            ? ' (hint: queued locally; will sync when network is available)'
            : '')
        )
      }
    }
    sitDown()
  }, [playerId, room, displayName, defaultChips])

  // Change name
  const saveName = async () => {
    try {
      localStorage.setItem('bj_name', nameDraft)
      await setDoc(doc(playersRef, playerId), { name: nameDraft }, { merge: true })
    } catch (e) {
      setMessage('Failed to save name: ' + (e?.message || e))
    }
  }

  // Sit/Leave controls (useful to force distinct seats in two windows)
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
        hand: [], melds: [], isRevealed:false, hasDrawnThisTurn:false,
        tennalaDeclared:false, graceDone:false, seatedAt:0
      }, { merge: true })
      setMessage('')
    } catch (e) {
      setMessage('Failed to leave: ' + (e?.message || e))
    }
  }

  const meState = players.find(p => p.id === playerId)

  // ---------- AUTO‑DEAL ----------
  useEffect(() => {
    if (!room) return
    // Change "1" to "2" if you want to auto‑deal only when at least two players are seated.
    const seated = players.filter(p => p.seatedAt > 0)
    if (seated.length < 1) return
    if (room.status === 'playing') return

    const autoStart = async () => {
      try {
        const p = seated
        const deck = shuffle(buildThreeDecks(), room.deckSeed || nanoid(8))
        const { deck: remaining, hands, tiplu, discard } = dealInitial(deck, p.length)
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
          p.forEach((pl, idx) => {
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

  // New round — redeal to currently seated players
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
  const currentTurnPlayerId = useMemo(() => {
    if (!room || !players.length) return null
    const idx = room.turnIndex % players.length
    return players[idx].id
  }, [room, players])
  const isMyTurn = room?.status==='playing' && currentTurnPlayerId === playerId
  const tipluVisibleToAll = room?.status === 'grace' && room?.tipluPublicAtGrace

  const selectedCards = useMemo(() => {
    if (!meState) return []
    const byId = Object.fromEntries(meState.hand.map(c => [c.id, c]))
    return handSel.map(id => byId[id]).filter(Boolean)
  }, [handSel, meState])

  const addToSel = (id) => setHandSel(prev => prev.includes(id) ? prev : [...prev, id])
  const removeFromSel = (id) => setHandSel(prev => prev.filter(x => x!==id))
  const clearSel = () => setHandSel([])

  const drawFrom = async (source) => {
    if (!isMyTurn) return
    await runTransaction(db, async (tx) => {
      const r = (await tx.get(roomRef)).data()
      const meD = (await tx.get(doc(playersRef, playerId))).data()
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
      tx.update(doc(playersRef, playerId), {
        hand: [...meD.hand, card],
        hasDrawnThisTurn: true
      })
    })
  }

  const discard = async (cardId) => {
    if (!isMyTurn) return
    await runTransaction(db, async (tx) => {
      const r = (await tx.get(roomRef)).data()
      const meSnap = await tx.get(doc(playersRef, playerId))
      const meD = meSnap.data()
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
      tx.update(doc(playersRef, playerId), {
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
      const pRef = doc(playersRef, playerId)
      const meD = (await tx.get(pRef)).data()
      const remaining = meD.hand.filter(c => !cards.some(x => x.id===c.id))
      const meld = { id: nanoid(6), kind, cards }
      const newMelds = [...meD.melds, meld]
      let willReveal = meD.isRevealed
      if (!meD.isRevealed) {
        const credits = newMelds.reduce((s, m) => s + revealCreditsForMeld(m, false, tiplu), 0)
        if (credits >= 3) willReveal = true
      }
      tx.update(pRef, { hand: remaining, melds: newMelds, isRevealed: willReveal })
    })
    clearSel()
  }

  const declareTennala = async () => {
    if (!meState || meState.tennalaDeclared) return
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
      const pRef = doc(playersRef, playerId)
      const meD = (await tx.get(pRef)).data()
      if (meD.tennalaDeclared) return
      const remaining = meD.hand.filter(c => !three.some(x => x.id===c.id))
      const meld = { id: nanoid(6), kind:'identical', cards: three, tag:'TENNALA' }
      tx.update(pRef, { hand: remaining, melds: [...meD.melds, meld], tennalaDeclared: true })
      const others = players.filter(pl => pl.id !== playerId)
      for (const o of others) {
        const oRef = doc(playersRef, o.id)
        const oD = (await tx.get(oRef)).data()
        tx.update(oRef, { chips: (oD.chips||0) - 10 })
      }
      const meNow = (await tx.get(pRef)).data()
      tx.update(pRef, { chips: (meNow.chips||0) + (others.length * 10) })
    })
  }

  // Grace
  const inGrace = room?.status === 'grace'
  useEffect(() => {
    if (!inGrace) return
    const allDone = players.every(p => p.graceDone || p.hand.length===0)
    if (allDone && room.status==='grace') {
      scoreRound()
    }
  }, [inGrace, players, room])

  const markGraceDone = async () => {
    await updateDoc(doc(playersRef, playerId), { graceDone: true })
  }

  const scoreRound = async () => {
    await runTransaction(db, async (tx) => {
      const r = (await tx.get(roomRef)).data()
      if (r.status !== 'grace') return
      const snaps = await Promise.all(players.map(pl => tx.get(doc(playersRef, pl.id))))
      const pStates = snaps.map(s => ({ id: s.id, ...s.data() }))
      const holdings = pStates.map(p => ({ id: p.id, name: p.name, holding: flattenHoldings(p) }))
      const side = sidePayments(holdings, r.tiplu)
      const balances = Object.fromEntries(pStates.map(p => [p.id, p.chips || 0]))
      for (const t of side) { balances[t.from] -= t.amount; balances[t.to] += t.amount }
      const winner = pStates.find(p => p.hand.length===0) || pStates[0]
      for (const p of pStates) {
        if (p.id === winner.id) continue
        const points = deadwoodPointsForPlayer(p.hand, r.tiplu)
        const chips = chipsFromDeadwood(points)
        balances[p.id] -= chips
        balances[winner.id] += chips
      }
      pStates.forEach(p => tx.update(doc(playersRef, p.id), { chips: balances[p.id] }))
      tx.update(roomRef, { status: 'scored', lastSummaryAt: Date.now(), lastSide: side })
    })
  }

  // ---------- UI ----------
  return (
    <div className="container">
      <h1>Blind Justice (Online)</h1>

      {(bootMsg || bootError) && (
        <p className={`pill ${bootError ? 'danger' : 'muted'}`}>
          {bootError ? `Boot error: ${bootError}` : bootMsg}
          {bootError && (
            <button style={{ marginLeft: 8 }} onClick={async () => { try { await enableNetwork(db) } catch {} }}>
              Retry
            </button>
          )}
        </p>
      )}

      {/* Controls: name, new round, seat ops */}
      <div className="row" style={{marginBottom: 8}}>
        <input value={nameDraft} onChange={e=>setNameDraft(e.target.value)} placeholder="Your name" style={{minWidth: 220}} />
        <button onClick={saveName}>Save name</button>
        <button onClick={newRound}>New round</button>
        <span className="pill" title={playerId}>ID: {playerId.slice(0,8)}…</span>
        <button onClick={sitSeat}>Sit</button>
        <button onClick={leaveSeat}>Leave</button>
        <span className="pill">Status: {room?.status || '—'}</span>
        <span className="pill">Tiplu: { (room?.tiplu && (meState?.isRevealed || room?.tipluPublicAtGrace)) ? `${room.tiplu.rank}${suitName(room.tiplu.suit)}` : 'Hidden' }</span>
        {meState && (
          <span className="pill">{meState.name || 'Me'} — {meState.isRevealed ? 'Revealed' : 'Blind'}</span>
        )}
      </div>

      {/* The table view */}
      <div className="tableWrap">
        <div className="table">
          {players.map((p, idx) => {
            const pos = seatPosition(idx, Math.max(players.length, 4))
            const isMe = p.id === playerId
            const handCount = (p.hand || []).length
            return (
              <div key={p.id} className={`seat ${isMe?'me':''}`} style={{ left: pos.left, top: pos.top }}>
                <div className="avatar" title={p.name || p.id.slice(0,6)}>{(p.name||'?').slice(0,2).toUpperCase()}</div>
                <div className="tag">
                  <div className="name">{p.name || p.id.slice(0,6)}</div>
                  <div className="meta muted">
                    Chips: {p.chips ?? 250} • {p.isRevealed ? 'Revealed' : 'Blind'} • Hand: {handCount}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Table melds */}
      <div className="panel" style={{marginTop:12}}>
        <h3>Table melds</h3>
        {!players.length && <div className="muted">No players seated.</div>}
        {players.map(pl => (
          <div key={pl.id} className="panel" style={{marginTop:8}}>
            <div className="row" style={{justifyContent:'space-between'}}>
              <strong>{pl.name || pl.id.slice(0,6)}</strong>
              <span className="muted">Melds: {pl.melds?.length || 0}</span>
            </div>
            <Melds melds={pl.melds || []} tiplu={room?.tiplu} />
          </div>
        ))}
      </div>

      {/* My hand + melds */}
      <div className="panel" style={{marginTop:12}}>
        <h3>My hand ({(meState?.hand||[]).length})</h3>
        <MyHand
          meState={meState}
          tiplu={room?.tiplu}
          showWild={meState?.isRevealed || tipluVisibleToAll}
          handSel={handSel}
          addToSel={addToSel}
          removeFromSel={removeFromSel}
        />
      </div>

      <div className="panel" style={{marginTop:12}}>
        <h3>My melds</h3>
        <Melds melds={meState?.melds || []} tiplu={room?.tiplu} />
      </div>

      {!!message && <p className="pill danger" style={{marginTop:8}}>{message}</p>}

      <div className="fixedbar">
        {room?.status==='playing' && (
          <>
            <button onClick={()=>drawFrom('stock')} disabled={!isMyTurn}>Draw from deck</button>
            <button onClick={()=>drawFrom('discard')} disabled={!isMyTurn}>Take top discard</button>
            <button onClick={()=>layMeld('sequence')}>Lay Sequence</button>
            <button onClick={()=>layMeld('identical')}>Lay Identical (3)</button>
            <button onClick={()=>layMeld('rankset')} disabled={!meState?.isRevealed}>Lay Rank Set</button>
            <button onClick={declareTennala} disabled={meState?.tennalaDeclared}>Declare Tennala</button>
            <button onClick={()=>discard(handSel[0])} disabled={!isMyTurn || handSel.length!==1}>Discard selected</button>
            <button onClick={clearSel}>Clear selection</button>
          </>
        )}
        {room?.status==='grace' && (
          <>
            <span className="pill">Grace phase — Tiplu is public</span>
            <button onClick={()=>layMeld('sequence')}>Lay Sequence (≥4 if unrevealed)</button>
            <button onClick={()=>updateDoc(doc(playersRef, playerId), { graceDone: true })} className="pill">Done</button>
            <button onClick={clearSel}>Clear selection</button>
          </>
        )}
        {room?.status==='scored' && (
          <>
            <button onClick={newRound}>New round</button>
          </>
        )}
      </div>
    </div>
  )
}

function MyHand({ meState, tiplu, showWild, handSel, addToSel, removeFromSel }) {
  const hand = meState?.hand || []
  return (
    <div className="row">
      {hand.map(c => {
        const isSel = handSel.includes(c.id)
        const wild = showWild && tiplu && isWildCard(c, tiplu)
        return (
          <div key={c.id}
               className={`card ${wild?'wild':''}`}
               onClick={()=> isSel ? removeFromSel(c.id) : addToSel(c.id)}
               style={{ borderColor: isSel ? 'var(--accent)' : '#00000020' }}>
            <span style={{ color: suitColour(c.suit), fontWeight: 600 }}>{c.rank}{suitName(c.suit)}</span>
          </div>
        )
      })}
      {!hand.length && <span className="muted">No cards in hand.</span>}
    </div>
  )
}

function Melds({ melds, tiplu }) {
  if (!melds.length) return <div className="muted">No melds yet.</div>
  return (
    <div className="row" style={{flexWrap:'wrap'}}>
      {melds.map(m => (
        <div key={m.id} className="panel" style={{marginRight:8}}>
          <div className="muted" style={{marginBottom:6}}>{m.kind.toUpperCase()} {m.tag ? `(${m.tag})` : ''}</div>
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