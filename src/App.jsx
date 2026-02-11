// src/App.jsx
import React, { useEffect, useState } from 'react'
import { signInAnonymously } from 'firebase/auth'
import { auth, db } from './firebase'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'
import { nanoid } from 'nanoid'

const PERSISTENT_ROOM_ID = 'TABLE-1'
const DEFAULT_STACK = 250

export default function App() {
  const [ready, setReady] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')

  // Keep a stable display name
  useEffect(() => {
    let name = localStorage.getItem('bj_name')
    if (!name) {
      name = `Player-${nanoid(4)}`
      localStorage.setItem('bj_name', name)
    }
    setDisplayName(name)
  }, [])

  useEffect(() => {
    (async () => {
      try {
        // 1) Ensure anonymous sign-in first (deterministic)
        if (!auth.currentUser) {
          console.log('[Auth] signing in anonymously…')
          await signInAnonymously(auth)
        }
        console.log('[Auth] signed in as', auth.currentUser?.uid)

        // 2) Ensure the single persistent room exists
        const roomRef = doc(db, 'rooms', PERSISTENT_ROOM_ID)
        const snap = await getDoc(roomRef)
        if (!snap.exists()) {
          console.log('[Room] creating TABLE-1')
          await setDoc(roomRef, {
            createdAt: Date.now(),
            ownerId: auth.currentUser.uid,
            status: 'lobby',         // lobby | playing | grace | scored
            tiplu: null,
            tipluPublicAtGrace: false,
            maxPlayers: 5,
            deckSeed: nanoid(10),
            deck: [],
            discard: [],
            turnIndex: 0
          })
        } else if (!snap.data().ownerId) {
          await updateDoc(roomRef, { ownerId: auth.currentUser.uid })
        }

        // 3) Ready to render the table
        setReady(true)
        console.log('[App] ready, navigating to TABLE-1')
      } catch (e) {
        console.error('[Boot error]', e)
        setError(e?.message || String(e))
      }
    })()
  }, [])

  if (error) {
    return (
      <div className="container">
        <h1>Blind Justice (Online)</h1>
        <p className="pill danger">Boot error: {error}</p>
      </div>
    )
  }

  if (!ready || !displayName) {
    return (
      <div className="container">
        <h1>Blind Justice (Online)</h1>
        <p className="muted">Loading table…</p>
      </div>
    )
  }

  // Straight to the single table; player stack gets set to 250 when seated inside the room component
  return <MarriageRummyOnline roomId={PERSISTENT_ROOM_ID} displayName={displayName} defaultChips={DEFAULT_STACK} />
}