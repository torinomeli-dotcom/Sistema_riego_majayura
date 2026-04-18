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
} else {
  document.body.style.visibility = 'visible';
}

// ── Configuración de sensores ───────────────────────────────────
const SENSORES_CONFIG = [
  { id: 'SL1', zona: 'IZQ', planta: 'Sensor 1'  },
  { id: 'SL2', zona: 'IZQ', planta: 'Sensor 2' },
  { id: 'SL3', zona: 'IZQ', planta: 'Sensor 3' },
  { id: 'SM1', zona: 'CTR', planta: 'Sensor 1'  },
  { id: 'SM2', zona: 'CTR', planta: 'Sensor 2' },
  { id: 'SR1', zona: 'DER', planta: 'Sensor 1'  },
  { id: 'SR2', zona: 'DER', planta: 'Sensor 2' },
  { id: 'SR3', zona: 'DER', planta: 'Sensor 3' },
];

// ── Catálogo de cultivos — La Guajira, riego goteo gravedad ────
const CULTIVOS = {
  cilantro:  { nombre:'Cilantro',        emoji:'🌿', agua:'Muy alta', aguaCls:'agua-muy-alta',
    desc:'Raíz muy superficial (10–20 cm). Muy sensible a la falta de agua — se seca rápido en calor guajiro.',
    tip:'En verano puede necesitar 6–8 ciclos de riego diarios. Ideal en horas frescas de madrugada y tarde.',
    umbral_seco:2800, umbral_humedo:1400, umbral_encharcado:500, min_riego_ms:480000,  max_riego_ms:1500000 },

  lechuga:   { nombre:'Lechuga',         emoji:'🥬', agua:'Muy alta', aguaCls:'agua-muy-alta',
    desc:'Raíz superficial (10–20 cm). La más sensible al calor. Produce mejor con sombra y riego constante.',
    tip:'En Maicao es casi obligatorio usar malla sombra 50%. Sin ella el calor de 40°C la quema en horas.',
    umbral_seco:2600, umbral_humedo:1300, umbral_encharcado:500, min_riego_ms:480000,  max_riego_ms:1500000 },

  cebolla:   { nombre:'Cebolla',         emoji:'🧅', agua:'Alta',     aguaCls:'agua-alta',
    desc:'Raíz superficial (15–30 cm). Necesita humedad consistente para que el bulbo se forme bien.',
    tip:'Riego irregular produce bulbos deformes y partidos. Reducir agua 2 semanas antes de cosechar.',
    umbral_seco:2900, umbral_humedo:1600, umbral_encharcado:500, min_riego_ms:600000,  max_riego_ms:2100000 },

  tomate:    { nombre:'Tomate',          emoji:'🍅', agua:'Alta',     aguaCls:'agua-alta',
    desc:'Raíz media (30–60 cm). Riego irregular causa pudrición apical del fruto — pérdida total del tomate.',
    tip:'Mantener humedad constante durante floración y cuaje del fruto. Crítico para calidad.',
    umbral_seco:3000, umbral_humedo:1700, umbral_encharcado:550, min_riego_ms:900000,  max_riego_ms:2400000 },

  aji:       { nombre:'Ají',             emoji:'🌶️', agua:'Media-alta',aguaCls:'agua-alta',
    desc:'Raíz media (30–50 cm). Cultivo tradicional de La Guajira. Tolera algo de estrés hídrico.',
    tip:'Muy adaptado al calor guajiro. Reducir riego en frío reduce picor. Ideal para todo el año.',
    umbral_seco:3300, umbral_humedo:1900, umbral_encharcado:600, min_riego_ms:900000,  max_riego_ms:2700000 },

  pimenton:  { nombre:'Pimentón',        emoji:'🫑', agua:'Media-alta',aguaCls:'agua-alta',
    desc:'Raíz media (30–50 cm). Similar al ají pero necesita más agua para desarrollar frutos grandes.',
    tip:'Sensible a temperaturas extremas. Cubierta o sombra parcial mejora producción en verano.',
    umbral_seco:3000, umbral_humedo:1800, umbral_encharcado:550, min_riego_ms:900000,  max_riego_ms:2700000 },

  pepino:    { nombre:'Pepino',          emoji:'🥒', agua:'Alta',     aguaCls:'agua-alta',
    desc:'Raíz superficial-media (25–40 cm). El fruto es 95% agua — sin riego constante se amarga.',
    tip:'Sequía produce frutos deformes y amargos. En La Guajira con goteo produce excelente calidad.',
    umbral_seco:2900, umbral_humedo:1600, umbral_encharcado:500, min_riego_ms:720000,  max_riego_ms:2100000 },

  berenjena: { nombre:'Berenjena',       emoji:'🍆', agua:'Media',    aguaCls:'agua-media',
    desc:'Raíz media-profunda (40–70 cm). Muy adaptada al calor. Tolera algo de sequía sin perder calidad.',
    tip:'Uno de los cultivos mejor adaptados a La Guajira. Excelente para goteo por gravedad.',
    umbral_seco:3200, umbral_humedo:2000, umbral_encharcado:600, min_riego_ms:900000,  max_riego_ms:2700000 },

  frijol:    { nombre:'Frijol',          emoji:'🫘', agua:'Media',    aguaCls:'agua-media',
    desc:'Raíz media (30–60 cm). Muy sensible al encharcamiento — raíces se pudren en 24 h con agua estancada.',
    tip:'Nunca regar en exceso. En La Guajira la arena drena bien — encharcamiento es poco probable.',
    umbral_seco:3100, umbral_humedo:1800, umbral_encharcado:480, min_riego_ms:720000,  max_riego_ms:2400000 },

  maiz:      { nombre:'Maíz',            emoji:'🌽', agua:'Media',    aguaCls:'agua-media',
    desc:'Raíz media-profunda (50–80 cm). Crítico mantener humedad en germinación y en espigamiento.',
    tip:'Con goteo en La Guajira se puede sembrar todo el año. Reducir agua al madurar el grano.',
    umbral_seco:3100, umbral_humedo:1900, umbral_encharcado:600, min_riego_ms:900000,  max_riego_ms:2700000 },

  auyama:    { nombre:'Auyama',          emoji:'🎃', agua:'Media',    aguaCls:'agua-media',
    desc:'Raíz profunda (60–100 cm). Muy común en La Guajira. Tolera períodos secos sin perder producción.',
    tip:'Reducir agua al madurar el fruto concentra el sabor. No regar el follaje — favorece hongos.',
    umbral_seco:3400, umbral_humedo:2000, umbral_encharcado:600, min_riego_ms:1200000, max_riego_ms:3000000 },

  patilla:   { nombre:'Patilla',         emoji:'🍉', agua:'Media-baja',aguaCls:'agua-media',
    desc:'Raíz muy profunda (60–120 cm). Cultivo emblema de La Guajira — produce naturalmente en sequía.',
    tip:'Reducir riego 10–15 días antes de cosechar aumenta el dulzor. Calidad excepcional con goteo.',
    umbral_seco:3400, umbral_humedo:2100, umbral_encharcado:600, min_riego_ms:1200000, max_riego_ms:3000000 },

  melon:     { nombre:'Melón',           emoji:'🍈', agua:'Media-baja',aguaCls:'agua-media',
    desc:'Raíz profunda (60–100 cm). Excelente adaptación al clima árido. Muy rentable en La Guajira.',
    tip:'Limitar a 2–3 frutos por planta para mayor tamaño. Reducir agua en maduración para más azúcar.',
    umbral_seco:3400, umbral_humedo:2100, umbral_encharcado:600, min_riego_ms:1200000, max_riego_ms:3000000 },

  yuca:      { nombre:'Yuca',            emoji:'🥔', agua:'Baja',     aguaCls:'agua-baja',
    desc:'Raíz muy profunda (60–120 cm). EL cultivo de La Guajira. Sobrevive meses sin lluvia.',
    tip:'Con riego por goteo la producción se duplica. Solo regar cuando el suelo esté muy seco. Muy rentable.',
    umbral_seco:3700, umbral_humedo:2300, umbral_encharcado:600, min_riego_ms:1200000, max_riego_ms:3600000 },
};

let cultivoSeleccionado = null;

// ── Estado local ────────────────────────────────────────────────
let estadoActual    = null;
let timerValvula    = null;
let segundosValvula = 0;
let chartInstance   = null;
let esp32Online     = false;   // estado real del ESP32 vía WebSocket
let otaEnProgreso   = false;   // true mientras ESP32 está actualizando firmware
let otaTimeout      = null;    // timer de watchdog OTA

// ── Mapa de campo ───────────────────────────────────────────────
let sensorSeleccionado = null;

const ZONA_INFO = {
  IZQ: { label: 'Columna Izquierda', cls: 'zona-izq' },
  CTR: { label: 'Columna Central',   cls: 'zona-ctr' },
  DER: { label: 'Columna Derecha',   cls: 'zona-der' },
};

function pinEmoji(estado) {
  if (estado === 'SECO')        return '🔴';
  if (estado === 'ENCHARCADO')  return '⚠️';
  if (estado === 'HUMEDO')      return '💧';
  return '⚪';
}

function inicializarSensores() {
  const mapa = document.getElementById('campoMapa');
  if (!mapa) return;
  mapa.innerHTML = '';

  ['IZQ','CTR','DER'].forEach(zona => {
    const sensores = SENSORES_CONFIG.filter(s => s.zona === zona);
    const col = document.createElement('div');
    col.className = 'campo-zona';
    col.innerHTML = `<div class="campo-zona-label"><span class="zona-badge ${ZONA_INFO[zona].cls}">${zona}</span><span>${ZONA_INFO[zona].label}</span></div>`;

    const pins = document.createElement('div');
    pins.className = 'campo-pins';

    sensores.forEach(cfg => {
      const pin = document.createElement('button');
      pin.className = 'sensor-pin';
      pin.id = `pin_${cfg.id}`;
      pin.innerHTML = `
        <span class="pin-emoji" id="pinemoji_${cfg.id}">⚪</span>
        <span class="pin-label">${cfg.id}</span>
        <span class="pin-pct" id="pinpct_${cfg.id}">--%</span>`;
      pin.onclick = () => sensorSeleccionado === cfg.id ? cerrarDetalleSensor() : abrirDetalleSensor(cfg.id);
      pins.appendChild(pin);
    });

    col.appendChild(pins);
    mapa.appendChild(col);
  });
}

function abrirDetalleSensor(id) {
  const panel = document.getElementById('sensorDetalle');
  const cfg   = SENSORES_CONFIG.find(s => s.id === id);
  if (!cfg) return;

  // Marcar pin activo
  document.querySelectorAll('.sensor-pin').forEach(p => p.classList.remove('activo'));
  document.getElementById(`pin_${id}`)?.classList.add('activo');
  sensorSeleccionado = id;

  const estado = document.getElementById(`pinemoji_${id}`)?.dataset.estado || '---';
  const pct    = document.getElementById(`pinpct_${id}`)?.textContent || '--%';
  const adc    = document.getElementById(`pinadc_${id}`)?.value       || '---';
  const tiempo = document.getElementById(`pintiempo_${id}`)?.value    || '--';

  const labels = { HUMEDO: 'HÚMEDO', SECO: 'SECO', ENCHARCADO: '⚠ ENCHARCADO' };
  const estadoLabel = labels[estado] || estado;
  const cls = estado === 'SECO' ? 'seco' : estado === 'ENCHARCADO' ? 'encharcado' : 'humedo';

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="detalle-header">
      <div>
        <span class="detalle-emoji">${pinEmoji(estado)}</span>
        <span class="detalle-nombre">${cfg.id} — ${ZONA_INFO[cfg.zona].label}</span>
      </div>
      <button onclick="cerrarDetalleSensor()" class="detalle-cerrar">✕</button>
    </div>
    <div class="detalle-body">
      <div class="detalle-item">
        <div class="detalle-item-label">Humedad</div>
        <div class="detalle-item-val pct-${cls}">${pct}</div>
      </div>
      <div class="detalle-item">
        <div class="detalle-item-label">Estado</div>
        <div class="detalle-item-val badge-estado badge-${estado}" style="display:inline-block">${estadoLabel}</div>
      </div>
      <div class="detalle-item">
        <div class="detalle-item-label">Valor ADC</div>
        <div class="detalle-item-val" id="detalleAdc">${adc}</div>
      </div>
      <div class="detalle-item">
        <div class="detalle-item-label">Última lectura</div>
        <div class="detalle-item-val" id="detalleTiempo">${tiempo}</div>
      </div>
    </div>`;
}

window.cerrarDetalleSensor = () => {
  document.getElementById('sensorDetalle').style.display = 'none';
  document.querySelectorAll('.sensor-pin').forEach(p => p.classList.remove('activo'));
  sensorSeleccionado = null;
};

// ── Actualizar UI con datos del ESP32 ───────────────────────────
function actualizarUI(data) {
  const prev = estadoActual;
  estadoActual = data;

  // ── Timestamp ──────────────────────────────────────────────
  const ahora = new Date();
  document.getElementById('ultimaActualizacion').textContent =
    'Actualizado: ' + ahora.toLocaleTimeString('es-CO');

  // ── Sensores (mapa) ────────────────────────────────────────
  const s = data.sensores || {};
  SENSORES_CONFIG.forEach(cfg => {
    const info = s[cfg.id];
    if (!info) return;

    const estado = info.estado || 'HUMEDO';
    const humPct = info.pct    || 0;
    const adc    = info.adc    || 0;
    const tiempoStr = 'Hace ' + tiempoRelativo(data.serverTimestamp || Date.now());

    // Actualizar pin
    const pin      = document.getElementById(`pin_${cfg.id}`);
    const emojiEl  = document.getElementById(`pinemoji_${cfg.id}`);
    const pctEl    = document.getElementById(`pinpct_${cfg.id}`);

    if (pin) {
      pin.classList.remove('pin-seco','pin-humedo','pin-encharcado');
      pin.classList.add(`pin-${estado.toLowerCase()}`);
    }
    if (emojiEl) {
      emojiEl.textContent = pinEmoji(estado);
      emojiEl.dataset.estado = estado;
    }
    if (pctEl) pctEl.textContent = humPct + '%';

    // Guardar ADC y tiempo en campos ocultos para el panel de detalle
    let adcHidden = document.getElementById(`pinadc_${cfg.id}`);
    if (!adcHidden) {
      adcHidden = document.createElement('input');
      adcHidden.type = 'hidden'; adcHidden.id = `pinadc_${cfg.id}`;
      document.body.appendChild(adcHidden);
    }
    adcHidden.value = `ADC ${adc}`;

    let tiempoHidden = document.getElementById(`pintiempo_${cfg.id}`);
    if (!tiempoHidden) {
      tiempoHidden = document.createElement('input');
      tiempoHidden.type = 'hidden'; tiempoHidden.id = `pintiempo_${cfg.id}`;
      document.body.appendChild(tiempoHidden);
    }
    tiempoHidden.value = tiempoStr;

    // Si este sensor está abierto en el panel, actualizar en vivo
    if (sensorSeleccionado === cfg.id) {
      const labels = { HUMEDO: 'HÚMEDO', SECO: 'SECO', ENCHARCADO: '⚠ ENCHARCADO' };
      const cls = estado === 'SECO' ? 'seco' : estado === 'ENCHARCADO' ? 'encharcado' : 'humedo';
      const adcD  = document.getElementById('detalleAdc');
      const tD    = document.getElementById('detalleTiempo');
      if (adcD) adcD.textContent = `ADC ${adc}`;
      if (tD)   tD.textContent   = tiempoStr;
    }
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
    document.getElementById('valvulaIcon').style.fontSize = on ? '2rem' : '2.2rem';

    const badgeModo = document.getElementById('badgeModoValvula');
    badgeModo.textContent = modo;
    badgeModo.classList.toggle('manual', modo === 'MANUAL');

    document.getElementById('motivoValvula').textContent =
      data.motivo_riego || '—';

    // Toggle auto
    const toggleAuto     = document.getElementById('toggleAuto');
    const toggleAutoText = document.getElementById('toggleAutoText');
    toggleAuto.checked       = modo === 'AUTO';
    toggleAutoText.textContent = modo === 'AUTO' ? 'AUTOMÁTICO' : 'MANUAL';

    // Botones (deshabilitados en AUTO o si tanque vacío)
    const modoAuto = modo === 'AUTO';
    const tanqueVacio = estadoActual?.tanque_lleno === false;
    document.getElementById('btnAbrir').disabled  = modoAuto || tanqueVacio;
    document.getElementById('btnCerrar').disabled = modoAuto;
    document.getElementById('btnB1On').disabled   = modoAuto;
    document.getElementById('btnB1Off').disabled  = modoAuto;
    document.getElementById('btnB2On').disabled   = modoAuto;
    document.getElementById('btnB2Off').disabled  = modoAuto;

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

  // ── TANQUE DE AGUA ─────────────────────────────────────────
  const tanqueLleno = data.tanque_lleno !== undefined ? data.tanque_lleno : true;
  const cardTanque     = document.getElementById('cardTanque');
  const estadoTanqueEl = document.getElementById('estadoTanque');
  const tanqueInfo     = document.getElementById('tanqueInfo');
  const tanqueFill     = document.getElementById('tanqueFill');
  const tanqueOla      = document.getElementById('tanqueOla');

  const prevVacio = cardTanque.classList.contains('tanque-vacio');
  cardTanque.classList.toggle('tanque-vacio', !tanqueLleno);

  // Trigger animación shake al vaciarse
  if (!tanqueLleno && !prevVacio) {
    const cuerpo = cardTanque.querySelector('.tanque-cuerpo');
    cuerpo.style.animation = 'none';
    requestAnimationFrame(() => { cuerpo.style.animation = ''; });
  }

  estadoTanqueEl.textContent = tanqueLleno ? 'CON AGUA' : 'VACÍO';
  estadoTanqueEl.className   = `act-estado${tanqueLleno ? ' on' : ' tanque-alerta'}`;
  tanqueInfo.textContent     = tanqueLleno
    ? 'Suministro de agua disponible'
    : 'Sin agua — válvula bloqueada';

  const alertaTanqueEl = document.getElementById('alertaTanque');
  alertaTanqueEl.style.display = !tanqueLleno ? 'block' : 'none';

  // Bloquear botón Abrir si tanque vacío (independiente del modo)
  const btnAbrir = document.getElementById('btnAbrir');
  if (btnAbrir && !btnAbrir.disabled) btnAbrir.disabled = !tanqueLleno;
  if (btnAbrir &&  btnAbrir.disabled && tanqueLleno) {
    const modoAuto = document.getElementById('toggleAuto')?.checked;
    if (!modoAuto) btnAbrir.disabled = false;
  }

  if (!tanqueLleno && (prev?.tanque_lleno !== false)) {
    mostrarToast('⚠ Tanque sin agua — válvula bloqueada automáticamente', 'red');
  }
  if (tanqueLleno && prev?.tanque_lleno === false) {
    mostrarToast('Tanque con agua — sistema de riego disponible', 'blue');
  }

  // ── ALERTA ENCHARCAMIENTO ──────────────────────────────────
  const alerta = data.alerta_encharcamiento || false;
  const alertaEl = document.getElementById('alertaEnchar');
  alertaEl.style.display = alerta ? 'block' : 'none';

  if (alerta && !prev?.alerta_encharcamiento) {
    mostrarToast('⚠ Encharcamiento detectado en columna IZQ', 'red');
  }

  // ── Cultivo activo desde ESP32 ────────────────────────────
  if (data.calibracion?.cultivo) {
    marcarCultivoActivo(data.calibracion.cultivo);
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
  document.getElementById(iconId).style.fontSize = on ? '2rem' : '2.2rem';
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

// ── WebSocket — actualizaciones en tiempo real ──────────────────
let wsObj = null;

function conectarWS() {
  if (wsObj) {
    wsObj.onclose = null;  // evitar reconexión doble
    wsObj.close();
    wsObj = null;
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url   = `${proto}//${location.host}/ws/dashboard?token=${TOKEN}`;
  console.log('[WS] Conectando...');

  wsObj = new WebSocket(url);

  wsObj.onopen = () => {
    console.log('[WS] Conectado');
    setConexionStatus(true);
  };

  wsObj.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.tipo === 'esp32_status') {
        esp32Online = data.conectado;
        actualizarIndicadorESP32();

        if (otaEnProgreso && data.conectado) {
          clearInterval(otaProgressInterval);
          otaSetProgress(95);
          const txt = document.getElementById('otaEstadoTxt');
          if (txt) txt.textContent = '🔗 ESP32 reconectado — verificando resultado...';
        }
        if (otaEnProgreso && !data.conectado) {
          const txt = document.getElementById('otaEstadoTxt');
          if (txt) txt.textContent = '🔄 ESP32 reiniciando — esperando reconexión...';
        }
      } else if (data.sensores || data.tipo === 'telemetria') {
        esp32Online = true;
        actualizarIndicadorESP32();
        if (otaEnProgreso) {
          // Primera telemetría tras OTA — determinar resultado
          if (data.ota_fallo) {
            otaResultado(false);
          } else {
            otaResultado(true);
          }
        }
        actualizarUI(data);
      }
    } catch (err) {
      console.warn('[WS] Error parseando:', err.message);
    }
  };

  wsObj.onclose = () => {
    setConexionStatus(false);
    console.warn('[WS] Cerrado — reconectando en 5s...');
    setTimeout(conectarWS, 5000);
  };

  wsObj.onerror = () => {
    setConexionStatus(false);
    console.warn('[WS] Error de conexión');
  };
}

// Estado del WebSocket browser ↔ servidor
function setConexionStatus(online) {
  const banner = document.getElementById('bannerReconectando');
  if (online) {
    banner.classList.remove('visible');
  } else {
    esp32Online = false;
    actualizarIndicadorESP32();
    if (!estadoActual) banner.classList.add('visible');
  }
}

// Estado del ESP32 ↔ servidor (verde/gris)
function actualizarIndicadorESP32() {
  const dot     = document.getElementById('wsDot');
  const label   = document.getElementById('wsLabel');
  const content = document.getElementById('dashboardContent');
  if (esp32Online) {
    dot.className     = 'ws-dot online';
    label.textContent = 'ESP32 Online';
    content?.classList.remove('esp32-offline');
  } else {
    dot.className     = 'ws-dot';
    label.textContent = 'ESP32 Offline';
    content?.classList.add('esp32-offline');
  }
}

// ── Polling HTTP de respaldo (cada 35s aunque SSE falle) ─────────
async function cargarEstadoHTTP() {
  try {
    const res = await fetch('/api/estado', {
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    });
    if (res.status === 401) {
      mostrarToast('Sesión expirada. Redirigiendo...', 'red');
      setTimeout(() => cerrarSesion(), 2000);
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.tipo === 'telemetria') {
      actualizarUI(data);
      document.getElementById('bannerReconectando').classList.remove('visible');
    }
  } catch (_) { /* silencioso */ }
}

// ── Enviar comandos al servidor ──────────────────────────────────
async function enviarComando(payload) {
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
      return;
    }
    // Confirmar estado a los 2s (ESP32 recibe → ejecuta → responde vía WS)
    // Si el WS ya entregó la actualización, esta llamada es redundante pero inofensiva
    setTimeout(cargarEstadoHTTP, 2000);
  } catch (e) {
    mostrarToast('No se pudo enviar el comando', 'red');
  }
}

// ── Botones del dashboard ───────────────────────────────────────
window.cmdValvula  = (estado) => enviarComando({ cmd: 'valvula',   estado });
window.cmdBombillo = (num, estado) => enviarComando({ cmd: `bombillo${num}`, estado });
window.cmdModoAuto = (auto) => {
  document.getElementById('toggleAutoText').textContent = auto ? 'AUTOMÁTICO' : 'MANUAL';
  enviarComando({ cmd: 'modo_auto', estado: auto });
};

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

// ── Modal OTA ───────────────────────────────────────────────────
let otaProgressInterval = null;
let otaProgressVal      = 0;

function otaFase(fase) {
  document.getElementById('otaFaseForm').style.display      = fase === 'form'      ? '' : 'none';
  document.getElementById('otaFaseProgreso').style.display  = fase === 'progreso'  ? '' : 'none';
  document.getElementById('otaFaseResultado').style.display = fase === 'resultado' ? '' : 'none';
}

function otaSetProgress(pct, fallo = false) {
  otaProgressVal = pct;
  const fill = document.getElementById('otaProgressFill');
  const lbl  = document.getElementById('otaProgressPct');
  fill.style.width = pct + '%';
  fill.classList.toggle('fallo', fallo);
  lbl.textContent  = pct + '%';
  lbl.style.color  = fallo ? 'var(--red)' : pct === 100 ? 'var(--green)' : 'var(--blue)';
}

function otaIniciarBarraSimulada() {
  // 0→85% en ~75s (descarga), luego frena esperando reconexión
  clearInterval(otaProgressInterval);
  otaProgressVal = 0;
  otaSetProgress(0);
  otaProgressInterval = setInterval(() => {
    if (otaProgressVal < 85) {
      otaProgressVal = Math.min(otaProgressVal + 1, 85);
      otaSetProgress(otaProgressVal);
      const txt = document.getElementById('otaEstadoTxt');
      if (otaProgressVal < 40)       txt.textContent = '📡 Descargando firmware...';
      else if (otaProgressVal < 75)  txt.textContent = '⚙ Instalando firmware...';
      else                           txt.textContent = '🔄 Esperando reinicio del ESP32...';
    }
  }, 900);
}

function otaResultado(exito) {
  clearInterval(otaProgressInterval);
  clearTimeout(otaTimeout);
  otaEnProgreso = false;

  otaSetProgress(exito ? 100 : otaProgressVal, !exito);
  otaFase('resultado');

  document.getElementById('otaResultadoIcon').textContent = exito ? '✅' : '❌';
  const msg = document.getElementById('otaResultadoMsg');
  msg.className   = `ota-resultado-msg ${exito ? 'exito' : 'fallo'}`;
  msg.textContent = exito
    ? '¡Firmware actualizado con éxito! El ESP32 está en línea.'
    : 'La actualización falló. Verifica la URL y vuelve a intentarlo.';

  document.getElementById('btnOtaReintentar').style.display = exito ? 'none' : '';
  if (exito) mostrarToast('✅ OTA completado — ESP32 reconectado', 'success');
  else       mostrarToast('❌ OTA falló — ESP32 reportó error', 'red');
}

window.reiniciarOTA = () => {
  otaFase('form');
  document.getElementById('otaUrl').value = '';
  document.getElementById('otaSuperPass').value = '';
  document.getElementById('msgOTA').textContent = '';
};

window.abrirModalOTA = () => {
  otaFase('form');
  document.getElementById('otaUrl').value = '';
  document.getElementById('otaSuperPass').value = '';
  document.getElementById('msgOTA').className = 'modal-msg';
  document.getElementById('msgOTA').textContent = '';
  document.getElementById('btnEnviarOTA').disabled = false;
  document.getElementById('btnEnviarOTA').textContent = 'Actualizar ESP32';
  document.getElementById('modalOTA').classList.add('open');
};

window.cerrarModalOTA = () => {
  if (otaEnProgreso) return; // no cerrar durante actualización activa
  clearInterval(otaProgressInterval);
  clearTimeout(otaTimeout);
  document.getElementById('modalOTA').classList.remove('open');
};

window.enviarOTA = async () => {
  const url = document.getElementById('otaUrl').value.trim();
  const msg = document.getElementById('msgOTA');
  const btn = document.getElementById('btnEnviarOTA');
  msg.className = 'modal-msg'; msg.textContent = '';

  // ── Validaciones previas ────────────────────────────────────
  if (!url) {
    msg.className = 'modal-msg err';
    msg.textContent = 'Ingresa la URL del archivo .bin.';
    return;
  }
  if (!url.startsWith('https://')) {
    msg.className = 'modal-msg err';
    msg.textContent = 'La URL debe comenzar con https://';
    return;
  }
  if (!url.toLowerCase().includes('.bin')) {
    msg.className = 'modal-msg err';
    msg.textContent = 'La URL debe apuntar a un archivo .bin';
    return;
  }
  if (!esp32Online) {
    msg.className = 'modal-msg err';
    msg.textContent = '⚠ ESP32 no está conectado. Enciéndelo e intenta de nuevo.';
    return;
  }

  const superPass = document.getElementById('otaSuperPass').value;
  if (!superPass) {
    msg.className = 'modal-msg err';
    msg.textContent = 'Ingresa la contraseña de autorización.';
    return;
  }

  btn.disabled = true;
  try {
    const res = await fetch('/api/comando', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ cmd: 'ota_update', url, superPass })
    });
    const respuesta = await res.json();

    if (!res.ok) {
      msg.className = 'modal-msg err';
      msg.textContent = respuesta.error || 'Error enviando comando.';
      btn.disabled = false;
      return;
    }

    if (respuesta.encolado) {
      // ESP32 se desconectó justo en el momento del envío
      msg.className = 'modal-msg err';
      msg.textContent = '⚠ El ESP32 se desconectó al momento de enviar. Intenta de nuevo.';
      btn.disabled = false;
      return;
    }

    // Comando llegó al ESP32 — iniciar seguimiento
    otaEnProgreso = true;
    otaFase('progreso');
    otaIniciarBarraSimulada();

    // Watchdog 4 min — si no responde, fallo
    otaTimeout = setTimeout(() => {
      if (otaEnProgreso) {
        otaResultado(false);
        document.getElementById('otaResultadoMsg').textContent = 'Tiempo de espera agotado. El ESP32 no respondió.';
      }
    }, 240000);

  } catch {
    msg.className = 'modal-msg err';
    msg.textContent = 'Error de conexión con el servidor.';
    btn.disabled = false;
  }
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
  if (!/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/.test(claveNueva)) {
    msg.className = 'modal-msg err'; msg.textContent = 'La clave debe tener mínimo 8 caracteres, una mayúscula, un número y un carácter especial.'; return;
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

// ── SELECTOR DE CULTIVO ─────────────────────────────────────────
function inicializarCultivos() {
  const grid = document.getElementById('cultivoGrid');
  if (!grid) return;
  Object.entries(CULTIVOS).forEach(([key, c]) => {
    const btn = document.createElement('button');
    btn.className = 'btn-cultivo';
    btn.id = `cultivo_${key}`;
    btn.innerHTML = `<span class="ce">${c.emoji}</span>${c.nombre}`;
    btn.onclick = () => seleccionarCultivo(key);
    grid.appendChild(btn);
  });
  if (typeof twemoji !== 'undefined') twemoji.parse(grid, { folder: 'svg', ext: '.svg' });
}

function seleccionarCultivo(key) {
  cultivoSeleccionado = key;
  const c = CULTIVOS[key];

  document.querySelectorAll('.btn-cultivo').forEach(b => b.classList.remove('activo'));
  document.getElementById(`cultivo_${key}`).classList.add('activo');

  document.getElementById('cultivoEmoji').textContent  = c.emoji;
  if (typeof twemoji !== 'undefined') twemoji.parse(document.getElementById('cultivoEmoji'), { folder: 'svg', ext: '.svg' });
  document.getElementById('cultivoNombre').textContent = c.nombre;
  document.getElementById('cultivoDesc').textContent   = c.desc;
  document.getElementById('cultivoTip').textContent    = c.tip;

  const badge = document.getElementById('cultivoBadgeAgua');
  badge.textContent = `💧 ${c.agua}`;
  badge.className   = `badge-agua ${c.aguaCls}`;

  document.getElementById('cultivoParams').innerHTML = `
    <div class="param-item">
      <div class="param-label">Abre válvula si ADC &gt;</div>
      <div class="param-value">${c.umbral_seco}<span class="param-unit">ADC</span></div>
    </div>
    <div class="param-item">
      <div class="param-label">Cierra válvula si ADC &lt;</div>
      <div class="param-value">${c.umbral_humedo}<span class="param-unit">ADC</span></div>
    </div>
    <div class="param-item">
      <div class="param-label">Riego mínimo</div>
      <div class="param-value">${c.min_riego_ms/60000}<span class="param-unit">min</span></div>
    </div>
    <div class="param-item">
      <div class="param-label">Corte seguridad</div>
      <div class="param-value">${c.max_riego_ms/60000}<span class="param-unit">min</span></div>
    </div>`;

  document.getElementById('cultivoInfo').style.display = 'block';
  document.getElementById('cultivoLabel').textContent  = `Seleccionado: ${c.nombre}`;
}

function marcarCultivoActivo(clave) {
  if (!clave || !CULTIVOS[clave]) return;
  document.querySelectorAll('.btn-cultivo').forEach(b => b.classList.remove('activo'));
  const btn = document.getElementById(`cultivo_${clave}`);
  if (btn) btn.classList.add('activo');
  document.getElementById('cultivoLabel').textContent = `Activo: ${CULTIVOS[clave].nombre}`;
}

window.aplicarCultivo = async () => {
  if (!cultivoSeleccionado) return;
  const c   = CULTIVOS[cultivoSeleccionado];
  const btn = document.getElementById('btnAplicarCultivo');
  btn.disabled = true;
  btn.textContent = 'Enviando al ESP32...';
  try {
    const res = await fetch('/api/comando', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        cmd:                'calibrar',
        cultivo:            cultivoSeleccionado,
        umbral_seco:        c.umbral_seco,
        umbral_humedo:      c.umbral_humedo,
        umbral_encharcado:  c.umbral_encharcado,
        min_riego_ms:       c.min_riego_ms,
        max_riego_ms:       c.max_riego_ms,
      })
    });
    if (res.ok) {
      mostrarToast(`✅ Cultivo "${c.nombre}" aplicado al sistema`, 'success');
      btn.disabled = false;
      btn.textContent = 'Aplicar parámetros al sistema';
      document.getElementById('cultivoInfo').style.display = 'none';
      document.getElementById('cultivoLabel').textContent  = `Activo: ${c.nombre}`;
    } else {
      const e = await res.json();
      mostrarToast(`Error: ${e.error}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Aplicar parámetros al sistema';
    }
  } catch {
    mostrarToast('Error de conexión', 'error');
    btn.disabled = false;
    btn.textContent = 'Aplicar parámetros al sistema';
  }
};

function marcarCultivoActivo(clave) {
  if (!clave || !CULTIVOS[clave]) return;
  document.querySelectorAll('.btn-cultivo').forEach(b => b.classList.remove('activo'));
  const btn = document.getElementById(`cultivo_${clave}`);
  if (btn) btn.classList.add('activo');
  document.getElementById('cultivoLabel').textContent = `Activo: ${CULTIVOS[clave].nombre}`;
}

// ── INACTIVIDAD — cierre automático de sesión ───────────────────
const INACTIV_AVISO_MS = 18 * 60 * 1000; // aviso a los 18 min
const INACTIV_CIERRE_S = 120;             // 2 min después cerrar

let _timerAviso, _timerCierre, _intervaloConteo;

function _resetInactividad() {
  clearTimeout(_timerAviso);
  clearTimeout(_timerCierre);
  clearInterval(_intervaloConteo);
  document.getElementById('modalInactividad')?.classList.remove('open');
  _timerAviso = setTimeout(_mostrarAvisoInactividad, INACTIV_AVISO_MS);
}

function _mostrarAvisoInactividad() {
  let seg = INACTIV_CIERRE_S;
  document.getElementById('cuentaRegresivaSegundos').textContent = seg;
  document.getElementById('modalInactividad').classList.add('open');
  _intervaloConteo = setInterval(() => {
    seg--;
    const el = document.getElementById('cuentaRegresivaSegundos');
    if (el) el.textContent = seg;
    if (seg <= 0) {
      clearInterval(_intervaloConteo);
      cerrarSesion();
    }
  }, 1000);
}

window.continuarSesion = () => _resetInactividad();

['mousemove','keydown','click','scroll','touchstart'].forEach(evt =>
  document.addEventListener(evt, _resetInactividad, { passive: true })
);

// ── HORARIO DE RIEGO ────────────────────────────────────────────
window.abrirModalHorario = () => {
  const modo = localStorage.getItem('horarioModo') || 'todo';
  const radio = document.querySelector(`input[name="horarioModo"][value="${modo}"]`);
  if (radio) radio.checked = true;
  document.getElementById('horarioDesde').value = localStorage.getItem('horarioDesde') || '06:00';
  document.getElementById('horarioHasta').value = localStorage.getItem('horarioHasta') || '18:00';
  document.getElementById('horarioRangoWrap').style.display = modo === 'rango' ? 'block' : 'none';
  document.getElementById('msgHorario').textContent = '';
  document.getElementById('modalHorario').classList.add('open');
};

window.cerrarModalHorario = () => document.getElementById('modalHorario').classList.remove('open');

window.onHorarioChange = () => {
  const modo = document.querySelector('input[name="horarioModo"]:checked')?.value;
  document.getElementById('horarioRangoWrap').style.display = modo === 'rango' ? 'block' : 'none';
};

window.guardarHorario = async () => {
  const modo = document.querySelector('input[name="horarioModo"]:checked')?.value;
  if (!modo) return;

  let inicio_h = 0, inicio_m = 0, fin_h = 23, fin_m = 59;
  if (modo === 'rango') {
    const desde = document.getElementById('horarioDesde').value; // "HH:MM"
    const hasta = document.getElementById('horarioHasta').value;
    if (!desde || !hasta) { document.getElementById('msgHorario').textContent = 'Selecciona ambas horas.'; return; }
    [inicio_h, inicio_m] = desde.split(':').map(Number);
    [fin_h,    fin_m]    = hasta.split(':').map(Number);
    if ((fin_h * 60 + fin_m) <= (inicio_h * 60 + inicio_m)) {
      document.getElementById('msgHorario').textContent = '"Hasta" debe ser mayor que "Desde".';
      return;
    }
  }

  const btn = document.getElementById('btnGuardarHorario');
  btn.disabled = true; btn.textContent = 'Aplicando...';
  try {
    const res = await fetch('/api/comando', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify({ cmd: 'horario_riego', modo, inicio_h, inicio_m, fin_h, fin_m })
    });
    if (!res.ok) {
      const err = await res.json();
      document.getElementById('msgHorario').textContent = err.error || 'Error al enviar al ESP32.';
    } else {
      localStorage.setItem('horarioModo',  modo);
      localStorage.setItem('horarioDesde', document.getElementById('horarioDesde').value);
      localStorage.setItem('horarioHasta', document.getElementById('horarioHasta').value);
      cerrarModalHorario();
      const fmt24 = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const etiquetas = { todo:'24/7', dia:'Solo día (7am–6pm)', noche:'Solo noche (6pm–7am)',
                          rango:`${fmt24(inicio_h,inicio_m)} – ${fmt24(fin_h,fin_m)}` };
      mostrarToast(`Horario: ${etiquetas[modo]}`, 'success');
    }
  } catch {
    document.getElementById('msgHorario').textContent = 'No se pudo conectar al servidor.';
  }
  btn.disabled = false; btn.textContent = 'Aplicar al sistema';
};

// ── INICIO ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  try {
    _resetInactividad();
    inicializarSensores();
    inicializarCultivos();
    cargarEstadoHTTP();
    setInterval(cargarEstadoHTTP, 60000);
    conectarWS();
  } catch(e) {
    console.error('[Dashboard] Error al inicializar:', e);
  }
});
