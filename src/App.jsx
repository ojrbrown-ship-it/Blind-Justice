import React, { useEffect, useState } from 'react'
import { db } from './firebase'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'
import { nanoid } from 'nanoid'

const PERSISTENT_ROOM_ID = 'TABLE-1'
const DEFAULT_STACK = 250

export default function App() {
  const [ready, setReady] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let name = localStorage.getItem('bj_name')
    if (!name) { name = `Player-${nanoid(4)}`; localStorage.setItem('bj_name', name) }
    setDisplayName(name)

    let pid = localStorage.getItem('bj_pid')
    if (!pid) { pid = `pid_${nanoid(10)}`; localStorage.setItem('bj_pid', pid) }
    setPlayerId(pid)
  }, [])

  useEffect(() => {
    (async () => {
      if (!playerId) return
      try {
        const roomRef = doc(db, 'rooms', PERSISTENT_ROOM_ID)
        const snap = await getDoc(roomRef)
        if (!snap.exists()) {
          await setDoc(roomRef, {
            createdAt: Date.now(),
            ownerId: playerId,
            status: 'lobby',
            tiplu: null,
            tipluPublicAtGrace: false,
            maxPlayers: 5,
            deckSeed: nanoid(10),
            deck: [],
            discard: [],
            turnIndex: 0
          })
        } else if (!snap.data().ownerId) {
          await updateDoc(roomRef, { ownerId: playerId })
        }
        setReady(true)
      } catch (e) {
        console.error('[Boot error]', e)
        setError(e?.message || String(e))
      }
    })()
  }, [playerId])

  if (error) {
    return (
      <div className="container">
        <h1>Blind Justice (Online)</h1>
        <p className="pill danger">Boot error: {error}</p>
      </div>
    )
  }

  if (!ready || !displayName || !playerId) {
    return (
      <div className="container">
        <h1>Blind Justice (Online)</h1>
        <p className="muted">Loading table…</p>
      </div>
    )
  }

  return (
    <MarriageRummyOnline
      roomId={PERSISTENT_ROOM_ID}
      displayName={displayName}
      defaultChips={DEFAULT_STACK}
      playerId={playerId}
    />
  )
}