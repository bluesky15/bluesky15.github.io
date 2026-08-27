import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Real API: WASM pulls relevant CSV based on query param `1` (e.g. /api/quiz=1, /api/quiz?quiz=1, /api/quiz/1)
// Each request instantiates wasm/quiz_csv which embeds quiz_csv_1.csv and calls
// get_filtered_json_by_index / get_filtered_json_by_id to serve filtered JSON.
function quizApiMiddleware() {
  const ORDER = ['general','science','maths','history','geography','space','sports','movies','music','technology','animals','food']
  let wasmInstance = null
  let wasmLoadPromise = null

  async function getWasm() {
    if (wasmInstance) return wasmInstance
    if (wasmLoadPromise) return wasmLoadPromise
    wasmLoadPromise = (async () => {
      const candidates = [
        join(process.cwd(), 'public', 'data', 'quiz.wasm'),
        join(process.cwd(), 'dist', 'data', 'quiz.wasm'),
      ]
      const file = candidates.find(p => existsSync(p))
      if (!file) throw new Error('quiz.wasm not found')
      const bytes = readFileSync(file)
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const { instance } = await WebAssembly.instantiate(copy)
      wasmInstance = instance.exports
      return wasmInstance
    })()
    return wasmLoadPromise
  }

  // Write-once WASM: generic converter pulls ANY static CSV file based on file param
  // Supports: /api/quiz=2  /api/quiz?file=2  /api/quiz/2  /api/quiz?file=2&quiz=1  /api/quiz?quiz=science
  function parseParams(rawUrl) {
    try {
      const u = new URL(rawUrl, 'http://localhost')
      let file = u.searchParams.get('file') || u.searchParams.get('csv') || u.searchParams.get('set')
      let quiz = u.searchParams.get('quiz') || u.searchParams.get('id') || u.searchParams.get('category') || u.searchParams.get('q') || u.searchParams.get('quiz_id')
      // path variants if no explicit query
      if (!file && !quiz) {
        // /api/quiz=2 , /api/quiz/2 , /api/quiz=2/1 , /api/quiz?1
        const m = rawUrl.match(/\/api\/quiz(?:[?=&/]+([A-Za-z0-9_]+))?(?:[/&]([A-Za-z0-9_]+))?/)
        if (m) {
          const v1 = m[1]
          const v2 = m[2]
          if (v1 && v2) { file = v1; quiz = v2 }
          else if (v1) {
            // single value: if file quiz_${v1}.csv exists -> file, else quiz
            const cand1 = join(process.cwd(), 'public', 'data', 'csvs', `quiz_${v1}.csv`)
            const cand2 = join(process.cwd(), 'public', 'data', 'csvs', `quiz_csv_${v1}.csv`)
            const cand3 = join(process.cwd(), `quiz_csv_${v1}.csv`)
            if (existsSync(cand1) || existsSync(cand2) || existsSync(cand3)) file = v1
            else quiz = v1
          }
        }
        if (!file && !quiz) {
          const m2 = rawUrl.match(/quiz=([A-Za-z0-9_]+)/)
          if (m2) {
            const v = m2[1]
            const cand = join(process.cwd(), 'public', 'data', 'csvs', `quiz_${v}.csv`)
            if (existsSync(cand) || existsSync(join(process.cwd(), `quiz_csv_${v}.csv`))) file = v
            else quiz = v
          }
        }
      }
      // bare ?1
      if (!file && !quiz && u.search && /^\?\d+/.test(u.search)) {
        const m = u.search.match(/^\?(\d+)/)
        if (m) quiz = m[1]
      }
      return { file: file ? String(file) : null, quiz: quiz ? String(quiz) : null }
    } catch (e) { void e }
    const m2 = rawUrl.match(/quiz=([A-Za-z0-9_]+)/)
    if (m2) return { file: null, quiz: m2[1] }
    return { file: null, quiz: null }
  }

  // Generic WASM convert: JS pulls static CSV file, passes bytes to wasm
  async function wasmConvertCsv(csvBytes, wasm) {
    const heapBase = wasm.__heap_base?.value ?? wasm.__heap_base ?? 50000
    const ptr = (typeof heapBase === 'number' ? heapBase : 50000) + 12000
    if (wasm.memory.buffer.byteLength < ptr + csvBytes.length) {
      const need = ptr + csvBytes.length - wasm.memory.buffer.byteLength
      wasm.memory.grow(Math.ceil(need / 65536))
    }
    new Uint8Array(wasm.memory.buffer).set(csvBytes, ptr)
    wasm.convert_csv_to_json(ptr, csvBytes.length)
    const outPtr = wasm.get_out_ptr()
    const outLen = wasm.get_out_len()
    return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen))
  }

  const handler = (req, res, next) => {
    const rawUrl = req.url || ''
    if (!/\/api\/quiz/.test(rawUrl)) return next()
    ;(async () => {
      try {
        const { file, quiz } = parseParams(rawUrl)
        let jsonText
        let filteredBy = null
        let sourceNote = ''
        // Try WASM generic path: pull relevant static CSV file based on file param
        try {
          const wasm = await getWasm()
          // Resolve CSV file for file param (default 1)
          const fileIdx = file || '1'
          const csvCandidates = [
            join(process.cwd(), 'public', 'data', 'csvs', `quiz_${fileIdx}.csv`),
            join(process.cwd(), 'public', 'data', 'csvs', `quiz_csv_${fileIdx}.csv`),
            join(process.cwd(), `quiz_csv_${fileIdx}.csv`),
            join(process.cwd(), 'public', 'data', 'quiz.json'), // fallback
          ]
          let csvBytes = null
          let csvPath = null
          for (const p of csvCandidates) {
            if (existsSync(p) && p.endsWith('.csv')) { csvBytes = readFileSync(p); csvPath = p; break }
          }
          let isCsv = !!csvBytes
          if (isCsv) {
            // WASM pulls the static CSV file and converts
            jsonText = await wasmConvertCsv(csvBytes, wasm)
            sourceNote = `WASM pulled static file ${csvPath} via convert_csv_to_json`
            // If quiz filter also requested, filter the converted JSON
            if (quiz) {
              const all = JSON.parse(jsonText)
              const num = Number(quiz)
              let filtered
              if (!Number.isNaN(num) && Number.isInteger(num) && num >=1 && num <= ORDER.length) {
                const wanted = ORDER[num-1]
                filtered = all.filter(r => r.quiz_id === wanted)
                filteredBy = `file:${fileIdx}+quiz:index:${num}(${wanted})`
              } else {
                const wanted = String(quiz).toLowerCase()
                filtered = all.filter(r => r.quiz_id === wanted)
                filteredBy = `file:${fileIdx}+quiz:id:${wanted}`
              }
              jsonText = JSON.stringify(filtered)
              if (!filteredBy.includes('file:')) filteredBy = `file:${fileIdx}+${filteredBy}`
            } else {
              filteredBy = `file:${fileIdx} (all 120)`
            }
          } else {
            // No CSV file -> fallback to embedded filtered (file=1)
            throw new Error('no csv')
          }
        } catch (e) {
          void e
          // Fallback: embedded WASM filtered (for quiz-only queries on file 1)
          try {
            const wasm = await getWasm()
            const param = quiz || file
            if (param) {
              const num = Number(param)
              if (!Number.isNaN(num) && Number.isInteger(num) && num >= 1 && num <= ORDER.length) {
                wasm.get_filtered_json_by_index(num)
                const outPtr = wasm.get_out_ptr()
                const outLen = wasm.get_out_len()
                jsonText = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen))
                filteredBy = `index:${num}(${ORDER[num-1]})`
              } else {
                const str = String(param)
                const idx = ORDER.indexOf(str.toLowerCase())
                if (idx !== -1) {
                  wasm.get_filtered_json_by_index(idx+1)
                  const outPtr = wasm.get_out_ptr()
                  const outLen = wasm.get_out_len()
                  jsonText = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen))
                  filteredBy = `id:${str}`
                } else {
                  const bytes = new TextEncoder().encode(str)
                  const heapBase = wasm.__heap_base?.value ?? wasm.__heap_base ?? 50000
                  const ptr = (typeof heapBase === 'number' ? heapBase : 50000) + 8000
                  if (wasm.memory.buffer.byteLength < ptr + bytes.length) {
                    const need = ptr + bytes.length - wasm.memory.buffer.byteLength
                    wasm.memory.grow(Math.ceil(need / 65536))
                  }
                  new Uint8Array(wasm.memory.buffer).set(bytes, ptr)
                  wasm.get_filtered_json_by_id(ptr, bytes.length)
                  const outPtr = wasm.get_out_ptr()
                  const outLen = wasm.get_out_len()
                  jsonText = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen))
                  filteredBy = `id:${str}`
                }
              }
            } else {
              const p = wasm.get_json_ptr()
              const l = wasm.get_json_len()
              const buf = wasm.memory.buffer
              jsonText = new TextDecoder().decode(new Uint8Array(buf, p, l))
              filteredBy = 'all'
            }
            sourceNote = 'WASM embedded CSV filtered'
          } catch (e2) {
            void e2
            // ultimate fallback: file JSON
            const candidates = [
              join(process.cwd(), 'public', 'data', 'quiz.json'),
              join(process.cwd(), 'dist', 'data', 'quiz.json'),
            ]
            const f = candidates.find(p => existsSync(p))
            if (!f) throw new Error('no data')
            const raw = readFileSync(f, 'utf8')
            const all = JSON.parse(raw)
            const param = quiz || file
            let data = all
            if (param) {
              const num = Number(param)
              if (!Number.isNaN(num) && num >=1 && num <= ORDER.length) {
                const wanted = ORDER[num-1]
                data = all.filter(r => r.quiz_id === wanted)
                filteredBy = `index:${num}(${wanted})`
              } else {
                const wanted = String(param).toLowerCase()
                data = all.filter(r => r.quiz_id === wanted)
                filteredBy = `id:${wanted}`
              }
            } else filteredBy = 'all'
            jsonText = JSON.stringify(data)
            sourceNote = 'file JSON fallback'
          }
        }

        const data = JSON.parse(jsonText)
        const wantsRaw = rawUrl.includes('raw=1')
        const paramInfo = file || quiz ? `file=${file || 1} quiz=${quiz || 'all'} (${filteredBy})` : 'no param (all)'
        const envelope = {
          status: 200,
          success: true,
          file: file ? String(file) : '1',
          quiz: quiz ? String(quiz) : null,
          filteredBy,
          count: Array.isArray(data) ? data.length : 0,
          source: 'wasm/quiz_csv generic convert_csv_to_json (write-once, pulls any static csv)',
          note: `${sourceNote} for ${paramInfo}`,
          data,
        }
        const body = wantsRaw ? jsonText : JSON.stringify(envelope, null, 2)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('X-Generated-By', 'wasm/quiz_csv -> csv_to_json')
        res.setHeader('X-Quiz-File', file ? String(file) : '1')
        res.setHeader('X-Quiz-Param', quiz ? String(quiz) : 'all')
        res.setHeader('Content-Disposition', 'inline')
        res.end(body)
      } catch (err) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ status: 500, success: false, error: String(err) }))
      }
    })()
  }

  return {
    name: 'quiz-api-middleware',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
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
