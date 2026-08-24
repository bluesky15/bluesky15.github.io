import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function instantiateFlagsModule() {
  const bytes = readFileSync(join(process.cwd(), "public", "data", "flags.wasm"));
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { instance } = await WebAssembly.instantiate(copy);
  return instance.exports;
}

describe("flags.wasm artifact", () => {
  it("exists and is a valid wasm binary (magic header)", () => {
    const bytes = readFileSync(join(process.cwd(), "public", "data", "flags.wasm"));
    expect(bytes.length).toBeGreaterThan(4);
    expect([...bytes.slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it("instantiates without any imports", async () => {
    const exports = await instantiateFlagsModule();
    expect(exports.get_flags_ptr).toBeTypeOf("function");
    expect(exports.get_flags_len).toBeTypeOf("function");
    expect(exports.memory).toBeDefined();
  });

  it("exposes the exact flag keys with boolean values", async () => {
    const e = await instantiateFlagsModule();
    const json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.get_flags_ptr(), e.get_flags_len()))
    );
    for (const key of ["blogs", "login", "resume", "themeToggle"]) {
      expect(json).toHaveProperty(key);
      expect(typeof json[key]).toBe("boolean");
    }
  });

  it("is in sync with the source config wasm/flags/flags.json", async () => {
    const source = JSON.parse(
      readFileSync(join(process.cwd(), "wasm", "flags", "flags.json"), "utf8")
    );
    const e = await instantiateFlagsModule();
    const embedded = JSON.parse(
      new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.get_flags_ptr(), e.get_flags_len()))
    );
    expect(embedded).toEqual(source);
  });
});
