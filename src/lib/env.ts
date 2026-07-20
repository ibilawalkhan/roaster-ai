import { z } from "zod";

/**
 * Runtime-validated environment access.
 *
 * Split into `public` (safe to ship to the browser — NEXT_PUBLIC_*) and
 * `server` (secrets that must never reach the client). Validation is lazy so
 * that importing this module in a context that doesn't need a given group
 * (e.g. tests, or the browser needing only public vars) never throws for
 * missing server secrets.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

let cachedPublic: z.infer<typeof publicSchema> | null = null;
let cachedServer: z.infer<typeof serverSchema> | null = null;

export function publicEnv(): z.infer<typeof publicSchema> {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment configuration:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}\nSee .env.example.`,
    );
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

export function serverEnv(): z.infer<typeof serverSchema> {
  if (cachedServer) return cachedServer;
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment configuration:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}\nSee .env.example.`,
    );
  }
  cachedServer = parsed.data;
  return cachedServer;
}
