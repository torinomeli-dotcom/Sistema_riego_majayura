/*
 * SISTEMA DE RIEGO AUTOMATIZADO v4.0 -- ESP32-S3-WROOM-1 N16R8
 * Majayura, La Guajira | 8x DFRobot SEN0308 | Valvula + 2 LEDs
 *
 * Conectividad: WebSocket persistente (wss) a Railway
 *   - ESP32 envia telemetria cada 30s via WS
 *   - Servidor envia comandos instantaneos via WS (sin polling)
 *
 * NAVEGACION DEL MENU (teclado 4x4):
 *   [#]  Entrar al menu desde pantalla de estado
 *   [A]  Subir cursor
 *   [B]  Bajar cursor
 *   [C]  Seleccionar / ejecutar item
 *   [D]  Salir del menu
 *   [*]  Reset contador valvula
 */

#include <WiFi.h>
#include <WiFiManager.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include <Keypad.h>
#include <Wire.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>

// =====================================================================
// CONFIGURACION
// =====================================================================
#define WIFI_AP_NAME  "Riego_Mi_Majayura"
#define WIFI_AP_PASS  ""
#define ESP32_KEY     "riego_esp32_2024"
#define WS_HOST       "riegomimajayura.onrender.com"
#define WS_PORT       443
#define WS_PATH       "/ws/esp32?key=" ESP32_KEY
#define FW_VERSION    "4.3.0"

// Pines Sensores ADC1
#define PIN_SL1    1
#define PIN_SL2    2
#define PIN_SL3    3
#define PIN_SM1    4
#define PIN_SM2    5
#define PIN_SR1    6
#define PIN_SR2    7
#define PIN_SR3   10

// Sensor de nivel de tanque (flotador magnético 2 cables)
// INPUT_PULLUP: LOW = imán cerca = agua presente; HIGH = vacío
#define PIN_TANQUE 38

// Pines Actuadores MOSFET
#define PIN_VALVULA    16
#define PIN_BOMBILLO1  17
#define PIN_BOMBILLO2  18

// LCD I2C 16x2
#define PIN_SDA   8
#define PIN_SCL   9
#define LCD_ADDR  0x27

// Teclado 4x4
const byte ROWS = 4;
const byte COLS = 4;
char teclas[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {47, 48, 21, 15};
byte colPins[COLS] = {42, 41, 40, 39};

// Tiempos fijos
#define INTERVALO_LECTURA    30000UL

// Valores por defecto de calibración (hortalizas, La Guajira)
// El dashboard los sobreescribe al seleccionar cultivo
#define DEF_UMBRAL_SECO        3200
#define DEF_UMBRAL_HUMEDO      2000
#define DEF_UMBRAL_ENCHARCADO   600
#define DEF_MIN_RIEGO_MS      900000UL
#define DEF_MAX_RIEGO_MS     2700000UL
#define N_MUESTRAS                5
#define INTERVALO_LCD_ESTADO   5000UL
#define INTERVALO_WIFI_CHECK  60000UL
#define TIMEOUT_MENU          15000UL

// Horario bombillos
#define HORA_LUZ_ON   18
#define HORA_LUZ_OFF   6

// =====================================================================
// OBJETOS GLOBALES
// =====================================================================
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
Keypad            teclado = Keypad(makeKeymap(teclas), rowPins, colPins, ROWS, COLS);
Preferences       prefs;
WiFiManager       wm;
WebSocketsClient  wsClient;

struct Sensor {
  const char* nombre;
  int         gpio;
  const char* zona;
  const char* planta;
  float       distancia_m;
  int         adcVal;
  int         pct;
  char        estado[16];
};

Sensor sensores[8] = {
  {"SL1", PIN_SL1, "IZQ", "M2",   2.0,  0, 0, "HUMEDO"},
  {"SL2", PIN_SL2, "IZQ", "M12",  2.0,  0, 0, "HUMEDO"},
  {"SL3", PIN_SL3, "IZQ", "M22",  2.0,  0, 0, "HUMEDO"},
  {"SM1", PIN_SM1, "CTR", "M6",   7.5,  0, 0, "HUMEDO"},
  {"SM2", PIN_SM2, "CTR", "M18",  7.5,  0, 0, "HUMEDO"},
  {"SR1", PIN_SR1, "DER", "M4",  13.0,  0, 0, "SECO"},
  {"SR2", PIN_SR2, "DER", "M12", 13.0,  0, 0, "SECO"},
  {"SR3", PIN_SR3, "DER", "M20", 13.0,  0, 0, "SECO"},
};

bool valvulaOn            = false;
bool bombillo1On          = false;
bool bombillo2On          = false;
bool modoAuto             = true;
bool alertaEncharcamiento = false;
bool tanqueLleno          = true;
bool otaFallo             = false;
int  contadorTanque       = 0;
#define DEBOUNCE_TANQUE   5
bool ntpOk                = false;
bool wifiConectado        = false;
bool wsConectado          = false;
char motivoRiego[64]      = "Sistema iniciado";

// Calibración dinámica por cultivo (guardada en flash)
int           umbralSeco       = DEF_UMBRAL_SECO;
int           umbralHumedo     = DEF_UMBRAL_HUMEDO;
int           umbralEncharcado = DEF_UMBRAL_ENCHARCADO;
unsigned long minTiempoRiego   = DEF_MIN_RIEGO_MS;
unsigned long maxTiempoRiego   = DEF_MAX_RIEGO_MS;
char          cultivoActual[32] = "hortalizas";

unsigned long tUltimaLectura   = 0;
unsigned long tUltimoLCD       = 0;
unsigned long tUltimaWifiCheck = 0;
unsigned long tValvulaOn       = 0;
int           pantallaEstado   = 0;

// Menu
#define MENU_VALVULA    0
#define MENU_BOMBILLO1  1
#define MENU_BOMBILLO2  2
#define MENU_MODO       3
#define MENU_VER_IP     4
#define MENU_SENSORES   5
#define MENU_RESET_CNT  6
#define MENU_WIFI_BORRAR 7
#define MENU_ITEMS      8

bool          enMenu        = false;
int           menuCursor    = 0;
int           menuScroll    = 0;
unsigned long tUltimasTecla = 0;

const char* menuNombres[MENU_ITEMS] = {
  "Valvula  ", "Bombill1 ", "Bombill2 ",
  "ModoAuto ", "Ver IP   ", "Sensores ", "ResetCnt ", "BorrarWiFi"
};

// Prototipos
void        actualizarFirmwareOTA(const char* url);
void        guardarCalibracion();
void        cargarCalibracion();
void        lcdMsg(const char* l1, const char* l2);
void        lcdScrollBoot();
int         leerSensor(int pin);
int         adcAPorcentaje(int adc);
const char* estadoSensor(int adc);
void        leerTodosSensores();
void        evaluarRiego();
void        controlAutoBombillos();
void        setValvula(bool on, bool porAuto, const char* motivo);
void        setBombillo(int num, bool on);
String      construirJSON();
void        transmitirEstado();
void        wsEvent(WStype_t type, uint8_t* payload, size_t length);
void        procesarMensajeWS(char* payload, size_t length);
void        procesarComando(const char* cmd, bool estado);
void        dibujarMenu();
void        ejecutarItemMenu(int item);
void        procesarTecla(char tecla);
void        dibujarEstado();
void        verificarWifi();

// =====================================================================
// SETUP
// =====================================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\nRIEGO IOT v" FW_VERSION " -- Majayura, La Guajira");

  pinMode(PIN_VALVULA,   OUTPUT); digitalWrite(PIN_VALVULA,   LOW);
  pinMode(PIN_BOMBILLO1, OUTPUT); digitalWrite(PIN_BOMBILLO1, LOW);
  pinMode(PIN_BOMBILLO2, OUTPUT); digitalWrite(PIN_BOMBILLO2, LOW);
  pinMode(PIN_TANQUE, INPUT_PULLUP);

  analogReadResolution(12);

  Wire.begin(PIN_SDA, PIN_SCL);
  lcd.init();
  lcd.backlight();
  lcdScrollBoot();

  prefs.begin("riego", true);
  modoAuto = prefs.getBool("modoAuto", true);
  prefs.end();
  cargarCalibracion();

  WiFi.persistent(true);  // garantiza escritura en NVS antes de reiniciar

  wm.setAPCallback([](WiFiManager*) {
    lcdMsg("Config WiFi:    ", "Abre 192.168.4.1");
  });
  wm.setBreakAfterConfig(true);  // guarda credenciales aunque la conexión falle
  wm.setConfigPortalTimeout(180);
  wm.setConnectTimeout(20);

  Serial.println("[BOOT] Iniciando WiFiManager...");
  if (wm.autoConnect(WIFI_AP_NAME, WIFI_AP_PASS)) {
    Serial.println("[BOOT] WiFi OK");
    wifiConectado = true;

    // CRITICO: reducir potencia TX para bajar consumo y calor en regulador 12V
    // Por defecto 20dBm (~500mA pico); con 11dBm baja a ~150mA pico
    WiFi.setTxPower(WIFI_POWER_11dBm);

    Serial.printf("[WiFi] IP: %s  RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    lcdMsg("WiFi conectado! ", WiFi.localIP().toString().c_str());

    // NTP no-bloqueante: lanza la sincronizacion y continua
    Serial.println("[BOOT] NTP lanzado (no bloqueante)...");
    configTime(-5 * 3600, 0, "pool.ntp.org", "time.cloudflare.com");
    struct tm t;
    if (getLocalTime(&t, 1000)) {
      ntpOk = true;
      Serial.printf("[NTP] %02d:%02d\n", t.tm_hour, t.tm_min);
    } else {
      Serial.println("[NTP] Sincronizando en segundo plano...");
    }

    // WebSocket — conexion persistente al servidor Railway
    Serial.println("[BOOT] Iniciando WebSocket...");
    wsClient.beginSSL(WS_HOST, WS_PORT, WS_PATH);
    wsClient.onEvent(wsEvent);
    wsClient.setReconnectInterval(5000);
    // Sin heartbeat — Railway no reenvía ping/pong correctamente
    // La telemetria cada 30s actua como keepalive
    Serial.println("[BOOT] WebSocket iniciado");

    Serial.println("[BOOT] OTA via HTTP activo (usar dashboard)");

  } else {
    Serial.println("[WiFi] Sin red -- modo standalone");
    lcdMsg("Sin WiFi        ", "Riego operativo!");
  }

  Serial.println("[BOOT] Leyendo sensores iniciales...");

  leerTodosSensores();
  if (modoAuto) evaluarRiego();
  dibujarEstado();
  Serial.println("[OK] *** SISTEMA LISTO — entrando al loop ***\n");
}

// =====================================================================
// LOOP
// =====================================================================
void loop() {
  unsigned long ahora = millis();

  if (wifiConectado) {
    wsClient.loop();   // mantener viva la conexion WebSocket
  }

  // Lectura de sensores + envio de telemetria
  if (ahora - tUltimaLectura >= INTERVALO_LECTURA) {
    tUltimaLectura = ahora;
    leerTodosSensores();
    if (modoAuto) {
      evaluarRiego();
      controlAutoBombillos();
    }
    if (valvulaOn && (ahora - tValvulaOn) >= maxTiempoRiego)
      setValvula(false, true, "Corte seg:max");
    transmitirEstado();
    if (!enMenu) dibujarEstado();
  }

  // Rotacion pantalla
  if (!enMenu && ahora - tUltimoLCD >= INTERVALO_LCD_ESTADO) {
    tUltimoLCD = ahora;
    pantallaEstado = (pantallaEstado + 1) % 3;
    dibujarEstado();
  }

  // Timeout menu
  if (enMenu && ahora - tUltimasTecla >= TIMEOUT_MENU) {
    enMenu = false;
    tUltimoLCD = ahora;
    dibujarEstado();
  }

  // Sensor tanque — lectura en cada loop con antirrebote (5 lecturas consecutivas)
  bool pinTanque = (digitalRead(PIN_TANQUE) == LOW);
  if (pinTanque != tanqueLleno) {
    contadorTanque++;
    if (contadorTanque >= DEBOUNCE_TANQUE) {
      contadorTanque = 0;
      tanqueLleno = pinTanque;
      Serial.printf("[TANQUE] %s\n", tanqueLleno ? "CON AGUA" : "VACIO — bloqueando valvula");
      if (!tanqueLleno && valvulaOn) setValvula(false, true, "Tanque vacio!");
      if (!enMenu) dibujarEstado();
      transmitirEstado();
    }
  } else {
    contadorTanque = 0;
  }

  char tecla = teclado.getKey();
  if (tecla) procesarTecla(tecla);

  if (ahora - tUltimaWifiCheck >= INTERVALO_WIFI_CHECK) {
    tUltimaWifiCheck = ahora;
    verificarWifi();
  }

  // Verificar NTP en segundo plano si aun no sincronizo
  if (!ntpOk && wifiConectado) {
    struct tm t;
    if (getLocalTime(&t, 0)) {
      ntpOk = true;
      Serial.printf("[NTP] Sincronizado: %02d:%02d\n", t.tm_hour, t.tm_min);
    }
  }
}

// =====================================================================
// WEBSOCKET — ENVIAR TELEMETRIA
// =====================================================================
void transmitirEstado() {
  if (!wifiConectado || !wsConectado) return;
  String json = construirJSON();
  wsClient.sendTXT(json);
  Serial.printf("[WS] Telemetria enviada (%d bytes)\n", json.length());
}

// =====================================================================
// WEBSOCKET — EVENTOS (conexion, mensajes, desconexion)
// =====================================================================
void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConectado = true;
      Serial.printf("[WS] Conectado al servidor: %s\n", (char*)payload);
      lcdMsg("Servidor online!", WS_HOST);
      // Enviar estado actual inmediatamente al conectar
      transmitirEstado();
      if (!enMenu) dibujarEstado();
      break;

    case WStype_DISCONNECTED:
      wsConectado = false;
      Serial.println("[WS] Desconectado del servidor");
      if (!enMenu) dibujarEstado();
      break;

    case WStype_TEXT:
      procesarMensajeWS((char*)payload, length);
      break;

    case WStype_ERROR:
      wsConectado = false;
      Serial.println("[WS] Error de conexion");
      break;

    default:
      break;
  }
}

// =====================================================================
// WEBSOCKET — PROCESAR COMANDO RECIBIDO
// =====================================================================
void procesarMensajeWS(char* payload, size_t length) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[WS] Error JSON: %s\n", err.c_str());
    return;
  }
  const char* cmd = doc["cmd"] | "";
  if (cmd[0] == '\0') return;

  // Comando especial: OTA por URL
  if (strcmp(cmd, "ota_update") == 0) {
    const char* url = doc["url"] | "";
    if (strlen(url) > 4) {
      actualizarFirmwareOTA(url);
    } else {
      Serial.println("[OTA] URL inválida");
    }
    return;
  }

  // Comando especial: calibrar cultivo
  if (strcmp(cmd, "calibrar") == 0) {
    if (doc.containsKey("umbral_seco"))       umbralSeco       = doc["umbral_seco"].as<int>();
    if (doc.containsKey("umbral_humedo"))     umbralHumedo     = doc["umbral_humedo"].as<int>();
    if (doc.containsKey("umbral_encharcado")) umbralEncharcado = doc["umbral_encharcado"].as<int>();
    if (doc.containsKey("min_riego_ms"))      minTiempoRiego   = doc["min_riego_ms"].as<unsigned long>();
    if (doc.containsKey("max_riego_ms"))      maxTiempoRiego   = doc["max_riego_ms"].as<unsigned long>();
    if (doc.containsKey("cultivo"))           strlcpy(cultivoActual, doc["cultivo"] | "general", sizeof(cultivoActual));
    guardarCalibracion();
    Serial.printf("[CALIBRA] Cultivo:%s Seco:%d Hum:%d Min:%lus Max:%lus\n",
      cultivoActual, umbralSeco, umbralHumedo, minTiempoRiego/1000, maxTiempoRiego/1000);
    char msg[32]; snprintf(msg, sizeof(msg), "Cultivo:%s", cultivoActual);
    lcdMsg("Calibracion OK! ", msg);
    transmitirEstado();
    return;
  }

  bool estado = doc["estado"] | false;
  procesarComando(cmd, estado);
}

void procesarComando(const char* cmd, bool estado) {
  if (!cmd || cmd[0] == '\0') return;
  Serial.printf("[CMD] %s -> %s\n", cmd, estado ? "ON" : "OFF");
  if      (strcmp(cmd, "valvula")   == 0) {
    if (estado && !tanqueLleno) { Serial.println("[CMD] Valvula bloqueada — tanque vacio"); return; }
    setValvula(estado, false, estado ? "Nube:ON" : "Nube:OFF");
  }
  else if (strcmp(cmd, "bombillo1") == 0) setBombillo(1, estado);
  else if (strcmp(cmd, "bombillo2") == 0) setBombillo(2, estado);
  else if (strcmp(cmd, "modo_auto") == 0) {
    modoAuto = estado;
    prefs.begin("riego", false);
    prefs.putBool("modoAuto", modoAuto);
    prefs.end();
    snprintf(motivoRiego, sizeof(motivoRiego), estado ? "AUTO (nube)" : "MANUAL (nube)");
  }
  if (!enMenu) dibujarEstado();
  // Enviar estado actualizado inmediatamente
  transmitirEstado();
}

// =====================================================================
// SENSORES
// =====================================================================
void leerTodosSensores() {
  for (int i = 0; i < 8; i++) {
    sensores[i].adcVal = leerSensor(sensores[i].gpio);
    sensores[i].pct    = adcAPorcentaje(sensores[i].adcVal);
    strncpy(sensores[i].estado, estadoSensor(sensores[i].adcVal), 15);
  }
  // tanque se lee en loop() con antirrebote — no aquí
}

int leerSensor(int pin) {
  long suma = 0;
  for (int i = 0; i < N_MUESTRAS; i++) {
    suma += analogRead(pin);
    delay(10);
  }
  return (int)(suma / N_MUESTRAS);
}

int adcAPorcentaje(int adc) {
  return constrain(map(adc, 4095, 0, 0, 100), 0, 100);
}

const char* estadoSensor(int adc) {
  if (adc < 30)                 return "S/C";
  if (adc < umbralEncharcado)   return "ENCHARCADO";
  if (adc < umbralHumedo)       return "HUMEDO";
  return "SECO";
}

// =====================================================================
// LOGICA DE RIEGO
// =====================================================================
void evaluarRiego() {
  // Protección: sin agua en tanque no activar válvula
  if (!tanqueLleno) {
    if (valvulaOn) setValvula(false, true, "Tanque vacio!");
    Serial.println("[RIEGO] Bloqueado — tanque sin agua");
    return;
  }

  int secosDer = 0, humedosDer = 0, scDer = 0;
  for (int i = 5; i <= 7; i++) {
    if (strcmp(sensores[i].estado, "S/C") == 0) { scDer++; continue; }
    if (sensores[i].adcVal > umbralSeco)    secosDer++;
    if (sensores[i].adcVal < umbralHumedo)  humedosDer++;
  }
  if (scDer == 3) {
    if (valvulaOn) setValvula(false, true, "Sin sensores");
    return;
  }

  // Mayoría simple según sensores activos (1→1, 2→1, 3→2)
  int activosDer = 3 - scDer;
  int mayoria    = (activosDer + 1) / 2;

  alertaEncharcamiento = false;
  for (int i = 0; i <= 2; i++) {
    if (strcmp(sensores[i].estado, "S/C") == 0) continue;
    if (sensores[i].adcVal < umbralEncharcado) {
      alertaEncharcamiento = true;
      break;
    }
  }

  unsigned long ahora = millis();
  if (!valvulaOn && secosDer >= mayoria) {
    snprintf(motivoRiego, sizeof(motivoRiego), "%d/%d DER secos", secosDer, activosDer);
    setValvula(true, true, motivoRiego);
  }
  bool tiempoMinOK = valvulaOn && (ahora - tValvulaOn) >= minTiempoRiego;
  if (valvulaOn && humedosDer >= mayoria && tiempoMinOK) {
    snprintf(motivoRiego, sizeof(motivoRiego), "%d/%d DER humedos", humedosDer, activosDer);
    setValvula(false, true, motivoRiego);
  }
}

void controlAutoBombillos() {
  if (!ntpOk) return;
  struct tm t;
  if (!getLocalTime(&t, 100)) return;
  bool luzNecesaria = (t.tm_hour >= HORA_LUZ_ON || t.tm_hour < HORA_LUZ_OFF);
  if (luzNecesaria != bombillo1On) setBombillo(1, luzNecesaria);
  if (luzNecesaria != bombillo2On) setBombillo(2, luzNecesaria);
}

// =====================================================================
// ACTUADORES
// =====================================================================
void setValvula(bool on, bool porAuto, const char* motivo) {
  valvulaOn = on;
  digitalWrite(PIN_VALVULA, on ? HIGH : LOW);
  if (on) tValvulaOn = millis();
  if (motivo && strlen(motivo) > 0)
    strncpy(motivoRiego, motivo, sizeof(motivoRiego) - 1);
  Serial.printf("[VALVULA] %s | %s\n", on ? "ABIERTA" : "CERRADA", motivo);
}

void setBombillo(int num, bool on) {
  if (num == 1) { bombillo1On = on; digitalWrite(PIN_BOMBILLO1, on ? HIGH : LOW); }
  if (num == 2) { bombillo2On = on; digitalWrite(PIN_BOMBILLO2, on ? HIGH : LOW); }
  Serial.printf("[B%d] %s\n", num, on ? "ON" : "OFF");
}

// =====================================================================
// JSON
// =====================================================================
String construirJSON() {
  StaticJsonDocument<1200> doc;
  doc["tipo"]      = "telemetria";
  doc["timestamp"] = millis() / 1000;
  doc["ip"]        = wifiConectado ? WiFi.localIP().toString() : "standalone";
  doc["rssi"]      = wifiConectado ? WiFi.RSSI() : 0;

  JsonObject s = doc.createNestedObject("sensores");
  for (int i = 0; i < 8; i++) {
    JsonObject sens = s.createNestedObject(sensores[i].nombre);
    sens["adc"]    = sensores[i].adcVal;
    sens["pct"]    = sensores[i].pct;
    sens["estado"] = sensores[i].estado;
  }

  JsonObject act  = doc.createNestedObject("actuadores");
  JsonObject valv = act.createNestedObject("valvula");
  valv["estado"]        = valvulaOn;
  valv["modo"]          = modoAuto ? "AUTO" : "MANUAL";
  valv["tiempo_on_seg"] = valvulaOn ? (millis() - tValvulaOn) / 1000 : 0;
  act.createNestedObject("bombillo1")["estado"] = bombillo1On;
  act.createNestedObject("bombillo2")["estado"] = bombillo2On;

  doc["alerta_encharcamiento"] = alertaEncharcamiento;
  doc["tanque_lleno"]          = tanqueLleno;
  doc["motivo_riego"]          = motivoRiego;
  if (otaFallo) { doc["ota_fallo"] = true; otaFallo = false; }
  doc["modo_auto"]             = modoAuto;

  JsonObject cal = doc.createNestedObject("calibracion");
  cal["cultivo"]           = cultivoActual;
  cal["umbral_seco"]       = umbralSeco;
  cal["umbral_humedo"]     = umbralHumedo;
  cal["umbral_encharcado"] = umbralEncharcado;
  cal["min_riego_s"]       = minTiempoRiego / 1000;
  cal["max_riego_s"]       = maxTiempoRiego / 1000;

  String json;
  serializeJson(doc, json);
  return json;
}

// =====================================================================
// MENU LCD
// =====================================================================
void dibujarMenu() {
  if (menuCursor < menuScroll)       menuScroll = menuCursor;
  if (menuCursor >= menuScroll + 2)  menuScroll = menuCursor - 1;
  lcd.clear();
  for (int fila = 0; fila < 2; fila++) {
    int item = menuScroll + fila;
    if (item >= MENU_ITEMS) break;
    lcd.setCursor(0, fila);
    lcd.print(item == menuCursor ? '>' : ' ');
    lcd.print(menuNombres[item]);
    lcd.setCursor(10, fila);
    switch (item) {
      case MENU_VALVULA:   lcd.print(valvulaOn   ? " [ON ]" : " [OFF]"); break;
      case MENU_BOMBILLO1: lcd.print(bombillo1On ? " [ON ]" : " [OFF]"); break;
      case MENU_BOMBILLO2: lcd.print(bombillo2On ? " [ON ]" : " [OFF]"); break;
      case MENU_MODO:      lcd.print(modoAuto    ? " [AUT]" : " [MAN]"); break;
      default:             lcd.print("    [>]");                          break;
    }
  }
}

void ejecutarItemMenu(int item) {
  switch (item) {
    case MENU_VALVULA:
      if (modoAuto) { lcdMsg("Modo AUTO activo", "Cambia a MANUAL "); delay(1500); dibujarMenu(); return; }
      if (!valvulaOn && !tanqueLleno) { lcdMsg("Sin agua!       ", "Valvula bloq.   "); delay(1500); dibujarMenu(); return; }
      setValvula(!valvulaOn, false, valvulaOn ? "Menu:OFF" : "Menu:ON");
      break;
    case MENU_BOMBILLO1: setBombillo(1, !bombillo1On); break;
    case MENU_BOMBILLO2: setBombillo(2, !bombillo2On); break;
    case MENU_MODO:
      modoAuto = !modoAuto;
      prefs.begin("riego", false); prefs.putBool("modoAuto", modoAuto); prefs.end();
      snprintf(motivoRiego, sizeof(motivoRiego), modoAuto ? "AUTO (menu)" : "MANUAL (menu)");
      break;
    case MENU_VER_IP:
      lcdMsg(wifiConectado ? "IP del sistema: " : "Sin WiFi        ",
             wifiConectado ? WiFi.localIP().toString().c_str() : "AP>" WIFI_AP_NAME);
      delay(2500);
      break;
    case MENU_SENSORES: {
      int pIzq = (sensores[0].pct + sensores[1].pct + sensores[2].pct) / 3;
      int pCtr = (sensores[3].pct + sensores[4].pct) / 2;
      int pDer = (sensores[5].pct + sensores[6].pct + sensores[7].pct) / 3;
      char l1[17], l2[17];
      snprintf(l1, sizeof(l1), "IZQ:%2d%% CTR:%2d%%", pIzq, pCtr);
      snprintf(l2, sizeof(l2), "DER:%2d%% %s      ", pDer, alertaEncharcamiento ? "!ENC" : "OK  ");
      lcdMsg(l1, l2); delay(2500);
      break;
    }
    case MENU_RESET_CNT:
      tValvulaOn = millis();
      lcdMsg("Contador        ", "reseteado OK    ");
      delay(1000);
      break;
    case MENU_WIFI_BORRAR:
      lcdMsg("Borrando WiFi...", "Reiniciando...  ");
      delay(1200);
      wm.resetSettings();
      ESP.restart();
      break;
  }
  dibujarMenu();
  transmitirEstado();
}

void procesarTecla(char tecla) {
  tUltimasTecla = millis();
  Serial.printf("[TECLADO] %c\n", tecla);
  if (!enMenu) {
    if      (tecla == '#') { enMenu = true; menuCursor = 0; menuScroll = 0; dibujarMenu(); }
    else if (tecla == '*') { tValvulaOn = millis(); lcdMsg("Contador        ", "reseteado OK    "); delay(800); dibujarEstado(); }
  } else {
    switch (tecla) {
      case 'A': menuCursor = (menuCursor - 1 + MENU_ITEMS) % MENU_ITEMS; dibujarMenu(); break;
      case 'B': menuCursor = (menuCursor + 1) % MENU_ITEMS; dibujarMenu(); break;
      case 'C': ejecutarItemMenu(menuCursor); break;
      case 'D': enMenu = false; tUltimoLCD = millis(); dibujarEstado(); break;
    }
  }
}

// =====================================================================
// PANTALLA DE ESTADO
// =====================================================================
void dibujarEstado() {
  int secosDer = 0, encharcados = 0, humedosIzq = 0;
  for (int i = 5; i <= 7; i++) if (strcmp(sensores[i].estado, "SECO")      == 0) secosDer++;
  for (int i = 0; i <= 2; i++) {
    if (strcmp(sensores[i].estado, "ENCHARCADO") == 0) encharcados++;
    if (strcmp(sensores[i].estado, "HUMEDO")     == 0) humedosIzq++;
  }
  if (!tanqueLleno)                                 { lcdMsg("ALERTA:SIN AGUA!", "Llenar tanque!  "); return; }
  if (alertaEncharcamiento && pantallaEstado == 2)  { lcdMsg("ALERTA:ENCHAR!  ", "Revisar col IZQ "); return; }
  lcd.clear();
  switch (pantallaEstado) {
    case 0:
      lcd.setCursor(0, 0);
      lcd.print(valvulaOn ? "RIEGO:ON  " : "RIEGO:OFF ");
      lcd.print(modoAuto  ? "AUTO" : "MANU");
      // * = WiFi+WS online | w = WiFi sin WS | espacio = sin WiFi
      lcd.print(wifiConectado ? (wsConectado ? "*" : "w") : " ");
      lcd.setCursor(0, 1);
      lcd.print("IZQ:");
      lcd.print(encharcados > 0 ? "!" : (humedosIzq >= 2 ? "H" : "S"));
      lcd.print(" DER:");
      lcd.print(secosDer >= 2 ? "SECO" : "HUM ");
      lcd.print(tanqueLleno ? " " : "!");
      break;
    case 1:
      lcd.setCursor(0, 0);
      lcd.print("B1:"); lcd.print(bombillo1On ? "ON " : "OFF");
      lcd.print("  B2:"); lcd.print(bombillo2On ? "ON " : "OFF");
      lcd.setCursor(0, 1);
      lcd.print(wifiConectado ? WiFi.localIP().toString().substring(0, 16) : "OFFLINE/STANDAL.");
      break;
    case 2: {
      int pIzq = (sensores[0].pct + sensores[1].pct + sensores[2].pct) / 3;
      int pDer = (sensores[5].pct + sensores[6].pct + sensores[7].pct) / 3;
      char l1[17]; snprintf(l1, sizeof(l1), "IZQ:%2d%% DER:%2d%%", pIzq, pDer);
      lcd.setCursor(0, 0); lcd.print(l1);
      unsigned long seg = millis() / 1000;
      char l2[17]; snprintf(l2, sizeof(l2), "UP:%02luh%02lum%02lus   ", seg/3600, (seg%3600)/60, seg%60);
      lcd.setCursor(0, 1); lcd.print(l2);
      break;
    }
  }
}

// =====================================================================
// WIFI
// =====================================================================
void verificarWifi() {
  bool ok = (WiFi.status() == WL_CONNECTED);
  if (ok && !wifiConectado) {
    wifiConectado = true;
    Serial.printf("[WiFi] Reconectado -- %s\n", WiFi.localIP().toString().c_str());
  } else if (!ok && wifiConectado) {
    wifiConectado = false;
    Serial.println("[WiFi] Perdido -- standalone activo");
    WiFi.reconnect();
  } else if (!ok) {
    WiFi.reconnect();
  }
}

// =====================================================================
// OTA POR URL — actualización remota desde internet
// =====================================================================
void actualizarFirmwareOTA(const char* url) {
  Serial.printf("[OTA] URL: %s\n", url);
  lcdMsg("OTA: iniciando  ", "No desconectar!");

  // Pausar WS para liberar recursos durante descarga
  wsClient.disconnect();

  WiFiClientSecure client;
  client.setInsecure();  // Acepta cualquier certificado HTTPS

  httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  httpUpdate.onStart([]()  { Serial.println("[OTA] Descargando..."); });
  httpUpdate.onEnd([]()    { Serial.println("[OTA] Descarga completa"); });
  httpUpdate.onError([](int e) {
    Serial.printf("[OTA] Error %d: %s\n", e, httpUpdate.getLastErrorString().c_str());
  });
  httpUpdate.onProgress([](int cur, int total) {
    Serial.printf("[OTA] %d / %d bytes\n", cur, total);
    char buf[17];
    snprintf(buf, sizeof(buf), "%d%%  %dKB", cur*100/total, total/1024);
    lcdMsg("OTA: actualizando", buf);
  });

  t_httpUpdate_return ret = httpUpdate.update(client, url);

  switch (ret) {
    case HTTP_UPDATE_OK:
      // El ESP32 reinicia automáticamente — no llega aquí
      break;
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] FALLO: %s\n", httpUpdate.getLastErrorString().c_str());
      lcdMsg("OTA: FALLO!     ", "Ver monitor...");
      otaFallo = true;
      wsClient.beginSSL(WS_HOST, WS_PORT, WS_PATH);
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] Sin cambios");
      lcdMsg("OTA: sin cambios", "Firmware actual ");
      wsClient.beginSSL(WS_HOST, WS_PORT, WS_PATH);
      break;
  }
}

// =====================================================================
// CALIBRACIÓN — guardar y cargar desde flash
// =====================================================================
void guardarCalibracion() {
  prefs.begin("calibra", false);
  prefs.putInt("umbSeco",  umbralSeco);
  prefs.putInt("umbHum",   umbralHumedo);
  prefs.putInt("umbEnch",  umbralEncharcado);
  prefs.putULong("minR",   minTiempoRiego);
  prefs.putULong("maxR",   maxTiempoRiego);
  prefs.putString("cultivo", cultivoActual);
  prefs.end();
}

void cargarCalibracion() {
  prefs.begin("calibra", true);
  umbralSeco       = prefs.getInt("umbSeco",    DEF_UMBRAL_SECO);
  umbralHumedo     = prefs.getInt("umbHum",     DEF_UMBRAL_HUMEDO);
  umbralEncharcado = prefs.getInt("umbEnch",    DEF_UMBRAL_ENCHARCADO);
  minTiempoRiego   = prefs.getULong("minR",     DEF_MIN_RIEGO_MS);
  maxTiempoRiego   = prefs.getULong("maxR",     DEF_MAX_RIEGO_MS);
  prefs.getString("cultivo", cultivoActual, sizeof(cultivoActual));
  prefs.end();
  if (strlen(cultivoActual) == 0) strlcpy(cultivoActual, "hortalizas", sizeof(cultivoActual));
  Serial.printf("[CALIBRA] Cultivo:%s Seco:%d Hum:%d Min:%lus\n",
    cultivoActual, umbralSeco, umbralHumedo, minTiempoRiego/1000);
}

// =====================================================================
// LCD
// =====================================================================
void lcdMsg(const char* l1, const char* l2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(l1);
  lcd.setCursor(0, 1); lcd.print(l2);
}

void lcdScrollBoot() {
  // Desliza "RIEGO MI MAJAYURA" y "by UniGuajira" de derecha a izquierda
  const char* t1 = "RIEGO MI MAJAYURA";
  const char* t2 = "  by UniGuajira  ";
  int len1 = strlen(t1);
  int len2 = strlen(t2);

  lcd.clear();
  for (int pos = 15; pos >= 0; pos--) {
    char row1[17], row2[17];
    memset(row1, ' ', 16); row1[16] = '\0';
    memset(row2, ' ', 16); row2[16] = '\0';
    for (int c = 0; c < len1 && pos + c < 16; c++) row1[pos + c] = t1[c];
    for (int c = 0; c < len2 && pos + c < 16; c++) row2[pos + c] = t2[c];
    lcd.setCursor(0, 0); lcd.print(row1);
    lcd.setCursor(0, 1); lcd.print(row2);
    delay(90);
  }
  delay(1200);
}
