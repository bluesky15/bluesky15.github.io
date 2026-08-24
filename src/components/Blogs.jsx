import { useEffect, useMemo, useState } from "react";
import { formatDate } from "../lib/format.js";

let blogCache = null;

export default function Blogs({ onBack }) {
  const [posts, setPosts] = useState(blogCache);
  const [failed, setFailed] = useState(false);
  const [year, setYear] = useState("all");
  const [tag, setTag] = useState("all");
  const [active, setActive] = useState(null);

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

  const openPost = (post) => {
    setActive(post);
    window.scrollTo({ top: 0 });
    fetch(`${import.meta.env.BASE_URL}data/posts/${post.slug}.html`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      })
      .then((html) => {
        setActive((cur) => (cur && cur.slug === post.slug ? { ...cur, html } : cur));
      })
      .catch(() => {
        setActive((cur) => (cur && cur.slug === post.slug ? { ...cur, failed: true } : cur));
      });
  };

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

  if (active) {
    return (
      <main id="content" className="container post-page">
        <a
          href="#top"
          className="back-link"
          onClick={(e) => {
            e.preventDefault();
            setActive(null);
          }}
        >
          ← Back to archive
        </a>

        <article className="post">
          <div className="blog-meta">
            <time dateTime={active.date}>{formatDate(active.date)}</time>
            {active.readTime && <span>{active.readTime}</span>}
          </div>
          <h2>{active.title}</h2>
          <ul className="chips">
            {active.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {active.failed ? (
            <p className="state">Could not load this post.</p>
          ) : active.html ? (
            <div className="prose post-body" dangerouslySetInnerHTML={{ __html: active.html }} />
          ) : (
            <p className="state">Loading…</p>
          )}
        </article>
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
          <article
            className="card blog-item blog-link"
            key={post.slug}
            onClick={() => openPost(post)}
          >
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
