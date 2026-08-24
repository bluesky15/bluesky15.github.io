import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const POSTS_DIR = "content/posts";
const OUT_DIR = "public/data";
const POSTS_OUT = join(OUT_DIR, "posts");

const REQUIRED = ["title", "date", "tags"];

rmSync(POSTS_OUT, { recursive: true, force: true });
mkdirSync(POSTS_OUT, { recursive: true });

const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md")).sort();

if (files.length === 0) {
  console.error(`No markdown files found in ${POSTS_DIR}/`);
  process.exit(1);
}

const posts = [];
for (const file of files) {
  const slug = file.replace(/\.md$/, "");
  const { data, content } = matter(readFileSync(join(POSTS_DIR, file), "utf8"));

  const missing = REQUIRED.filter((k) => !data[k] || (Array.isArray(data[k]) && data[k].length === 0));
  if (missing.length > 0) {
    console.error(`${file}: missing frontmatter field(s): ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
    console.error(`${file}: date must be YYYY-MM-DD`);
    process.exit(1);
  }

  const html = marked.parse(content.trim(), { gfm: true });
  writeFileSync(join(POSTS_OUT, `${slug}.html`), html);

  posts.push({
    slug,
    title: String(data.title),
    summary: String(data.summary ?? ""),
    date: String(data.date),
    tags: (data.tags ?? []).map(String),
    readTime: String(data.readTime ?? ""),
  });
}

posts.sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(join(OUT_DIR, "blogs.json"), JSON.stringify(posts, null, 2) + "\n");
console.log(`Built ${posts.length} posts -> ${OUT_DIR}/blogs.json + ${POSTS_OUT}/*.html`);
