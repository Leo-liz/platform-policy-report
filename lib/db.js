import { neon } from "@neondatabase/serverless";

let cached;

export function database() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!cached) cached = neon(process.env.DATABASE_URL);
  return cached;
}
