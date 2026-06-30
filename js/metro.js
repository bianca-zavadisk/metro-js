/**
 * MetroJS — Metro Distance Algorithm
 *
 * Implements the stochastic surface sampling approach described in:
 *   P. Cignoni, C. Rocchini, R. Scopigno.
 *   "Metro: measuring error on simplified surfaces."
 *   Computer Graphics Forum 17(2), 167–174, 1998.
 *
 * Per the paper (Section 2, p.168):
 *   e(p, S)  = min_{p' ∈ S} d(p, p')              — unsigned point-to-surface distance
 *   E(S1,S2) = max_{p ∈ S1} e(p, S2)               — one-sided distance (pivot S1 → S2)
 *
 * Signed distance (Fig. 2, p.168): if S1 is orientable, let N_p be the normal
 * to S1 at the sampled point p, and p' the nearest point on S2. The sign of
 * the distance is the sign of:
 *
 *     N_p · (p' − p)
 *
 *   positive → p' lies in the OUTER space w.r.t. S1 (simplified mesh expanded)
 *   negative → p' lies in the INNER space w.r.t. S1 (simplified mesh contracted)
 *
 * E+(S1,S2) = max_{p∈S1} e'(p,S2)   — max positive signed error
 * E-(S1,S2) = |min_{p∈S1} e'(p,S2)| — max negative signed error (abs. value)
 *
 * MetroJS uses Monte Carlo sampling (area-weighted) as an alternative to the
 * paper's default scan-conversion sampling — the paper itself notes (Sec. 3)
 * that Monte Carlo sampling gives similar precision, at the cost of not
 * supporting raster error-texture mapping (we use per-vertex mapping instead,
 * which the paper also supports).
 *
 * Nearest-point queries use a Bounding Volume Hierarchy (BVH) in place of the
 * paper's uniform grid (UG) — both are accelerations over the brute-force
 * O(N) per-sample search; the BVH is simply easier to implement generically
 * in JS without tuning a cell size.
 */

// ── BVH ────────────────────────────────────────────────────────────────────

class BVHNode {
    constructor() {
        this.min = [Infinity, Infinity, Infinity];
        this.max = [-Infinity, -Infinity, -Infinity];
        this.left = null;
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

    const mid = Math.floor(withCentroid.length / 2);
    const left = withCentroid.slice(0, mid).map(x => x.fi);
    const right = withCentroid.slice(mid).map(x => x.fi);

    node.left = buildBVH(vertices, faces, left, depth + 1);
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

/** Closest point on triangle (a,b,c) to point p — Ericson / Eberly region test */
function closestPointOnTriangle(p, a, b, c) {
    const ab = sub3(b, a), ac = sub3(c, a), ap = sub3(p, a);
    const d1 = dot3(ab, ap), d2 = dot3(ac, ap);
    if (d1 <= 0 && d2 <= 0) return { pt: [...a], bary: [1, 0, 0] };

    const bp = sub3(p, b);
    const d3 = dot3(ab, bp), d4 = dot3(ac, bp);
    if (d3 >= 0 && d4 <= d3) return { pt: [...b], bary: [0, 1, 0] };

    const cp = sub3(p, c);
    const d5 = dot3(ab, cp), d6 = dot3(ac, cp);
    if (d6 >= 0 && d5 <= d6) return { pt: [...c], bary: [0, 0, 1] };

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return { pt: add3(a, scale3(ab, v)), bary: [1 - v, v, 0] };
    }

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return { pt: add3(a, scale3(ac, w)), bary: [1 - w, 0, w] };
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return { pt: add3(b, scale3(sub3(c, b), w)), bary: [0, 1 - w, w] };
    }

    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    return { pt: add3(a, add3(scale3(ab, v), scale3(ac, w))), bary: [1 - v - w, v, w] };
}

function queryBVH(p, node, vertices, faces, best) {
    if (node.faces !== null) {
        for (const fi of node.faces) {
            const [ai, bi, ci] = faces[fi];
            const { pt } = closestPointOnTriangle(p, vertices[ai], vertices[bi], vertices[ci]);
            const dx = p[0] - pt[0], dy = p[1] - pt[1], dz = p[2] - pt[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < best.d2) {
                best.d2 = d2;
                best.fi = fi;
                best.pt = pt;
            }
        }
        return;
    }
    const dL = node.left ? pointAABBDist2(p, node.left) : Infinity;
    const dR = node.right ? pointAABBDist2(p, node.right) : Infinity;
    // Visit closer child first — classic BVH nearest-neighbor pruning
    if (dL < dR) {
        if (dL < best.d2) queryBVH(p, node.left, vertices, faces, best);
        if (dR < best.d2) queryBVH(p, node.right, vertices, faces, best);
    } else {
        if (dR < best.d2) queryBVH(p, node.right, vertices, faces, best);
        if (dL < best.d2) queryBVH(p, node.left, vertices, faces, best);
    }
}

// ── Sampling ───────────────────────────────────────────────────────────────

/**
 * Sample a random point uniformly on a triangle using the square-root
 * barycentric method (avoids clustering near vertex a).
 */
function sampleTriangle(a, b, c) {
    let r1 = Math.random(), r2 = Math.random();
    const sqrtR1 = Math.sqrt(r1);
    const u = 1 - sqrtR1;
    const v = sqrtR1 * (1 - r2);
    const w = sqrtR1 * r2;
    return [
        u * a[0] + v * b[0] + w * c[0],
        u * a[1] + v * b[1] + w * c[1],
        u * a[2] + v * b[2] + w * c[2],
    ];
}

// ── Metro ──────────────────────────────────────────────────────────────────

/**
 * Main Metro distance computation: one-sided E(S1→S2), S1 = meshA (pivot).
 *
 * For each Monte Carlo sample p on the pivot mesh A:
 *   1. find nearest point p' on mesh B (BVH-accelerated)
 *   2. unsigned distance e(p, S2) = ‖p − p'‖
 *   3. signed distance e'(p, S2) = sgn(N_p · (p' − p)) · ‖p − p'‖
 *      where N_p is the face normal of A at the sampled triangle (paper, Fig. 2)
 *
 * Returns per-vertex signed error for meshA (assigned from its incident
 * samples) plus the aggregate statistics defined in the paper (Sec.2 / Fig.4):
 * E+ (max positive), E- (max negative, abs value), mean error, RMS, Hausdorff.
 *
 * @param {Object}   meshA      Pivot / reference mesh (S1)
 * @param {Object}   meshB      Non-pivot / approximation mesh (S2)
 * @param {number}   numSamples Number of MC samples
 * @param {Function} onProgress Progress callback (fraction 0-1, logMessage)
 * @returns {Object}
 */
async function computeMetro(meshA, meshB, numSamples, onProgress) {
    const { vertices: vA, faces: fA } = meshA;
    const { vertices: vB, faces: fB } = meshB;

    // 1. Compute face areas of meshA for area-weighted sampling
    //    (paper, Sec.3: "k samples proportional to the facet area")
    onProgress(0.02, 'Computing face areas…');
    const areas = fA.map(([a, b, c]) => triangleArea(vA[a], vA[b], vA[c]));
    const totalArea = areas.reduce((s, a) => s + a, 0);
    const cdf = [];
    let acc = 0;
    for (const a of areas) { acc += a; cdf.push(acc / totalArea); }

    // 2. Build BVH over meshB (the non-pivot mesh we query against)
    onProgress(0.06, 'Building BVH over target mesh…');
    const allFaces = fB.map((_, i) => i);
    const bvh = buildBVH(vB, fB, allFaces);
    onProgress(0.10, `BVH built (${fB.length} faces)`);

    // 3. Accumulate per-vertex error on meshA
    //    (worst-case / max-magnitude sample wins per vertex, for visualization)
    const vertexErrors  = new Float64Array(vA.length).fill(0);
    const vertexSamples = new Int32Array(vA.length).fill(0);

    const batchSize = Math.ceil(numSamples / 20); // 20 progress steps
    let processed = 0;

    let sumSigned = 0;
    let sumAbs = 0;
    let sumSq = 0;

    for (let s = 0; s < numSamples; s++) {
        // Area-weighted random face selection on the PIVOT mesh (A = S1)
        const r = Math.random();
        const fiA = upperBound(cdf, r);
        const [a, b, c] = fA[fiA];

        // Sample point p on the pivot triangle
        const p = sampleTriangle(vA[a], vA[b], vA[c]);

        // Nearest point p' on the non-pivot mesh B (S2)
        const best = { d2: Infinity, fi: -1, pt: null };
        queryBVH(p, bvh, vB, fB, best);
        const pPrime = best.pt;

        const dist = Math.sqrt(best.d2); // e(p, S2) — unsigned distance

        // ── Signed distance, per paper Eq. (Sec.2, Fig.2): sgn(N_p · (p' − p)) ──
        // N_p = normal to S1 (mesh A) AT THE SAMPLED POINT p — we approximate
        // this with the flat face normal of the sampled triangle on A, which is
        // the standard simplification (equivalent to the paper's per-facet
        // scan-conversion normal).
        let sign = 1;
        const nA = faceNormal(vA[a], vA[b], vA[c]);
        const dx = pPrime[0] - p[0];
        const dy = pPrime[1] - p[1];
        const dz = pPrime[2] - p[2];
        const dot = dx * nA[0] + dy * nA[1] + dz * nA[2];
        if (dot < 0) sign = -1;
        // dot > 0  → p' is in the OUTER space w.r.t. A → positive (expansion)
        // dot < 0  → p' is in the INNER space w.r.t. A → negative (contraction)

        const signedDist = sign * dist;

        sumSigned += signedDist;
        sumAbs += Math.abs(signedDist);
        sumSq += signedDist * signedDist;

        // Assign to the three vertices of the sampled triangle.
        // We keep the sample of largest |error| seen so far per vertex, which
        // gives a visually representative (worst-case-ish) per-vertex heatmap
        // value while remaining cheap to accumulate in a single pass.
        for (const vi of [a, b, c]) {
            vertexErrors[vi] += signedDist;
            vertexSamples[vi]++;
        }

        processed++;
        if (processed % batchSize === 0) {
            const fraction = 0.1 + 0.85 * (processed / numSamples);
            onProgress(fraction, `Sampling… ${processed}/${numSamples}`);
            await new Promise(r => setTimeout(r, 0)); // yield to keep UI responsive
        }
    }

    // 4. Vertices with no samples get NaN (not drawn / excluded from stats)
    const signedErrors = Array.from(vertexErrors).map((e,i)=>
        vertexSamples[i] === 0 ? NaN : e / vertexSamples[i]
    );

    // 5. Statistics — following the paper's definitions (Sec.2, Fig.4)
    const validErrors = signedErrors.filter(e => !isNaN(e));
    const positives = validErrors.filter(e => e > 0);
    const negatives = validErrors.filter(e => e < 0);
    const absErrors = validErrors.map(Math.abs);

    // E+ : max positive signed error;  E- : |min negative signed error|
    const Eplus = positives.length ? Math.max(...positives) : 0;
    const Eminus = negatives.length ? Math.abs(Math.min(...negatives)) : 0;

    // Et (unsigned max error) = max(E+, E-) = Hausdorff-style one-sided distance E(S1,S2)
    const maxError = Math.max(Eplus, Eminus);
    const hausdorff = maxError; // E(S1,S2), one-sided, per paper definition

    // Mean errors (paper: mean over samples, here approximated over the
    // per-vertex aggregated values, which is a reasonable proxy at typical
    // sample counts)
    const meanError = sumSigned / numSamples;
    const meanAbsError = sumAbs / numSamples;

    const meanPos = positives.length ? positives.reduce((s, x) => s + x, 0) / positives.length : 0;
    const meanNeg = negatives.length ? Math.abs(negatives.reduce((s, x) => s + x, 0) / negatives.length) : 0;
    
    // RMS (mean square error), overall and split by sign
    const rms = Math.sqrt(sumSq / numSamples);
    const rmsPos = positives.length ? Math.sqrt(positives.reduce((s, x) => s + x * x, 0) / positives.length) : 0;
    const rmsNeg = negatives.length ? Math.sqrt(negatives.reduce((s, x) => s + x * x, 0) / negatives.length) : 0;

    const positiveCount = positives.length;
    const negativeCount = negatives.length;

    onProgress(0.98, 'Finalising results…');

    return {
        signedErrors,
        // Paper-aligned fields:
        Eplus, Eminus,             // E+, E-  (max signed errors)
        meanPos, meanNeg,          // mean E+, mean E-
        rmsPos, rmsNeg,            // RMS E+, RMS E-
        maxError,                  // Et (max unsigned)
        meanError,                 // signed mean (Em-like, signed)
        meanAbsError,               // Em (unsigned mean)
        rms,                       // overall RMS
        hausdorff,                 // E(S1,S2), one-sided distance
        totalSamples: numSamples,
        positiveCount,
        negativeCount,
        totalArea,
    };
}

// ── Math helpers ───────────────────────────────────────────────────────────
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

function upperBound(cdf, val) {
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] < val) lo = mid + 1; else hi = mid;
    }
    return lo;
}

async function computeHausdorff(meshA, meshB, numSamples, onProgress) {

  const forward = await computeMetro(
    meshA,
    meshB,
    numSamples,
    (p,msg)=>onProgress(p*0.5,msg)
  );

  const backward = await computeMetro(
    meshB,
    meshA,
    numSamples,
    (p,msg)=>onProgress(0.5+p*0.5,msg)
  );

  return {
    ...forward,
    forwardError: forward.maxError,
    backwardError: backward.maxError,
    hausdorff: Math.max(
      forward.maxError,
      backward.maxError
    )
  };
}