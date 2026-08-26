export const WILDCARD = "*";

export function normalizeScopeSelection(values) {
  const normalized = [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!normalized.length || normalized.includes(WILDCARD)) return [WILDCARD];
  return normalized;
}

export function toggleScopeSelection(current, value, checked) {
  const selected = new Set(normalizeScopeSelection(current));
  if (value === WILDCARD && checked) return [WILDCARD];
  selected.delete(WILDCARD);
  if (checked) selected.add(value);
  else selected.delete(value);
  return selected.size ? [...selected] : [WILDCARD];
}

export function scopeSelectionText(values, labels, allText) {
  const selected = normalizeScopeSelection(values);
  if (selected.includes(WILDCARD)) return allText;
  const names = selected.map((value) => labels[value] || value);
  return names.length <= 2 ? names.join("、") : `已选 ${names.length} 项`;
}
