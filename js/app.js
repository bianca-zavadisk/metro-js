/**
 * MetroJS — App Controller
 * Wires parser → topology → renderer → metro pipeline.
 */

// import { parseOBJ, normalizeMesh } from './parser.js';
// import { analyzeMesh, surfaceArea } from './topology.js';
// import { computeMetro } from './metro.js';
// import { MeshRenderer, startHeroCanvas } from './renderer.js';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  meshA: null,     // reference mesh
  meshB: null,     // simplified mesh
  topoA: null,
  topoB: null,
  results: null,
  renderer: null,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startHeroCanvas($('hero-canvas'));
  state.renderer = new MeshRenderer($('mesh-canvas'));

  setupUploadZone('upload-a', 'drop-a', 'browse-a', file => handleMeshLoad(file, 'A'));
  setupUploadZone('upload-b', 'drop-b', 'browse-b', file => handleMeshLoad(file, 'B'));

  $('run-btn').addEventListener('click', runAnalysis);
  $('load-example-btn').addEventListener('click', loadExampleMeshes);
  $('mode-select').addEventListener('change', e => {
    state.renderer.setMode(e.target.value);
  });
  $('samples-range').addEventListener('input', e => {
    $('samples-val').textContent = Number(e.target.value).toLocaleString();
  });

  setupNav();
  addLog('info', 'MetroJS initialised. Upload a mesh or load the example.');
});

// ── Navigation ─────────────────────────────────────────────────────────────
function setupNav() {
  const sections = document.querySelectorAll('[data-section]');
  const links    = document.querySelectorAll('.nav-links a');

  const obs = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const id = e.target.dataset.section;
        links.forEach(l => {
          l.classList.toggle('active', l.getAttribute('href') === `#${id}`);
        });
      }
    }
  }, { threshold: 0.3 });

  sections.forEach(s => obs.observe(s));
}

// ── File upload ─────────────────────────────────────────────────────────────
function setupUploadZone(inputId, dropId, browseId, cb) {
  const input  = $(inputId);
  const drop   = $(dropId);
  const browse = $(browseId);

  // "Browse file…" button opens the file picker
  browse.addEventListener('click', () => input.click());

  // File chosen via picker
  input.addEventListener('change', e => {
    if (e.target.files[0]) {
      cb(e.target.files[0]);
      input.value = ''; // allow re-selecting the same file
    }
  });

  // Drag-and-drop on the zone div (no input covering it)
  drop.addEventListener('dragenter', e => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', e => {
    // only remove when truly leaving the drop zone (not a child)
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('drag-over');
  });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) cb(file);
  });

  // Also allow clicking the drop zone itself to open picker
  drop.addEventListener('click', () => input.click());
  drop.style.cursor = 'pointer';
}

// ── Load example meshes from assets.js ────────────────────────────────────
async function loadExampleMeshes() {
  const btn = $('load-example-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Loading…';

  try {
    // Instead of fetching over the network, we parse the global text variables
    processOBJText(SPHERE_REF_TEXT, 'sphere_ref.obj', 'A');
    processOBJText(SPHERE_LOW_TEXT, 'sphere_low.obj', 'B');
    addLog('ok', 'Example meshes loaded: sphere_ref.obj + sphere_low.obj');
  } catch (err) {
    addLog('err', `Could not load example files: ${err.message}`);
  }

  btn.disabled = false;
  btn.textContent = '⬇ Load Example Meshes';
}

// You can now delete the fetchText(path) function completely, as it is no longer used.

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
  return res.text();
}

function processOBJText(text, filename, which) {
  try {
    let mesh = parseOBJ(text);
    mesh = normalizeMesh(mesh);
    const topo = analyzeMesh(mesh);
    if (which === 'A') {
      state.meshA = mesh; state.topoA = topo;
      renderMeshInfo('info-a', mesh, topo, filename);
      state.renderer.setMesh(mesh, topo);
      addLog('ok', `Mesh A: ${topo.V} vertices, ${topo.F} faces.`);
      markDropLoaded('drop-a', filename);
    } else {
      state.meshB = mesh; state.topoB = topo;
      renderMeshInfo('info-b', mesh, topo, filename);
      addLog('ok', `Mesh B: ${topo.V} vertices, ${topo.F} faces.`);
      markDropLoaded('drop-b', filename);
    }
    updateRunButton();
  } catch (err) {
    addLog('err', `Parse error (${filename}): ${err.message}`);
  }
}

function markDropLoaded(dropId, filename) {
  const drop = $(dropId);
  drop.classList.add('loaded');
  drop.innerHTML = `
    <div class="upload-icon">✅</div>
    <div class="upload-text"><strong>${filename}</strong></div>
    <div class="upload-formats">Click or drop to replace</div>
  `;
}

function handleMeshLoad(file, which) {
  addLog('info', `Loading ${which === 'A' ? 'reference' : 'simplified'} mesh: ${file.name}…`);
  const reader = new FileReader();
  reader.onload = e => {
    processOBJText(e.target.result, file.name, which);
    markDropLoaded(which === 'A' ? 'drop-a' : 'drop-b', file.name);
  };
  reader.onerror = () => addLog('err', `Failed to read file: ${file.name}`);
  reader.readAsText(file);
}

function renderMeshInfo(containerId, mesh, topo, filename) {
  const el = $(containerId);
  if (!el) return;

  const area = surfaceArea(mesh.vertices, mesh.faces).toFixed(4);

  el.innerHTML = `
    <div class="mesh-info-list">
      <div class="mesh-info-row">
        <span>File</span>
        <span>${filename}</span>
      </div>
      <div class="mesh-info-row">
        <span>Vertices (V)</span>
        <span>${topo.V.toLocaleString()}</span>
      </div>
      <div class="mesh-info-row">
        <span>Edges (E)</span>
        <span>${topo.E.toLocaleString()}</span>
      </div>
      <div class="mesh-info-row">
        <span>Faces (F)</span>
        <span>${topo.F.toLocaleString()}</span>
      </div>
      <div class="mesh-info-row">
        <span>Euler χ = V−E+F</span>
        <span>${topo.euler}</span>
      </div>
      <div class="mesh-info-row">
        <span>Genus</span>
        <span>${topo.genus !== null ? topo.genus : 'N/A (open)'}</span>
      </div>
      <div class="mesh-info-row">
        <span>Components</span>
        <span>${topo.components}</span>
      </div>
      <div class="mesh-info-row">
        <span>Manifold</span>
        <span>
          ${topo.isManifold
            ? '<span class="badge-ok">✓ Yes</span>'
            : `<span class="badge-err">✗ ${topo.nonManifoldEdges} non-mfld edges</span>`}
        </span>
      </div>
      <div class="mesh-info-row">
        <span>Closed surface</span>
        <span>
          ${topo.isClosed
            ? '<span class="badge-ok">✓ Yes</span>'
            : `<span class="badge-warn">Open (${topo.boundaryEdges} boundary)</span>`}
        </span>
      </div>
      <div class="mesh-info-row">
        <span>Degenerate faces</span>
        <span>${topo.degenerateFaces === 0
          ? '<span class="badge-ok">None</span>'
          : `<span class="badge-warn">${topo.degenerateFaces}</span>`}</span>
      </div>
      <div class="mesh-info-row">
        <span>Surface area (norm.)</span>
        <span>${area}</span>
      </div>
    </div>
  `;
}

function updateRunButton() {
  const btn = $('run-btn');
  if (state.meshA && state.meshB) {
    btn.disabled = false;
    btn.textContent = '▶ Run Metro Analysis';
  } else if (state.meshA || state.meshB) {
    btn.disabled = true;
    btn.textContent = 'Upload both meshes to run';
  }
}

// ── Metro analysis ─────────────────────────────────────────────────────────
async function runAnalysis() {
  if (!state.meshA || !state.meshB) return;

  const numSamples = parseInt($('samples-range').value);
  $('run-btn').disabled = true;
  $('run-btn').innerHTML = '<span class="spinner"></span> Running…';
  $('progress-wrap').classList.remove('hidden');
  $('results-section').classList.add('hidden');

  const progressBar = $('progress-bar');
  const progressStatus = $('progress-status');

  function onProgress(fraction, msg) {
    progressBar.style.width = `${Math.round(fraction * 100)}%`;
    progressStatus.textContent = msg;
  }

  addLog('info', `Starting Metro analysis: ${numSamples.toLocaleString()} samples…`);
  const t0 = performance.now();

  try {
    const results = await computeMetro(state.meshA, state.meshB, numSamples, onProgress);
    state.results = results;

    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    addLog('ok', `Analysis complete in ${elapsed}s.`);
    addLog('ok', `Hausdorff distance: ${results.hausdorff.toExponential(4)}`);
    addLog('ok', `RMS error: ${results.rms.toExponential(4)}`);

    // Pass errors to renderer
    state.renderer.setMesh(state.meshA, state.topoA);
    state.renderer.setErrors(results.signedErrors);
    state.renderer.setMode('heatmap');
    $('mode-select').value = 'heatmap';

    renderResults(results);
    $('results-section').classList.remove('hidden');
  } catch (err) {
    addLog('err', `Analysis failed: ${err.message}`);
    console.error(err);
  }

  $('progress-wrap').classList.add('hidden');
  $('run-btn').disabled = false;
  $('run-btn').textContent = '▶ Run Metro Analysis';
}

function renderResults(r) {
  const fmt = v => v.toExponential(4);
  const pct = v => `${((v / (r.positiveCount + r.negativeCount)) * 100).toFixed(1)}%`;

  const el = $('metrics-row');
  el.innerHTML = `
    <div class="metric-card">
      <div class="metric-name">Hausdorff Dist.</div>
      <div class="metric-val accent">${fmt(r.hausdorff)}</div>
      <div class="metric-desc">Max one-sided distance (A→B)</div>
    </div>
    <div class="metric-card">
      <div class="metric-name">RMS Error</div>
      <div class="metric-val accent">${fmt(r.rms)}</div>
      <div class="metric-desc">Root mean squared distance</div>
    </div>
    <div class="metric-card">
      <div class="metric-name">Expansion</div>
      <div class="metric-val pos">+${pct(r.positiveCount)}</div>
      <div class="metric-desc">${r.positiveCount.toLocaleString()} sample vertices</div>
    </div>
    <div class="metric-card">
      <div class="metric-name">Contraction</div>
      <div class="metric-val neg">-${pct(r.negativeCount)}</div>
      <div class="metric-desc">${r.negativeCount.toLocaleString()} sample vertices</div>
    </div>
  `;

  // Error histogram
  drawHistogram($('histogram-canvas'), r.signedErrors);
}

function drawHistogram(canvas, errors) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 300;
  const H = canvas.offsetHeight || 120;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const valid = errors.filter(e => !isNaN(e));
  if (valid.length === 0) return;

  const minE = Math.min(...valid);
  const maxE = Math.max(...valid);
  const range = maxE - minE || 1;
  const bins  = 60;
  const counts = new Float64Array(bins);

  for (const e of valid) {
    const idx = Math.min(bins - 1, Math.floor(((e - minE) / range) * bins));
    counts[idx]++;
  }

  const maxCount = Math.max(...counts);

  ctx.clearRect(0, 0, W, H);

  for (let i = 0; i < bins; i++) {
    const x  = (i / bins) * W;
    const bw = W / bins - 0.5;
    const bh = (counts[i] / maxCount) * (H - 20);
    const t  = (i / bins) * 2 - 1; // -1..1

    let r, g, b;
    if (t < 0) {
      r = Math.round(lerp(130, 0, -t));
      g = Math.round(lerp(130, 212, -t));
      b = Math.round(lerp(140, 170, -t));
    } else {
      r = Math.round(lerp(130, 255, t));
      g = Math.round(lerp(130, 107, t));
      b = Math.round(lerp(140, 107, t));
    }

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, H - 20 - bh, bw, bh);
  }

  // Zero line
  const zx = ((-minE) / range) * W;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(zx, 0); ctx.lineTo(zx, H-20); ctx.stroke();
  ctx.setLineDash([]);

  // X-axis labels
  ctx.fillStyle = 'rgba(138,155,181,0.8)';
  ctx.font = `${9 * dpr / dpr}px JetBrains Mono, monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(minE.toExponential(2), 2, H - 4);
  ctx.textAlign = 'center';
  ctx.fillText('0', zx, H - 4);
  ctx.textAlign = 'right';
  ctx.fillText(maxE.toExponential(2), W - 2, H - 4);
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ── Log console ────────────────────────────────────────────────────────────
function addLog(type, msg) {
  const console = $('log-console');
  if (!console) return;
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-${type}">${msg}</span>`;
  console.appendChild(line);
  console.scrollTop = console.scrollHeight;
}
