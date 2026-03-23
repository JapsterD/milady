const KNOWN_RISKY_BUN_LINUX = /^1\.3\.(?:9|[1-9][0-9])(?:$|[-+].*)/;

/**
 * Bun 1.3.9+ on Linux has crash reports on some hosts (no AVX / odd vCPUs).
 * We do NOT fall back to Node for `milady.mjs`: Node cannot resolve some
 * extensionless ESM imports in @elizaos/agent. Use MILADY_BUN_BIN with Bun 1.2.x instead.
 */
export function isKnownRiskyBunOnLinux({ platform, bunVersion }) {
  return (
    platform === "linux" &&
    typeof bunVersion === "string" &&
    KNOWN_RISKY_BUN_LINUX.test(bunVersion)
  );
}

/**
 * Explicit path to the Bun binary for the Milady child process (runtime = bun).
 * Prefer this on VPS when system Bun is 1.3.x and crashes; use Bun 1.2.22+ here.
 */
export function resolveBunExecPath() {
  const explicit =
    process.env.MILADY_BUN_BIN?.trim() || process.env.ELIZA_BUN_BIN?.trim();
  if (explicit) {
    return explicit;
  }
  return "bun";
}

/**
 * Runtime selection priority:
 * 1) Explicit ELIZA_RUNTIME override (bun|node)
 * 2) Default to bun (see warnings for risky Bun/Linux combos)
 */
export function chooseMiladyRuntime({
  requestedRuntime,
  platform,
  bunVersion,
}) {
  const normalized = requestedRuntime?.trim().toLowerCase();
  if (normalized === "bun" || normalized === "node") {
    return { runtime: normalized, warning: null };
  }

  if (isKnownRiskyBunOnLinux({ platform, bunVersion })) {
    return {
      runtime: "bun",
      warning:
        "Bun 1.3.9+ on Linux can crash on weak CPUs. Install Bun 1.2.22 and set MILADY_BUN_BIN to that binary (see scripts/rebuild-sharp-lowcpu.sh / VPS docs).",
    };
  }

  return { runtime: "bun", warning: null };
}

export function resolveNodeExecPath({
  currentExecPath,
  platform,
  explicitNodePath,
}) {
  const explicit = explicitNodePath?.trim();
  if (explicit) {
    return explicit;
  }

  const normalized =
    platform === "win32"
      ? (currentExecPath ?? "").toLowerCase()
      : (currentExecPath ?? "");
  const looksLikeBun = /(?:^|[\\/])bun(?:\.exe)?$/.test(normalized);

  if (!looksLikeBun && normalized.length > 0) {
    return currentExecPath;
  }

  return platform === "win32" ? "node.exe" : "node";
}

export function resolveRuntimeExecPath({
  runtime,
  currentExecPath,
  platform,
  explicitNodePath,
}) {
  if (runtime === "bun") {
    return resolveBunExecPath();
  }
  return resolveNodeExecPath({
    currentExecPath,
    platform,
    explicitNodePath,
  });
}
