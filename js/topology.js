/**
 * MetroJS — Topology Analysis
 * Validates mesh structural integrity and computes topological invariants.
 */

/**
 * Analyse a mesh and return full topological report.
 */
function analyzeMesh(mesh) {
  const { vertices, faces } = mesh;
  const V = vertices.length;
  const F = faces.length;

  // ── Build edge map ──────────────────────────────────────────────────────
  // key: "a_b" with a < b  →  list of adjacent face indices
  const edgeMap = new Map();

  function edgeKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

  for (let fi = 0; fi < faces.length; fi++) {
    const [a, b, c] = faces[fi];
    for (const [u, v] of [[a,b],[b,c],[c,a]]) {
      const k = edgeKey(u, v);
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(fi);
    }
  }

  const E = edgeMap.size;

  // ── Manifold check ──────────────────────────────────────────────────────
  // A triangular mesh is manifold if every edge is shared by exactly 1 or 2 faces.
  const boundaryEdges  = [];
  const nonManifoldEdges = [];

  for (const [key, adj] of edgeMap) {
    if (adj.length === 1) {
      boundaryEdges.push(key);
    } else if (adj.length > 2) {
      nonManifoldEdges.push(key);
    }
  }

  const isClosed    = boundaryEdges.length === 0;
  const isManifold  = nonManifoldEdges.length === 0;

  // ── Euler characteristic ────────────────────────────────────────────────
  // χ = V - E + F
  const euler = V - E + F;
  // For a closed orientable surface of genus g: χ = 2 - 2g
  // For a surface with b boundary components: χ = 2 - 2g - b
  const genus = isClosed ? Math.round((2 - euler) / 2) : null;

  // ── Connected components via BFS ────────────────────────────────────────
  // Build adjacency: face → adjacent faces via shared edges
  const faceAdj = Array.from({ length: F }, () => []);
  for (const adj of edgeMap.values()) {
    if (adj.length === 2) {
      faceAdj[adj[0]].push(adj[1]);
      faceAdj[adj[1]].push(adj[0]);
    }
  }

  const visited   = new Uint8Array(F);
  let components  = 0;
  const compSizes = [];

  for (let start = 0; start < F; start++) {
    if (visited[start]) continue;
    components++;
    let size = 0;
    const queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const fi = queue.pop();
      size++;
      for (const nb of faceAdj[fi]) {
        if (!visited[nb]) {
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
    compSizes.push(size);
  }

  // ── Vertex normals ──────────────────────────────────────────────────────
  const vertexNormals = computeVertexNormals(vertices, faces);

  // ── Degenerate faces ───────────────────────────────────────────────────
  let degenerateFaces = 0;
  for (const [a, b, c] of faces) {
    const area = triangleArea(vertices[a], vertices[b], vertices[c]);
    if (area < 1e-12) degenerateFaces++;
  }

  // ── Build edge adjacency for rendering ─────────────────────────────────
  const edges = [];
  for (const key of edgeMap.keys()) {
    const [a, b] = key.split('_').map(Number);
    edges.push([a, b]);
  }

  return {
    V, E, F,
    euler,
    genus,
    isClosed,
    isManifold,
    boundaryEdges:   boundaryEdges.length,
    nonManifoldEdges: nonManifoldEdges.length,
    components,
    compSizes,
    degenerateFaces,
    vertexNormals,
    edges,
    edgeMap,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function computeVertexNormals(vertices, faces) {
  const normals = vertices.map(() => [0, 0, 0]);

  for (const [a, b, c] of faces) {
    const n = faceNormal(vertices[a], vertices[b], vertices[c]);
    for (const i of [a, b, c]) {
      normals[i][0] += n[0];
      normals[i][1] += n[1];
      normals[i][2] += n[2];
    }
  }

  return normals.map(n => {
    const len = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]) || 1;
    return [n[0]/len, n[1]/len, n[2]/len];
  });
}

function faceNormal(a, b, c) {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
  const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  const nx = uy*vz - uz*vy;
  const ny = uz*vx - ux*vz;
  const nz = ux*vy - uy*vx;
  const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  return [nx/len, ny/len, nz/len];
}

function triangleArea(a, b, c) {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
  const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  const cx = uy*vz - uz*vy;
  const cy = uz*vx - ux*vz;
  const cz = ux*vy - uy*vx;
  return 0.5 * Math.sqrt(cx*cx + cy*cy + cz*cz);
}

/** Surface area of a mesh */
function surfaceArea(vertices, faces) {
  let area = 0;
  for (const [a, b, c] of faces) {
    area += triangleArea(vertices[a], vertices[b], vertices[c]);
  }
  return area;
}
