/**
 * Event ledger — append-only, hash-chained (SHA-256), replayable.
 * Same guarantees as agi-system's EventLedger:
 *   prev + payload → hash; any retroactive edit breaks the chain.
 * Runs in Node (crypto.subtle) and modern browsers.
 */

export interface LedgerEntry {
  seq: number;
  at: string;
  type: string;
  payload: unknown;
  prev: string; // "GENESIS" | previous hash
  hash: string;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class Ledger {
  private entries: LedgerEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  /** append an event; returns the sealed entry */
  async append(type: string, payload: unknown): Promise<LedgerEntry> {
    const prev =
      this.entries.length === 0
        ? "GENESIS"
        : this.entries[this.entries.length - 1].hash;
    const at = new Date().toISOString();
    const material = JSON.stringify({ seq: this.entries.length, at, type, payload, prev });
    const hash = await sha256Hex(material);
    const entry: LedgerEntry = {
      seq: this.entries.length,
      at,
      type,
      payload,
      prev,
      hash,
    };
    this.entries.push(entry);
    return entry;
  }

  /** verify the full chain; returns first broken seq or null */
  async verify(): Promise<{ valid: boolean; brokenAt: number | null }> {
    let prev = "GENESIS";
    for (const e of this.entries) {
      if (e.prev !== prev) return { valid: false, brokenAt: e.seq };
      const material = JSON.stringify({ seq: e.seq, at: e.at, type: e.type, payload: e.payload, prev: e.prev });
      const expected = await sha256Hex(material);
      if (expected !== e.hash) return { valid: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { valid: true, brokenAt: null };
  }

  export(): LedgerEntry[] {
    return [...this.entries];
  }

  static from(entries: LedgerEntry[]): Ledger {
    const l = new Ledger();
    l.entries = [...entries];
    return l;
  }
}
