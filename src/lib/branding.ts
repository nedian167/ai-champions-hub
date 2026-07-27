// Program-wide app branding: a single primary/brand color drives --primary,
// its hover + soft variants, and the active sidebar highlight.

export interface BrandPreset {
  key: string;
  label: string;
  color: string;
}

export const DEFAULT_BRAND = '#5b5bd6';

export const BRAND_PRESETS: BrandPreset[] = [
  { key: 'indigo', label: 'Indigo', color: '#5b5bd6' },
  { key: 'blue', label: 'Ocean Blue', color: '#2563eb' },
  { key: 'teal', label: 'Teal', color: '#0d9488' },
  { key: 'green', label: 'Emerald', color: '#059669' },
  { key: 'purple', label: 'Royal Purple', color: '#7c3aed' },
  { key: 'magenta', label: 'Magenta', color: '#c026d3' },
  { key: 'rose', label: 'Rose', color: '#e11d48' },
  { key: 'orange', label: 'Sunset', color: '#ea580c' },
  { key: 'slate', label: 'Slate', color: '#475569' },
  { key: 'crimson', label: 'Crimson', color: '#b91c1c' },
];

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Normalize any input (#rgb, #rrggbb, preset key) to a #rrggbb hex, or null. */
export function normalizeBrand(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.trim();
  const preset = BRAND_PRESETS.find((p) => p.key === raw.toLowerCase());
  if (preset) return preset.color;
  let hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  return null;
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix a color toward black (amount<0) or white (amount>0) by a 0..1 fraction. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply (or clear) the program brand color on the document root. Passing an
 * empty/invalid value removes the overrides so the stylesheet defaults return.
 */
export function applyBrand(input?: string | null): void {
  const root = document.documentElement;
  const hex = normalizeBrand(input);
  const vars = ['--primary', '--primary-hover', '--primary-soft', '--sidebar-active'];
  if (!hex) {
    vars.forEach((v) => root.style.removeProperty(v));
    return;
  }
  root.style.setProperty('--primary', hex);
  root.style.setProperty('--primary-hover', shade(hex, -0.14));
  root.style.setProperty('--primary-soft', rgba(hex, 0.14));
  root.style.setProperty('--sidebar-active', hex);
}
