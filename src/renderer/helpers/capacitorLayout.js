const CAPACITOR_LAYOUT_MODES = new Set(['auto', 'phone', 'tablet'])

export function normalizeCapacitorLayoutMode(value) {
  return CAPACITOR_LAYOUT_MODES.has(value) ? value : 'auto'
}

export function usesCapacitorTabletLayout(mode, automaticTabletMatch) {
  const normalized = normalizeCapacitorLayoutMode(mode)
  return normalized === 'tablet' || (normalized === 'auto' && automaticTabletMatch)
}
