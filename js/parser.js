/**
 * MetroJS — OBJ Parser
 * Parses Wavefront .obj files into an internal mesh representation.
 */

function parseOBJ(text) {
  const vertices = [];  // [x, y, z, ...]
  const faces = [];     // [[i0, i1, i2], ...]
  const normals = [];

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const cmd   = parts[0];

    if (cmd === 'v') {
      vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (cmd === 'vn') {
      normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (cmd === 'f') {
      // Handles: f v, f v/vt, f v/vt/vn, f v//vn
      // Triangulates polygons with fan method
      const idx = parts.slice(1).map(p => parseInt(p.split('/')[0]) - 1);
      for (let i = 1; i < idx.length - 1; i++) {
        faces.push([idx[0], idx[i], idx[i + 1]]);
      }
    }
  }

  return buildMesh(vertices, faces);
}

/**
 * Build a Mesh object from raw arrays.
 */
function buildMesh(vertices, faces) {
  return {
    vertices,
    faces,
    // Derived fields (populated by analyzeMesh)
    edges: null,
    adjacency: null,
    vertexNormals: null,
  };
}

/**
 * Normalize mesh to fit in [-1,1]^3 bounding box.
 */
function normalizeMesh(mesh) {
  const V = mesh.vertices;
  if (V.length === 0) return mesh;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const [x, y, z] of V) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;

  const norm = V.map(([x, y, z]) => [
    (x - cx) / scale * 2,
    (y - cy) / scale * 2,
    (z - cz) / scale * 2,
  ]);

  return {
    ...mesh,
    vertices: norm,
    bbox: { minX, maxX, minY, maxY, minZ, maxZ, cx, cy, cz, scale },
  };
}
