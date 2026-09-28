import { BufferAttribute } from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

export interface PlyWorkerRequest {
  buffer: ArrayBuffer;
}

export interface AttrData {
  buffer: ArrayBuffer;
  itemSize: number;
  normalized: boolean;
}

export type PlyWorkerResponse =
  | { ok: true; attrs: Record<string, AttrData>; index: ArrayBuffer | null; indexIsUint32: boolean; isMesh: boolean; hasFaceColors: boolean }
  | { ok: false; error: string };

/** Check for "element face <n>" in the PLY ASCII header to distinguish mesh from point cloud. */
function detectMesh(buffer: ArrayBuffer): boolean {
  const slice = new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength));
  const header = new TextDecoder('ascii').decode(slice);
  return /^element face\s+[1-9]/m.test(header);
}

/** Check whether the PLY header declares color properties on the face element. */
function detectFaceColors(buffer: ArrayBuffer): boolean {
  const header = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength)));
  return /\nelement face[^\n]*\n(?:property[^\n]*\n)*property[^\n]* red\b/.test(header);
}

/**
 * Extracts per-vertex RGB colors from an ASCII PLY buffer, normalised to [0, 1].
 *
 * Only runs when the PLY also has face colors, because that is the only case where extraction
 * is needed: Three.js PLYLoader silently overwrites vertex colors with face colors when both
 * exist (calls geometry.toNonIndexed() and replaces the 'color' attribute). For scan data the
 * face colors are typically uniform segment IDs, while vertex colors are the camera-captured
 * RGB values.
 *
 * When no face colors are present, PLYLoader preserves vertex colors in 'color' unchanged —
 * extracting them again into a separate attribute would make both color modes show the same
 * data.
 *
 * Returns null if: the PLY is not ASCII; it has no vertex red/green/blue properties; or it
 * has no face color properties (extraction not needed in that case).
 */
export function extractVertexColors(buffer: ArrayBuffer): Float32Array | null {
  // Only handle ASCII PLY — binary format needs byte-offset arithmetic per-property type.
  const headerSlice = new TextDecoder('ascii').decode(
    new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength)),
  );
  if (!headerSlice.includes('format ascii')) return null;

  // Decode full buffer as ASCII text to parse vertex lines.
  const text = new TextDecoder('ascii').decode(new Uint8Array(buffer));

  const headerEndIdx = text.indexOf('\nend_header\n');
  if (headerEndIdx === -1) return null;
  // +1 includes the '\n' before 'end_header' so the last property line is newline-terminated
  // and the property-block regex matches it correctly.
  const header = text.substring(0, headerEndIdx + 1);
  const dataStartIdx = headerEndIdx + '\nend_header\n'.length;

  // Vertex count
  const vertexCountMatch = header.match(/^element vertex (\d+)/m);
  if (!vertexCountMatch) return null;
  const vertexCount = parseInt(vertexCountMatch[1], 10);

  // Vertex property names — only the block between 'element vertex' and the next 'element' line.
  const vertexBlockMatch = header.match(/element vertex \d+\n((?:property [^\n]+\n)*)/);
  if (!vertexBlockMatch) return null;
  const vertexPropNames = [...vertexBlockMatch[1].matchAll(/property [^\s]+ (\w+)/g)].map(
    (m) => m[1],
  );

  const rIdx = vertexPropNames.indexOf('red');
  const gIdx = vertexPropNames.indexOf('green');
  const bIdx = vertexPropNames.indexOf('blue');
  if (rIdx === -1 || gIdx === -1 || bIdx === -1) return null;

  // Only extract when the PLY also has face colors. PLYLoader replaces vertex colors with
  // face colors when face colors exist; for PLYs without face colors vertex colors are already
  // correct in the 'color' attribute and no separate extraction is needed.
  if (!/\nelement face[^\n]*\n(?:property[^\n]*\n)*property[^\n]* red\b/.test(header)) return null;

  // Parse vertex lines — each line is a space-separated list of property values.
  const colors = new Float32Array(vertexCount * 3);
  let pos = dataStartIdx;

  for (let i = 0; i < vertexCount; i++) {
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;

    const parts = text.substring(pos, lineEnd).split(' ');
    colors[i * 3 + 0] = parseInt(parts[rIdx], 10) / 255;
    colors[i * 3 + 1] = parseInt(parts[gIdx], 10) / 255;
    colors[i * 3 + 2] = parseInt(parts[bIdx], 10) / 255;

    pos = lineEnd + 1;
  }

  return colors;
}

self.addEventListener('message', (e: MessageEvent<PlyWorkerRequest>) => {
  try {
    const isMesh = detectMesh(e.data.buffer);
    const hasFaceColors = detectFaceColors(e.data.buffer);
    const geometry = new PLYLoader().parse(e.data.buffer);

    if (isMesh) {
      // Compute face normals so the main thread can use a lit material.
      // For this unindexed mesh (no shared vertices between faces) this
      // produces flat per-face normals, which is correct for scan data.
      geometry.computeVertexNormals();
    }

    // PLYLoader overwrites vertex colors with face colors when both exist in the PLY
    // (three.js calls geometry.toNonIndexed() and replaces the 'color' attribute with
    // per-face values). For scan data the face colors are uniform segment IDs; the
    // vertex colors are the actual camera-captured RGB values.
    // Keep both: 'color' = face/segment colors for defects mode,
    //            'vertexColor' = camera RGB for colorization mode.
    const vertexColors = extractVertexColors(e.data.buffer);
    if (vertexColors) {
      geometry.setAttribute('vertexColor', new BufferAttribute(vertexColors, 3));
    }

    const attrs: Record<string, AttrData> = {};
    const transferList: ArrayBuffer[] = [];

    for (const [name, attr] of Object.entries(geometry.attributes)) {
      // PLYLoader always produces Float32 vertex attributes; copy to a fresh buffer.
      const copy = new Float32Array(attr.array as Float32Array);
      attrs[name] = { buffer: copy.buffer, itemSize: attr.itemSize, normalized: attr.normalized };
      transferList.push(copy.buffer);
    }

    let index: ArrayBuffer | null = null;
    let indexIsUint32 = false;
    if (geometry.index) {
      indexIsUint32 = !(geometry.index.array instanceof Uint16Array);
      const indexCopy = indexIsUint32
        ? new Uint32Array(geometry.index.array)
        : new Uint16Array(geometry.index.array);
      index = indexCopy.buffer;
      transferList.push(index);
    }

    const response: PlyWorkerResponse = { ok: true, attrs, index, indexIsUint32, isMesh, hasFaceColors };
    self.postMessage(response, transferList as unknown as WindowPostMessageOptions);
  } catch (err) {
    const response: PlyWorkerResponse = { ok: false, error: String(err) };
    self.postMessage(response);
  }
});
