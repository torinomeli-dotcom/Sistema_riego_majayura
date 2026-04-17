# Sistema de Riego Automatizado IoT
**Majayura, La Guajira, Colombia**  
ESP32-S3 · Node.js · Dashboard Web en tiempo real

---

## Estructura del proyecto

```
SISTEMA_RIEGO/
├── firmware/
│   └── riego_esp32s3/
│       └── riego_esp32s3.ino        ← Código Arduino (abrir en Arduino IDE)
├── server/
│   ├── package.json
│   ├── server.js                    ← Servidor Node.js principal
│   ├── .env                         ← Variables de entorno (editar antes de correr)
│   ├── routes/
│   │   ├── api.js                   ← REST API con JWT
│   │   └── auth.js                  ← Login y verificación de token
│   └── public/
│       ├── index.html               ← Dashboard principal
│       ├── login.html               ← Pantalla de login
│       └── assets/
│           ├── css/dashboard.css
│           └── js/dashboard.js
└── README.md
```

---

## Instalación paso a paso

### 1. Firmware ESP32-S3

**Librerías requeridas (instalar en Arduino IDE → Gestionar librerías):**
- `WebSocketsServer` — de Markus Sattler
- `ArduinoJson` — de Benoit Blanchon (v6 o v7)
- `LiquidCrystal_I2C` — de Frank de Brabander
- `Keypad` — de Mark Stanley, Alexander Brevig

**Pasos:**
1. Abrir `firmware/riego_esp32s3/riego_esp32s3.ino` en Arduino IDE
2. Editar las líneas:
   ```cpp
   #define WIFI_SSID     "TU_RED_WIFI"
   #define WIFI_PASSWORD "TU_CONTRASEÑA"
   ```
3. Seleccionar placa: **ESP32S3 Dev Module** (o ESP32-S3-WROOM-1)
4. Configurar: Flash Size → 16MB, PSRAM → OPI PSRAM
5. Subir el código
6. Abrir Monitor Serie (115200) y anotar la IP del ESP32

### 2. Servidor Node.js

**Requisitos:** Node.js ≥ 18

```bash
cd server
npm install
```

Editar `.env`:
```env
ESP32_WS_URL=ws://192.168.1.XXX:81    ← IP real del ESP32
ADMIN_USER=admin
ADMIN_PASS=riego2024                   ← Cambiar en producción
JWT_SECRET=clave_muy_larga_aqui
```

Iniciar el servidor:
```bash
npm start          # Producción
npm run dev        # Desarrollo con recarga automática
```

Dashboard disponible en: **http://localhost:3000**

---

## Credenciales de acceso

| Campo    | Valor      |
|----------|------------|
| Usuario  | `admin`    |
| Contraseña | `riego2024` |

> Cambiar `ADMIN_PASS` en `.env` antes de exponer en internet.

---

## Despliegue en internet (acceso mundial)

### Opción A — Ngrok (rápido, pruebas)
```bash
npm install -g ngrok
ngrok http 3000
# URL pública: https://abc123.ngrok.io
```

### Opción B — Railway / Render.com (gratis)
1. Hacer push del servidor a GitHub (solo la carpeta `server/`)
2. Conectar el repositorio en railway.app o render.com
3. Agregar las variables de entorno del `.env`
4. El servidor queda disponible públicamente

### Opción C — VPS (producción recomendada)
```bash
git clone tu-repo && cd riego-iot/server
npm install
npm install -g pm2
pm2 start server.js --name riego-iot
pm2 startup && pm2 save
```

---

## Lógica de riego automático

```
RIEGO ON  → 2 de 3 sensores columna DERECHA (SR1, SR2, SR3) reportan SECO
RIEGO OFF → 2 de 3 sensores columna DERECHA reportan HÚMEDO (después de mín. 5 min)
ALERTA    → cualquier sensor columna IZQUIERDA (SL1, SL2, SL3) detecta ENCHARCAMIENTO

Umbrales ADC 12-bit (0–4095):
  SECO         → ADC > 2800
  HÚMEDO       → ADC < 1800
  ENCHARCADO   → ADC < 800

Seguridad:
  Tiempo máximo de riego: 30 minutos (corte automático)
  Tiempo mínimo ON:        5 minutos
```

---

## Teclado 4×4 — funciones

| Tecla | Función |
|-------|---------|
| `A`   | Toggle válvula ON/OFF |
| `B`   | Toggle bombillo 1 |
| `C`   | Toggle bombillo 2 |
| `D`   | Toggle modo AUTO/MANUAL |
| `#`   | Mostrar IP en LCD |
| `*`   | Reset contadores |

---

## API REST (ESP32 — puerto 80)

| Método | Endpoint    | Descripción |
|--------|-------------|-------------|
| GET    | `/ping`     | Verificar conexión |
| GET    | `/estado`   | Estado completo en JSON |
| GET    | `/sensores` | Solo datos de sensores |
| POST   | `/valvula`  | `{"estado": true/false}` |
| POST   | `/bombillo1`| `{"estado": true/false}` |
| POST   | `/bombillo2`| `{"estado": true/false}` |
| POST   | `/modo`     | `{"auto": true/false}` |

## API REST (Servidor Node.js — puerto 3000)

| Método | Endpoint              | Auth | Descripción |
|--------|----------------------|------|-------------|
| POST   | `/api/auth/login`    | No   | Obtener JWT |
| POST   | `/api/auth/verificar`| No   | Verificar token |
| GET    | `/api/estado`        | JWT  | Último estado del ESP32 |
| POST   | `/api/comando`       | JWT  | Enviar comando al ESP32 |
| GET    | `/api/historial`     | JWT  | Últimas 100 lecturas |
| GET    | `/api/estadisticas`  | JWT  | Resumen estadístico |
| GET    | `/api/salud`         | No   | Estado del servidor |

---

## Hardware

| Componente | Cantidad |
|------------|----------|
| ESP32-S3-WROOM-1 N16R8 | 1 |
| DFRobot SEN0308 (sensor humedad capacitivo) | 8 |
| MOSFET IRLZ44N Logic Level | 3 |
| Válvula solenoide 1" 12V/3A | 1 |
| Bombillo LED 12W 12V | 2 |
| LCD 16×2 I2C | 1 |
| Teclado membrana 4×4 | 1 |
| Resistencia 10kΩ (pulldown MOSFET + filtro RC) | 11 |
| Condensador 100nF (filtro RC sensores) | 8 |
| Diodo 1N4007 (flyback válvula) | 1 |
| Resistencia 220Ω (gate MOSFET) | 3 |

---

*Sistema de Riego IoT — Majayura, La Guajira, Colombia*
