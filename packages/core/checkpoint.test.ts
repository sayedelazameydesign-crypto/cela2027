import { describe, expect, it } from "vitest";
import { captureCheckpoint, restoreCheckpoint } from "./src/checkpoint";
import { Workspace } from "./src/workspace";
import { Ledger } from "./src/ledger";

async function fixture() {
  const ws = new Workspace();
  ws.write("pkg/مرحبا.py", "print('مرحبا')\n");
  ws.writeBinary("pkg/picture.bin", new Uint8Array([0, 255, 128, 42]));
  const ledger = new Ledger();
  await ledger.append("step_retrying", { attempt: 1 });
  await ledger.append("step_finished", { status: "VERIFIED" });
  return { ws, ledger };
}

describe("verified Core checkpoint", () => {
  it("round trips unicode text, exact binary bytes and the complete sealed ledger", async () => {
    const { ws, ledger } = await fixture();
    const checkpoint = await captureCheckpoint("task", "goal", "RUNNING", 1, ws, ledger);
    const roundTrip = JSON.parse(JSON.stringify(checkpoint));
    const restored = await restoreCheckpoint(roundTrip);
    expect(restored.workspace.read("pkg/مرحبا.py")).toBe("print('مرحبا')\n");
    expect(restored.workspace.readBinary("pkg/picture.bin")).toEqual(new Uint8Array([0, 255, 128, 42]));
    expect(restored.workspace.totalBytes()).toBe(ws.totalBytes());
    expect(restored.currentStepIndex).toBe(1);
    expect((await restored.ledger.verify()).valid).toBe(true);
    expect(restored.ledger.export()).toEqual(ledger.export());
    const next = await restored.ledger.append("another", {});
    expect(next.prev).toBe(checkpoint.lastLedgerHash);
    expect(next.seq).toBe(2);
  });

  it("refuses altered hashes, incomplete chains and a falsified terminal hash", async () => {
    const { ws, ledger } = await fixture();
    const source = await captureCheckpoint("task", "goal", "RUNNING", 1, ws, ledger);
    const mutate = (fn: (value: typeof source) => void) => {
      const copy = structuredClone(source);
      fn(copy);
      return restoreCheckpoint(copy);
    };
    await expect(mutate((s) => { s.ledger[0].payload = { attempt: 999 }; })).rejects.toThrow();
    await expect(mutate((s) => { s.ledger.splice(0, 1); })).rejects.toThrow();
    await expect(mutate((s) => { s.lastLedgerHash = "0".repeat(64); })).rejects.toThrow();
  });

  it("rejects traversal and malformed base64 rather than writing outside the workspace", async () => {
    const { ws, ledger } = await fixture();
    const source = await captureCheckpoint("task", "goal", "RUNNING", 1, ws, ledger);
    const escape = structuredClone(source);
    escape.workspace["../escape"] = "x";
    await expect(restoreCheckpoint(escape)).rejects.toThrow();
    const corrupted = structuredClone(source);
    corrupted.workspace["pkg/picture.bin"] = { base64: "!!!" };
    await expect(restoreCheckpoint(corrupted)).rejects.toThrow();
  });
});
