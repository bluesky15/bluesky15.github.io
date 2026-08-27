import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

  // Write canonical JSON
  const dataDir = join(outDir, "data");
  ensureDir(dataDir);
  writeFileSync(join(dataDir, "quiz.json"), jsonText, "utf8");

  // Expose to /api/quiz=1 as requested (literal '=' in filename) + friendly aliases
  const apiDir = join(outDir, "api");
  ensureDir(apiDir);
  // literal file for /api/quiz=1 (vite serves public/api/quiz=1 at /api/quiz=1)
  writeFileSync(join(apiDir, "quiz=1"), jsonText, "utf8");
  // aliases: /api/quiz.json and /api/quiz/1 etc
  writeFileSync(join(apiDir, "quiz.json"), jsonText, "utf8");
  const apiQuizDir = join(apiDir, "quiz");
  ensureDir(apiQuizDir);
  writeFileSync(join(apiQuizDir, "1.json"), jsonText, "utf8");
  writeFileSync(join(apiQuizDir, "1"), jsonText, "utf8");

  // Also write grouped by quiz_id for nicer API? Keep single file but log
  console.log(`Built quiz JSON: ${json.length} records -> public/data/quiz.json & public/api/quiz=1`);

  return json;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildQuiz();
}
