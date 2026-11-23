import { describe, expect, it } from "vitest";
import { checkPostHeaders, readCappedBody } from "./guarded-post";

const URL_ = "https://app.test/app/files";
const OPTS = { requestedWith: "photo", maxBody: 1000, requestUrl: URL_ };
const good = (extra: Record<string, string> = {}) =>
  new Headers({ host: "app.test", origin: "https://app.test", "x-requested-with": "photo", "content-length": "500", ...extra });

/** A request whose body stream sends `chunks` one after another. */
function streamed(chunks: Uint8Array[], headers = good()): Request {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= chunks.length) return c.close();
      c.enqueue(chunks[at++]!);
    },
  });
  return { headers, url: URL_, body } as unknown as Request;
}

describe("checkPostHeaders", () => {
  it("accepts a same-origin request with the header and a declared length within the cap", () => {
    expect(checkPostHeaders(good(), OPTS)).toBeNull();
    expect(checkPostHeaders(good({ "content-length": "1000" }), OPTS)).toBeNull();
  });

  it("refuses a missing Origin and another site's Origin", () => {
    const none = good();
    none.delete("origin");
    expect(checkPostHeaders(none, OPTS)).toBe("bad_origin");
    expect(checkPostHeaders(good({ origin: "https://evil.test" }), OPTS)).toBe("bad_origin");
    expect(checkPostHeaders(good({ origin: "null" }), OPTS)).toBe("bad_origin");
  });

  it("refuses a request without the custom header, or with another value", () => {
    const none = good();
    none.delete("x-requested-with");
    expect(checkPostHeaders(none, OPTS)).toBe("bad_header");
    expect(checkPostHeaders(good({ "x-requested-with": "upload" }), OPTS)).toBe("bad_header");
  });

  it("refuses a Content-Length over the cap, or none at all", () => {
    expect(checkPostHeaders(good({ "content-length": "1001" }), OPTS)).toBe("too_large");
    const none = good();
    none.delete("content-length");
    expect(checkPostHeaders(none, OPTS)).toBe("too_large");
    expect(checkPostHeaders(good({ "content-length": "abc" }), OPTS)).toBe("too_large");
  });
});

describe("readCappedBody", () => {
  it("returns the whole body when it is within the cap", async () => {
    const out = await readCappedBody(streamed([new Uint8Array([1, 2]), new Uint8Array([3])]), 3);
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns null for a stream longer than the cap, whatever the declared length", async () => {
    const lying = good({ "content-length": "10" });
    const chunks = Array.from({ length: 5 }, () => new Uint8Array(400));
    expect(await readCappedBody(streamed(chunks, lying), 1000)).toBeNull();
  });

  it("an absent body is empty", async () => {
    expect(await readCappedBody({ headers: good(), url: URL_, body: null } as unknown as Request, 10)).toEqual(new Uint8Array());
  });
});
