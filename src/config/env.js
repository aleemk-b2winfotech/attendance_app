import { z } from "zod";
// Central schema for all process environment variables.
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("production"),
  DATABASE_URL: z
    .string()
    .min(1),
  JWT_ACCESS_SECRET: z.string().min(8).default("supersecretkeyforaccess"),
  JWT_REFRESH_SECRET: z.string().min(8).default("supersecretkeyforrefresh"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  BUSINESS_TIMEZONE: z.string().default("Asia/Kolkata"),
  COMPANY_DOMAIN: z.string().min(1).default("b2winfotech.ai"),
  GOOGLE_WEB_CLIENT_ID: z
    .string()
    .min(1),
  GOOGLE_WEB_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_ANDROID_CLIENT_ID: z
    .string()
    .min(1),
  WEB_AUTH_CALLBACK_URL: z.string().url().optional(),
  WEB_AUTH_SUCCESS_URL: z.string().url().optional(),
  WEB_AUTH_FAILURE_URL: z.string().url().optional(),
  FULL_DAY_MINUTES: z.coerce.number().default(540),
  HALF_DAY_MINUTES: z.coerce.number().default(270),
  CORS_WEB_ORIGIN: z.string().default("https://w2b.vercel.app"),
  LOG_LEVEL: z.string().default("info"),
});
// Cached singleton to avoid reparsing process.env repeatedly.
let _env = null;
/**
 * Parses and validates environment variables once at startup.
 * Process exits on invalid config because serving traffic with bad config is unsafe.
 */
export function loadEnv() {
  if (_env) return _env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error(
      "Invalid environment variables:",
      result.error.flatten().fieldErrors,
    );
    process.exit(1);
  }
  _env = result.data;
  return _env;
}
export function env() {
  // Lazy-load support for modules that call env() before server bootstrap.
  if (!_env) return loadEnv();
  return _env;
}
//# sourceMappingURL=env.js.map
