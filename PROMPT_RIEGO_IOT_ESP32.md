# 🌱 PROMPT — Sistema de Riego Automatizado IoT
**ESP32-S3 + Node.js + HTML/Bootstrap + Control Mundial**
**Proyecto: Majayura, La Guajira — Melón / Sandía / Pepino**

---

## 📋 DESCRIPCIÓN GENERAL DEL SISTEMA

Construir un sistema IoT completo de 3 capas:

1. **Firmware ESP32-S3** (Arduino IDE) — lee 8 sensores de humedad, controla válvula solenoide y 2 bombillos LED 12V, expone WebSocket + REST API por WiFi
2. **Servidor Node.js** — puente entre el ESP32 (red local) y el mundo exterior vía WebSocket/MQTT, sirve la interfaz web y gestiona autenticación
3. **Dashboard HTML + Bootstrap 5** — panel de control accesible desde cualquier parte del mundo, en tiempo real, con diseño oscuro profesional

---

## 🔌 HARDWARE — PINES ESP32-S3-WROOM-1 N16R8

### Sensores de Humedad — 8× DFRobot SEN0308
Todos en ADC1 (compatibles con WiFi activo). Filtro RC: **10kΩ serie + 100nF a GND** en cada pin.

| Sensor | GPIO | Posición en campo | Zona |
|--------|------|-------------------|------|
| SL1 | GPIO 1 | M2 · 2 m del tubo | Izquierda proximal |
| SL2 | GPIO 2 | M12 · 2 m del tubo | Izquierda centro |
| SL3 | GPIO 3 | M22 · 2 m del tubo | Izquierda distal |
| SM1 | GPIO 4 | M6 · 7.5 m del tubo | Centro superior |
| SM2 | GPIO 5 | M18 · 7.5 m del tubo | Centro inferior |
| SR1 | GPIO 6 | M4 · 13 m del tubo | Derecha proximal |
| SR2 | GPIO 7 | M12 · 13 m del tubo | Derecha centro |
| SR3 | GPIO 10 | M20 · 13 m del tubo | Derecha distal |

### Salidas de Potencia 12V — MOSFET IRLZ44N Logic Level
| Dispositivo | GPIO | Circuito |
|-------------|------|----------|
| Válvula Solenoide 1" / 3A | GPIO 16 | 220Ω gate + 10kΩ pulldown + 1N4007 flyback |
| Bombillo LED 12W #1 | GPIO 17 | 220Ω gate + 10kΩ pulldown |
| Bombillo LED 12W #2 | GPIO 18 | 220Ω gate + 10kΩ pulldown |

### Periféricos adicionales
| Periférico | GPIO |
|------------|------|
| LCD 16×2 I2C (SDA) | GPIO 8 |
| LCD 16×2 I2C (SCL) | GPIO 9 |
| Teclado 4×4 — Fila 1 | GPIO 42 |
| Teclado 4×4 — Fila 2 | GPIO 41 |
| Teclado 4×4 — Fila 3 | GPIO 40 |
| Teclado 4×4 — Fila 4 | GPIO 39 |
| Teclado 4×4 — Col 1 | GPIO 47 |
| Teclado 4×4 — Col 2 | GPIO 48 |
| Teclado 4×4 — Col 3 | GPIO 21 |
| Teclado 4×4 — Col 4 | GPIO 15 |

---

## 🧠 LÓGICA DE AUTOMATIZACIÓN DEL RIEGO

```
RIEGO ON  → 2 de 3 sensores Columna Derecha (SR1, SR2, SR3) reportan SECO
RIEGO OFF → 2 de 3 sensores Columna Derecha reportan HÚMEDO
ALERTA    → cualquier sensor Columna Izquierda (SL1, SL2, SL3) detecta ENCHARCAMIENTO

Umbrales ADC 12-bit (0–4095):
  SECO          → lectura > 2800
  HÚMEDO        → lectura < 1800
  ENCHARCADO    → lectura < 800

Tiempos:
  Intervalo lectura : 30 segundos
  Tiempo mínimo ON  : 5 minutos
  Tiempo máximo ON  : 30 minutos
  Promedio muestras : 5 lecturas por ciclo
```

---

## 📁 ESTRUCTURA DE ARCHIVOS A GENERAR

```
/riego-iot/
├── firmware/
│   └── riego_esp32s3/
│       └── riego_esp32s3.ino        ← Código Arduino completo
│
├── server/
│   ├── package.json
│   ├── server.js                    ← Servidor Node.js principal
│   ├── routes/
│   │   ├── api.js                   ← REST API endpoints
│   │   └── auth.js                  ← Autenticación JWT
│   └── public/
│       ├── index.html               ← Dashboard principal
│       ├── login.html               ← Pantalla de login
│       └── assets/
│           ├── css/
│           │   └── dashboard.css    ← Estilos personalizados
│           └── js/
│               └── dashboard.js     ← Lógica frontend WebSocket
│
└── README.md                        ← Instrucciones de instalación
```

---

## 🔧 PARTE 1 — FIRMWARE ESP32-S3 (Arduino IDE)

### Librerías requeridas (instalar en Arduino IDE)
```
- WiFi.h              (incluida en ESP32 Arduino Core)
- WebSocketsServer    (Markus Sattler — biblioteca de Arduino)
- ArduinoJson         (Benoit Blanchon — v6 o v7)
- LiquidCrystal_I2C   (Frank de Brabander)
- Keypad              (Mark Stanley, Alexander Brevig)
- ESPmDNS             (incluida en ESP32 Core)
```

### Archivo: `riego_esp32s3.ino`

El firmware debe implementar exactamente esto:

```cpp
/*
 * SISTEMA DE RIEGO AUTOMATIZADO — ESP32-S3-WROOM-1 N16R8
 * Majayura, La Guajira | 8x SEN0308 | Válvula + 2 Bombillos 12V
 * Conexión: WiFi → WebSocket JSON en puerto 81
 *           REST API en puerto 80
 */

// ── Configuración WiFi ─────────────────────────────────────────
#define WIFI_SSID     "TU_RED_WIFI"
#define WIFI_PASSWORD "TU_CONTRASEÑA"
#define WS_PORT       81
#define HTTP_PORT     80

// ── Pines Sensores ADC1 ────────────────────────────────────────
#define PIN_SL1   1    // Izquierda M2
#define PIN_SL2   2    // Izquierda M12
#define PIN_SL3   3    // Izquierda M22
#define PIN_SM1   4    // Centro M6
#define PIN_SM2   5    // Centro M18
#define PIN_SR1   6    // Derecha M4
#define PIN_SR2   7    // Derecha M12
#define PIN_SR3   10   // Derecha M20

// ── Pines Actuadores MOSFET IRLZ44N ───────────────────────────
#define PIN_VALVULA   16
#define PIN_BOMBILLO1 17
#define PIN_BOMBILLO2 18

// ── Pines I2C LCD 16x2 ────────────────────────────────────────
#define PIN_SDA 8
#define PIN_SCL 9

// ── Pines Teclado 4x4 ─────────────────────────────────────────
byte rowPins[4] = {42, 41, 40, 39};   // Filas OUTPUT
byte colPins[4] = {47, 48, 21, 15};   // Columnas INPUT_PULLUP

// ── Umbrales ADC 12-bit ────────────────────────────────────────
#define UMBRAL_SECO          2800
#define UMBRAL_HUMEDO        1800
#define UMBRAL_ENCHARCADO     800

// ── Tiempos ───────────────────────────────────────────────────
#define INTERVALO_LECTURA    30000UL    // 30 seg
#define MIN_TIEMPO_RIEGO    300000UL    // 5 min
#define MAX_TIEMPO_RIEGO   1800000UL    // 30 min
#define N_MUESTRAS               5
```

#### Funciones que debe tener el firmware:

**`setup()`**
- Inicializar Serial a 115200
- Inicializar pines actuadores como OUTPUT y en LOW
- Inicializar I2C con Wire.begin(PIN_SDA, PIN_SCL)
- Inicializar LCD 16×2 con mensaje de bienvenida "RIEGO IOT v2"
- Conectar WiFi con reconnect automático
- Iniciar servidor WebSocket en puerto 81
- Iniciar servidor HTTP en puerto 80
- Mostrar IP en LCD y Serial

**`loop()`**
- Manejar clientes WebSocket: `webSocket.loop()`
- Manejar servidor HTTP: `server.handleClient()`
- Cada `INTERVALO_LECTURA`: leer todos los sensores, aplicar lógica de riego automático, transmitir JSON por WebSocket a todos los clientes conectados
- Verificar tiempo máximo de riego: si supera MAX_TIEMPO_RIEGO, cortar válvula automáticamente

**`leerSensor(int pin)`** → promedio de N_MUESTRAS lecturas analogRead con delay(10) entre cada una

**`evaluarRiego()`** → aplica la lógica de 2/3 sensores derecha, encharcamiento izquierda

**`transmitirEstado()`** → construye y envía JSON con toda la telemetría

**Formato JSON que el ESP32 transmite por WebSocket cada 30 seg:**
```json
{
  "tipo": "telemetria",
  "timestamp": 1234567890,
  "uptime_seg": 3600,
  "sensores": {
    "SL1": { "gpio": 1,  "adc": 2100, "pct": 65, "estado": "HUMEDO",  "zona": "IZQ", "distancia_m": 2.0 },
    "SL2": { "gpio": 2,  "adc": 2050, "pct": 67, "estado": "HUMEDO",  "zona": "IZQ", "distancia_m": 2.0 },
    "SL3": { "gpio": 3,  "adc": 800,  "pct": 98, "estado": "ENCHARCADO", "zona": "IZQ", "distancia_m": 2.0 },
    "SM1": { "gpio": 4,  "adc": 2400, "pct": 55, "estado": "HUMEDO",  "zona": "CTR", "distancia_m": 7.5 },
    "SM2": { "gpio": 5,  "adc": 2600, "pct": 45, "estado": "HUMEDO",  "zona": "CTR", "distancia_m": 7.5 },
    "SR1": { "gpio": 6,  "adc": 3100, "pct": 20, "estado": "SECO",    "zona": "DER", "distancia_m": 13.0 },
    "SR2": { "gpio": 7,  "adc": 3200, "pct": 15, "estado": "SECO",    "zona": "DER", "distancia_m": 13.0 },
    "SR3": { "gpio": 10, "adc": 2900, "pct": 30, "estado": "SECO",    "zona": "DER", "distancia_m": 13.0 }
  },
  "actuadores": {
    "valvula":    { "gpio": 16, "estado": true,  "modo": "AUTO", "tiempo_on_seg": 180 },
    "bombillo1":  { "gpio": 17, "estado": false, "modo": "MANUAL" },
    "bombillo2":  { "gpio": 18, "estado": false, "modo": "MANUAL" }
  },
  "alerta_encharcamiento": true,
  "motivo_riego": "2/3 sensores DER secos"
}
```

**Comandos JSON que el ESP32 recibe por WebSocket:**
```json
{ "cmd": "valvula",   "estado": true  }
{ "cmd": "bombillo1", "estado": true  }
{ "cmd": "bombillo2", "estado": false }
{ "cmd": "modo_auto", "estado": true  }
{ "cmd": "ping" }
```

**Endpoints REST HTTP (puerto 80):**
```
GET  /estado        → devuelve JSON completo del estado actual
POST /valvula       → body: {"estado": true/false}
POST /bombillo1     → body: {"estado": true/false}
POST /bombillo2     → body: {"estado": true/false}
POST /modo          → body: {"auto": true/false}
GET  /sensores      → solo datos de sensores
GET  /ping          → {"ok": true, "ip": "192.168.x.x"}
```

**Teclado 4×4 — mapa de teclas:**
```
1 2 3 A  →  [1][2][3][A]
4 5 6 B  →  [4][5][6][B]
7 8 9 C  →  [7][8][9][C]
* 0 # D  →  [*][0][#][D]

A = Toggle Válvula
B = Toggle Bombillo 1
C = Toggle Bombillo 2
D = Toggle Modo Auto/Manual
# = Ver IP en LCD
* = Reset contadores
```

**LCD 16×2 — pantallas rotativas cada 5 segundos:**
```
Pantalla 1:  "RIEGO: ON  AUTO"  /  "SL:H SM:H SR:S  "
Pantalla 2:  "B1:OFF  B2:OFF  "  /  "IP:192.168.1.xx "
Pantalla 3:  "ALERTA:ENCHAR!  "  (solo si hay alerta)
```

---

## 🖥️ PARTE 2 — SERVIDOR NODE.JS

### Archivo: `package.json`
```json
{
  "name": "riego-iot-server",
  "version": "2.0.0",
  "description": "Servidor IoT Sistema de Riego Majayura",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "ws": "^8.16.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "morgan": "^1.10.0"
  }
}
```

### Archivo: `server.js`

El servidor Node.js debe:

1. **Puente WebSocket bidireccional**
   - Mantener conexión WebSocket persistente con el ESP32 (reconectar automáticamente cada 5 seg si se cae)
   - Mantener conexiones WebSocket con N clientes web (dashboard)
   - Al recibir telemetría del ESP32, guardar en memoria (`ultimoEstado`) y reenviar a TODOS los clientes web conectados
   - Al recibir comando de un cliente web (autenticado), reenviar al ESP32

2. **REST API con autenticación JWT**
   - `POST /api/login` → valida usuario/contraseña, devuelve JWT token (expira en 24h)
   - `GET /api/estado` → requiere JWT, devuelve `ultimoEstado`
   - `POST /api/comando` → requiere JWT, envía comando al ESP32
   - `GET /api/historial` → requiere JWT, devuelve últimas 100 lecturas en memoria
   - `GET /api/salud` → público, devuelve estado del servidor y conexión ESP32

3. **Historial en memoria circular**
   - Guardar últimas 100 lecturas de telemetría con timestamp
   - Calcular promedios por zona para gráficas

4. **Archivos estáticos**
   - Servir `public/` como carpeta estática
   - Ruta `/*` devuelve `index.html` (SPA)

5. **Variables de entorno (.env)**
```env
PORT=3000
ESP32_WS_URL=ws://192.168.1.100:81
JWT_SECRET=clave_secreta_muy_larga_aqui
ADMIN_USER=admin
ADMIN_PASS=riego2024
```

---

## 🌐 PARTE 3 — DASHBOARD HTML + BOOTSTRAP 5

### Archivo: `login.html`

Pantalla de login minimalista con:
- Fondo oscuro con imagen de campo agrícola o gradiente verde oscuro
- Logo/icono de planta 🌱
- Card centrada con campos usuario y contraseña
- Botón "Ingresar al Sistema"
- Al hacer login exitoso: guardar JWT en localStorage y redirigir a `index.html`
- Mostrar error si credenciales incorrectas

### Archivo: `index.html` — Dashboard Principal

**Estructura visual:**

```
┌─────────────────────────────────────────────────────┐
│  🌱 RIEGO IOT — MAJAYURA          [●ONLINE] [Salir] │
│  ESP32-S3 · La Guajira · Actualizado: hace 5 seg    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────┐  ┌──────────┐  ┌──────────┐   │
│  │  💧 VÁLVULA     │  │ 💡 LUZ 1 │  │ 💡 LUZ 2 │   │
│  │  ● ABIERTA      │  │ ○ APAGADA│  │ ○ Apagada│   │
│  │  Modo: AUTO     │  │  MANUAL  │  │  MANUAL  │   │
│  │  [Abrir][Cerrar]│  │[ON] [OFF]│  │[ON] [OFF]│   │
│  │  Tiempo: 03:42  │  │          │  │          │   │
│  └─────────────────┘  └──────────┘  └──────────┘   │
│                                                     │
│  ┌─────────────────── 8 SENSORES ─────────────────┐ │
│  │                                                │ │
│  │  COLUMNA IZQUIERDA (2m)                        │ │
│  │  [SL1 65% HÚMEDO ●] [SL2 67% HÚMEDO ●]        │ │
│  │  [SL3 98% ⚠ ENCHARCADO ●]                     │ │
│  │                                                │ │
│  │  COLUMNA CENTRAL (7.5m)                        │ │
│  │  [SM1 55% HÚMEDO ●] [SM2 45% HÚMEDO ●]        │ │
│  │                                                │ │
│  │  COLUMNA DERECHA (13m) ← CONTROL RIEGO        │ │
│  │  [SR1 20% SECO 🔴] [SR2 15% SECO 🔴]          │ │
│  │  [SR3 30% SECO 🔴]                             │ │
│  │                                                │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌──────────────── HISTORIAL ─────────────────────┐ │
│  │  Gráfica de línea — últimas 2 horas por zona   │ │
│  │  [IZQ ─── CTR ─── DER ───]                    │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Especificaciones visuales:**

- **Tema:** oscuro — `#0d1117` fondo, `#161b22` cards, `#21262d` bordes
- **Tipografía:** `JetBrains Mono` para valores, `Inter` para textos
- **Colores de estado:**
  - SECO → rojo `#f85149` con animación pulso lento
  - HÚMEDO → verde `#3fb950`
  - ENCHARCADO → naranja/amarillo `#d29922` con icono ⚠ y alerta visual
  - Válvula abierta → azul `#58a6ff`
  - Bombillo encendido → amarillo `#f0c040` con efecto glow
- **Indicador de conexión:** punto verde animado si WebSocket activo, rojo si desconectado
- **Cada tarjeta de sensor** muestra:
  - Nombre (SL1, SL2, etc.), posición (M2 · 2m), zona (IZQ/CTR/DER)
  - Barra de progreso de humedad 0–100%
  - Valor ADC crudo entre paréntesis
  - Badge de estado: SECO / HÚMEDO / ENCHARCADO
  - Tiempo desde última lectura
- **Tarjeta válvula** muestra:
  - Estado ON/OFF con color e icono 💧
  - Modo AUTO o MANUAL con badge
  - Contador de tiempo encendida (mm:ss)
  - Motivo del último cambio de estado
  - Botones Abrir / Cerrar (deshabilitados en modo AUTO)
  - Toggle "Modo AUTO / MANUAL"
- **Tarjetas bombillos** muestran:
  - Estado con efecto visual (glow amarillo si ON)
  - Toggle ON/OFF grande y visible
  - Accesible siempre desde MANUAL
- **Gráfica historial** (Chart.js):
  - Línea de tiempo últimas 2 horas
  - 3 líneas: promedio IZQ, promedio CTR, promedio DER
  - Líneas de referencia horizontales: SECO (rojo punteado) y HÚMEDO (verde punteado)
  - Colores: IZQ=#58a6ff, CTR=#f0c040, DER=#3fb950

**Comportamiento en tiempo real:**
- Conectar WebSocket a `ws://TU_SERVIDOR:3000/ws` con token JWT en query param
- Al recibir mensaje JSON → actualizar DOM sin recargar página
- Si WebSocket se desconecta → intentar reconectar cada 3 seg, mostrar banner "Reconectando..."
- Animación suave en valores que cambian (transición CSS 0.3s)
- Notificación toast en pantalla cuando:
  - Se detecta encharcamiento → toast rojo ⚠
  - Riego se activa automáticamente → toast azul 💧
  - Bombillo cambia de estado → toast amarillo 💡
  - Conexión perdida / recuperada → toast gris

**Responsive:**
- Desktop: layout de 3 columnas para sensores
- Tablet: 2 columnas
- Móvil: 1 columna, tarjetas de actuadores en grid 2×2

---

## 📡 FLUJO DE DATOS COMPLETO

```
[Campo]                [Router WiFi]          [Internet]
  │                        │                      │
SEN0308×8 ─→ ESP32-S3 ──→ WiFi ──→ Node.js ──→ Ngrok/VPS
  │           │WebSocket81  │       │WS:3000       │
Válvula ←──  │REST:80       │       │REST:3000      │HTTPS
Bombillo×2   │              │       │               │
  │          │              │       └──→ Dashboard ←┘
Teclado ──→  │              │           HTML+Bootstrap
LCD ←──────  │              │           (cualquier celular
              │              │            o PC del mundo)
              └──────────────┘
```

---

## 🔒 SEGURIDAD

- Login con JWT — token expira en 24 horas
- Todas las rutas API y WebSocket requieren token válido
- Rate limiting: máximo 10 comandos por minuto por IP
- CORS configurado solo para dominios permitidos
- Contraseñas hasheadas con bcrypt
- En producción: usar HTTPS con certificado SSL (Let's Encrypt)
- El ESP32 solo acepta conexiones desde la IP del servidor Node.js (filtro IP opcional)

---

## 🚀 DESPLIEGUE — ACCESO MUNDIAL

### Opción A — Ngrok (rápido, para pruebas)
```bash
npm install -g ngrok
ngrok http 3000
# Obtienes URL pública: https://abc123.ngrok.io
```

### Opción B — VPS (producción recomendada)
```bash
# En servidor Ubuntu (DigitalOcean, AWS, etc.)
git clone tu-repo
cd riego-iot/server
npm install
npm start

# Con PM2 para que no se caiga:
npm install -g pm2
pm2 start server.js --name riego-iot
pm2 startup
pm2 save
```

### Opción C — Render.com o Railway (gratis)
- Hacer push del código a GitHub
- Conectar repositorio en render.com
- El servidor queda en internet automáticamente

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

### ESP32
- [ ] Firmware compila sin errores en Arduino IDE con ESP32-S3 board
- [ ] WiFi conecta y muestra IP en LCD y Serial Monitor
- [ ] Los 8 sensores leen valores ADC entre 0–4095
- [ ] Válvula y bombillos responden a comandos WebSocket
- [ ] JSON de telemetría se transmite cada 30 segundos
- [ ] Teclado 4×4 funciona correctamente
- [ ] Lógica 2/3 sensores derecha activa/corta el riego

### Node.js
- [ ] `npm install` sin errores
- [ ] Servidor arranca en puerto 3000
- [ ] Se conecta al ESP32 por WebSocket
- [ ] Login devuelve JWT válido
- [ ] Dashboard carga en `http://localhost:3000`
- [ ] Datos en tiempo real aparecen en dashboard

### Dashboard
- [ ] Login funciona y guarda token
- [ ] Sensores muestran valores en tiempo real
- [ ] Botones de bombillos funcionan desde el celular
- [ ] Válvula responde a comandos manuales
- [ ] Gráfica de historial se actualiza
- [ ] Funciona correctamente en móvil

---

## 📝 NOTAS IMPORTANTES PARA LA IMPLEMENTACIÓN

1. **ADC del ESP32-S3** tiene no-linealidad cerca de 0V y 3.3V — compensar con la función `analogReadMilliVolts()` si se necesita más precisión, o calibrar los umbrales empíricamente en campo

2. **GPIO 3 (SL3)** es pin JTAG — funciona bien en operación normal, pero no conectar a GND durante el boot

3. **GPIO 39 (Fila 4 teclado)** arranca en HIGH — no afecta el funcionamiento del teclado en uso normal

4. **GPIO 48 (Columna 2 teclado)** está conectado al LED RGB de la placa — puede causar un parpadeo imperceptible al escanear, no es problema funcional

5. **Los MOSFETs IRLZ44N** requieren que la resistencia de 10kΩ pulldown esté siempre presente para evitar estado indeterminado al arrancar el ESP32

6. **Filtro RC en sensores:** 10kΩ + 100nF ya instalados — frecuencia de corte 159Hz, válido para todos los cables de 7m a 18m de longitud

7. **Prioridad de comandos:** MANUAL siempre tiene prioridad sobre AUTO para la válvula — el operador puede anular el sistema desde el dashboard o el teclado

8. **Reconexión WiFi:** implementar en `loop()` verificando `WiFi.status() != WL_CONNECTED` y llamando `WiFi.reconnect()` con backoff exponencial

---

*Generado para: Sistema de Riego IoT — Majayura, La Guajira, Colombia*
*Hardware: ESP32-S3-WROOM-1 N16R8 · 8× DFRobot SEN0308 · 3× IRLZ44N · LCD 16×2 I2C · Teclado 4×4*
