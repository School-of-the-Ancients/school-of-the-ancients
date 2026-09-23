import { normalDimensions, numberLabel, volumeOf } from './client-core.js';
import { scaleDiagram } from './scale-view.js';

export const VISUAL_MODES = Object.freeze(['diagram', 'data', 'off']);

/** Rendering is separate from the saved scale artifact and lesson transitions. */
export function createScaleVisualAdapter({ diagram = scaleDiagram } = {}) {
  if (typeof diagram !== 'function') throw new TypeError('A diagram renderer is required.');
  function render(dimensions, mode = 'diagram') {
    const values = normalDimensions(dimensions);
    if (mode === 'diagram') return diagram(values);
    if (mode === 'data') {
      const rows = ['Width', 'Height', 'Depth'].map((label, index) =>
        '<tr><th scope="row">' + label + '</th><td>' + numberLabel(values[index]) + '</td></tr>').join('');
      return '<table class="scale-data"><caption>Simulated browser dimensions</caption><tbody>' + rows +
        '<tr><th scope="row">Calculated volume</th><td>' + numberLabel(volumeOf(values)) + ' cubic units</td></tr></tbody></table>';
    }
    if (mode === 'off') return '<p class="visual-placeholder">Visual hidden. The dimensions, calculated volume, and lesson text remain available.</p>';
    throw new RangeError('Unknown visual mode.');
  }
  return { render, modes: VISUAL_MODES };
}
