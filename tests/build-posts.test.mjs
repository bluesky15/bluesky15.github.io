import { describe, it, expect } from "vitest";
import { parsePost, sortPosts, buildPosts } from "../scripts/build-posts.mjs";

const validRaw = `---
title: "Hello World"
summary: "A teaser"
date: "2026-08-24"
tags: ["Android", "Kotlin"]
readTime: "6 min"
---

## Section

Some **bold** text.
`;

describe("parsePost", () => {
  it("parses frontmatter into a post object with slug from filename", () => {
    const { post } = parsePost("hello-world.md", validRaw);
    expect(post).toEqual({
      slug: "hello-world",
      title: "Hello World",
      summary: "A teaser",
      date: "2026-08-24",
      tags: ["Android", "Kotlin"],
      readTime: "6 min",
    });
  });

  it("converts markdown body to html including gfm headings and emphasis", () => {
    const { html } = parsePost("x.md", validRaw);
    expect(html).toContain("<h2>Section</h2>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders gfm tables", () => {
    const raw = `---\ntitle: t\ndate: 2026-01-01\ntags: [a]\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |`;
    const { html } = parsePost("x.md", raw);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("defaults optional fields to empty strings", () => {
    const raw = `---\ntitle: OnlyTitle\ndate: 2026-05-05\ntags: [x]\n---\nbody`;
    const { post } = parsePost("only.md", raw);
    expect(post.summary).toBe("");
    expect(post.readTime).toBe("");
  });

  it.each([
    ["title", `date: 2026-01-01\ntags: [a]`],
    ["date", `title: T\ntags: [a]`],
    ["tags", `title: T\ndate: 2026-01-01`],
  ])("throws listing missing field %s", (field, frontmatter) => {
    const raw = `---\n${frontmatter}\n---\nbody`;
    expect(() => parsePost("bad.md", raw)).toThrow(/missing frontmatter field\(s\)/);
    expect(() => parsePost("bad.md", raw)).toThrow(new RegExp(field));
  });

  it("throws when tags array is empty", () => {
    const raw = `---\ntitle: T\ndate: 2026-01-01\ntags: []\n---\nbody`;
    expect(() => parsePost("bad.md", raw)).toThrow(/tags/);
  });

  it.each(["24-08-2026", "2026/08/24", "20260824", "2026-8-2"])(
    "throws for malformed date %s",
    (bad) => {
      const raw = `---\ntitle: T\ndate: ${bad}\ntags: [a]\n---\nbody`;
      expect(() => parsePost("bad.md", raw)).toThrow(/date must be YYYY-MM-DD/);
    }
  );

  it("normalizes unquoted YAML dates (parsed as Date objects) to YYYY-MM-DD", () => {
    const raw = `---\ntitle: T\ndate: 2026-01-09\ntags: [a]\n---\nbody`;
    const { post } = parsePost("x.md", raw);
    expect(post.date).toBe("2026-01-09");
  });
});

describe("sortPosts", () => {
  it("sorts newest first without mutating input", () => {
    const input = [
      { date: "2024-01-01" },
      { date: "2026-08-02" },
      { date: "2025-06-14" },
    ];
    const sorted = sortPosts(input);
    expect(sorted.map((p) => p.date)).toEqual(["2026-08-02", "2025-06-14", "2024-01-01"]);
    expect(input.map((p) => p.date)).toEqual(["2024-01-01", "2026-08-02", "2025-06-14"]);
  });

  it("is stable for identical dates", () => {
    const input = [
      { date: "2026-01-01", title: "first" },
      { date: "2026-01-01", title: "second" },
    ];
    expect(sortPosts(input).map((p) => p.title)).toEqual(["first", "second"]);
  });
});

describe("buildPosts", () => {
  function makeFs(files) {
    return {
      readdirSync: () => Object.keys(files),
      readFileSync: (path) => files[path.split("/").pop()],
      mkdirSync: () => {},
      writeFileSync: (path, data) => { files[`__written:${path}`] = data; },
      rmSync: () => {},
    };
  }

  it("writes an html file per post and a sorted index json", () => {
    const files = {
      "b.md": `---\ntitle: B\ndate: 2025-01-01\ntags: [x]\n---\nb`,
      "a.md": `---\ntitle: A\ndate: 2026-01-01\ntags: [y]\n---\na`,
    };
    const fs = makeFs(files);
    const result = buildPosts("content/posts", "public/data", fs);

    expect(result.map((p) => p.slug)).toEqual(["a", "b"]);
    expect(files["__written:public/data/posts/a.html"]).toContain("a");
    const index = JSON.parse(files["__written:public/data/blogs.json"]);
    expect(index).toHaveLength(2);
    expect(index[0].date).toBe("2026-01-01");
  });

  it("clears stale generated posts between runs", () => {
    const removed = [];
    const fs = makeFs({ "a.md": `---\ntitle: A\ndate: 2026-01-01\ntags: [x]\n---\na` });
    fs.rmSync = (p) => removed.push(p);
    buildPosts("content/posts", "public/data", fs);
    expect(removed[0]).toBe(["public", "data", "posts"].join("/"));
  });

  it("throws when the posts directory is empty", () => {
    const fs = makeFs({});
    expect(() => buildPosts("empty", "out", fs)).toThrow(/No markdown files found in empty\//);
  });

  it("propagates validation errors from individual posts", () => {
    const fs = makeFs({
      "ok.md": `---\ntitle: OK\ndate: 2026-01-01\ntags: [x]\n---\nok`,
      "bad.md": `---\ntitle: Bad\ndate: nope\ntags: [x]\n---\nbad`,
    });
    expect(() => buildPosts("content/posts", "public/data", fs)).toThrow(/date must be YYYY-MM-DD/);
  });
});
