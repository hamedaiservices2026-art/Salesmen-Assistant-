import { describe, expect, it } from "vitest";
import { draftContextKey, type CloseDraft, type DraftLine } from "@/domain/ai/draft";
import { clearDraft, loadDraft, saveDraft } from "./draft-store";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const ID = "0123456789abcdef0123456789abcdef";
const lines: DraftLine[] = [
  { lineId: "bev", code: "bev", unit: "cases", kind: "sales" },
  { lineId: "food", code: "food", unit: "value", kind: "sales" },
  { lineId: "coll", code: "coll", unit: "value", kind: "collection" },
];
const KEY = draftContextKey(lines, "2026-11-14");

const draft = (date = "2026-11-14"): CloseDraft => ({
  source: "photo",
  date,
  fields: { "line:bev": { value: 118, confidence: 0.97, low: false, seenAs: "118" }, creditSales: { value: 320000, confidence: 0.62, low: true, seenAs: "3,200" } },
  problems: [],
  reportDate: date,
  dateMismatch: false,
});
const entry = (over: Partial<{ savedAt: number; draftId: string; contextKey: string; transcript: string }> = {}, date = "2026-11-14") => ({
  draft: draft(date),
  draftId: ID,
  savedAt: NOW,
  contextKey: KEY,
  ...over,
});

describe("draft store", () => {
  it("returns a draft saved 23 hours ago and null (and removes it) at 25 hours", () => {
    const s = new MemoryStorage();
    saveDraft(s, "u1", entry({ savedAt: NOW - 23 * HOUR }));
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toEqual({ draft: draft(), draftId: ID });
    saveDraft(s, "u1", entry({ savedAt: NOW - 25 * HOUR }));
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toBeNull();
    expect(s.length).toBe(0);
  });

  it("keeps the transcript of a voice draft", () => {
    const s = new MemoryStorage();
    saveDraft(s, "u1", entry({ transcript: "مشروبات مية وعشرين" }));
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toEqual({ draft: draft(), draftId: ID, transcript: "مشروبات مية وعشرين" });
  });

  it("an entry stored for another date is null", () => {
    const s = new MemoryStorage();
    saveDraft(s, "u1", entry({}, "2026-11-12"));
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toBeNull();
    // Even if the entry were copied under today's key by hand.
    s.setItem("close-draft:u1:2026-11-14", s.getItem("close-draft:u1:2026-11-12")!);
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toBeNull();
    expect(s.getItem("close-draft:u1:2026-11-14")).toBeNull();
  });

  it("a field value that is a string is null and removed", () => {
    const s = new MemoryStorage();
    const bad = JSON.parse(JSON.stringify({ v: 1, ...entry() }));
    bad.draft.fields["line:bev"].value = "118";
    s.setItem("close-draft:u1:2026-11-14", JSON.stringify(bad));
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toBeNull();
    expect(s.length).toBe(0);
  });

  it("two userKeys do not mix", () => {
    const s = new MemoryStorage();
    saveDraft(s, "u1", entry());
    expect(loadDraft(s, "u2", "2026-11-14", NOW, KEY)).toBeNull();
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).not.toBeNull();
    // The other rep's entry is not removed by the failed read.
    expect(s.length).toBe(1);
  });

  it("a different context key (a line changed unit, a line added) is null and removed", () => {
    const s = new MemoryStorage();
    saveDraft(s, "u1", entry());
    const other = draftContextKey([...lines.slice(1), { lineId: "bev", code: "bev", unit: "value", kind: "sales" }], "2026-11-14");
    expect(loadDraft(s, "u1", "2026-11-14", NOW, other)).toBeNull();
    expect(s.length).toBe(0);
  });

  it("refuses broken JSON, a wrong version, unknown properties, a bad draft id and a future save time", () => {
    const s = new MemoryStorage();
    const k = "close-draft:u1:2026-11-14";
    const full = { v: 1, ...entry() };
    for (const bad of ["{not json", "null", "[]", JSON.stringify({ ...full, v: 2 }), JSON.stringify({ ...full, extra: 1 }), JSON.stringify({ ...full, draftId: "../x" }), JSON.stringify({ ...full, savedAt: NOW + 10 * HOUR }), JSON.stringify({ ...full, savedAt: "now" }), JSON.stringify({ ...full, transcript: 5 })]) {
      s.setItem(k, bad);
      expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY), bad).toBeNull();
      expect(s.getItem(k)).toBeNull();
    }
  });

  it("refuses a prototype key inside the stored fields", () => {
    const s = new MemoryStorage();
    const text = JSON.stringify({ v: 1, ...entry() }).replace('"line:bev"', '"__proto__"');
    s.setItem("close-draft:u1:2026-11-14", text);
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toBeNull();
    expect(({} as Record<string, unknown>).value).toBeUndefined();
  });

  it("clearDraft removes only that rep's entry for that day", () => {
    const s = new MemoryStorage();
    saveDraft(s, "u1", entry());
    saveDraft(s, "u2", entry());
    clearDraft(s, "u1", "2026-11-14");
    expect(loadDraft(s, "u1", "2026-11-14", NOW, KEY)).toBeNull();
    expect(loadDraft(s, "u2", "2026-11-14", NOW, KEY)).not.toBeNull();
  });

  it("a userKey or date that is not a plain token touches nothing", () => {
    const s = new MemoryStorage();
    saveDraft(s, "a:b", entry());
    saveDraft(s, "u1", entry({}, "x"));
    expect(s.length).toBe(0);
    expect(loadDraft(s, "a:b", "2026-11-14", NOW, KEY)).toBeNull();
  });

  it("a storage that throws is survived", () => {
    const boom = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => saveDraft(boom, "u1", entry())).not.toThrow();
    expect(loadDraft(boom, "u1", "2026-11-14", NOW, KEY)).toBeNull();
    expect(() => clearDraft(boom, "u1", "2026-11-14")).not.toThrow();
  });
});
