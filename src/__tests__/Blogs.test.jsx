// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const postsFixture = [
  {
    slug: "newer-post",
    title: "Newer Post",
    summary: "s1",
    date: "2026-08-02",
    tags: ["Android"],
    readTime: "8 min",
  },
  {
    slug: "older-post",
    title: "Older Post",
    summary: "s2",
    date: "2025-06-14",
    tags: ["Rust"],
    readTime: "6 min",
  },
];

function makeFetch({ failIndex = false } = {}) {
  return vi.fn((url) => {
    if (url.includes("blogs.json")) {
      if (failIndex) return Promise.reject(new Error("offline"));
      return Promise.resolve({ ok: true, json: async () => postsFixture });
    }
    if (url.includes("/posts/")) {
      const slug = url.split("/posts/")[1].replace(".html", "");
      return Promise.resolve({
        ok: true,
        text: async () => `<h2>Body of ${slug}</h2><p>With <em>markdown</em>.</p>`,
      });
    }
    return Promise.reject(new Error(`unmocked url ${url}`));
  });
}

async function mountBlogs(fetchImpl, onBack = () => {}) {
  vi.stubGlobal("fetch", fetchImpl);
  const { default: Blogs } = await import("../components/Blogs.jsx");
  render(<Blogs onBack={onBack} />);
}

beforeEach(() => {
  vi.resetModules();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Blogs archive", () => {
  it("shows a loading state before data arrives", async () => {
    let resolveFetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (resolveFetch = resolve)))
    );
    const { default: Blogs } = await import("../components/Blogs.jsx");
    render(<Blogs onBack={() => {}} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    resolveFetch({ ok: true, json: async () => postsFixture });
    await screen.findByText("Newer Post");
  });

  it("shows an error state when the index fails to load", async () => {
    await mountBlogs(makeFetch({ failIndex: true }));
    await screen.findByText(/Could not load the blog posts/);
  });

  it("renders all posts with correct pluralized count", async () => {
    await mountBlogs(makeFetch());
    expect(await screen.findByText("Newer Post")).toBeTruthy();
    expect(screen.getByText("Older Post")).toBeTruthy();
    expect(screen.getByText("2 posts")).toBeTruthy();
  });

  it("uses singular wording for a single post", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) =>
        url.includes("blogs.json")
          ? Promise.resolve({ ok: true, json: async () => [postsFixture[0]] })
          : Promise.reject(new Error("unmocked"))
      )
    );
    const { default: Blogs } = await import("../components/Blogs.jsx");
    render(<Blogs onBack={() => {}} />);
    expect(await screen.findByText("1 post")).toBeTruthy();
  });

  it("filters by year and by tag", async () => {
    await mountBlogs(makeFetch());
    await screen.findByText("Newer Post");

    fireEvent.change(screen.getByLabelText("Filter by date"), {
      target: { value: "2025" },
    });
    expect(screen.queryByText("Newer Post")).toBeNull();
    expect(screen.getByText("Older Post")).toBeTruthy();
    expect(screen.getByText("1 post")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Tag"), {
      target: { value: "Android" },
    });
    expect(screen.getByText("No posts match those filters."));
  });

  it("back-to-profile link triggers onBack", async () => {
    const onBack = vi.fn();
    await mountBlogs(makeFetch(), onBack);
    await screen.findByText("Newer Post");
    fireEvent.click(screen.getByText("← Back to profile"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("Blogs reader view", () => {
  it("opens a post, lazy-fetches its html and renders it", async () => {
    const fetchImpl = makeFetch();
    await mountBlogs(fetchImpl);
    fireEvent.click(await screen.findByText("Newer Post"));

    expect(await screen.findByRole("heading", { level: 2 })).toBeTruthy();
    expect(screen.getByText("← Back to archive")).toBeTruthy();
    await waitFor(() => {
      const body = document.querySelector(".post-body");
      expect(body).toBeTruthy();
      expect(body.querySelector("h2").textContent).toBe("Body of newer-post");
      expect(body.querySelector("em").textContent).toBe("markdown");
    });
    const htmlCalls = fetchImpl.mock.calls.filter(([u]) => u.includes("/posts/"));
    expect(htmlCalls).toHaveLength(1);
  });

  it("shows an error when post html fails to load", async () => {
    const failing = makeFetch();
    failingImplementation(failing);
    await mountBlogs(failing);
    fireEvent.click(await screen.findByText("Newer Post"));
    await screen.findByText("Could not load this post.");
  });

  function failingImplementation(fetchImpl) {
    fetchImpl.mockImplementation((url) => {
      if (url.includes("blogs.json")) {
        return Promise.resolve({ ok: true, json: async () => postsFixture });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
  }

  it("returns to the archive via back link", async () => {
    await mountBlogs(makeFetch());
    fireEvent.click(await screen.findByText("Newer Post"));
    fireEvent.click(await screen.findByText("← Back to archive"));
    expect(await screen.findByText("Blog Archive")).toBeTruthy();
  });
});

describe("formatDate", () => {
  it.each([
    ["2026-08-02", "Aug 2, 2026"],
    ["2025-11-21", "Nov 21, 2025"],
    ["2024-01-09", "Jan 9, 2024"],
  ])("formats %s as %s", async (iso, expected) => {
    const { formatDate } = await import("../lib/format.js");
    expect(formatDate(iso)).toBe(expected);
  });
});
