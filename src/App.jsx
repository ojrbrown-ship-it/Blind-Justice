import React from 'react'
// Import your full game component below
import MarriageRummyOnline from './game/MarriageRummyOnline.jsx'

export default function App() {
  return (
    <div style={{minHeight: '100vh', background: '#f6f7fb'}}>
      <div style={{maxWidth: 1200, margin: '0 auto', padding: 16}}>
        <MarriageRummyOnline />
      </div>
    </div>
  )
}