import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";

const POSTS_DIR = "content/posts";
const OUT_DIR = "public/data";
const POSTS_OUT = join(OUT_DIR, "posts");
const REQUIRED = ["title", "date", "tags"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePost(file, raw) {
  const slug = file.replace(/\.md$/, "");
  const { data, content } = matter(raw);

  const missing = REQUIRED.filter(
    (k) => !data[k] || (Array.isArray(data[k]) && data[k].length === 0)
  );
  if (missing.length > 0) {
    throw new Error(`${file}: missing frontmatter field(s): ${missing.join(", ")}`);
  }

  const date =
    data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date);
  if (!DATE_RE.test(date)) {
    throw new Error(`${file}: date must be YYYY-MM-DD`);
  }

  return {
    post: {
      slug,
      title: String(data.title),
      summary: String(data.summary ?? ""),
      date,
      tags: (data.tags ?? []).map(String),
      readTime: String(data.readTime ?? ""),
    },
    html: marked.parse(content.trim(), { gfm: true }),
  };
}

export function sortPosts(posts) {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
}

export function buildPosts(postsDir = POSTS_DIR, outDir = OUT_DIR, fs = { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync }) {
  const postsOutDir = join(outDir, "posts");
  fs.rmSync(postsOutDir, { recursive: true, force: true });
  fs.mkdirSync(postsOutDir, { recursive: true });

  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) {
    throw new Error(`No markdown files found in ${postsDir}/`);
  }

  const posts = [];
  for (const file of files) {
    const { post, html } = parsePost(file, fs.readFileSync(join(postsDir, file), "utf8"));
    fs.writeFileSync(join(postsOutDir, `${post.slug}.html`), html);
    posts.push(post);
  }

  const sorted = sortPosts(posts);
  fs.writeFileSync(join(outDir, "blogs.json"), JSON.stringify(sorted, null, 2) + "\n");
  return sorted;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = buildPosts().length;
    console.log(`Built ${count} posts -> ${OUT_DIR}/blogs.json + ${POSTS_OUT}/*.html`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
