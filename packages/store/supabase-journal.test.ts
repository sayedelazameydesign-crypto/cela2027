import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseEventJournal } from "./src/journal";

afterEach(() => vi.unstubAllGlobals());

describe("SupabaseEventJournal REST contract", () => {
  it("stores ordered sequence and reads after cursor without interpolating task IDs into filters", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json([{ seq: 4, event: { type: "task_finished" } }]));
    vi.stubGlobal("fetch", fetchMock);
    const journal = new SupabaseEventJournal("https://example.supabase.co", "server-secret");
    await journal.append("task &", { seq: 4, e: { type: "task_finished" } });
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ task_id: "task &", seq: 4, event: { type: "task_finished" } }));
    expect(await journal.after("task &", 3)).toEqual([{ seq: 4, e: { type: "task_finished" } }]);
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.searchParams.get("task_id")).toBe("eq.task &");
    expect(url.searchParams.get("seq")).toBe("gt.3");
    expect(url.searchParams.get("order")).toBe("seq.asc");
  });

  it("fails closed when the durable backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const journal = new SupabaseEventJournal("https://example.supabase.co", "server-secret");
    await expect(journal.append("t", { seq: 0, e: {} })).rejects.toThrow("HTTP 503");
    await expect(journal.after("t", -1)).rejects.toThrow("HTTP 503");
  });
});
