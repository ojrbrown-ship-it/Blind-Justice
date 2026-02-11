// src/firebase.js
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  initializeFirestore,
  enableIndexedDbPersistence,
  enableNetwork
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
}

const app = initializeApp(firebaseConfig)

// Force HTTP long‑polling (works through strict proxies) and disable fetch streams
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  ignoreUndefinedProperties: true
})

// Optional but nice: enable local cache so reads work if the wire drops
enableIndexedDbPersistence(db).catch(() => {
  // If persistence fails (e.g., Safari private windows), just ignore and continue
})

// Explicitly (re)enable the network on boot — avoids “client is offline”
enableNetwork(db).catch(() => {
  // If it errors here, we’ll retry from the UI logic
})