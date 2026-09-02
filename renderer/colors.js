// Named colours used by scripts (cast colours, water colours).
export const NAMED = {
  silver: '#c9d3dc', gold: '#f2c14e', golden: '#f2c14e', blue: '#3b7dd8', red: '#d63a2f', green: '#3fa34d',
  yellow: '#f7d64a', orange: '#f28c28', pink: '#ff8ad0', purple: '#8e5bd1', violet: '#8e5bd1', white: '#f4f6f8',
  black: '#1b1e24', grey: '#8a9199', gray: '#8a9199', brown: '#8a5a33', teal: '#2aa198', cyan: '#3fd3e0',
  turquoise: '#2ec4b6', navy: '#22406f', lime: '#a8e05f', magenta: '#e04fb0', coral: '#ff6f61', salmon: '#fa8072',
  ivory: '#f5f0dc', beige: '#e3d3a8', tan: '#d2b48c', crimson: '#c8102e', maroon: '#7a1f2b', olive: '#7a8a3a',
  indigo: '#4b3f9e', lavender: '#b7a3e3', peach: '#f9c9a3', mint: '#9de3c2', aqua: '#4fd1c5', azure: '#5aa9ff',
  sky: '#8ec5ff', sand: '#e0cd9a', copper: '#b87333', bronze: '#cd7f32', pearl: '#eae6da', rainbow: '#f2c14e', striped: '#f28c28',
};

export function toHex(name, fallback = '#c9d3dc') {
  if (!name) return fallback;
  const s = String(name).trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return s;
  return NAMED[s] || fallback;
}

export function isRtl(text) { return /[֐-׿؀-ۿ܀-ݏ]/.test(text || ''); }
