import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The repository-wide checks of plan 3, Task 20, Step 5 (R40, R43): where the provider and storage
// keys may be named, and what browser code may import from the server.

const ROOT = path.resolve(__dirname, "..");

/** Tracked files plus untracked ones that are not ignored (so a new file is checked before it is committed). */
function repoFiles(): string[] {
  const git = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.split("\n").filter(Boolean);
  };
  return [...new Set([...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])])];
}

const TEXT = /\.(?:ts|tsx|mjs|js|cjs|json|md|css|yml|yaml|example|txt)$|(?:^|\/)\.env\.example$/;
const isText = (file: string) => TEXT.test(file) && !/\.(?:jpg|png|xlsx)$/.test(file);
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("key variable names (R40)", () => {
  const KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  // Code that reads or clears them, the examples and the documents. Tests may name them freely.
  const ALLOWED = (file: string) =>
    file === "src/server/ai/config.ts" ||
    file === "src/server/files/store.ts" ||
    file === "scripts/ai-smoke.mjs" ||
    // the end-to-end runs remove them from the environment they start the server with
    file === "scripts/e2e-ai.mjs" ||
    file === ".env.example" ||
    /\.test\.tsx?$/.test(file) ||
    /\.md$/.test(file);

  it("appear only in the reading code, the smoke check, tests, .env.example and the documents", () => {
    const offenders: string[] = [];
    for (const file of repoFiles().filter(isText)) {
      if (ALLOWED(file)) continue;
      const text = read(file);
      for (const key of KEYS) if (text.includes(key)) offenders.push(`${file}: ${key}`);
    }
    expect(offenders).toEqual([]);
  });

  it("never appear behind a NEXT_PUBLIC_ name anywhere", () => {
    const offenders: string[] = [];
    for (const file of repoFiles().filter(isText)) {
      // The documents may say "never NEXT_PUBLIC_*"; a variable named after a key is what is refused.
      const text = read(file);
      for (const key of KEYS) if (text.includes(`NEXT_PUBLIC_${key}`)) offenders.push(`${file}: NEXT_PUBLIC_${key}`);
      if (/NEXT_PUBLIC_[A-Z_]*(?:GEMINI|GROQ|OPENROUTER|SERVICE_ROLE)/.test(text)) offenders.push(`${file}: a NEXT_PUBLIC_ variable named after a key`);
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("are read from the environment in exactly two places", () => {
    const readers = repoFiles()
      .filter((f) => /^src\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => KEYS.some((k) => read(f).includes(k)));
    expect(readers.sort()).toEqual(["src/server/ai/config.ts", "src/server/files/store.ts"]);
  });
});

/** True when the file's first statement is the "use client" directive. */
export function isClientFile(source: string): boolean {
  const withoutLeadingComments = source.replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(withoutLeadingComments);
}

type Import = { from: string; typeOnly: boolean };

/** Every static import, `export … from`, and dynamic `import("…")` in a source text. */
export function importsOf(source: string): Import[] {
  const out: Import[] = [];
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const m of stripped.matchAll(/\b(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*["']([^"']+)["']/g)) {
    const clause = m[3] ?? "";
    const named = /\{([\s\S]*)\}/.exec(clause)?.[1];
    const allMembersTyped = named !== undefined && named.split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
    const defaultPart = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    out.push({ from: m[4]!, typeOnly: m[2] !== undefined || (allMembersTyped && defaultPart === "") });
  }
  for (const m of stripped.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g)) out.push({ from: m[1]!, typeOnly: false });
  for (const m of stripped.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ from: m[1]!, typeOnly: false });
  return out;
}

/** The part of an import path below `src/`, for both `@/…` and relative specifiers. */
function resolveSrc(file: string, from: string): string | null {
  if (from.startsWith("@/")) return from.slice(2);
  if (from.startsWith(".")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), from));
    return target.startsWith("src/") ? target.slice(4) : null;
  }
  return null;
}

describe("import scanner", () => {
  it("finds client files, value imports and type-only imports", () => {
    expect(isClientFile('"use client";\nimport x from "y";')).toBe(true);
    expect(isClientFile("// note\n/* block */\n'use client'\n")).toBe(true);
    expect(isClientFile('import x from "y";\n"use client";')).toBe(false);
    const found = importsOf(
      [
        'import { a } from "@/server/a";',
        'import type { B } from "@/server/b";',
        'import { type C, type D } from "@/server/c";',
        'import { type E, f } from "@/server/d";',
        'export { g } from "@/server/e";',
        'export type { H } from "@/server/f";',
        'import "@/server/g";',
        'const m = await import("@/server/h");',
        '// import { z } from "@/server/commented";',
      ].join("\n"),
    );
    expect(found).toEqual([
      { from: "@/server/a", typeOnly: false },
      { from: "@/server/b", typeOnly: true },
      { from: "@/server/c", typeOnly: true },
      { from: "@/server/d", typeOnly: false },
      { from: "@/server/e", typeOnly: false },
      { from: "@/server/f", typeOnly: true },
      { from: "@/server/g", typeOnly: false },
      { from: "@/server/h", typeOnly: false },
    ]);
  });
});

describe("browser code and the server (R43)", () => {
  const clientFiles = repoFiles()
    .filter((f) => /^src\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => isClientFile(read(f)));

  it("finds the client files it is meant to check", () => {
    expect(clientFiles.length).toBeGreaterThan(20);
    expect(clientFiles).toContain("src/app/app/close/close-form.tsx");
    expect(clientFiles).toContain("src/app/app/assistant/chat.tsx");
  });

  it("no client file imports the AI or the file-storage modules, not even for types", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      for (const imp of importsOf(read(file))) {
        const target = resolveSrc(file, imp.from);
        if (target !== null && /^server\/(?:ai|files)(?:\/|$)/.test(target)) offenders.push(`${file}: ${imp.from}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no client file has a value import from @/server/** except upload-request-shared", () => {
    const offenders: string[] = [];
    for (const file of clientFiles) {
      for (const imp of importsOf(read(file))) {
        const target = resolveSrc(file, imp.from);
        if (target === null || !/^server(?:\/|$)/.test(target)) continue;
        if (imp.typeOnly) continue;
        if (target === "server/admin/upload-request-shared") continue;
        offenders.push(`${file}: ${imp.from}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no client file reaches the AI or the file-storage modules through other modules (value imports, followed transitively; server actions are the boundary)", () => {
    const fileOf = (target: string): string | null => {
      for (const c of [`src/${target}.ts`, `src/${target}.tsx`, `src/${target}/index.ts`, `src/${target}/index.tsx`, `src/${target}`]) {
        if (/\.tsx?$/.test(c) && existsSync(path.join(ROOT, c))) return c;
      }
      return null;
    };
    const offenders: string[] = [];
    for (const start of clientFiles) {
      const seen = new Set<string>([start]);
      const queue: { file: string; via: string[] }[] = [{ file: start, via: [start] }];
      while (queue.length > 0) {
        const { file, via } = queue.shift()!;
        for (const imp of importsOf(read(file))) {
          if (imp.typeOnly) continue;
          const target = resolveSrc(file, imp.from);
          if (target === null) continue;
          if (/^server\/(?:ai|files)(?:\/|$)/.test(target)) {
            offenders.push([...via, imp.from].join(" -> "));
            continue;
          }
          const next = fileOf(target);
          if (next === null || seen.has(next)) continue;
          // A "use server" module reaches the browser only as action references, never as code.
          if (/^["']use server["']/.test(read(next).replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, ""))) continue;
          seen.add(next);
          queue.push({ file: next, via: [...via, next] });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no client file reads process.env", () => {
    const offenders = clientFiles.filter((f) => /\bprocess\.env\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
