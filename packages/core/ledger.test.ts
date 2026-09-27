import { describe, it, expect } from "vitest";
import { Ledger } from "./src/ledger";

describe("Ledger (سجل الأحداث)", () => {
  it("chains hashes append-only", async () => {
    const l = new Ledger();
    await l.append("a", { x: 1 });
    await l.append("b", { y: 2 });
    expect(l.length).toBe(2);
    const entries = l.export();
    expect(entries[0].prev).toBe("GENESIS");
    expect(entries[1].prev).toBe(entries[0].hash);
  });

  it("verify passes on intact chain", async () => {
    const l = new Ledger();
    for (let i = 0; i < 5; i++) await l.append("evt", { i });
    const r = await l.verify();
    expect(r.valid).toBe(true);
    expect(r.brokenAt).toBeNull();
  });

  it("verify detects retroactive tampering", async () => {
    const l = new Ledger();
    await l.append("a", { secret: false });
    await l.append("b", {});
    const entries = l.export();
    // tamper with the first payload after sealing
    entries[0].payload = { secret: true };
    const forged = Ledger.from(entries);
    const r = await forged.verify();
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
  });

  it("round-trips through export/from", async () => {
    const l = new Ledger();
    await l.append("t", [1, 2, 3]);
    const copy = Ledger.from(l.export());
    expect((await copy.verify()).valid).toBe(true);
    expect(copy.export()[0].payload).toEqual([1, 2, 3]);
  });
});
