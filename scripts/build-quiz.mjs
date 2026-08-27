import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";

const CSV_PATH = join(process.cwd(), "quiz_csv_1.csv");
const CANDIDATE2 = join(process.cwd(), "wasm", "quiz_csv", "quiz_csv_1.csv");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  // Filter out empty trailing
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

function csvToJson(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  const out = [];
  for (const r of rows.slice(1)) {
    const obj = {};
    header.forEach((h, idx) => obj[h] = r[idx] ?? "");
    out.push({
      quiz_id: obj.quiz_id,
      position: Number(obj.position),
      question: obj.question,
      options: [obj.option_1, obj.option_2, obj.option_3, obj.option_4],
      correct_index: Number(obj.correct_index),
      correct_answer: obj.correct_answer,
    });
  }
  return out;
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

export function buildQuiz(src = CSV_PATH, outDir = join(process.cwd(), "public")) {
  let csvText;
  if (existsSync(src)) csvText = readFileSync(src, "utf8");
  else if (existsSync(CANDIDATE2)) csvText = readFileSync(CANDIDATE2, "utf8");
  else throw new Error(`CSV not found at ${src} or ${CANDIDATE2}`);

  const json = csvToJson(csvText);
  const jsonText = JSON.stringify(json, null, 2);

  // Real API envelope (200 success) for static hosting (GitHub Pages has no vite middleware)
  const envelope = {
    status: 200,
    success: true,
    count: json.length,
    source: 'wasm/quiz_csv csv_to_json',
    data: json,
  }
  const envelopeText = JSON.stringify(envelope, null, 2)

  // Write canonical JSON (raw) + envelope for data
  const dataDir = join(outDir, "data");
  ensureDir(dataDir);
  writeFileSync(join(dataDir, "quiz.json"), jsonText, "utf8");
  // also keep csvs for generic WASM pull (handled by vite middleware via convert_csv_to_json)
  // Ensure csvs folder exists for static hosting
  const csvsDir = join(dataDir, "csvs");
  ensureDir(csvsDir);
  // Copy all quiz_csv_*.csv to public/data/csvs/ if present
  try {
    const csvs = readdirSync(process.cwd()).filter(f => /^quiz_csv_\d+\.csv$/.test(f))
    for (const f of csvs) copyFileSync(join(process.cwd(), f), join(csvsDir, f.replace('quiz_csv_', 'quiz_').replace('.csv','.csv')))
    // also handle quiz_csv_1.csv -> quiz_1.csv etc. already done via copyFile, ensure quiz_1.csv exists
    if (existsSync(CSV_PATH) && !existsSync(join(csvsDir, 'quiz_1.csv'))) copyFileSync(CSV_PATH, join(csvsDir, 'quiz_1.csv'))
  } catch {}

  // Expose to /api - static GitHub Pages serves .json with correct Content-Type
  // /api/quiz.json and /api/quiz/1.json are correct (application/json)
  // /api/quiz=1 has no extension -> GitHub Pages serves application/octet-stream (download) -> keep for dev middleware, but also provide _headers for Cloudflare
  const apiDir = join(outDir, "api");
  ensureDir(apiDir);
  // For GitHub Pages, the real API is the envelope (200 success)
  writeFileSync(join(apiDir, "quiz.json"), envelopeText, "utf8");
  writeFileSync(join(apiDir, "quiz=1"), envelopeText, "utf8"); // dev: middleware overrides to correct type
  const apiQuizDir = join(apiDir, "quiz");
  ensureDir(apiQuizDir);
  writeFileSync(join(apiQuizDir, "1.json"), envelopeText, "utf8");
  writeFileSync(join(apiQuizDir, "1"), envelopeText, "utf8");

  // Generate per-file envelopes for 2,3,4 if present (so /api/quiz?file=2 works statically via /api/quiz/2.json)
  for (const n of [2,3,4]) {
    const p = join(process.cwd(), `quiz_csv_${n}.csv`);
    if (!existsSync(p)) continue
    const txt = readFileSync(p, 'utf8')
    const j = csvToJson(txt)
    const env = JSON.stringify({ status:200, success:true, file:String(n), count:j.length, source:'wasm/quiz_csv', data:j }, null, 2)
    writeFileSync(join(apiDir, `quiz_${n}.json`), env, "utf8");
    writeFileSync(join(apiQuizDir, `${n}.json`), env, "utf8");
    // also data/csvs already copied
  }

  // Cloudflare/_headers for extension-less file (dev preview already sets via middleware)
  const headersPath = join(outDir, "_headers");
  const headersContent = `/api/quiz=1
  Content-Type: application/json; charset=utf-8
  Cache-Control: no-cache
  Access-Control-Allow-Origin: *
/api/quiz/*
  Content-Type: application/json; charset=utf-8
`;
  try { writeFileSync(headersPath, headersContent, "utf8") } catch {}

  console.log(`Built quiz JSON: ${json.length} records -> public/data/quiz.json & public/api/quiz.json (envelope) + public/data/csvs/`);

  return json;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildQuiz();
}
