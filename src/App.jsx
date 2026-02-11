import React, { useEffect, useState } from 'react'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'
import { doc, setDoc } from 'firebase/firestore'
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'
import { nanoid } from 'nanoid'

export default function App() {
  const [user, setUser] = useState(null)
  const [roomId, setRoomId] = useState('')
  const [nick, setNick] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u))
    return () => unsub()
  }, [])

  const ensureAnon = async () => {
    if (!auth.currentUser) await signInAnonymously(auth)
  }

  const createRoom = async () => {
    await ensureAnon()
    const id = (Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6)).toUpperCase()
    const displayName = nick || localStorage.getItem('bj_name') || `Player-${nanoid(4)}`
    localStorage.setItem('bj_name', displayName)
    const roomRef = doc(db, 'rooms', id)
    await setDoc(roomRef, {
      createdAt: Date.now(),
      ownerId: auth.currentUser.uid,
      status: 'lobby',        // lobby | playing | grace | scored
      tiplu: null,
      tipluPublicAtGrace: false,
      maxPlayers: 5,
      deckSeed: nanoid(10)
    })
    setRoomId(id)
  }

  const joinRoom = async () => {
    if (!roomId) return
    await ensureAnon()
    const displayName = nick || localStorage.getItem('bj_name') || `Player-${nanoid(4)}`
    localStorage.setItem('bj_name', displayName)
    setRoomId(roomId.toUpperCase())
  }

  if (!user) {
    return (
      <div className="container">
        <h1>Blind Justice (Online)</h1>
        <p className="muted">You’ll be signed in anonymously to sync games via Firebase.</p>
        <button onClick={ensureAnon}>Sign in anonymously</button>
      </div>
    )
  }

  if (roomId) {
    return <MarriageRummyOnline roomId={roomId} displayName={localStorage.getItem('bj_name') || 'Player'} />
  }

  return (
    <div className="container">
      <h1>Blind Justice (Online)</h1>

      <div className="panel">
        <h3>Create a room</h3>
        <div className="row">
          <input placeholder="Your name (optional)" value={nick} onChange={e=>setNick(e.target.value)} />
          <button onClick={createRoom}>Create</button>
        </div>
      </div>

      <div className="panel" style={{marginTop: 16}}>
        <h3>Join a room</h3>
        <div className="row">
          <input placeholder="ROOM CODE" value={roomId} onChange={e=>setRoomId(e.target.value.toUpperCase())} />
          <input placeholder="Your name (optional)" value={nick} onChange={e=>setNick(e.target.value)} />
          <button onClick={joinRoom}>Join</button>
        </div>
      </div>

      <p className="muted">Max 5 players. The host can start once everyone is ready.</p>
    </div>
  )
}