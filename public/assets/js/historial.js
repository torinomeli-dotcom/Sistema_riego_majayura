/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  RIEGO IOT — Big Data Analytics JS v1.0                     ║
 * ║  Chart.js · Tendencia · Riego · Distribución                ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const TOKEN = localStorage.getItem('riego_token');
if (!TOKEN) window.location.href = '/login.html';

// ── Tema ─────────────────────────────────────────────────────────
(function initTema() {
  const guardado = localStorage.getItem('riego_tema') || 'dark';
  document.documentElement.setAttribute('data-theme', guardado);
  const btn = document.getElementById('btnTema');
  if (btn) btn.textContent = guardado === 'dark' ? '🌙' : '☀️';
})();

window.toggleTema = () => {
  const actual = document.documentElement.getAttribute('data-theme') || 'dark';
  const nuevo  = actual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nuevo);
  localStorage.setItem('riego_tema', nuevo);
  const btn = document.getElementById('btnTema');
  if (btn) btn.textContent = nuevo === 'dark' ? '🌙' : '☀️';
  // Redibujar charts con nuevos colores
  actualizarColoresCharts();
};

window.cerrarSesion = () => {
  localStorage.removeItem('riego_token');
  localStorage.removeItem('riego_usuario');
  window.location.href = '/login.html';
};

// ── Colores del tema actual ───────────────────────────────────────
function getThemeColors() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    gridColor:    light ? 'rgba(0,0,0,0.07)' : '#21262d',
    tickColor:    light ? '#636c76'           : '#484f58',
    tooltipBg:    light ? '#ffffff'           : '#161b22',
    tooltipBorder:light ? '#d0d7de'           : '#21262d',
    tooltipTitle: light ? '#1f2328'           : '#e6edf3',
    tooltipBody:  light ? '#636c76'           : '#8b949e',
    legendColor:  light ? '#636c76'           : '#8b949e',
  };
}

// ── Instancias de charts ──────────────────────────────────────────
let chartTend = null;
let chartRiego = null;
let chartDist  = null;
let rangoActivo = '24h';

// ── Cambiar rango ─────────────────────────────────────────────────
window.cambiarRango = function(rango) {
  rangoActivo = rango;
  ['24h', '7d', '30d'].forEach(r => {
    const btn = document.getElementById(`rango${r}`);
    if (btn) btn.classList.toggle('active', r === rango);
  });
  cargarAnalytics(rango);
};

// ── Toast ─────────────────────────────────────────────────────────
function toast(msg, tipo = 'gray') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast-item type-${tipo}`;
  el.innerHTML = `<span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ── Mostrar / ocultar loading ─────────────────────────────────────
function setLoading(ids, visible) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !visible);
  });
}

// ── Cargar datos del servidor ─────────────────────────────────────
async function cargarAnalytics(rango) {
  setLoading(['loadTendencia', 'loadRiego', 'loadDist'], true);
  document.getElementById('subInfo').textContent = 'Actualizando...';

  try {
    const res = await fetch(`/api/analytics?rango=${rango}`, {
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    });

    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }

    const data = await res.json();

    if (data.sin_datos) {
      document.getElementById('sinDatos').style.display = 'block';
      document.getElementById('subInfo').textContent = 'Sin datos para este período';
      setLoading(['loadTendencia', 'loadRiego', 'loadDist'], false);
      return;
    }

    document.getElementById('sinDatos').style.display = 'none';

    // ── Stat cards ────────────────────────────────────────────
    const r = data.resumen;
    document.getElementById('statLecturas').textContent    = r.lecturas.toLocaleString('es-CO');
    document.getElementById('statMinRiego').textContent    = r.minutosRiego + ' min';
    document.getElementById('statActivaciones').textContent = r.activaciones;
    document.getElementById('statAlertas').textContent     = r.alertas;
    document.getElementById('statHumDer').textContent      = r.humedadProm.der + '%';
    document.getElementById('statHumIzq').textContent      = r.humedadProm.izq + '%';

    // Promedios bajo los charts
    document.getElementById('promIzq').textContent = r.humedadProm.izq + '%';
    document.getElementById('promCtr').textContent = r.humedadProm.ctr + '%';
    document.getElementById('promDer').textContent = r.humedadProm.der + '%';

    // Sub info
    const etiq = { '24h': 'Últimas 24 horas', '7d': 'Últimos 7 días', '30d': 'Últimos 30 días' };
    document.getElementById('subInfo').textContent =
      `${etiq[rango]} · ${r.lecturas.toLocaleString('es-CO')} lecturas · actualizado ahora`;

    // ── Charts ────────────────────────────────────────────────
    renderTendencia(data.tendencia);
    renderRiego(data.riego);
    renderDistribucion(data.distribucion);

    setLoading(['loadTendencia', 'loadRiego', 'loadDist'], false);

  } catch (e) {
    toast('Error cargando datos: ' + e.message, 'red');
    setLoading(['loadTendencia', 'loadRiego', 'loadDist'], false);
    document.getElementById('subInfo').textContent = 'Error al cargar — reintentando...';
    setTimeout(() => cargarAnalytics(rangoActivo), 15000);
  }
}

// ── CHART 1: Tendencia Humedad (line) ────────────────────────────
function renderTendencia(d) {
  const c = getThemeColors();
  const ctx = document.getElementById('chartTendencia').getContext('2d');

  const datasets = [
    {
      label: 'IZQ (2m)',
      data: d.izq,
      borderColor: '#58a6ff',
      backgroundColor: 'rgba(88,166,255,0.07)',
      borderWidth: 2,
      pointRadius: d.labels.length > 60 ? 0 : 2,
      tension: 0.4,
      fill: true,
    },
    {
      label: 'CTR (7.5m)',
      data: d.ctr,
      borderColor: '#f0c040',
      backgroundColor: 'rgba(240,192,64,0.07)',
      borderWidth: 2,
      pointRadius: d.labels.length > 60 ? 0 : 2,
      tension: 0.4,
      fill: true,
    },
    {
      label: 'DER (13m)',
      data: d.der,
      borderColor: '#3fb950',
      backgroundColor: 'rgba(63,185,80,0.07)',
      borderWidth: 2,
      pointRadius: d.labels.length > 60 ? 0 : 2,
      tension: 0.4,
      fill: true,
    }
  ];

  const opciones = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: c.legendColor, font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        borderWidth: 1,
        titleColor: c.tooltipTitle,
        bodyColor: c.tooltipBody,
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}% humedad` }
      }
    },
    scales: {
      x: {
        grid:  { color: c.gridColor },
        ticks: { color: c.tickColor, font: { size: 10 }, maxTicksLimit: 10 }
      },
      y: {
        min: 0, max: 100,
        grid:  { color: c.gridColor },
        ticks: { color: c.tickColor, font: { size: 10 }, callback: v => v + '%' }
      }
    },
    animation: { duration: 400 }
  };

  if (chartTend) {
    chartTend.data.labels = d.labels;
    chartTend.data.datasets.forEach((ds, i) => { ds.data = [d.izq, d.ctr, d.der][i]; });
    chartTend.options = opciones;
    chartTend.update();
    agregarLineasRef(chartTend);
    return;
  }

  chartTend = new Chart(ctx, { type: 'line', data: { labels: d.labels, datasets }, options: opciones });
  agregarLineasRef(chartTend);
}

function agregarLineasRef(chart) {
  const orig = chart.draw.bind(chart);
  chart.draw = function() {
    orig();
    const ctx   = this.ctx;
    const area  = this.chartArea;
    const yScale = this.scales.y;
    if (!yScale || !area) return;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;

    // Línea SECO ~32%
    ctx.strokeStyle = 'rgba(248,81,73,0.5)';
    ctx.beginPath();
    ctx.moveTo(area.left,  yScale.getPixelForValue(32));
    ctx.lineTo(area.right, yScale.getPixelForValue(32));
    ctx.stroke();

    // Línea HÚMEDO ~56%
    ctx.strokeStyle = 'rgba(63,185,80,0.5)';
    ctx.beginPath();
    ctx.moveTo(area.left,  yScale.getPixelForValue(56));
    ctx.lineTo(area.right, yScale.getPixelForValue(56));
    ctx.stroke();

    ctx.restore();
  };
}

// ── CHART 2: Riego por período (bar) ─────────────────────────────
function renderRiego(d) {
  const c = getThemeColors();
  const ctx = document.getElementById('chartRiego').getContext('2d');
  const maxMin = Math.max(...d.minutos, 1);

  const opciones = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        borderWidth: 1,
        titleColor: c.tooltipTitle,
        bodyColor: c.tooltipBody,
        callbacks: { label: ctx => ` Riego: ${ctx.raw} min` }
      }
    },
    scales: {
      x: {
        grid:  { color: c.gridColor },
        ticks: { color: c.tickColor, font: { size: 10 }, maxTicksLimit: 14 }
      },
      y: {
        min: 0,
        suggestedMax: maxMin * 1.15,
        grid:  { color: c.gridColor },
        ticks: { color: c.tickColor, font: { size: 10 }, callback: v => v + ' min' }
      }
    },
    animation: { duration: 400 }
  };

  const barData = {
    label: 'Minutos de riego',
    data: d.minutos,
    backgroundColor: d.minutos.map(v =>
      v > 0 ? 'rgba(88,166,255,0.65)' : 'rgba(88,166,255,0.1)'
    ),
    borderColor: 'rgba(88,166,255,0.9)',
    borderWidth: 1,
    borderRadius: 4,
  };

  if (chartRiego) {
    chartRiego.data.labels = d.labels;
    chartRiego.data.datasets[0].data = d.minutos;
    chartRiego.data.datasets[0].backgroundColor = barData.backgroundColor;
    chartRiego.options = opciones;
    chartRiego.update();
    return;
  }

  chartRiego = new Chart(ctx, {
    type: 'bar',
    data: { labels: d.labels, datasets: [barData] },
    options: opciones
  });
}

// ── CHART 3: Distribución estados (donut) ────────────────────────
function renderDistribucion(d) {
  const c   = getThemeColors();
  const ctx = document.getElementById('chartDistribucion').getContext('2d');
  const total = d.seco + d.humedo + d.encharcado || 1;
  const pSeco   = Math.round(d.seco   / total * 100);
  const pHumedo = Math.round(d.humedo / total * 100);
  const pEnchar = Math.round(d.encharcado / total * 100);

  // Leyenda textual
  document.getElementById('distLeyenda').innerHTML = `
    <span style="color:#f85149">■</span> Seco: <b>${pSeco}%</b> &nbsp;
    <span style="color:#3fb950">■</span> Húmedo: <b>${pHumedo}%</b> &nbsp;
    <span style="color:#d29922">■</span> Encharcado: <b>${pEnchar}%</b>
  `;

  const donutData = {
    labels: ['SECO', 'HÚMEDO', 'ENCHARCADO'],
    datasets: [{
      data: [d.seco, d.humedo, d.encharcado],
      backgroundColor: ['rgba(248,81,73,0.8)', 'rgba(63,185,80,0.8)', 'rgba(210,153,34,0.8)'],
      borderColor: ['#f85149', '#3fb950', '#d29922'],
      borderWidth: 1,
      hoverOffset: 8,
    }]
  };

  const donutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        borderWidth: 1,
        titleColor: c.tooltipTitle,
        bodyColor: c.tooltipBody,
        callbacks: {
          label: ctx => {
            const pct = Math.round(ctx.raw / total * 100);
            return ` ${ctx.label}: ${ctx.raw} lecturas (${pct}%)`;
          }
        }
      }
    },
    cutout: '65%',
    animation: { duration: 400 }
  };

  if (chartDist) {
    chartDist.data.datasets[0].data = [d.seco, d.humedo, d.encharcado];
    chartDist.update();
    return;
  }

  chartDist = new Chart(ctx, { type: 'doughnut', data: donutData, options: donutOpts });
}

// ── Actualizar colores de charts al cambiar tema ──────────────────
function actualizarColoresCharts() {
  if (chartTend)  { chartTend.update();  }
  if (chartRiego) { chartRiego.update(); }
  if (chartDist)  { chartDist.update();  }
}

// ── Auto-refresh cada 2 minutos ───────────────────────────────────
setInterval(() => cargarAnalytics(rangoActivo), 2 * 60 * 1000);

// ── Inicio ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  cargarAnalytics('24h');
});
