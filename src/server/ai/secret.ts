const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** Holds a provider key so it cannot be printed, logged or serialised by accident. */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): "[secret]" {
    return "[secret]";
  }

  toJSON(): "[secret]" {
    return "[secret]";
  }

  [INSPECT](): "[secret]" {
    return "[secret]";
  }
}
