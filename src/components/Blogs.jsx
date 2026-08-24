import { useEffect, useMemo, useState } from "react";

function formatDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

let blogCache = null;

export default function Blogs({ onBack }) {
  const [posts, setPosts] = useState(blogCache);
  const [failed, setFailed] = useState(false);
  const [year, setYear] = useState("all");
  const [tag, setTag] = useState("all");

  useEffect(() => {
    if (blogCache) return;
    fetch(`${import.meta.env.BASE_URL}data/blogs.json`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      })
      .then((data) => {
        blogCache = [...data].sort((a, b) => b.date.localeCompare(a.date));
        setPosts(blogCache);
      })
      .catch(() => setFailed(true));
  }, []);

  const years = useMemo(
    () => (posts ? [...new Set(posts.map((p) => p.date.slice(0, 4)))].sort().reverse() : []),
    [posts]
  );
  const tags = useMemo(
    () => (posts ? [...new Set(posts.flatMap((p) => p.tags))].sort() : []),
    [posts]
  );

  const filtered = useMemo(() => {
    if (!posts) return [];
    return posts.filter(
      (p) =>
        (year === "all" || p.date.startsWith(year)) &&
        (tag === "all" || p.tags.includes(tag))
    );
  }, [posts, year, tag]);

  if (failed) {
    return (
      <main id="content" className="container">
        <p className="state">Could not load the blog posts. Please try again later.</p>
      </main>
    );
  }

  if (!posts) {
    return (
      <main id="content" className="container">
        <p className="state">Loading…</p>
      </main>
    );
  }

  return (
    <main id="content" className="container blogs-page">
      <a
        href="#top"
        className="back-link"
        onClick={(e) => {
          e.preventDefault();
          onBack();
        }}
      >
        ← Back to profile
      </a>

      <h2 className="numbered">Blog Archive</h2>
      <p className="blogs-count">
        {filtered.length} post{filtered.length === 1 ? "" : "s"}
      </p>

      <div className="filter-bar">
        <label>
          Filter by date{" "}
          <select className="filter-select" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All dates</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag{" "}
          <select className="filter-select" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="all">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 && <p className="state">No posts match those filters.</p>}

      <div className="blog-list">
        {filtered.map((post) => (
          <article className="card blog-item" key={post.title}>
            <div className="blog-meta">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span>{post.readTime}</span>
            </div>
            <h3>{post.title}</h3>
            <p className="desc">{post.summary}</p>
            <ul className="chips">
              {post.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </main>
  );
}
