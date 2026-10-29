// Fails fast with a clear message if the runtime cannot provide node:sqlite.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
  require("node:sqlite");
} catch {
  console.error(
    "\n[setup] This project needs Node.js 22.5+ for the built-in node:sqlite driver.\n" +
      `[setup] Detected ${process.version}. Install Node 24 LTS and re-run npm install.\n`,
  );
  process.exit(1);
}
