export const RULE_WILDCARD = "*";

function stringValues(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to treating the value as a legacy scalar.
    }
  }
  return value === undefined || value === null ? [] : [value];
}

export function canonicalScope(values, { allowed = null, field = "scope" } = {}) {
  const normalized = [...new Set(stringValues(values)
    .map((value) => String(value || "").trim().slice(0, 80))
    .filter(Boolean))];
  if (!normalized.length) throw new Error(`${field} is required`);
  if (normalized.includes(RULE_WILDCARD) && normalized.length > 1) {
    throw new Error(`${field} wildcard cannot be combined with specific values`);
  }
  if (allowed) {
    for (const value of normalized) {
      if (value !== RULE_WILDCARD && !allowed.has(value)) throw new Error(`unknown ${field}: ${value}`);
    }
  }
  return normalized.includes(RULE_WILDCARD) ? [RULE_WILDCARD] : normalized.sort();
}

export function storedRuleScope(rule, pluralField, legacyField) {
  const raw = rule?.[pluralField] ?? rule?.[legacyField];
  try {
    return canonicalScope(raw, { field: pluralField });
  } catch {
    return [];
  }
}

export function legacyScopeValue(values) {
  const normalized = canonicalScope(values);
  return normalized.includes(RULE_WILDCARD) ? RULE_WILDCARD : normalized[0];
}
