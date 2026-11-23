import { describe, expect, it, vi } from "vitest";

describe("loading the provider layer", () => {
  it("does not load sharp until a vision call needs it", async () => {
    let loaded = false;
    vi.resetModules();
    vi.doMock("sharp", () => {
      loaded = true;
      const sharp = Object.assign(() => ({ metadata: async () => ({ width: 640, height: 40 }) }), { cache: () => {}, block: () => {} });
      return { default: sharp };
    });
    try {
      const { getProviders } = await import("./providers");
      const { readAiConfig } = await import("./config");
      const [fake] = getProviders("vision", readAiConfig({ AI_PROVIDER: "fake" }));
      expect(fake?.name).toBe("fake");
      expect(loaded).toBe(false);

      await fake!.vision(
        { image: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), system: "s", prompt: "p", maxOutputTokens: 10 },
        new AbortController().signal,
      );
      expect(loaded).toBe(true);
    } finally {
      vi.doUnmock("sharp");
      vi.resetModules();
    }
  });
});
