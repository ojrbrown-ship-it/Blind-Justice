// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { db } from './firebase'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'
import { nanoid } from 'nanoid'

const PERSISTENT_ROOM_ID = 'TABLE-1'
const DEFAULT_STACK = 250

// Safe localStorage helpers (work even if storage is blocked)
function getOrSeed(key, seed) {
  try {
    let v = localStorage.getItem(key)
    if (!v) {
      v = typeof seed === 'function' ? seed() : seed
      localStorage.setItem(key, v)
    }
    return v
  } catch {
    // Fallback if storage is unavailable
    return typeof seed === 'function' ? seed() : seed
  }
}

export default function App() {
  // Seed synchronously so we don’t gate rendering on an effect
  const displayName = useMemo(
    () => getOrSeed('bj_name', () => `Player-${nanoid(4)}`),
    []
  )
  const playerId = useMemo(
    () => getOrSeed('bj_pid', () => `pid_${nanoid(10)}`),
    []
  )

  const [bootMsg, setBootMsg] = useState('Initialising…')
  const [bootError, setBootError] = useState('')
  const createdOnce = useRef(false)

  useEffect(() => {
    // Create the persistent room if needed, then we just render.
    const ensureRoom = async () => {
      try {
        setBootMsg(`Ensuring table ${PERSISTENT_ROOM_ID} exists…`)
        const roomRef = doc(db, 'rooms', PERSISTENT_ROOM_ID)
        const snap = await getDoc(roomRef)

        if (!snap.exists()) {
          console.log('[Room] creating', PERSISTENT_ROOM_ID)
          await setDoc(roomRef, {
            createdAt: Date.now(),
            ownerId: playerId,       // first visitor becomes owner
            status: 'lobby',         // lobby | playing | grace | scored
            tiplu: null,
            tipluPublicAtGrace: false,
            maxPlayers: 5,
            deckSeed: nanoid(10),
            deck: [],
            discard: [],
            turnIndex: 0
          })
          createdOnce.current = true
          console.log('[Room] created OK')
        } else if (!snap.data().ownerId) {
          await updateDoc(roomRef, { ownerId: playerId })
          console.log('[Room] adopted ownerId', playerId)
        }
        setBootMsg('Table ready')
        setBootError('')
      } catch (e) {
        console.error('[Boot error] ensureRoom failed:', e)
        setBootError(
          e?.message ||
          'Failed to create or load the table. Check Firestore rules and env values.'
        )
      }
    }

    // Safety timeout: if nothing finishes in 8s, show guidance
    const t = setTimeout(() => {
      setBootMsg('Still waiting…')
      if (!createdOnce.current && !bootError) {
        setBootError(
          'Taking longer than expected. If this persists: ' +
          '1) confirm Firestore is enabled for the project in your env vars, ' +
          '2) confirm public rules are deployed to THIS project, ' +
          '3) hard-refresh (Shift+Reload).'
        )
      }
    }, 8000)

    ensureRoom()
      .finally(() => clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId])

  // Always render the table as soon as we have a playerId; the room
  // component will subscribe via onSnapshot and update as soon as the doc exists.
  const canRenderRoom = !!playerId && !!displayName

  if (!canRenderRoom) {
    return (
      <div className="container">
        <h1>Blind Justice (Online)</h1>
        <p className="muted">Preparing player identity…</p>
      </div>
    )
  }

  return (
    <div>
      {/* Optional tiny boot panel when something’s slow or errors */}
      {(bootMsg || bootError) && (
        <div className="container" style={{paddingTop: 8}}>
          {!!bootError ? (
            <p className="pill danger">Boot error: {bootError}</p>
          ) : (
            <p className="muted">{bootMsg}</p>
          )}
        </div>
      )}

      <MarriageRummyOnline
        roomId={PERSISTENT_ROOM_ID}
        displayName={displayName}
        defaultChips={DEFAULT_STACK}
        playerId={playerId}
      />
    </div>
  )
}