# MetroJS — Topological Analysis & Signed Error Mapping for Triangular Meshes

**Computer Graphics & Visualization — Final Project**  
*Topic 3: Data structures and topological operators for triangular meshes*

---

## Overview

MetroJS is a browser-based interactive tool for measuring geometric fidelity between
triangular meshes, inspired by the Metro algorithm (Cignoni, Rocchini & Scopigno, 1998).

It runs entirely in the browser — no server, no npm, no build step.

## How to run

1. Open `index.html` directly in a modern browser (Chrome, Firefox, Edge, Safari).
2. Upload Mesh A (reference) and Mesh B (simplified approximation) — both must be `.obj` files.
3. Adjust the number of Monte Carlo samples and click **Run Metro Analysis**.
4. View the signed error heatmap and numerical metrics.

Sample meshes are provided in `assets/`:
- `sphere_ref.obj` — 12-vertex icosphere (use as Mesh A)
- `sphere_low.obj` — 6-vertex octahedron (use as Mesh B)

## File Structure

```
MetroJS/
├── index.html          Main application page
├── css/
│   └── style.css       Design system and all styles
├── js/
│   ├── app.js          App controller (wires everything together)
│   ├── parser.js       OBJ file parser and mesh normalisation
│   ├── topology.js     Topological analysis (Euler χ, manifold, BFS)
│   ├── metro.js        Metro distance algorithm (BVH + Monte Carlo)
│   └── renderer.js     Canvas 2D software renderer + hero animation
└── assets/
    ├── sphere_ref.obj  Sample reference mesh
    └── sphere_low.obj  Sample simplified mesh
```

## Algorithm

1. **Parse** — Read vertices and faces from `.obj` files
2. **Normalise** — Center and scale meshes to unit bounding box
3. **Topology** — Build edge map, check manifold, compute Euler χ, BFS components
4. **BVH** — Build AABB tree over target mesh for O(log N) nearest-point queries
5. **Sample** — Area-weighted Monte Carlo sampling on source mesh
6. **Query** — For each sample, find closest point on target mesh via BVH
7. **Sign** — Determine expansion/contraction from face normal dot product
8. **Visualise** — Render diverging heatmap, compute Hausdorff/RMS statistics

## Primary Reference

P. Cignoni, C. Rocchini, R. Scopigno.  
"Metro: measuring error on simplified surfaces."  
*Computer Graphics Forum* 17(2), pp. 167–174, 1998.
