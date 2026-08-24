// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const profileFixture = {
  name: "Test Person",
  role: "Engineer",
  tagline: "tag",
  about: ["a"],
  skills: [],
  experience: [],
  projects: [],
  contact: { email: "", github: "", linkedin: "" },
};

function makeWasmExports(flagsJson) {
  const encoded = new TextEncoder().encode(JSON.stringify(flagsJson));
  const buffer = new ArrayBuffer(encoded.length);
  new Uint8Array(buffer).set(encoded);
  return {
    memory: { buffer },
    get_flags_ptr: () => 0,
    get_flags_len: () => encoded.length,
  };
}

function stubEnvironment({ flags = {}, failWasm = false } = {}) {
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (url.includes("flags.wasm")) {
      if (failWasm) return Promise.reject(new Error("wasm offline"));
      const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
      return Promise.resolve({
        arrayBuffer: async () => bytes.buffer.slice(0),
      });
    }
    if (url.includes("profile.json")) {
      return Promise.resolve({ ok: true, json: async () => profileFixture });
    }
    return Promise.reject(new Error(`unmocked ${url}`));
  }));
  vi.stubGlobal("WebAssembly", {
    instantiate: async () => ({ instance: { exports: makeWasmExports(flags) } }),
  });
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mountApp() {
  const App = (await import("../App.jsx")).default;
  render(<App />);
}

describe("App", () => {
  it("renders nothing until flags resolve", async () => {
    stubEnvironment({ flags: {} });
    let resolveInstantiate;
    vi.stubGlobal("WebAssembly", {
      instantiate: () =>
        new Promise((resolve) => (resolveInstantiate = resolve)),
    });
    const App = (await import("../App.jsx")).default;
    render(<App />);
    expect(document.querySelector(".nav")).toBeNull();
    await waitFor(() => expect(resolveInstantiate).toBeTypeOf("function"));
    resolveInstantiate({ instance: { exports: makeWasmExports({}) } });
    await waitFor(() => expect(document.querySelector(".nav")).toBeTruthy());
  });

  it("applies flags loaded from wasm — disabled features are hidden", async () => {
    stubEnvironment({
      flags: { blogs: false, login: false, resume: false, themeToggle: false },
    });
    await mountApp();
    await screen.findByText(/Hi, my name is/i);
    expect(screen.queryByText("Blogs")).toBeNull();
    expect(screen.queryByText("login")).toBeNull();
    expect(screen.queryByText("Resume ↓")).toBeNull();
    expect(screen.queryByText("retro_crt")).toBeNull();
  });

  it("shows enabled features when flags are true", async () => {
    stubEnvironment({
      flags: { blogs: true, login: true, resume: true, themeToggle: true },
    });
    await mountApp();
    await screen.findByText("Blogs");
    expect(screen.getByText("login")).toBeTruthy();
    expect(screen.getByText("Resume ↓")).toBeTruthy();
    expect(screen.getByText("retro_crt")).toBeTruthy();
  });

  it("falls back to defaults (all enabled) when wasm fails to load", async () => {
    stubEnvironment({ failWasm: true });
    await mountApp();
    await screen.findByText("Blogs");
    expect(screen.getByText("login")).toBeTruthy();
    expect(screen.getByText("Resume ↓")).toBeTruthy();
  });

  it("renders profile content once loaded", async () => {
    stubEnvironment({ flags: {} });
    await mountApp();
    expect(await screen.findByText("Test Person.")).toBeTruthy();
    expect(screen.getByText("tag")).toBeTruthy();
  });
});
