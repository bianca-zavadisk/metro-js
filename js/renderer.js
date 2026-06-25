/**
 * MetroJS — Canvas Renderer
 * Software rasterizer for triangular meshes using HTML Canvas 2D.
 * Supports: solid shading, wireframe, heatmap (signed error), normal shading.
 */

const DEG = Math.PI / 180;

export class MeshRenderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.mesh    = null;
    this.topo    = null;
    this.errors  = null; // signed error per vertex

    // Camera
    this.yaw   = 0.35;
    this.pitch = 0.25;
    this.zoom  = 1.0;
    this.mode  = 'solid'; // 'solid' | 'wireframe' | 'heatmap' | 'normals'

    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;
    this._animFrame = null;

    this._bindEvents();
    this._startLoop();
  }

  setMesh(mesh, topo) {
    this.mesh = mesh;
    this.topo = topo;
    this.errors = null;
  }

  setErrors(errors) {
    this.errors = errors;
  }

  setMode(mode) {
    this.mode = mode;
  }

  // ── Event bindings ───────────────────────────────────────────────────────
  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown', e => {
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    window.addEventListener('mouseup',   () => { this._dragging = false; });
    window.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this.yaw   += dx * 0.008;
      this.pitch += dy * 0.008;
      this.pitch = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, this.pitch));
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoom *= e.deltaY > 0 ? 0.95 : 1.05;
      this.zoom = Math.max(0.2, Math.min(5, this.zoom));
    }, { passive: false });

    // Touch
    let lastDist = 0;
    c.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this._dragging = true;
        this._lastX = e.touches[0].clientX;
        this._lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        lastDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    });
    c.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && this._dragging) {
        const dx = e.touches[0].clientX - this._lastX;
        const dy = e.touches[0].clientY - this._lastY;
        this.yaw   += dx * 0.008;
        this.pitch += dy * 0.008;
        this.pitch = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, this.pitch));
        this._lastX = e.touches[0].clientX;
        this._lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        this.zoom *= dist / lastDist;
        this.zoom  = Math.max(0.2, Math.min(5, this.zoom));
        lastDist   = dist;
      }
    }, { passive: false });
    c.addEventListener('touchend', () => { this._dragging = false; });
  }

  // ── Render loop ──────────────────────────────────────────────────────────
  _startLoop() {
    const loop = () => {
      this._render();
      this._animFrame = requestAnimationFrame(loop);
    };
    this._animFrame = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }

  // ── Projection ───────────────────────────────────────────────────────────
  _buildMVP() {
    // Rotation matrix: yaw then pitch
    const cy = Math.cos(this.yaw),   sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);

    // Ry * Rx (row-major applied as column vectors)
    this._rot = [
      cy,       0,   sy,
      sy*sp,    cp, -cy*sp,
     -sy*cp,    sp,  cy*cp,
    ];
  }

  _project(v) {
    const r = this._rot;
    const x = r[0]*v[0] + r[1]*v[1] + r[2]*v[2];
    const y = r[3]*v[0] + r[4]*v[1] + r[5]*v[2];
    const z = r[6]*v[0] + r[7]*v[1] + r[8]*v[2];
    // Simple perspective
    const fov = 2.0 * this.zoom;
    const W = this.canvas.width, H = this.canvas.height;
    const scale = (W * 0.42) * fov / (z + 3.5);
    return {
      sx: W/2 + x * scale,
      sy: H/2 - y * scale,
      z,
    };
  }

  // ── Main render ──────────────────────────────────────────────────────────
  _render() {
    const { canvas, ctx, mesh, topo, mode } = this;
    // Resize to display size
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, W, H);

    if (!mesh) {
      this._drawEmpty(W, H);
      return;
    }

    this._buildMVP();

    const { vertices, faces } = mesh;

    // Project all vertices
    const proj = vertices.map(v => this._project(v));

    // Sort faces by depth (painter's algorithm)
    const sortedFaces = faces.map((f, i) => {
      const z = (proj[f[0]].z + proj[f[1]].z + proj[f[2]].z) / 3;
      return { f, i, z };
    });
    sortedFaces.sort((a, b) => b.z - a.z);

    // Light direction (world space)
    const r   = this._rot;
    const lx  = r[0]*0.6 + r[1]*0.5 + r[2]*0.6;
    const ly  = r[3]*0.6 + r[4]*0.5 + r[5]*0.6;
    const lz  = r[6]*0.6 + r[7]*0.5 + r[8]*0.6;
    const ll  = Math.sqrt(lx*lx+ly*ly+lz*lz);
    const ld  = [lx/ll, ly/ll, lz/ll];

    const hasErrors = mode === 'heatmap' && this.errors;
    const maxErr    = hasErrors ? Math.max(...this.errors.map(e => isNaN(e) ? 0 : Math.abs(e))) : 1;

    for (const { f, i } of sortedFaces) {
      const [ai, bi, ci] = f;
      const pA = proj[ai], pB = proj[bi], pC = proj[ci];

      // Back-face cull
      const ex = pB.sx - pA.sx, ey = pB.sy - pA.sy;
      const fx = pC.sx - pA.sx, fy = pC.sy - pA.sy;
      if (ex*fy - ey*fx > 0) continue;

      // Compute face normal in world space
      const vA = vertices[ai], vB = vertices[bi], vC = vertices[ci];
      const ux = vB[0]-vA[0], uy = vB[1]-vA[1], uz = vB[2]-vA[2];
      const vx = vC[0]-vA[0], vy = vC[1]-vA[1], vz = vC[2]-vA[2];
      let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const nl = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      nx/=nl; ny/=nl; nz/=nl;

      const diff = Math.max(0, nx*ld[0]+ny*ld[1]+nz*ld[2]);
      const amb  = 0.25;
      const lit  = amb + (1 - amb) * diff;

      let fillColor;
      if (mode === 'wireframe') {
        fillColor = null;
      } else if (hasErrors) {
        const eA = isNaN(this.errors[ai]) ? 0 : this.errors[ai];
        const eB = isNaN(this.errors[bi]) ? 0 : this.errors[bi];
        const eC = isNaN(this.errors[ci]) ? 0 : this.errors[ci];
        const avgErr = (eA + eB + eC) / 3;
        fillColor = errorToColor(avgErr, maxErr, lit);
      } else if (mode === 'normals') {
        const r = Math.round((nx * 0.5 + 0.5) * 255 * lit);
        const g = Math.round((ny * 0.5 + 0.5) * 255 * lit);
        const b = Math.round((nz * 0.5 + 0.5) * 255 * lit);
        fillColor = `rgb(${r},${g},${b})`;
      } else {
        // Solid — steel blue
        const v = Math.round(lit * 220);
        fillColor = `rgb(${Math.round(v*0.42)},${Math.round(v*0.62)},${v})`;
      }

      ctx.beginPath();
      ctx.moveTo(pA.sx, pA.sy);
      ctx.lineTo(pB.sx, pB.sy);
      ctx.lineTo(pC.sx, pC.sy);
      ctx.closePath();

      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }

      // Wireframe overlay (thin)
      if (mode === 'wireframe') {
        ctx.strokeStyle = 'rgba(74,158,255,0.7)';
        ctx.lineWidth   = 0.6;
        ctx.stroke();
      } else if (mode === 'solid' || mode === 'normals') {
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth   = 0.4;
        ctx.stroke();
      }
    }
  }

  _drawEmpty(W, H) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(74,158,255,0.06)';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(74,158,255,0.06)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(138,155,181,0.4)';
    ctx.font = '14px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Upload a mesh to visualize it here', W/2, H/2 - 10);
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(138,155,181,0.25)';
    ctx.fillText('Supported: .obj', W/2, H/2 + 14);
  }
}

// ── Color mapping ──────────────────────────────────────────────────────────

/**
 * Map signed error to a diverging blue→grey→red heatmap.
 * Negative = contraction (blue/cool), Positive = expansion (red/warm).
 */
function errorToColor(err, maxErr, lit) {
  if (maxErr === 0) return `rgb(120,120,120)`;
  const t = Math.max(-1, Math.min(1, err / maxErr)); // [-1, 1]

  let r, g, b;
  if (t < 0) {
    // Negative: interpolate from cool blue (0,212,170) to grey (130,130,140)
    const s = -t; // 0..1
    r = lerp(130, 0,   s);
    g = lerp(130, 212, s);
    b = lerp(140, 170, s);
  } else {
    // Positive: interpolate from grey (130,130,140) to warm red (255,107,107)
    r = lerp(130, 255, t);
    g = lerp(130, 107, t);
    b = lerp(140, 107, t);
  }

  return `rgb(${Math.round(r*lit)},${Math.round(g*lit)},${Math.round(b*lit)})`;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ── Hero canvas — animated wireframe mesh ─────────────────────────────────

export function startHeroCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const pts = [];
  const N   = 42;

  // Generate a rough sphere-like cloud of points
  for (let i = 0; i < N; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 0.7 + Math.random() * 0.3;
    pts.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
      vx: (Math.random()-0.5) * 0.0005,
      vy: (Math.random()-0.5) * 0.0005,
      vz: (Math.random()-0.5) * 0.0005,
    });
  }

  let t = 0;

  function frame() {
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    t += 0.003;
    const cy = Math.cos(t), sy = Math.sin(t);

    // Project
    const proj = pts.map(p => {
      const rx = p.x * cy - p.z * sy;
      const ry = p.y;
      const rz = p.x * sy + p.z * cy;
      const sc = W * 0.35 / (rz + 2.5);
      return { sx: W/2 + rx * sc, sy: H/2 - ry * sc, z: rz };
    });

    // Draw edges for "nearby" pairs
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const dz = pts[i].z - pts[j].z;
        const d  = Math.sqrt(dx*dx+dy*dy+dz*dz);
        if (d < 0.55) {
          const alpha = (1 - d / 0.55) * 0.3;
          ctx.strokeStyle = `rgba(74,158,255,${alpha})`;
          ctx.lineWidth   = 0.6;
          ctx.beginPath();
          ctx.moveTo(proj[i].sx, proj[i].sy);
          ctx.lineTo(proj[j].sx, proj[j].sy);
          ctx.stroke();
        }
      }
    }

    // Dots
    for (const p of proj) {
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 1.5, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(74,158,255,0.5)';
      ctx.fill();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
