import { describe, expect, it } from "vitest";
import { westernDigits } from "./digits";

describe("westernDigits", () => {
  it("makes Arabic-Indic and Persian digits Western and leaves the rest", () => {
    expect(westernDigits("أغذية ٨٢٥٠ ريال و ۱۲۰ كرتونة")).toBe("أغذية 8250 ريال و 120 كرتونة");
    expect(westernDigits("abc 123")).toBe("abc 123");
  });
});
