import { describe, it, expect } from 'vitest';
import { BufferGeometry, Color } from 'three';
import { applyLabelColors } from './pcdLabelColorizer';
import { ELEMENT_COLORS } from './SemanticLayer';

// Three.js Color stores values in linear colour space; capture the expected
// value directly from a Color instance to avoid manual sRGB→linear conversion.
const GRAY_COLOR = new Color(0x888888);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal binary PCD buffer with FIELDS x y z rgba label.
 * Each point is 20 bytes: 4×float32 (x,y,z) + 1×uint32 (rgba) + 1×uint32 (label).
 */
function makePcdBuffer(labels: number[], includeLabel = true): ArrayBuffer {
  const fields = includeLabel
    ? 'FIELDS x y z rgba label\nSIZE 4 4 4 4 4\nTYPE F F F U U\nCOUNT 1 1 1 1 1\n'
    : 'FIELDS x y z rgba\nSIZE 4 4 4 4\nTYPE F F F U\nCOUNT 1 1 1 1\n';

  const header =
    '# .PCD v0.7 - Point Cloud Data file format\n' +
    'VERSION 0.7\n' +
    fields +
    `WIDTH ${labels.length}\n` +
    'HEIGHT 1\n' +
    'VIEWPOINT 0 0 0 1 0 0 0\n' +
    `POINTS ${labels.length}\n` +
    'DATA binary\n';

  const headerBytes = new TextEncoder().encode(header);
  const bytesPerPoint = includeLabel ? 20 : 16;
  const dataBytes = labels.length * bytesPerPoint;

  const buffer = new ArrayBuffer(headerBytes.length + dataBytes);
  const u8 = new Uint8Array(buffer);
  u8.set(headerBytes, 0);

  const view = new DataView(buffer, headerBytes.length);
  labels.forEach((label, i) => {
    const base = i * bytesPerPoint;
    view.setFloat32(base + 0, 0, true); // x
    view.setFloat32(base + 4, 0, true); // y
    view.setFloat32(base + 8, 0, true); // z
    view.setUint32(base + 12, 0, true); // rgba
    if (includeLabel) {
      view.setUint32(base + 16, label, true); // label
    }
  });

  return buffer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyLabelColors', () => {
  it('should set color attribute on geometry for a buffer with label field', () => {
    const buffer = makePcdBuffer([1001]);
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    expect(geometry.hasAttribute('color')).toBe(true);
  });

  it('should not set color attribute for a buffer without label field', () => {
    const buffer = makePcdBuffer([0], false);
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    expect(geometry.hasAttribute('color')).toBe(false);
  });

  it('should produce one RGB triple per point', () => {
    const buffer = makePcdBuffer([1001, 2005]);
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    const attr = geometry.getAttribute('color');
    expect(attr.count).toBe(2);
    expect(attr.itemSize).toBe(3);
  });

  it('should colour manhole points (class 1) with the manhole element colour', () => {
    const buffer = makePcdBuffer([1001]); // label 1001 → class_id 1 → manhole
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    const attr = geometry.getAttribute('color');
    const expected = ELEMENT_COLORS['manhole'];
    expect(attr.getX(0)).toBeCloseTo(expected.r, 4);
    expect(attr.getY(0)).toBeCloseTo(expected.g, 4);
    expect(attr.getZ(0)).toBeCloseTo(expected.b, 4);
  });

  it('should colour longitudinal points (class 2) with the longitudinal element colour', () => {
    const buffer = makePcdBuffer([2011]); // label 2011 → class_id 2 → longitudinal
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    const attr = geometry.getAttribute('color');
    const expected = ELEMENT_COLORS['longitudinal'];
    expect(attr.getX(0)).toBeCloseTo(expected.r, 4);
    expect(attr.getY(0)).toBeCloseTo(expected.g, 4);
    expect(attr.getZ(0)).toBeCloseTo(expected.b, 4);
  });

  it('should colour wall points (class 3) with the wall element colour', () => {
    const buffer = makePcdBuffer([3002]);
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    const attr = geometry.getAttribute('color');
    const expected = ELEMENT_COLORS['wall'];
    expect(attr.getX(0)).toBeCloseTo(expected.r, 4);
    expect(attr.getY(0)).toBeCloseTo(expected.g, 4);
    expect(attr.getZ(0)).toBeCloseTo(expected.b, 4);
  });

  it('should colour compartment points (class 4) with the compartment element colour', () => {
    const buffer = makePcdBuffer([4007]);
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    const attr = geometry.getAttribute('color');
    const expected = ELEMENT_COLORS['compartment'];
    expect(attr.getX(0)).toBeCloseTo(expected.r, 4);
    expect(attr.getY(0)).toBeCloseTo(expected.g, 4);
    expect(attr.getZ(0)).toBeCloseTo(expected.b, 4);
  });

  it('should colour unlabeled points (label 0 → class_id 0) with neutral gray', () => {
    const buffer = makePcdBuffer([0]);
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    const attr = geometry.getAttribute('color');
    expect(attr.getX(0)).toBeCloseTo(GRAY_COLOR.r, 4);
    expect(attr.getY(0)).toBeCloseTo(GRAY_COLOR.g, 4);
    expect(attr.getZ(0)).toBeCloseTo(GRAY_COLOR.b, 4);
  });

  it('should handle multiple points with different labels', () => {
    const buffer = makePcdBuffer([1001, 2005, 0]);
    const geometry = new BufferGeometry();

    applyLabelColors(buffer, geometry);

    const attr = geometry.getAttribute('color');
    expect(attr.count).toBe(3);

    // Point 0: manhole
    expect(attr.getX(0)).toBeCloseTo(ELEMENT_COLORS['manhole'].r, 4);
    // Point 1: longitudinal
    expect(attr.getX(1)).toBeCloseTo(ELEMENT_COLORS['longitudinal'].r, 4);
    // Point 2: gray (unlabeled)
    expect(attr.getX(2)).toBeCloseTo(GRAY_COLOR.r, 4);
  });
});
