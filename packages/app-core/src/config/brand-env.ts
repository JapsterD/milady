/**
 * Shared brand-env aliasing — single source of truth for Milady ↔ Eliza
 * environment variable mirroring.
 */

export const BRAND_ENV_ALIASES = [
  // From api/server.ts
  ["MILADY_API_TOKEN", "ELIZA_API_TOKEN"],
  ["MILADY_API_BIND", "ELIZA_API_BIND"],
  ["MILADY_PAIRING_DISABLED", "ELIZA_PAIRING_DISABLED"],
  ["MILADY_ALLOWED_ORIGINS", "ELIZA_ALLOWED_ORIGINS"],
  ["MILADY_ALLOWED_HOSTS", "ELIZA_ALLOWED_HOSTS"],
  ["MILADY_ALLOW_NULL_ORIGIN", "ELIZA_ALLOW_NULL_ORIGIN"],
  ["MILADY_ALLOW_WS_QUERY_TOKEN", "ELIZA_ALLOW_WS_QUERY_TOKEN"],
  ["MILADY_WALLET_EXPORT_TOKEN", "ELIZA_WALLET_EXPORT_TOKEN"],
  ["MILADY_TERMINAL_RUN_TOKEN", "ELIZA_TERMINAL_RUN_TOKEN"],
  ["MILADY_STATE_DIR", "ELIZA_STATE_DIR"],
  ["MILADY_CONFIG_PATH", "ELIZA_CONFIG_PATH"],
  // From runtime/eliza.ts
  ["MILADY_CLOUD_TTS_DISABLED", "ELIZA_CLOUD_TTS_DISABLED"],
  ["MILADY_CLOUD_MEDIA_DISABLED", "ELIZA_CLOUD_MEDIA_DISABLED"],
  ["MILADY_CLOUD_EMBEDDINGS_DISABLED", "ELIZA_CLOUD_EMBEDDINGS_DISABLED"],
  ["MILADY_CLOUD_RPC_DISABLED", "ELIZA_CLOUD_RPC_DISABLED"],
  ["MILADY_DISABLE_LOCAL_EMBEDDINGS", "ELIZA_DISABLE_LOCAL_EMBEDDINGS"],
  ["MILADY_DISABLE_EDGE_TTS", "ELIZA_DISABLE_EDGE_TTS"],
  // Port aliases
  ["MILADY_PORT", "ELIZA_PORT"],
  ["MILADY_API_PORT", "ELIZA_API_PORT"],
  ["MILADY_GATEWAY_PORT", "ELIZA_GATEWAY_PORT"],
  ["MILADY_BRIDGE_PORT", "ELIZA_BRIDGE_PORT"],
] as const;

const miladyMirroredEnvKeys = new Set<string>();
const elizaMirroredEnvKeys = new Set<string>();

function shouldForceElizaProductionNodeEnv(): boolean {
  if (process.env.MILADY_FORCE_ELIZA_PRODUCTION_UI === "0") {
    return false;
  }
  if (process.env.MILADY_FORCE_ELIZA_PRODUCTION_UI === "1") {
    return true;
  }
  const hasApiToken =
    Boolean(process.env.MILADY_API_TOKEN?.trim()) ||
    Boolean(process.env.ELIZA_API_TOKEN?.trim());
  // Eliza serves apps/app/dist only when NODE_ENV is "production" (resolveUiDir).
  // Deploys that set an API token almost always need the HTML dashboard on GET /.
  return hasApiToken;
}

export function syncMiladyEnvToEliza(): void {
  if (shouldForceElizaProductionNodeEnv()) {
    process.env.NODE_ENV = "production";
  }

  for (const [miladyKey, elizaKey] of BRAND_ENV_ALIASES) {
    const value = process.env[miladyKey];
    if (typeof value === "string") {
      process.env[elizaKey] = value;
      elizaMirroredEnvKeys.add(elizaKey);
    } else if (elizaMirroredEnvKeys.has(elizaKey)) {
      delete process.env[elizaKey];
      elizaMirroredEnvKeys.delete(elizaKey);
    }
  }
}

export function syncElizaEnvToMilady(): void {
  for (const [miladyKey, elizaKey] of BRAND_ENV_ALIASES) {
    const value = process.env[elizaKey];
    if (typeof value === "string") {
      process.env[miladyKey] = value;
      miladyMirroredEnvKeys.add(miladyKey);
    } else if (miladyMirroredEnvKeys.has(miladyKey)) {
      delete process.env[miladyKey];
      miladyMirroredEnvKeys.delete(miladyKey);
    }
  }
}
