# Lalit Kumar Behera — Portfolio

A fully **static portfolio website** built with React + Vite and served on GitHub Pages. No backend server — all content is driven by static JSON, Markdown, and a tiny WebAssembly feature-flag module.

**Live:** [https://onlinelkb.in](https://onlinelkb.in) · [https://bluesky15.github.io](https://bluesky15.github.io)

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19 + Vite 7 |
| Styling | Plain CSS (custom properties, light/dark "retro CRT" theme) |
| Content | Markdown (`marked`, `gray-matter`) |
| Config/Flags | Rust → WebAssembly (`no_std`, 234 bytes) |
| Hosting | GitHub Pages (custom domain via `CNAME`) |
| CI/CD | GitHub Actions |
| Tooling | ESLint 9, Node 24 (`.nvmrc`) |

---

## Project Structure

```
.
├── .github/workflows/deploy.yml   # CI: build & deploy on push to main
├── .nvmrc                         # Node version pin (24.x)
├── CNAME                          # Custom domain config (published with dist/)
├── content/
│   └── posts/                     # ✍️ Blog source files (Markdown + frontmatter)
├── public/
│   ├── data/
│   │   ├── profile.json           # Site content (skills, experience, projects…)
│   │   ├── blogs.json             # Generated blog index (do not edit by hand)
│   │   ├── posts/*.html           # Generated post HTML (do not edit by hand)
│   │   └── flags.wasm             # Compiled feature-flag module (see below)
│   ├── resume.pdf
│   └── CNAME                      # Copied into dist/ at build time
├── scripts/
│   ├── build-posts.mjs            # Markdown → JSON index + HTML files
│   └── build-wasm.sh              # Rust → flags.wasm (TinyGo/Go fallbacks removed)
├── src/
│   ├── App.jsx                    # Root component, flag loading, view switching
│   ├── components/
│   │   ├── Nav.jsx                # Nav links, login modal, theme toggle (flag-gated)
│   │   ├── Profile.jsx            # Hero, about, skills, experience, projects, contact
│   │   └── Blogs.jsx              # Blog archive list + reader view
│   └── styles.css
├── wasm/                          # Cargo workspace for WebAssembly modules
│   ├── Cargo.toml                 # Workspace root
│   └── flags/
│       ├── Cargo.toml
│       ├── flags.json             # 🔧 Feature flags source of truth (edit this)
│       └── src/lib.rs             # Exports get_flags_ptr / get_flags_len
├── dist/                          # Build output (generated)
└── vite.config.js                 # base: "./" for portable static hosting
```

---

## Architecture

```
┌────────────────────  BUILD TIME  ────────────────────┐
│                                                      │
│  content/posts/*.md ──build-posts.mjs──► blogs.json  │
│                                    └─► posts/*.html  │
│                                                      │
│  wasm/flags/flags.json ──cargo──► public/data/flags.wasm │
│                                                      │
│  public/** ──vite build──► dist/ (+ CNAME copied)    │
└──────────────────────────────────────────────────────┘
                        │ git push → GitHub Actions
                        ▼
┌────────────────────  RUNTIME (browser)  ─────────────┐
│                                                      │
│  App.jsx                                             │
│    1. fetch flags.wasm ── instantiate ── read        │
│       memory[get_flags_ptr() .. get_flags_len()]     │
│       ── JSON.parse ──► feature flags                 │
│    2. fetch profile.json ──► Profile page            │
│    3. fetch blogs.json  ──► Blog archive             │
│           └─ click post ──► lazy-fetch posts/<slug>.html │
└──────────────────────────────────────────────────────┘
```

Everything runs client-side; GitHub Pages only serves files.

---

## Feature Flags (WebAssembly)

Feature toggles are compiled **into** a 234-byte Wasm module — the browser never sees a plain config file.

**1. Edit** `wasm/flags/flags.json`:
```json
{
  "blogs": true,
  "login": false,
  "resume": true,
  "themeToggle": true
}
```

**2. Rebuild:**
```bash
npm run wasm
```

**3. What each flag controls**

| Flag | Controls |
|---|---|
| `blogs` | "Blogs" nav link + blog route access |
| `login` | Login/logout button and its modal |
| `resume` | Nav Resume link **and** hero "Resume ↓" button |
| `themeToggle` | retro/modern theme switcher |

If the module fails to load, safe defaults are used so the site never breaks.

---

## Writing a Blog Post

Create `content/posts/my-post-slug.md` (filename = URL slug):

```markdown
---
title: "My Post Title"
summary: "One-line teaser shown in the archive."
date: "2026-08-24"
tags: ["Android", "Kotlin"]
readTime: "5 min"
---

Body in regular **Markdown** — headings, code blocks, tables,
and lists are all supported in the reader view.
```

Then rebuild (`npm run dev` or `npm run build` does it automatically). The script validates required frontmatter and sorts posts newest-first.

---

## Getting Started

```bash
nvm use          # picks Node 24 from .nvmrc
npm install
npm run dev      # http://localhost:3001
```

Optional but recommended for rebuilding the flag module locally:
```bash
rustup target add wasm32-unknown-unknown
```
No Rust? The script keeps using the last committed `flags.wasm`.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Build posts → build wasm → Vite dev server (:3001) |
| `npm run build` | Same chain → production bundle in `dist/` |
| `npm run blogs` | Regenerate `blogs.json` + post HTML from Markdown |
| `npm run wasm` | Compile `wasm/flags/flags.json` → `flags.wasm` |
| `npm run lint` | ESLint |
| `npm run preview` | Serve `dist/` locally |

---

## Deployment

1. Push to `main`
2. GitHub Actions (`.github/workflows/deploy.yml`) installs deps, runs `npm run build`, publishes `dist/` to the `gh-pages` branch
3. GitHub Pages serves it; `CNAME` inside makes `onlinelkb.in` resolve

> **Note:** CI has no Rust toolchain — it deploys whatever `flags.wasm` was last committed. Always run `npm run wasm` before pushing when you change flags.
