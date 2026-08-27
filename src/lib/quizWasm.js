/**
 * WASM-backed CSV -> JSON helper.
 * Loads public/data/quiz.wasm (built from wasm/quiz_csv) and
 * exposes helpers for the quiz API.
 * Correct buffer capture order is crucial because the first
 * get_json_ptr() call allocates and grows memory.
 */

let wasmExports = null;

async function loadQuizWasm() {
  if (wasmExports) return wasmExports;
  const bytes = await (await fetch(`${import.meta.env.BASE_URL}data/quiz.wasm`)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes);
  wasmExports = instance.exports;
  return wasmExports;
}

export async function getQuizJsonViaWasm() {
  const e = await loadQuizWasm();
  const ptr = e.get_json_ptr();
  const len = e.get_json_len();
  const buf = e.memory.buffer;
  const json = new TextDecoder().decode(new Uint8Array(buf, ptr, len));
  return JSON.parse(json);
}

export async function getQuizCsvViaWasm() {
  const e = await loadQuizWasm();
  const ptr = e.get_csv_ptr();
  const len = e.get_csv_len();
  const buf = e.memory.buffer;
  return new TextDecoder().decode(new Uint8Array(buf, ptr, len));
}

/**
 * Generic CSV->JSON using WASM convert_csv_to_json.
 * @param {string} csvText
 * @returns {Array}
 */
export async function convertCsvToJsonViaWasm(csvText) {
  const e = await loadQuizWasm();
  const csvBytes = new TextEncoder().encode(csvText);
  // write csv into wasm memory at a safe offset (after static data)
  // Use __heap_base as hint if available, else pick 20000
  const heapBase = e.__heap_base?.value ?? e.__heap_base ?? 20000;
  const ptr = heapBase + 5000;
  // ensure memory large enough
  if (e.memory.buffer.byteLength < ptr + csvBytes.length) {
    const needed = ptr + csvBytes.length - e.memory.buffer.byteLength;
    const pages = Math.ceil(needed / 65536);
    e.memory.grow(pages);
  }
  new Uint8Array(e.memory.buffer).set(csvBytes, ptr);
  e.convert_csv_to_json(ptr, csvBytes.length);
  const outPtr = e.get_out_ptr();
  const outLen2 = e.get_out_len();
  // after convert, memory may have grown -> re-read buffer
  const jsonText = new TextDecoder().decode(new Uint8Array(e.memory.buffer, outPtr, outLen2));
  return JSON.parse(jsonText);
}

// WASM pulls relevant CSV slice by query param (1..12 or quiz_id string)
// e.g. getFilteredQuizViaWasm(1) => general (10 rows), getFilteredQuizViaWasm('science') => science
export async function getFilteredQuizViaWasm(param) {
  const e = await loadQuizWasm();
  const num = Number(param)
  if (!Number.isNaN(num) && Number.isInteger(num) && num >= 1 && num <= 12) {
    e.get_filtered_json_by_index(num)
    const outPtr = e.get_out_ptr()
    const outLen = e.get_out_len()
    return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, outPtr, outLen)))
  }
  // string id
  const str = String(param)
  const bytes = new TextEncoder().encode(str)
  const heapBase = e.__heap_base?.value ?? e.__heap_base ?? 50000
  const ptr = (typeof heapBase === 'number' ? heapBase : 50000) + 8000
  if (e.memory.buffer.byteLength < ptr + bytes.length) {
    const need = ptr + bytes.length - e.memory.buffer.byteLength
    e.memory.grow(Math.ceil(need / 65536))
  }
  new Uint8Array(e.memory.buffer).set(bytes, ptr)
  e.get_filtered_json_by_id(ptr, bytes.length)
  const outPtr = e.get_out_ptr()
  const outLen = e.get_out_len()
  return JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, outPtr, outLen)))
}

// Convenience: fetch via real API server (which itself uses WASM)
export async function fetchQuizApi(param = null, raw = false) {
  const base = import.meta.env.BASE_URL
  // Build URL: /api/quiz=1  or /api/quiz?quiz=1
  const url = param == null
    ? `${base}api/quiz.json${raw ? '?raw=1' : ''}`
    : `${base}api/quiz=${encodeURIComponent(param)}${raw ? '&raw=1' : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}
