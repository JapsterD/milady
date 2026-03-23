#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  chooseMiladyRuntime,
  resolveRuntimeExecPath,
} from "./run-node-runtime.mjs";

const args = process.argv.slice(2);
const cwd = process.cwd();
const env = { ...process.env };
if (!env.ELIZA_NAMESPACE) {
  env.ELIZA_NAMESPACE = "milady";
}
// WHY: The child runs dist/eliza.js, which dynamic-imports @elizaos/plugin-*. Node does not
// use cwd to resolve package names for import("pkg"); we must set NODE_PATH to repo root
// node_modules so those imports succeed. See docs/plugin-resolution-and-node-path.md.
const rootModules = path.join(cwd, "node_modules");
env.NODE_PATH = env.NODE_PATH
  ? `${rootModules}${path.delimiter}${env.NODE_PATH}`
  : rootModules;
const compiler = "tsdown";

/** systemd often runs this script with Node; child still uses Bun — probe PATH for version warnings. */
const resolveBunVersionForRuntimeChoice = () => {
  if (process.versions?.bun) {
    return process.versions.bun;
  }
  const bunBin =
    process.env.MILADY_BUN_BIN?.trim() ||
    process.env.ELIZA_BUN_BIN?.trim() ||
    "bun";
  try {
    const out = spawnSync(bunBin, ["--version"], {
      encoding: "utf8",
      env: process.env,
    });
    if (out.status !== 0) {
      return undefined;
    }
    const line = out.stdout?.trim()?.split("\n")[0] ?? "";
    const m = line.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : line || undefined;
  } catch {
    return undefined;
  }
};

const resolveTsdownCli = () => {
  const p = path.join(cwd, "node_modules", "tsdown", "dist", "run.mjs");
  return fs.existsSync(p) ? p : null;
};

/** Prefer Node-driven tsdown on minimal VPS (no bunx / Bun crashes on write-build-info). */
const useNodeForTsdown = () =>
  env.MILADY_TSDOWN_NODE === "1" || env.MILADY_VITE_LOW_CPU === "1";

const spawnTsdownBuild = (onExit) => {
  const tsdownCli = resolveTsdownCli();
  const nodeForTsdown = env.ELIZA_NODE_PATH?.trim() || process.execPath;
  if (useNodeForTsdown() && tsdownCli) {
    const build = spawn(nodeForTsdown, [tsdownCli], {
      cwd,
      env,
      stdio: "inherit",
    });
    build.on("exit", onExit);
    return;
  }
  const bunxArgs = [compiler];
  const buildCmd = process.platform === "win32" ? "cmd.exe" : "bunx";
  const buildArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "bunx", ...bunxArgs]
      : bunxArgs;
  const build = spawn(buildCmd, buildArgs, {
    cwd,
    env,
    stdio: "inherit",
  });
  build.on("exit", onExit);
};

const distRoot = path.join(cwd, "dist");
const distEntry = path.join(distRoot, "/entry.js");
const buildStampPath = path.join(distRoot, ".buildstamp");
const srcRoot = path.join(cwd, "src");
const configFiles = [
  path.join(cwd, "tsconfig.json"),
  path.join(cwd, "package.json"),
];

const statMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
};

const isExcludedSource = (filePath) => {
  const relativePath = path.relative(srcRoot, filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }
  return (
    relativePath.endsWith(".test.ts") ||
    relativePath.endsWith(".test.tsx") ||
    relativePath.endsWith(`test-utils.ts`)
  );
};

const findLatestMtime = (dirPath, shouldSkip) => {
  let latest = null;
  const queue = [dirPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkip?.(fullPath)) {
        continue;
      }
      const mtime = statMtime(fullPath);
      if (mtime == null) {
        continue;
      }
      if (latest == null || mtime > latest) {
        latest = mtime;
      }
    }
  }
  return latest;
};

const shouldBuild = () => {
  if (env.ELIZA_FORCE_BUILD === "1") {
    return true;
  }
  const stampMtime = statMtime(buildStampPath);
  if (stampMtime == null) {
    return true;
  }
  if (statMtime(distEntry) == null) {
    return true;
  }

  for (const filePath of configFiles) {
    const mtime = statMtime(filePath);
    if (mtime != null && mtime > stampMtime) {
      return true;
    }
  }

  const srcMtime = findLatestMtime(srcRoot, isExcludedSource);
  if (srcMtime != null && srcMtime > stampMtime) {
    return true;
  }
  return false;
};

const logRunner = (message) => {
  if (env.ELIZA_RUNNER_LOG === "0") {
    return;
  }
  process.stderr.write(`[eliza] ${message}\n`);
};

/** Exit code used by the restart action to signal "restart requested". */
const RESTART_EXIT_CODE = 75;

const runNode = () => {
  const { runtime, warning } = chooseMiladyRuntime({
    requestedRuntime: process.env.ELIZA_RUNTIME,
    platform: process.platform,
    bunVersion: resolveBunVersionForRuntimeChoice(),
  });
  if (warning) {
    logRunner(warning);
  }
  const execPath = resolveRuntimeExecPath({
    runtime,
    currentExecPath: process.execPath,
    platform: process.platform,
    explicitNodePath: process.env.ELIZA_NODE_PATH,
  });
  const nodeProcess = spawn(execPath, ["milady.mjs", ...args], {
    cwd,
    env,
    stdio: "inherit",
  });

  nodeProcess.on("exit", (exitCode, exitSignal) => {
    if (exitSignal) {
      process.exit(1);
    }

    // Restart loop: when the agent requests a restart it exits with code 75.
    // Re-run the full runner (including the build-staleness check) so any
    // source changes are compiled before the new process starts.
    if (exitCode === RESTART_EXIT_CODE) {
      logRunner("Restart requested — relaunching...");

      // Re-check whether a rebuild is needed (source files may have changed).
      if (shouldBuild()) {
        logRunner("Building TypeScript (dist is stale).");
        spawnTsdownBuild((code, signal) => {
          if (signal || (code !== 0 && code !== null)) {
            logRunner("Rebuild failed, restarting anyway.");
          } else {
            writeBuildStamp();
          }
          runNode();
        });
      } else {
        runNode();
      }
      return;
    }

    process.exit(exitCode ?? 1);
  });
};

const writeBuildStamp = () => {
  try {
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(buildStampPath, `${Date.now()}\n`);
  } catch (error) {
    // Best-effort stamp; still allow the runner to start.
    logRunner(
      `Failed to write build stamp: ${error?.message ?? "unknown error"}`,
    );
  }
};

if (!shouldBuild()) {
  runNode();
} else {
  logRunner("Building TypeScript (dist is stale).");
  spawnTsdownBuild((code, signal) => {
    if (signal) {
      process.exit(1);
    }
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
    writeBuildStamp();
    runNode();
  });
}
