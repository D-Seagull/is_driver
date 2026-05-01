import Constants from "expo-constants";

/**
 * Pulls API base URL + auth flags from Expo config.
 * Set in app.json → expo.extra, or via EXPO_PUBLIC_* env vars.
 *   - EXPO_PUBLIC_API_URL
 *   - EXPO_PUBLIC_MOCK_AUTH ("true" / "false")
 *
 * Defaults are dev-friendly so the app boots without any env tweaks.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function readString(key: string, fallback: string): string {
  const env = process.env[`EXPO_PUBLIC_${key}`];
  if (typeof env === "string" && env.length > 0) return env;
  const fromExtra = extra[key];
  if (typeof fromExtra === "string" && fromExtra.length > 0) return fromExtra;
  return fallback;
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = readString(key, "");
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

export const API_URL = readString("API_URL", "http://localhost:3001");

/**
 * While the backend OTP endpoints aren't ready, we accept any 6-digit code
 * locally and synthesize a fake JWT/user. Flip the env to false to hit the
 * real backend.
 */
export const MOCK_AUTH = readBool("MOCK_AUTH", false);

// Boot-time sanity log — confirms which API the app is talking to. Remove
// this once the network setup is stable.
console.log("[config]", { API_URL, MOCK_AUTH });
