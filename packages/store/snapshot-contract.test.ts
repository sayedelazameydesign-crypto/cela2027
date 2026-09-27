import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySnapshotStore, SupabaseSnapshotStore } from "./src/persistent_store";
import type { TaskSnapshot } from "./src/types";

const snapshot: TaskSnapshot = {
  version: 1, id: "task", goal: "build", status: "RUNNING", currentStepIndex: 2,
  workspace: { "data.bin": { base64: "AP8=" }, "test.py": "print(1)" },
  ledger: [{ seq: 0, at: "2026-01-01", type: "start", payload: {}, prev: "GENESIS", hash: "abc" }],
  lastLedgerHash: "abc",
};
afterEach(() => vi.unstubAllGlobals());

describe("SnapshotStore contract", () => {
  it("memory adapter round trips independent copies", async () => {
    const store = new MemorySnapshotStore();
    await store.saveSnapshot(snapshot);
    const loaded = await store.loadSnapshot("task");
    expect(loaded).toEqual(snapshot);
    (loaded!.workspace["data.bin"] as { base64: string }).base64 = "bad";
    expect(await store.loadSnapshot("task")).toEqual(snapshot);
    expect(await store.loadSnapshot("missing")).toBeUndefined();
  });

  it("Supabase adapter saves and loads JSON data with encoded task id and errors fail closed", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json([{ snapshot }]));
    vi.stubGlobal("fetch", fetchMock);
    const store = new SupabaseSnapshotStore("https://example.supabase.co", "secret");
    await store.saveSnapshot(snapshot);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ task_id: "task", snapshot });
    expect(await store.loadSnapshot("task &")).toEqual(snapshot);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("task_id")).toBe("eq.task &");
    await expect(store.saveSnapshot({ ...snapshot, workspace: { big: "x".repeat(520_000) } }))
      .rejects.toThrow("external blob storage required");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(store.loadSnapshot("task")).rejects.toThrow("503");
  });
});
