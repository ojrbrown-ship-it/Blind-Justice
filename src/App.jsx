// src/App.jsx
import React, { useMemo } from 'react'
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'
import { nanoid } from 'nanoid'

const PERSISTENT_ROOM_ID = 'TABLE-1'
const DEFAULT_STACK = 250

function seedLocal(key, make) {
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const v = typeof make === 'function' ? make() : make
    localStorage.setItem(key, v)
    return v
  } catch {
    return typeof make === 'function' ? make() : make
  }
}

export default function App() {
  // Seed synchronously so we never block rendering
  const displayName = useMemo(
    () => seedLocal('bj_name', () => `Player-${nanoid(4)}`),
    []
  )
  const playerId = useMemo(
    () => seedLocal('bj_pid', () => `pid_${nanoid(10)}`),
    []
  )

  return (
    <MarriageRummyOnline
      roomId={PERSISTENT_ROOM_ID}
      displayName={displayName}
      defaultChips={DEFAULT_STACK}
      playerId={playerId}
    />
  )
}
