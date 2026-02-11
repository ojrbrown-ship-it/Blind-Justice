import React, { useMemo } from 'react'
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'
import { nanoid } from 'nanoid'

const PERSISTENT_ROOM_ID = 'TABLE-1'
const DEFAULT_STACK = 250

function seedLocal(key, make) {
  try {
    const v = localStorage.getItem(key)
    if (v) return v
    const n = typeof make === 'function' ? make() : make
    localStorage.setItem(key, n)
    return n
  } catch {
    return typeof make === 'function' ? make() : make
  }
}

function seedSession(key, make) {
  try {
    const v = sessionStorage.getItem(key)
    if (v) return v
    const n = typeof make === 'function' ? make() : make
    sessionStorage.setItem(key, n)
    return n
  } catch {
    return typeof make === 'function' ? make() : make
  }
}

export default function App() {
  // Persistent display name (device-level)
  const displayName = useMemo(
    () => seedLocal('bj_name', () => `Player-${nanoid(4)}`),
    []
  )

  // Persistent device/player root id
  const baseId = useMemo(
    () => seedLocal('bj_pid', () => `pid_${nanoid(10)}`),
    []
  )

  // Per-tab session id
  const sessionId = useMemo(
    () => seedSession('bj_sid', () => `sid_${nanoid(6)}`),
    []
  )

  // Final per-seat id = device id + tab session id
  const playerSeatId = `${baseId}-${sessionId}`

  return (
    <MarriageRummyOnline
      roomId={PERSISTENT_ROOM_ID}
      displayName={displayName}
      defaultChips={DEFAULT_STACK}
      playerId={playerSeatId}      // <— per-tab seat
    />
  )
}