import { BufferAttribute, Color } from 'three';
import type { BufferGeometry } from 'three';
import { ELEMENT_COLORS } from './SemanticLayer';
import type { ElementType } from './StructuralElementService';

/** Maps PCD class_id (from metadata.yaml) to structural element type. */
const CLASS_ID_TO_ELEMENT_TYPE: Record<number, ElementType> = {
  1: 'manhole',
  2: 'longitudinal',
  3: 'wall',
  4: 'compartment',
};

/** Fallback colour for points whose class_id is not in the taxonomy (e.g. label 0). */
const UNLABELED_COLOR = new Color(0x888888);

/**
 * Reads the `label` field from a binary PCD buffer and writes per-point vertex
 * colours onto `geometry` using the structural element colour palette.
 *
 * Label encoding (see metadata.yaml): label = 1000 * class_id + instance_id.
 *
 * If the PCD buffer has no `label` field this function is a no-op.
 */
export function applyLabelColors(buffer: ArrayBuffer, geometry: BufferGeometry): void {
  const parsed = parsePcdHeader(buffer);
  if (!parsed) return;

  const { fields, sizes, pointCount, dataStart } = parsed;

  const labelIdx = fields.indexOf('label');
  if (labelIdx < 0) return;

  const rowSize = sizes.reduce((a, b) => a + b, 0);
  let labelByteOffset = 0;
  for (let i = 0; i < labelIdx; i++) {
    labelByteOffset += sizes[i];
  }

  const colors = new Float32Array(pointCount * 3);
  const view = new DataView(buffer, dataStart);

  for (let i = 0; i < pointCount; i++) {
    const label = view.getUint32(i * rowSize + labelByteOffset, true /* little-endian */);
    const classId = Math.floor(label / 1000);
    const elementType = CLASS_ID_TO_ELEMENT_TYPE[classId];
    const color = elementType ? ELEMENT_COLORS[elementType] : UNLABELED_COLOR;
    colors[i * 3]     = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------------------
// Internal PCD header parser
// ---------------------------------------------------------------------------

interface PcdHeader {
  fields: string[];
  sizes: number[];
  pointCount: number;
  /** Byte offset in `buffer` where binary point data begins. */
  dataStart: number;
}

function parsePcdHeader(buffer: ArrayBuffer): PcdHeader | null {
  const bytes = new Uint8Array(buffer);

  // Locate 'DATA binary\n' — everything after is raw point data.
  const dataMarker = new TextEncoder().encode('DATA binary\n');
  let dataStart = -1;

  outer: for (let i = 0; i <= bytes.length - dataMarker.length; i++) {
    for (let j = 0; j < dataMarker.length; j++) {
      if (bytes[i + j] !== dataMarker[j]) continue outer;
    }
    dataStart = i + dataMarker.length;
    break;
  }

  if (dataStart < 0) return null;

  const headerText = new TextDecoder('ascii').decode(bytes.slice(0, dataStart));
  const lines = headerText.split('\n');

  let fields: string[] = [];
  let sizes: number[] = [];
  let pointCount = 0;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'FIELDS') fields = parts.slice(1);
    else if (parts[0] === 'SIZE') sizes = parts.slice(1).map(Number);
    else if (parts[0] === 'POINTS') pointCount = parseInt(parts[1], 10);
  }

  if (fields.length === 0 || sizes.length === 0 || pointCount === 0) return null;

  return { fields, sizes, pointCount, dataStart };
}
