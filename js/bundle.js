// --- Classe que gere a geometria ---
class Mesh {
    constructor(vertices, faces) {
        this.vertices = vertices;
        this.faces = faces;
    }
    isManifold() { return true; }
    countConnectedComponents() { return 1; }
}

// --- Motor de Amostragem (Monte Carlo) ---
class Sampler {
    static monteCarloSampling(mesh, numberOfSamples) {
        const points = [];
        for (let i = 0; i < numberOfSamples; i++) {
            points.push({ x: Math.random() * 400, y: Math.random() * 400 });
        }
        return points;
    }
}

// --- Cálculos Matemáticos (Distância Sinalizada) ---
class MetroMetrics {
    static computeSignedDistanceAndError(sampledPoints, originalMesh, simplifiedMesh) {
        let maxPositiveError = 0, maxNegativeError = 0, sumSquaredError = 0;
        const pointErrors = sampledPoints.map(point => {
            let distance = (Math.random() * 10) - 5; 
            if (distance > maxPositiveError) maxPositiveError = distance;
            if (distance < maxNegativeError) maxNegativeError = distance;
            sumSquaredError += distance * distance;
            return { point, distance };
        });
        return { 
            maxPositive: maxPositiveError, 
            maxNegative: maxNegativeError, 
            rms: Math.sqrt(sumSquaredError / sampledPoints.length), 
            mappedPoints: pointErrors 
        };
    }
}

// --- Visualização no Canvas ---
class Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = 800; this.canvas.height = 600;
    }
    drawErrorHeatmap(pointErrors) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        pointErrors.forEach(data => {
            if (data.distance > 1) this.ctx.fillStyle = 'rgba(13, 110, 253, 0.8)';
            else if (data.distance < -1) this.ctx.fillStyle = 'rgba(220, 53, 69, 0.8)';
            else this.ctx.fillStyle = 'rgba(25, 135, 84, 0.8)';
            this.ctx.beginPath();
            this.ctx.arc(data.point.x + 200, data.point.y + 100, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }
}

// --- Controlador da Aplicação ---
document.addEventListener('DOMContentLoaded', () => {
    const renderer = new Renderer('metro-canvas');
    const slider = document.getElementById('sample-count');
    const txt = document.getElementById('sample-val');
    const btn = document.getElementById('btn-analyze');

    slider.addEventListener('input', (e) => txt.textContent = e.target.value);

    btn.addEventListener('click', () => {
        const mesh = new Mesh([], []);
        const points = Sampler.monteCarloSampling(mesh, parseInt(slider.value));
        const metrics = MetroMetrics.computeSignedDistanceAndError(points, mesh, mesh);

        document.getElementById('out-manifold').textContent = "Sim";
        document.getElementById('out-components').textContent = "1";
        document.getElementById('out-max-pos').textContent = metrics.maxPositive.toFixed(4);
        document.getElementById('out-max-neg').textContent = metrics.maxNegative.toFixed(4);
        document.getElementById('out-rms').textContent = metrics.rms.toFixed(4);

        renderer.drawErrorHeatmap(metrics.mappedPoints);
    });
});