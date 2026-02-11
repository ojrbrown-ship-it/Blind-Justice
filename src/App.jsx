// src/App.jsx
import React, { useEffect, useState } from 'react'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'
import { nanoid } from 'nanoid'

const PERSISTENT_ROOM_ID = 'TABLE-1'   // rename if you want a different fixed ID
const DEFAULT_STACK = 250              // chips on sit-down

export default function App() {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [displayName, setDisplayName] = useState('')

  // Keep a stable display name in localStorage
  useEffect(() => {
    const existing = localStorage.getItem('bj_name')
    if (existing) setDisplayName(existing)
    else {
      const name = `Player-${nanoid(4)}`
      localStorage.setItem('bj_name', name)
      setDisplayName(name)
    }
  }, [])

  // Auto sign-in and ensure the single room exists
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        await signInAnonymously(auth)
        return
      }
      setUser(u)
      // Ensure persistent room document exists (create once, keep reusing)
      const roomRef = doc(db, 'rooms', PERSISTENT_ROOM_ID)
      const snap = await getDoc(roomRef)
      if (!snap.exists()) {
        await setDoc(roomRef, {
          createdAt: Date.now(),
          ownerId: u.uid,          // first to arrive becomes owner; not critical
          status: 'lobby',         // lobby | playing | grace | scored
          tiplu: null,
          tipluPublicAtGrace: false,
          maxPlayers: 5,
          deckSeed: nanoid(10),
          deck: [],
          discard: [],
          turnIndex: 0
        })
      } else {
        // Optional: if ownerId empty/invalid, adopt current user as owner
        const data = snap.data()
        if (!data.ownerId) await updateDoc(roomRef, { ownerId: u.uid })
      }
      setReady(true)
    })
    return () => unsub()
  }, [])

  if (!ready || !user || !displayName) {
    return (
      <div className="container">
        <h1>Blind Justice (Online)</h1>
        <p className="muted">Loading table…</p>
      </div>
    )
  }

  // Straight to the single table
  return <MarriageRummyOnline roomId={PERSISTENT_ROOM_ID} displayName={displayName} defaultChips={DEFAULT_STACK} />
}