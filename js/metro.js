/**
 * MetroJS — Metro Distance Algorithm
 *
 * Implements the stochastic surface sampling approach described in:
 *   P. Cignoni, C. Rocchini, R. Scopigno.
 *   "Metro: measuring error on simplified surfaces."
 *   Computer Graphics Forum 17(2), 167–174, 1998.
 *
 * For each sample point on mesh A, we find the closest point on mesh B
 * and record the signed distance (positive = expansion, negative = contraction).
 * The signed distance is determined by the surface normal orientation at the
 * closest point relative to the vector from the closest point to the sample.
 */

// import { triangleArea, faceNormal } from './topology.js';

// ── BVH ────────────────────────────────────────────────────────────────────

class BVHNode {
  constructor() {
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
    this.left  = null;
    this.right = null;
    this.faces = null; // leaf: array of face indices
  }
}

function expandAABB(node, v) {
  for (let i = 0; i < 3; i++) {
    if (v[i] < node.min[i]) node.min[i] = v[i];
    if (v[i] > node.max[i]) node.max[i] = v[i];
  }
}

function buildBVH(vertices, faces, faceList, depth = 0) {
  const node = new BVHNode();

  // Compute AABB for all faces in this list
  for (const fi of faceList) {
    for (const vi of faces[fi]) {
      expandAABB(node, vertices[vi]);
    }
  }

  if (faceList.length <= 8 || depth > 20) {
    node.faces = faceList;
    return node;
  }

  // Split along the longest axis at median centroid
  const size = [
    node.max[0] - node.min[0],
    node.max[1] - node.min[1],
    node.max[2] - node.min[2],
  ];
  const axis = size.indexOf(Math.max(...size));

  // Compute face centroids
  const withCentroid = faceList.map(fi => {
    const [a, b, c] = faces[fi];
    const cx = (vertices[a][axis] + vertices[b][axis] + vertices[c][axis]) / 3;
    return { fi, cx };
  });
  withCentroid.sort((a, b) => a.cx - b.cx);

  const mid   = Math.floor(withCentroid.length / 2);
  const left  = withCentroid.slice(0, mid).map(x => x.fi);
  const right = withCentroid.slice(mid).map(x => x.fi);

  node.left  = buildBVH(vertices, faces, left,  depth + 1);
  node.right = buildBVH(vertices, faces, right, depth + 1);
  return node;
}

function pointAABBDist2(p, node) {
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const v = Math.max(node.min[i], Math.min(p[i], node.max[i]));
    const diff = p[i] - v;
    d2 += diff * diff;
  }
  return d2;
}

/** Closest point on triangle (a,b,c) to point p */
function closestPointOnTriangle(p, a, b, c) {
  const ab = sub3(b, a), ac = sub3(c, a), ap = sub3(p, a);
  const d1 = dot3(ab, ap), d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { pt: [...a], bary: [1,0,0] };

  const bp = sub3(p, b);
  const d3 = dot3(ab, bp), d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { pt: [...b], bary: [0,1,0] };

  const cp = sub3(p, c);
  const d5 = dot3(ab, cp), d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { pt: [...c], bary: [0,0,1] };

  const vc = d1*d4 - d3*d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { pt: add3(a, scale3(ab, v)), bary: [1-v, v, 0] };
  }

  const vb = d5*d2 - d1*d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { pt: add3(a, scale3(ac, w)), bary: [1-w, 0, w] };
  }

  const va = d3*d6 - d5*d4;
  if (va <= 0 && (d4-d3) >= 0 && (d5-d6) >= 0) {
    const w = (d4-d3) / ((d4-d3)+(d5-d6));
    return { pt: add3(b, scale3(sub3(c,b), w)), bary: [0, 1-w, w] };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return { pt: add3(a, add3(scale3(ab, v), scale3(ac, w))), bary: [1-v-w, v, w] };
}

function queryBVH(p, node, vertices, faces, best) {
  if (node.faces !== null) {
    for (const fi of node.faces) {
      const [ai, bi, ci] = faces[fi];
      const { pt } = closestPointOnTriangle(p, vertices[ai], vertices[bi], vertices[ci]);
      const dx = p[0]-pt[0], dy = p[1]-pt[1], dz = p[2]-pt[2];
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < best.d2) {
        best.d2 = d2;
        best.fi = fi;
        best.pt = pt;
      }
    }
    return;
  }
  const dL = node.left  ? pointAABBDist2(p, node.left)  : Infinity;
  const dR = node.right ? pointAABBDist2(p, node.right) : Infinity;
  // Visit closer child first
  if (dL < dR) {
    if (dL < best.d2) queryBVH(p, node.left,  vertices, faces, best);
    if (dR < best.d2) queryBVH(p, node.right, vertices, faces, best);
  } else {
    if (dR < best.d2) queryBVH(p, node.right, vertices, faces, best);
    if (dL < best.d2) queryBVH(p, node.left,  vertices, faces, best);
  }
}

// ── Sampling ───────────────────────────────────────────────────────────────

/** Sample a random point uniformly on a triangle */
function sampleTriangle(a, b, c) {
  let r1 = Math.random(), r2 = Math.random();
  if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
  const r3 = 1 - r1 - r2;
  return [
    r3*a[0] + r1*b[0] + r2*c[0],
    r3*a[1] + r1*b[1] + r2*c[1],
    r3*a[2] + r1*b[2] + r2*c[2],
  ];
}

// ── Metro ──────────────────────────────────────────────────────────────────

/**
 * Main Metro distance computation.
 * Returns per-vertex signed error for meshA relative to meshB.
 *
 * @param {Object}   meshA      Source mesh (reference)
 * @param {Object}   meshB      Target mesh (approximation)
 * @param {number}   numSamples Number of MC samples
 * @param {Function} onProgress Progress callback (fraction 0-1, logMessage)
 * @returns {Object}
 */
async function computeMetro(meshA, meshB, numSamples, onProgress) {
  const { vertices: vA, faces: fA } = meshA;
  const { vertices: vB, faces: fB } = meshB;

  // 1. Compute face areas of meshA for area-weighted sampling
  onProgress(0.02, 'Computing face areas…');
  const areas = fA.map(([a,b,c]) => triangleArea(vA[a], vA[b], vA[c]));
  const totalArea = areas.reduce((s, a) => s + a, 0);
  // Cumulative distribution for sampling
  const cdf = [];
  let acc = 0;
  for (const a of areas) { acc += a; cdf.push(acc / totalArea); }

  // 2. Build BVH over meshB
  onProgress(0.06, 'Building BVH over target mesh…');
  const allFaces = fB.map((_, i) => i);
  const bvh = buildBVH(vB, fB, allFaces);
  onProgress(0.10, `BVH built (${fB.length} faces)`);

  // 3. Accumulate per-vertex error on meshA
  //    We store the signed errors per vertex (nearest sample wins)
  const vertexErrors  = new Float64Array(vA.length).fill(Infinity);
  const vertexSamples = new Int32Array(vA.length).fill(0);

  const batchSize = Math.ceil(numSamples / 20); // 20 progress steps
  let processed = 0;

  for (let s = 0; s < numSamples; s++) {
    // Area-weighted random face selection
    const r    = Math.random();
    const fiA  = upperBound(cdf, r);
    const [a,b,c] = fA[fiA];

    // Sample point on the triangle
    const pt = sampleTriangle(vA[a], vA[b], vA[c]);

    // Closest point on meshB
    const best = { d2: Infinity, fi: -1, pt: null };
    queryBVH(pt, bvh, vB, fB, best);

    const dist = Math.sqrt(best.d2);

    // Sign: determined by normal of closest face on meshB
    // positive  → sample is on the outside (expansion)
    // negative  → sample is on the inside  (contraction)
    let sign = 1;
    if (best.fi >= 0) {
      const [bi,ci,di] = fB[best.fi];
      const n = faceNormal(vB[bi], vB[ci], vB[di]);
      const dx = pt[0]-best.pt[0], dy = pt[1]-best.pt[1], dz = pt[2]-best.pt[2];
      if (dx*n[0]+dy*n[1]+dz*n[2] < 0) sign = -1;
    }

    const signedDist = sign * dist;

    // Assign to nearest vertex of sampled triangle (closest wins)
    for (const vi of [a,b,c]) {
      const dx = pt[0]-vA[vi][0], dy = pt[1]-vA[vi][1], dz = pt[2]-vA[vi][2];
      const d2 = dx*dx+dy*dy+dz*dz;
      vertexSamples[vi]++;
      if (Math.abs(signedDist) > Math.abs(vertexErrors[vi]) || vertexErrors[vi] === Infinity) {
        vertexErrors[vi] = signedDist;
      }
    }

    processed++;
    if (processed % batchSize === 0) {
      const fraction = 0.1 + 0.85 * (processed / numSamples);
      onProgress(fraction, `Sampling… ${processed}/${numSamples}`);
      // Yield to browser
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // 4. Vertices with no samples get NaN
  const signedErrors = Array.from(vertexErrors).map((e, i) =>
    vertexSamples[i] === 0 ? NaN : e
  );

  // 5. Statistics
  const validErrors = signedErrors.filter(e => !isNaN(e));
  const absErrors   = validErrors.map(Math.abs);
  const maxError    = Math.max(...absErrors);
  const meanError   = validErrors.reduce((s,x) => s+x, 0) / validErrors.length;
  const meanAbsError= absErrors.reduce((s,x) => s+x, 0) / absErrors.length;

  // RMS
  const rms = Math.sqrt(absErrors.reduce((s,x) => s+x*x, 0) / absErrors.length);

  // Hausdorff (one-sided: max absolute distance from A to B)
  const hausdorff = maxError;

  const positiveCount = validErrors.filter(e => e > 0).length;
  const negativeCount = validErrors.filter(e => e < 0).length;

  onProgress(0.98, 'Finalising results…');

  return {
    signedErrors,
    maxError,
    meanError,
    meanAbsError,
    rms,
    hausdorff,
    totalSamples: numSamples,
    positiveCount,
    negativeCount,
    totalArea,
  };
}

// ── Math helpers ───────────────────────────────────────────────────────────
function sub3(a,b)    { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function add3(a,b)    { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function dot3(a,b)    { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function scale3(a,s)  { return [a[0]*s, a[1]*s, a[2]*s]; }

function upperBound(cdf, val) {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < val) lo = mid + 1; else hi = mid;
  }
  return lo;
}
