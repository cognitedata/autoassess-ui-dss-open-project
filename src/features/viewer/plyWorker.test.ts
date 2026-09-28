import { describe, it, expect } from 'vitest';
import { extractVertexColors } from './plyWorker';

function makePlyBuffer(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer;
}

describe(extractVertexColors.name, () => {
  it('returns null for binary PLY format', () => {
    const buf = makePlyBuffer('ply\nformat binary_little_endian 1.0\nend_header\n');
    expect(extractVertexColors(buf)).toBeNull();
  });

  it('returns null when vertex has no red/green/blue properties', () => {
    const ply = `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
end_header
0 0 0
1 0 0
`;
    expect(extractVertexColors(makePlyBuffer(ply))).toBeNull();
  });

  it('returns null for PLY with vertex colors but no face colors (no extraction needed)', () => {
    const ply = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 255 0 0
1 0 0 0 255 0
0 1 0 0 0 255
`;
    // PLYLoader preserves vertex colors unchanged when no face colors exist — no re-extraction needed.
    expect(extractVertexColors(makePlyBuffer(ply))).toBeNull();
  });

  it('extracts vertex colors as [0,1]-normalised floats when face colors also exist', () => {
    const ply = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_index
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 255 0 0
1 0 0 0 255 0
0 1 0 0 0 255
3 0 1 2 59 153 67
`;
    const colors = extractVertexColors(makePlyBuffer(ply));
    expect(colors).not.toBeNull();
    expect(colors!.length).toBe(9);
    // Vertex 0: red
    expect(colors![0]).toBeCloseTo(1.0);
    expect(colors![1]).toBeCloseTo(0.0);
    expect(colors![2]).toBeCloseTo(0.0);
    // Vertex 1: green
    expect(colors![3]).toBeCloseTo(0.0);
    expect(colors![4]).toBeCloseTo(1.0);
    expect(colors![5]).toBeCloseTo(0.0);
    // Vertex 2: blue
    expect(colors![6]).toBeCloseTo(0.0);
    expect(colors![7]).toBeCloseTo(0.0);
    expect(colors![8]).toBeCloseTo(1.0);
  });

  // Regression: PLYLoader overwrites vertex colors with face colors when both exist.
  // extractVertexColors must return the per-vertex camera colors, not the uniform segment color.
  it('returns vertex colors even when the PLY also has face colors', () => {
    const ply = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_index
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 100 150 200
1 0 0 110 160 210
0 1 0 120 170 220
3 0 1 2 59 153 67
`;
    const colors = extractVertexColors(makePlyBuffer(ply));
    expect(colors).not.toBeNull();
    // Must use vertex colors (100, 150, 200), not face color (59, 153, 67)
    expect(colors![0]).toBeCloseTo(100 / 255);
    expect(colors![1]).toBeCloseTo(150 / 255);
    expect(colors![2]).toBeCloseTo(200 / 255);
    expect(colors![3]).toBeCloseTo(110 / 255);
    expect(colors![4]).toBeCloseTo(160 / 255);
    expect(colors![5]).toBeCloseTo(210 / 255);
  });

  it('handles extra vertex properties (e.g. segment_id) without misreading colors', () => {
    const ply = `ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
property int segment_id
element face 1
property list uchar int vertex_index
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 200 100 50 1
1 0 0 100 200 150 2
3 0 1 0 59 153 67
`;
    const colors = extractVertexColors(makePlyBuffer(ply));
    expect(colors).not.toBeNull();
    expect(colors![0]).toBeCloseTo(200 / 255);
    expect(colors![1]).toBeCloseTo(100 / 255);
    expect(colors![2]).toBeCloseTo(50 / 255);
    expect(colors![3]).toBeCloseTo(100 / 255);
    expect(colors![4]).toBeCloseTo(200 / 255);
    expect(colors![5]).toBeCloseTo(150 / 255);
  });
});
