import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(HERE, "..", "reports", "notification-catalog.json");

export function loadCatalog() {
  const value = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  if (!Array.isArray(value.platforms) || !Array.isArray(value.primary_tags)) {
    throw new Error("notification catalog is invalid");
  }
  return value;
}

export function catalogSets(catalog = loadCatalog()) {
  return {
    platforms: new Set(catalog.platforms.map((item) => item.code)),
    tags: new Set(catalog.primary_tags.map((item) => item.code)),
  };
}
