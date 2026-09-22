import { normalDimensions, numberLabel, volumeOf, escapeHtml } from './client-core.js';

// This is a deterministic diagram in browser units, not a measurement of a physical or Matrix object.
export function scaleDiagram(input, { compact = false } = {}) {
  const [width, height, depth] = normalDimensions(input);
  const size = compact ? 18 : 24;
  const project = (x, y, z) => [160 + (x - z) * size * 0.87, 174 + (x + z) * size * 0.45 - y * size];
  const point = (x, y, z) => project(x, y, z).map(value => value.toFixed(2)).join(',');
  const polygon = (points, fill, extra = '') => `<polygon points="${points.join(' ')}" fill="${fill}" ${extra}/>`;
  let grid = '';
  for (let i = 0; i <= 6; i++) {
    grid += `<line x1="${project(i, 0, 0)[0]}" y1="${project(i, 0, 0)[1]}" x2="${project(i, 0, 6)[0]}" y2="${project(i, 0, 6)[1]}"/>`;
    grid += `<line x1="${project(0, 0, i)[0]}" y1="${project(0, 0, i)[1]}" x2="${project(6, 0, i)[0]}" y2="${project(6, 0, i)[1]}"/>`;
  }
  const top = [point(0, height, 0), point(width, height, 0), point(width, height, depth), point(0, height, depth)];
  const left = [point(0, 0, depth), point(0, height, depth), point(width, height, depth), point(width, 0, depth)];
  const right = [point(width, 0, depth), point(width, height, depth), point(width, height, 0), point(width, 0, 0)];
  // Visible near faces correspond to width × height and depth × height.
  let seams = '';
  for (let x = 1; x < width; x++) seams += `<polyline points="${point(x, 0, depth)} ${point(x, height, depth)} ${point(x, height, 0)}"/>`;
  for (let z = 1; z < depth; z++) seams += `<polyline points="${point(width, 0, z)} ${point(width, height, z)} ${point(0, height, z)}"/>`;
  for (let y = 1; y < height; y++) seams += `<polyline points="${point(0, y, depth)} ${point(width, y, depth)} ${point(width, y, 0)}"/>`;
  const title = `${numberLabel(width)} by ${numberLabel(height)} by ${numberLabel(depth)} browser units; volume ${numberLabel(volumeOf(input))} cubic units`;
  return `<svg class="scale-diagram" viewBox="0 0 330 285" role="img" aria-label="${escapeHtml(title)}">
    <g stroke="#deddd3" stroke-width="0.8" opacity="0.65">${grid}</g>
    <ellipse cx="164" cy="216" rx="77" ry="12" fill="#244c4220"/>
    <g stroke="#285649" stroke-width="1.2" stroke-linejoin="round">${polygon(left, '#628d7b')}${polygon(right, '#83ad93')}${polygon(top, '#bed9b4')}</g>
    <g fill="none" stroke="#3e715c" stroke-width="0.7" opacity="0.68">${seams}</g>
    <text x="20" y="264" class="diagram-label">${numberLabel(width)} × ${numberLabel(height)} × ${numberLabel(depth)}</text>
    <text x="308" y="264" text-anchor="end" class="diagram-label">${numberLabel(volumeOf(input))} unit³</text>
  </svg>`;
}
