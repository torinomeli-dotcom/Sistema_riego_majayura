/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  RIEGO IOT — Dashboard JS v2.0                              ║
 * ║  WebSocket en tiempo real · Chart.js · Control remoto       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

// ── Autenticación ───────────────────────────────────────────────
const TOKEN = localStorage.getItem('riego_token');
if (!TOKEN) {
  window.location.href = '/login.html';
}

// ── Configuración de sensores ───────────────────────────────────
const SENSORES_CONFIG = [
  { id: 'SL1', zona: 'IZQ', planta: 'M2',  dist: 2.0 },
  { id: 'SL2', zona: 'IZQ', planta: 'M12', dist: 2.0 },
  { id: 'SL3', zona: 'IZQ', planta: 'M22', dist: 2.0 },
  { id: 'SM1', zona: 'CTR', planta: 'M6',  dist: 7.5 },
  { id: 'SM2', zona: 'CTR', planta: 'M18', dist: 7.5 },
  { id: 'SR1', zona: 'DER', planta: 'M4',  dist: 13.0 },
  { id: 'SR2', zona: 'DER', planta: 'M12', dist: 13.0 },
  { id: 'SR3', zona: 'DER', planta: 'M20', dist: 13.0 },
];

// ── Estado local ────────────────────────────────────────────────
let estadoActual    = null;
let wsReconectando  = false;
let wsObj           = null;
let timerReconectar = null;
let timerValvula    = null;
let segundosValvula = 0;
let chartInstance   = null;

// ── Inicializar tarjetas de sensores ────────────────────────────
function inicializarSensores() {
  const grupos = { IZQ: 'sensoresIzq', CTR: 'sensoresCtr', DER: 'sensoresDer' };

  SENSORES_CONFIG.forEach(cfg => {
    const contenedor = document.getElementById(grupos[cfg.zona]);
    if (!contenedor) return;

    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-lg-4';
    col.innerHTML = `
      <div class="sensor-card" id="card_${cfg.id}">
        <div class="sensor-top">
          <div>
            <div class="sensor-nombre">${cfg.id}</div>
            <div class="sensor-pos">${cfg.planta} · ${cfg.dist}m · ${cfg.zona}</div>
          </div>
          <span class="badge-estado badge-HUMEDO" id="badge_${cfg.id}">HUMEDO</span>
        </div>
        <div class="sensor-barra-wrap">
          <div class="sensor-barra-fill fill-humedo" id="barra_${cfg.id}" style="width:50%"></div>
        </div>
        <div class="sensor-valores">
          <span class="sensor-pct pct-humedo" id="pct_${cfg.id}">50%</span>
          <span class="sensor-adc" id="adc_${cfg.id}">ADC: ---</span>
        </div>
        <div class="sensor-tiempo" id="tiempo_${cfg.id}">--</div>
      </div>`;
    contenedor.appendChild(col);
  });
}

// ── Actualizar UI con datos del ESP32 ───────────────────────────
function actualizarUI(data) {
  const prev = estadoActual;
  estadoActual = data;

  // ── Timestamp ──────────────────────────────────────────────
  const ahora = new Date();
  document.getElementById('ultimaActualizacion').textContent =
    'Actualizado: ' + ahora.toLocaleTimeString('es-CO');

  // ── Sensores ───────────────────────────────────────────────
  const s = data.sensores || {};
  SENSORES_CONFIG.forEach(cfg => {
    const info = s[cfg.id];
    if (!info) return;

    const card   = document.getElementById(`card_${cfg.id}`);
    const badge  = document.getElementById(`badge_${cfg.id}`);
    const barra  = document.getElementById(`barra_${cfg.id}`);
    const pct    = document.getElementById(`pct_${cfg.id}`);
    const adcEl  = document.getElementById(`adc_${cfg.id}`);
    const tiempo = document.getElementById(`tiempo_${cfg.id}`);

    const estado = info.estado || 'HUMEDO';
    const humPct = info.pct    || 0;
    const adc    = info.adc    || 0;

    // Card clases de estado
    card.classList.remove('estado-seco', 'estado-encharcado');
    if (estado === 'SECO')        card.classList.add('estado-seco');
    if (estado === 'ENCHARCADO')  card.classList.add('estado-encharcado');

    // Badge
    badge.className = `badge-estado badge-${estado}`;
    badge.textContent = estado === 'ENCHARCADO' ? '⚠ ENCHARCADO' : estado;

    // Barra de humedad
    barra.style.width = humPct + '%';
    barra.className = `sensor-barra-fill fill-${estado.toLowerCase()}`;

    // Porcentaje con animación si cambió
    const pctStr = humPct + '%';
    if (pct.textContent !== pctStr) {
      pct.textContent = pctStr;
      pct.className   = `sensor-pct pct-${estado.toLowerCase()}`;
      pct.classList.add('changed');
      setTimeout(() => pct.classList.remove('changed'), 400);
    }

    // ADC crudo
    adcEl.textContent = `ADC: ${adc}`;

    // Tiempo desde última lectura
    tiempo.textContent = 'Hace ' + tiempoRelativo(data.serverTimestamp || Date.now());
  });

  // ── VÁLVULA ────────────────────────────────────────────────
  const valv = data.actuadores?.valvula;
  if (valv) {
    const on    = valv.estado;
    const modo  = valv.modo || 'AUTO';
    const tsOn  = valv.tiempo_on_seg || 0;

    const cardValv = document.getElementById('cardValvula');
    cardValv.classList.toggle('valvula-on', on);

    const estadoEl = document.getElementById('estadoValvula');
    estadoEl.textContent = on ? 'ABIERTA' : 'CERRADA';
    estadoEl.className   = `act-estado${on ? ' on' : ''}`;

    document.getElementById('valvulaIcon').textContent = on ? '💧' : '🔒';

    const badgeModo = document.getElementById('badgeModoValvula');
    badgeModo.textContent = modo;
    badgeModo.classList.toggle('manual', modo === 'MANUAL');

    document.getElementById('motivoValvula').textContent =
      data.motivo_riego || '—';

    // Toggle auto
    const toggleAuto = document.getElementById('toggleAuto');
    toggleAuto.checked = modo === 'AUTO';

    // Botones (deshabilitados en AUTO)
    const modoAuto = modo === 'AUTO';
    document.getElementById('btnAbrir').disabled  = modoAuto;
    document.getElementById('btnCerrar').disabled = modoAuto;

    // Timer válvula
    if (on) {
      segundosValvula = tsOn;
      if (!timerValvula) {
        timerValvula = setInterval(() => {
          segundosValvula++;
          document.getElementById('timerValvula').textContent = formatearTiempo(segundosValvula);
        }, 1000);
      }
    } else {
      clearInterval(timerValvula);
      timerValvula = null;
      document.getElementById('timerValvula').textContent = '--:--';
    }

    // Toast si cambió estado
    if (prev?.actuadores?.valvula?.estado !== on) {
      mostrarToast(
        on ? '💧 Riego activado — ' + (data.motivo_riego || '') : '🔒 Riego detenido',
        'blue'
      );
    }
  }

  // ── BOMBILLOS ─────────────────────────────────────────────
  const b1on = data.actuadores?.bombillo1?.estado || false;
  const b2on = data.actuadores?.bombillo2?.estado || false;

  actualizarBombillo('cardB1', 'estadoB1', 'b1Icon', b1on,
    prev?.actuadores?.bombillo1?.estado, '1');
  actualizarBombillo('cardB2', 'estadoB2', 'b2Icon', b2on,
    prev?.actuadores?.bombillo2?.estado, '2');

  // ── ALERTA ENCHARCAMIENTO ──────────────────────────────────
  const alerta = data.alerta_encharcamiento || false;
  const alertaEl = document.getElementById('alertaEnchar');
  alertaEl.style.display = alerta ? 'block' : 'none';

  if (alerta && !prev?.alerta_encharcamiento) {
    mostrarToast('⚠ Encharcamiento detectado en columna IZQ', 'red');
  }

  // ── Actualizar historial del servidor ──────────────────────
  actualizarHistorial();
}

function actualizarBombillo(cardId, estadoId, iconId, on, prevOn, num) {
  const card = document.getElementById(cardId);
  card.classList.toggle('bombillo-on', on);
  const est = document.getElementById(estadoId);
  est.textContent  = on ? 'ENCENDIDA' : 'APAGADA';
  est.className    = `act-estado${on ? ' encendido' : ''}`;
  document.getElementById(iconId).textContent = on ? '💡' : '🔦';
  if (on !== prevOn && prevOn !== undefined) {
    mostrarToast(`💡 Luz ${num} ${on ? 'encendida' : 'apagada'}`, 'yellow');
  }
}

// ── HISTORIAL (Chart.js) ────────────────────────────────────────
async function actualizarHistorial() {
  try {
    const res = await fetch('/api/historial?limit=100', {
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    });
    if (!res.ok) return;
    const { datos } = await res.json();
    if (!datos || datos.length === 0) return;

    const labels = datos.map(d => new Date(d.ts).toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit'
    }));

    const dataIzq = datos.map(d => d.izq || 0);
    const dataCtr = datos.map(d => d.ctr || 0);
    const dataDer = datos.map(d => d.der || 0);

    if (!chartInstance) {
      const ctx = document.getElementById('chartHistorial').getContext('2d');
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'IZQ (2m)',
              data: dataIzq,
              borderColor: '#58a6ff',
              backgroundColor: 'rgba(88,166,255,0.06)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.4,
              fill: true,
            },
            {
              label: 'CTR (7.5m)',
              data: dataCtr,
              borderColor: '#f0c040',
              backgroundColor: 'rgba(240,192,64,0.06)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.4,
              fill: true,
            },
            {
              label: 'DER (13m)',
              data: dataDer,
              borderColor: '#3fb950',
              backgroundColor: 'rgba(63,185,80,0.06)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.4,
              fill: true,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: { color: '#8b949e', font: { size: 11 } }
            },
            tooltip: {
              backgroundColor: '#161b22',
              borderColor: '#21262d',
              borderWidth: 1,
              titleColor: '#e6edf3',
              bodyColor: '#8b949e',
              callbacks: {
                label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}% humedad`
              }
            },
            // Líneas de referencia
            annotation: undefined
          },
          scales: {
            x: {
              grid:   { color: '#21262d' },
              ticks:  { color: '#484f58', font: { size: 10 }, maxTicksLimit: 8 }
            },
            y: {
              min: 0,
              max: 100,
              grid:   { color: '#21262d' },
              ticks:  {
                color: '#484f58',
                font: { size: 10 },
                callback: v => v + '%'
              }
            }
          },
          animation: { duration: 300 }
        }
      });

      // Líneas de referencia manuales (sin plugin externo)
      const origDraw = chartInstance.draw.bind(chartInstance);
      chartInstance.draw = function() {
        origDraw();
        const ctx  = this.ctx;
        const area = this.chartArea;
        const yScale = this.scales.y;

        // Línea SECO (ADC>2800 ≈ <32% humedad)
        const ySecoRaw = yScale.getPixelForValue(32);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(248,81,73,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(area.left, ySecoRaw);
        ctx.lineTo(area.right, ySecoRaw);
        ctx.stroke();

        // Línea HÚMEDO (ADC<1800 ≈ >56% humedad)
        const yHumedoRaw = yScale.getPixelForValue(56);
        ctx.strokeStyle = 'rgba(63,185,80,0.4)';
        ctx.beginPath();
        ctx.moveTo(area.left, yHumedoRaw);
        ctx.lineTo(area.right, yHumedoRaw);
        ctx.stroke();
        ctx.restore();
      };
    } else {
      // Actualizar datos existentes
      chartInstance.data.labels          = labels;
      chartInstance.data.datasets[0].data = dataIzq;
      chartInstance.data.datasets[1].data = dataCtr;
      chartInstance.data.datasets[2].data = dataDer;
      chartInstance.update('none');
    }
  } catch (e) {
    // Silencioso — el historial se actualiza en el siguiente ciclo
  }
}

// ── WebSocket ───────────────────────────────────────────────────
function conectarWS() {
  if (wsObj && wsObj.readyState === WebSocket.OPEN) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url   = `${proto}//${location.host}/ws?token=${TOKEN}`;

  console.log('[WS] Conectando a', url);
  wsObj = new WebSocket(url);

  wsObj.onopen = () => {
    console.log('[WS] Conectado');
    setWsStatus(true);
    mostrarToast('Conexión establecida con el servidor', 'gray');
    if (timerReconectar) { clearTimeout(timerReconectar); timerReconectar = null; }
  };

  wsObj.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.tipo === 'telemetria') {
        actualizarUI(data);
      } else if (data.tipo === 'error') {
        mostrarToast('⚠️ ' + data.mensaje, 'red');
      } else if (data.tipo === 'conexion') {
        const wsDot = document.getElementById('wsDot');
        if (!data.esp32) {
          wsDot.style.background = '#f0c040';
          document.getElementById('wsLabel').textContent = 'ESP32 offline';
        }
      }
    } catch (err) {
      console.warn('[WS] Error parseando:', err.message);
    }
  };

  wsObj.onclose = () => {
    console.warn('[WS] Desconectado');
    setWsStatus(false);
    programarReconexionWS();
  };

  wsObj.onerror = () => {
    // onclose se dispara después
  };
}

function setWsStatus(online) {
  const dot    = document.getElementById('wsDot');
  const label  = document.getElementById('wsLabel');
  const banner = document.getElementById('bannerReconectando');

  if (online) {
    dot.className = 'ws-dot online';
    label.textContent = 'Online';
    banner.classList.remove('visible');
  } else {
    dot.className = 'ws-dot';
    label.textContent = 'Desconectado';
    // Solo mostrar el banner si tampoco tenemos datos por HTTP
    if (!estadoActual) banner.classList.add('visible');
    mostrarToast('Conexión perdida. Reconectando...', 'gray');
  }
}

// ── Polling HTTP de respaldo (funciona aunque falle el WebSocket) ──
async function cargarEstadoHTTP() {
  try {
    const res = await fetch('/api/estado', {
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    });
    if (res.status === 401) {
      // Token expirado — redirigir al login
      mostrarToast('Sesión expirada. Redirigiendo...', 'red');
      setTimeout(() => cerrarSesion(), 2000);
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.tipo === 'telemetria') {
      actualizarUI(data);
      // Si tenemos datos, ocultar el banner de reconexión
      document.getElementById('bannerReconectando').classList.remove('visible');
      // Actualizar indicador si WS está caído
      if (!wsObj || wsObj.readyState !== WebSocket.OPEN) {
        document.getElementById('wsDot').className = 'ws-dot online';
        document.getElementById('wsLabel').textContent = 'Polling 30s';
      }
    }
  } catch (e) {
    // Silencioso — el WS seguirá intentando
  }
}

function programarReconexionWS() {
  if (timerReconectar) return;
  timerReconectar = setTimeout(() => {
    timerReconectar = null;
    conectarWS();
  }, 3000);
}

// ── Enviar comandos al servidor ─────────────────────────────────
async function enviarComando(payload) {
  // Intento 1: por WebSocket (más rápido)
  if (wsObj && wsObj.readyState === WebSocket.OPEN) {
    wsObj.send(JSON.stringify(payload));
    return;
  }

  // Intento 2: por REST API como fallback
  try {
    const res = await fetch('/api/comando', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      mostrarToast('Error: ' + (err.error || 'Sin respuesta'), 'red');
    }
  } catch (e) {
    mostrarToast('No se pudo enviar el comando', 'red');
  }
}

// ── Botones del dashboard ───────────────────────────────────────
window.cmdValvula  = (estado) => enviarComando({ cmd: 'valvula',   estado });
window.cmdBombillo = (num, estado) => enviarComando({ cmd: `bombillo${num}`, estado });
window.cmdModoAuto = (auto) => enviarComando({ cmd: 'modo_auto', estado: auto });

window.cerrarSesion = () => {
  localStorage.removeItem('riego_token');
  localStorage.removeItem('riego_usuario');
  window.location.href = '/login.html';
};

// ── Tema claro / oscuro ─────────────────────────────────────────
(function initTema() {
  const guardado = localStorage.getItem('riego_tema') || 'dark';
  aplicarTema(guardado);
})();

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const btn = document.getElementById('btnTema');
  if (btn) btn.textContent = tema === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('riego_tema', tema);
}

window.toggleTema = () => {
  const actual = document.documentElement.getAttribute('data-theme') || 'dark';
  aplicarTema(actual === 'dark' ? 'light' : 'dark');
};

// ── Modal cambiar clave ─────────────────────────────────────────
window.abrirModalClave = () => {
  document.getElementById('claveActual').value  = '';
  document.getElementById('claveNueva').value   = '';
  document.getElementById('claveConfirm').value = '';
  const msg = document.getElementById('msgClave');
  msg.className = 'modal-msg'; msg.textContent = '';
  document.getElementById('modalClave').classList.add('open');
  setTimeout(() => document.getElementById('claveActual').focus(), 100);
};

window.cerrarModalClave = () => {
  document.getElementById('modalClave').classList.remove('open');
};

// Cerrar modal al hacer clic fuera
document.getElementById('modalClave').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.cerrarModalClave();
});

window.guardarClave = async () => {
  const claveActual  = document.getElementById('claveActual').value;
  const claveNueva   = document.getElementById('claveNueva').value;
  const claveConfirm = document.getElementById('claveConfirm').value;
  const btn = document.getElementById('btnGuardarClave');
  const msg = document.getElementById('msgClave');
  msg.className = 'modal-msg'; msg.textContent = '';

  if (!claveActual || !claveNueva || !claveConfirm) {
    msg.className = 'modal-msg err'; msg.textContent = 'Completa todos los campos.'; return;
  }
  if (claveNueva.length < 6) {
    msg.className = 'modal-msg err'; msg.textContent = 'La nueva clave debe tener mínimo 6 caracteres.'; return;
  }
  if (claveNueva !== claveConfirm) {
    msg.className = 'modal-msg err'; msg.textContent = 'Las contraseñas no coinciden.'; return;
  }

  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const res  = await fetch('/api/auth/cambiar-clave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify({ claveActual, claveNueva })
    });
    const data = await res.json();
    if (res.ok) {
      msg.className = 'modal-msg ok'; msg.textContent = '✓ ' + data.mensaje;
      setTimeout(() => window.cerrarModalClave(), 2000);
    } else {
      msg.className = 'modal-msg err'; msg.textContent = data.error || 'Error al cambiar la clave.';
    }
  } catch {
    msg.className = 'modal-msg err'; msg.textContent = 'Error de conexión.';
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
};

// ── Toasts ──────────────────────────────────────────────────────
function mostrarToast(msg, tipo = 'gray') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast-item type-${tipo}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Utilidades ──────────────────────────────────────────────────
function formatearTiempo(seg) {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function tiempoRelativo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return 'unos segundos';
  if (diff < 60) return diff + ' seg';
  return Math.floor(diff / 60) + ' min';
}

// ── INICIO ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  inicializarSensores();

  // Cargar estado inmediatamente por HTTP
  cargarEstadoHTTP();

  // Polling HTTP cada 35 segundos (el ESP32 envía cada 30s)
  // Funciona aunque el WebSocket falle
  setInterval(cargarEstadoHTTP, 35000);

  // Intentar WebSocket para actualizaciones en tiempo real
  conectarWS();
});
