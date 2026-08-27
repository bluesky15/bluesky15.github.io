import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Simple API middleware to expose WASM-derived JSON at /api/quiz=1 and variants.
// Static files at public/api/quiz=1 and public/api/quiz.json already exist,
// but this middleware ensures query-param and path-param aliases work in dev.
function quizApiMiddleware() {
  return {
    name: 'quiz-api-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        // Match: /api/quiz=1, /api/quiz?1, /api/quiz?q=1, /api/quiz/1, /api/quiz.json, /api/quiz
        const isQuizApi = /\/api\/quiz/.test(url)
        if (!isQuizApi) return next()
        // Resolve JSON from public/data/quiz.json (built by scripts/build-quiz.mjs)
        const candidates = [
          join(process.cwd(), 'public', 'data', 'quiz.json'),
          join(process.cwd(), 'dist', 'data', 'quiz.json'),
        ]
        let file = candidates.find(p => existsSync(p))
        if (!file) return next()
        try {
          const json = readFileSync(file, 'utf8')
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('X-Generated-By', 'wasm/quiz_csv -> csv_to_json')
          res.end(json)
        } catch {
          next()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), quizApiMiddleware()],
  base: "./",
  server: {open: true,
    port: 3001,
  },
  test: {
    environment: 'jsdom',
  },
})
