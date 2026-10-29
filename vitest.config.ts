import path from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * `node:sqlite` is a Node built-in that this Vite version does not recognise,
 * so it strips the prefix and tries to load a package called "sqlite".
 * Redirect it to a tiny ESM shim that loads the real built-in through
 * `createRequire`, which bypasses Vite's resolver entirely.
 */
function nodeSqliteShim(): Plugin {
  const virtualId = "\0virtual:node-sqlite";
  return {
    name: "node-sqlite-shim",
    enforce: "pre",
    resolveId(id) {
      if (id === "node:sqlite" || id === "sqlite") return virtualId;
      return null;
    },
    load(id) {
      if (id !== virtualId) return null;
      return [
        'import { createRequire } from "node:module";',
        'const require = createRequire(process.cwd() + "/");',
        'const mod = require("node:sqlite");',
        "export const DatabaseSync = mod.DatabaseSync;",
        "export const StatementSync = mod.StatementSync;",
        "export default mod;",
      ].join("\n");
    },
  };
}

export default defineConfig({
  plugins: [nodeSqliteShim()],
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  ssr: { external: ["node:sqlite"] },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The local store is a process-wide SQLite handle; keep files isolated.
    pool: "forks",
    fileParallelism: false,
  },
});
