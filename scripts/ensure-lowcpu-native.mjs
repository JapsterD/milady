#!/usr/bin/env node
/**
 * After install on Linux x86_64 without sse4_2, prebuilt sharp fails at runtime
 * ("x86-64-v2"). Rebuild sharp from source against distro libvips when possible.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (
  process.env.MILADY_SKIP_LOWCPU_SHARP_REBUILD === "1" ||
  process.env.MILADY_SKIP_LOWCPU_NATIVE === "1"
) {
  process.exit(0);
}

if (os.platform() !== "linux") {
  process.exit(0);
}
if (os.arch() !== "x64") {
  process.exit(0);
}

let flags = "";
try {
  const text = fs.readFileSync("/proc/cpuinfo", "utf8");
  const m = text.match(/^flags\s*:\s*(.+)$/m);
  flags = m?.[1] ?? "";
} catch {
  process.exit(0);
}

if (/\bsse4_2\b/.test(flags)) {
  process.exit(0);
}

const script = path.join(root, "scripts", "rebuild-sharp-lowcpu.sh");
const result = spawnSync("bash", [script], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env },
});

if (result.status !== 0) {
  console.warn(
    "[milady] CPU lacks sse4_2 (prebuilt sharp will not load). Install build deps, then run: bun run rebuild:sharp-lowcpu\n" +
      "  apt install -y build-essential python3 pkg-config libvips-dev libglib2.0-dev",
  );
}

process.exit(0);
