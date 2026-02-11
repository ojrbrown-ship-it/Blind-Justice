// vite.config.js
import react from '@vitejs/plugin-react'

export default {
  plugins: [react()],
  // Keep sourcemaps on while we’re debugging; safe to remove later
  build: {
    sourcemap: true
  }
}