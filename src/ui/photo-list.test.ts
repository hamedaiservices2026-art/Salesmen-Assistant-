import { describe, expect, it } from "vitest";
import { addPhoto, removePhoto } from "./photo-list";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const D = "d".repeat(32);

describe("photo list updates (R71)", () => {
  it("adds to the latest list, never past the limit, never twice", () => {
    expect(addPhoto([A], B, 3)).toEqual([A, B]);
    expect(addPhoto([A, B, C], D, 3)).toEqual([A, B, C]);
    expect(addPhoto([A], A, 3)).toEqual([A]);
  });

  it("two uploads finishing one after the other both survive when applied as updates", () => {
    // Both started from [] (the render at the time); applied as updates they compose.
    const updates = [(l: string[]) => addPhoto(l, A, 3), (l: string[]) => addPhoto(l, B, 3)];
    expect(updates.reduce((list, f) => f(list), [] as string[])).toEqual([A, B]);
  });

  it("a remove during an upload is kept when the upload lands", () => {
    const list = [A, B];
    const afterRemove = removePhoto(list, A);
    expect(addPhoto(afterRemove, C, 3)).toEqual([B, C]);
  });
});
