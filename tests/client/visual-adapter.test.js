import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleVisualAdapter } from '../../public/visual-adapter.js';

test('visual presentation can change or be disabled without changing scale evidence', () => {
  const source = [2, 2, 2];
  const adapter = createScaleVisualAdapter();
  assert.match(adapter.render(source), /scale-diagram/);
  assert.match(adapter.render(source, 'data'), /Calculated volume<\/th><td>8 cubic units/);
  assert.match(adapter.render(source, 'off'), /Visual hidden/);
  assert.doesNotMatch(adapter.render(source, 'off'), /scale-diagram/);
  assert.deepEqual(source, [2, 2, 2]);
  assert.throws(() => adapter.render(source, 'unknown'), /Unknown visual mode/);
});

test('a different diagram implementation uses the same saved dimensions', () => {
  let received;
  const adapter = createScaleVisualAdapter({ diagram: dimensions => {
    received = dimensions;
    return '<figure>alternate renderer</figure>';
  } });
  assert.equal(adapter.render([2, 1, 1]), '<figure>alternate renderer</figure>');
  assert.deepEqual(received, [2, 1, 1]);
  assert.match(adapter.render([2, 1, 1], 'data'), /2 cubic units/);
});
