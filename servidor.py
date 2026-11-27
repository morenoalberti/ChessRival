"""Servidor local de ChessRival.

Sirve la carpeta de la web sin caché (para ver siempre la última versión) y, además, da acceso de LECTURA a la MegaDatabase de ChessBase
que el usuario elija, sin los avisos de permiso del navegador: el servidor abre el cuadro «Elegir archivo .cbh» de Windows (como la
versión de escritorio), recuerda la ruta y entrega a la página, por trozos, los cuatro archivos de la base (.cbh .cbg .cbp .cbt).

También permite elegir la carpeta de copias con su ruta completa y guardar allí copias JSON sin sobrescribir las existentes.
Seguridad: las funciones del equipo (rutas /local/…) solo atienden al propio equipo (127.0.0.1 / ::1), cuando la página se abre con una
dirección local (localhost, 127.0.0.1, [::1]) y desde páginas de ese mismo origen. La MegaDatabase es de solo lectura; las escrituras se
limitan a archivos de copia en la carpeta elegida expresamente.

El mismo servidor sirve también la web publicada (por ejemplo en Render, que indica el puerto en la variable PORT): los archivos de la web
se entregan a cualquiera, pero las rutas /local/… responden 404 si la petición no es local.
"""
import http.server
import json
import os
import socket
import sqlite3
import subprocess
import queue
import re
import atexit
import time
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.parse import urlencode
import copias_local
import fotos_fide
import mega_sqlite
from urllib.parse import parse_qs, urlsplit

PUERTO = int(os.environ.get("PORT") or 8765)
CARPETA = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(CARPETA, ".mega.json")
EXTENSIONES = ("cbh", "cbg", "cbp", "cbt")
EXTENSIONES_2CBH = ("2cbh", "2cbg", "2lid")
PRIVADA = os.path.join(CARPETA, "BaseDatos")      # las bases propias no se sirven como archivos de la web
EXTENSIONES_LIBRO = ("ctg", "ctb", "cto")
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}
ORIGENES = {f"http://localhost:{PUERTO}", f"http://127.0.0.1:{PUERTO}", f"http://[::1]:{PUERTO}"}
HOSTS_LOCALES = {"localhost", "127.0.0.1", "[::1]"}
TROZO = 1 << 20
_cuadro = threading.Lock()                    # un solo cuadro «Elegir archivo» a la vez
_bridge_lock = threading.RLock()
_bridge = {"proceso": None, "token": None, "ruta": None}


# ---------- La MegaDatabase elegida ----------

def leer_config():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def guardar_config(datos):
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False)


def archivos_de(ruta_cbh):
    """{extensión: ruta real} de los archivos requeridos por la base, y los que faltan."""
    carpeta, nombre = os.path.split(ruta_cbh)
    extension = os.path.splitext(nombre)[1].lower().lstrip(".")
    if extension == "sqlite":                    # la base convertida es un solo archivo
        return ({extension: ruta_cbh}, []) if os.path.isfile(ruta_cbh) else ({}, [nombre])
    familia = EXTENSIONES_2CBH if extension == "2cbh" else EXTENSIONES
    base = os.path.splitext(nombre)[0].lower()
    try:
        existentes = {n.lower(): n for n in os.listdir(carpeta)}
    except OSError:
        existentes = {}
    rutas, faltan = {}, []
    for ext in familia:
        real = existentes.get(f"{base}.{ext}")
        if real:
            rutas[ext] = os.path.join(carpeta, real)
        else:
            faltan.append(f"{os.path.splitext(nombre)[0]}.{ext}")
    return rutas, faltan


def estado_mega():
    ruta = leer_config().get("ruta", "")
    if not ruta:
        return {"disponible": True, "configurada": False}
    rutas, faltan = archivos_de(ruta)
    nombre = os.path.splitext(os.path.basename(ruta))[0]
    formato = os.path.splitext(ruta)[1].lower().lstrip(".")
    if faltan:
        return {"disponible": True, "configurada": True, "nombre": nombre, "ruta": ruta, "formato": formato, "error": "La base está incompleta. No encuentro: " + ", ".join(faltan)}
    estado = {"disponible": True, "configurada": True, "nombre": nombre, "ruta": ruta, "formato": formato, "tamanos": {e: os.path.getsize(p) for e, p in rutas.items()}}
    if formato == "2cbh":
        estado["totalPartidas"] = max(0, os.path.getsize(rutas["2cbh"]) // 208 - 1)
    elif formato == "sqlite":
        try:
            estado["totalPartidas"] = mega_sqlite.total_partidas(ruta)
        except ValueError as ex:
            estado["error"] = str(ex)
    return estado


def archivos_libro(ruta_ctg):
    """{extensión: ruta real} de los tres archivos del libro (.ctg .ctb .cto), y los que faltan."""
    carpeta, nombre = os.path.split(ruta_ctg)
    base = os.path.splitext(nombre)[0].lower()
    try:
        existentes = {n.lower(): n for n in os.listdir(carpeta)}
    except OSError:
        existentes = {}
    rutas, faltan = {}, []
    for ext in EXTENSIONES_LIBRO:
        real = existentes.get(f"{base}.{ext}")
        if real:
            rutas[ext] = os.path.join(carpeta, real)
        else:
            faltan.append(f"{os.path.splitext(nombre)[0]}.{ext}")
    return rutas, faltan


def estado_libro():
    ruta = leer_config().get("libro", "")
    if not ruta:
        return {"disponible": True, "configurado": False}
    rutas, faltan = archivos_libro(ruta)
    nombre = os.path.splitext(os.path.basename(ruta))[0]
    if faltan:
        return {"disponible": True, "configurado": True, "nombre": nombre, "error": "El libro está incompleto. No encuentro: " + ", ".join(faltan)}
    return {"disponible": True, "configurado": True, "nombre": nombre, "tamanos": {e: os.path.getsize(p) for e, p in rutas.items()}}


def elegir_libro_con_cuadro():
    """El cuadro de Windows para elegir el .ctg. Devuelve la ruta, '' si se cancela o None si no hay interfaz gráfica."""
    try:
        import tkinter
        from tkinter import filedialog
    except ImportError:
        return None
    with _cuadro:
        raiz = tkinter.Tk()
        raiz.withdraw()
        raiz.attributes("-topmost", True)
        try:
            inicial = os.path.dirname(leer_config().get("libro", "")) or None
            ruta = filedialog.askopenfilename(
                parent=raiz, title="Elige el libro de aperturas de ChessBase (archivo .ctg)", initialdir=inicial,
                filetypes=[("Libro de aperturas (*.ctg)", "*.ctg"), ("Todos los archivos", "*.*")])
        finally:
            raiz.destroy()
    return os.path.normpath(ruta) if ruta else ""


def validar_y_guardar_libro(ruta):
    if not ruta.lower().endswith(".ctg") or not os.path.isfile(ruta):
        return {"error": "Selecciona el archivo .ctg del libro."}
    _, faltan = archivos_libro(ruta)
    if faltan:
        return {"error": "El libro está incompleto. No encuentro: " + ", ".join(faltan)}
    guardar_config({**leer_config(), "libro": ruta})
    return estado_libro()


def elegir_con_cuadro():
    """El cuadro de Windows para elegir el .cbh. Devuelve la ruta, '' si se cancela o None si no hay interfaz gráfica."""
    try:
        import tkinter
        from tkinter import filedialog
    except ImportError:
        return None
    with _cuadro:
        raiz = tkinter.Tk()
        raiz.withdraw()
        raiz.attributes("-topmost", True)
        try:
            inicial = os.path.dirname(leer_config().get("ruta", "")) or None
            ruta = filedialog.askopenfilename(
                parent=raiz, title="Elige la MegaDatabase de ChessBase", initialdir=inicial,
                filetypes=[("Bases ChessBase y SQLite", "*.cbh *.2cbh *.sqlite"), ("SQLite de ChessRival (*.sqlite)", "*.sqlite"), ("ChessBase clásico (*.cbh)", "*.cbh"), ("ChessBase 2 (*.2cbh)", "*.2cbh"), ("Todos los archivos", "*.*")])
        finally:
            raiz.destroy()
    return os.path.normpath(ruta) if ruta else ""


def validar_y_guardar(ruta):
    if not ruta.lower().endswith((".cbh", ".2cbh", ".sqlite")) or not os.path.isfile(ruta):
        return {"error": "Selecciona el archivo .cbh, .2cbh o .sqlite de la base."}
    _, faltan = archivos_de(ruta)
    if faltan:
        return {"error": "La base está incompleta. No encuentro: " + ", ".join(faltan)}
    if ruta.lower().endswith(".sqlite"):
        try:
            mega_sqlite.total_partidas(ruta)
        except ValueError as ex:
            return {"error": str(ex)}
    guardar_config({**leer_config(), "ruta": ruta})
    return estado_mega()


def _cerrar_bridge():
    with _bridge_lock:
        proceso = _bridge.get("proceso")
        _bridge.update(proceso=None, token=None, ruta=None)
    if proceso and proceso.poll() is None:
        proceso.terminate()
        try:
            proceso.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proceso.kill()


atexit.register(_cerrar_bridge)


def _asegurar_bridge(ruta):
    """Inicia el lector local 2CBH y devuelve su token. La base se abre en solo lectura."""
    with _bridge_lock:
        proceso = _bridge.get("proceso")
        if proceso and proceso.poll() is None and _bridge.get("ruta") == ruta and _bridge.get("token"):
            return _bridge["token"]
        _cerrar_bridge()
        exe = os.path.join(CARPETA, "tools", "chessbase-2cbh", "cbtool.exe")
        if not os.path.isfile(exe):
            raise RuntimeError("Falta el lector ChessBase 2. Restaura tools/chessbase-2cbh/cbtool.exe.")
        localappdata = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        datos = os.path.join(localappdata, "ChessRival", "cb-bridge-data")
        appdata, localappdata = os.path.join(datos, "roaming"), os.path.join(datos, "local")
        os.makedirs(appdata, exist_ok=True)
        os.makedirs(localappdata, exist_ok=True)
        entorno = os.environ.copy()
        entorno.update(APPDATA=appdata, LOCALAPPDATA=localappdata)
        creacion = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proceso = subprocess.Popen(
            [exe, "bridge", "--database", ruta, "--show-token"],
            cwd=CARPETA, env=entorno, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", creationflags=creacion)
        mensajes = queue.Queue()
        def leer_salida():
            for linea in proceso.stdout:
                mensajes.put(linea.rstrip())
        threading.Thread(target=leer_salida, daemon=True).start()
        token, lineas, limite = None, [], time.monotonic() + 60
        while time.monotonic() < limite and proceso.poll() is None:
            try:
                linea = mensajes.get(timeout=0.25)
            except queue.Empty:
                continue
            lineas.append(linea)
            m = re.search(r"#cb-bridge=([A-Za-z0-9_-]+)", linea)
            if m:
                token = m.group(1)
                break
        if not token:
            proceso.terminate()
            detalle = " ".join(lineas[-4:])
            raise RuntimeError("No se pudo iniciar el lector local de la MegaBase 2027. " + (detalle or "Comprueba que el puerto 39581 esté libre."))
        _bridge.update(proceso=proceso, token=token, ruta=ruta)
        return token


def _bridge_json(token, ruta, parametros=None):
    url = "http://127.0.0.1:39581" + ruta
    if parametros:
        url += "?" + urlencode(parametros)
    req = Request(url, headers={"Authorization": "Bearer " + token})
    with urlopen(req, timeout=180) as respuesta:
        return json.loads(respuesta.read().decode("utf-8"))


def _normalizar_nombre(nombre):
    texto = unicodedata.normalize("NFKD", nombre.casefold())
    return "".join(c for c in texto if not unicodedata.combining(c)).replace(".", " ").strip()


def buscar_2cbh(jugador, elo):
    ruta = leer_config().get("ruta", "")
    if not ruta.lower().endswith(".2cbh"):
        raise ValueError("La MegaBase seleccionada no es una base ChessBase 2 (.2cbh).")
    token = _asegurar_bridge(ruta)
    nombre = str(jugador or "").strip()
    if not nombre:
        raise ValueError("No se recibió el nombre del jugador.")
    bases = _bridge_json(token, "/v1/databases").get("databases", [])
    nombre_base = os.path.splitext(os.path.basename(ruta))[0].casefold()
    candidatas_base = [b for b in bases if b.get("format") == "2cbh" and b.get("state") == "ready" and b.get("name", "").casefold() == nombre_base]
    if not candidatas_base:
        raise RuntimeError("El lector aún no ha terminado de abrir la MegaBase 2027. Vuelve a intentarlo en unos segundos.")
    base = max(candidatas_base, key=lambda b: b.get("records", 0))
    query = 'player:"' + nombre.replace('"', '') + '"'
    offset, total, coincidencias, cantidad = 0, None, [], 0
    while total is None or offset < total:
        pagina = _bridge_json(token, f"/v1/databases/{base['id']}/games", {
            "offset": str(offset), "limit": "500", "sort": "date-desc", "q": query})
        filas = pagina.get("rows", [])
        total = pagina.get("total", 0)
        if not filas:
            break
        for fila in filas:
            if fila.get("kind") != "game":
                continue
            blanco, negro = fila.get("white", ""), fila.get("black", "")
            nb, nn = _normalizar_nombre(blanco), _normalizar_nombre(negro)
            objetivo = _normalizar_nombre(nombre)
            if objetivo not in (nb, nn):
                continue
            color = "B" if objetivo == nb else "N"
            elo_partida = fila.get("whiteElo" if color == "B" else "blackElo", 0)
            try:
                elo_actual = int(elo or 0)
            except (ValueError, TypeError):
                elo_actual = 0
            if elo_actual and elo_partida and abs(elo_actual - elo_partida) > 250:
                continue
            cantidad += 1
            if len(coincidencias) < 300:
                coincidencias.append((fila["number"], color))
        offset += len(filas)
    def leer_pgn(item):
        numero, color = item
        datos = _bridge_json(token, f"/v1/databases/{base['id']}/games/{numero}")
        return {"numero": numero, "pgn": datos["pgn"], "color": color}
    partidas, no_legibles = [], 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futuros = [pool.submit(leer_pgn, item) for item in coincidencias]
        for futuro in as_completed(futuros):
            try:
                partidas.append(futuro.result())
            except Exception:
                no_legibles += 1
    # Los números de registro siguen el orden de fecha de la consulta; las tareas
    # concurrentes terminan desordenadas, así que conservamos ese orden explícito.
    partidas.sort(key=lambda p: next((i for i, (n, _) in enumerate(coincidencias) if p["numero"] == n), 0))
    return {"candidatas": cantidad, "noLegibles": no_legibles,
            "partidas": [{"pgn": p["pgn"], "color": p["color"]} for p in partidas[:300]]}


# ---------- Servidor ----------


class SinCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=CARPETA, **kwargs)

    def _anfitrion_local(self):
        """True si la página se abrió con una dirección local (no la de una web publicada)."""
        host = (self.headers.get("Host") or "").strip().lower()
        if host.startswith("["):
            host = host.split("]")[0] + "]"
        else:
            host = host.split(":")[0]
        return host in HOSTS_LOCALES

    def end_headers(self):
        # En el equipo se ve siempre la última versión; en la web publicada el navegador revalida (304 si no ha cambiado).
        self.send_header("Cache-Control", "no-store" if self._anfitrion_local() else "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass

    def send_head(self):
        destino = os.path.normcase(os.path.realpath(self.translate_path(self.path)))
        privada = os.path.normcase(os.path.realpath(PRIVADA))
        if destino == privada or destino.startswith(privada + os.sep):
            self.send_error(404)
            return None
        return super().send_head()

    # Las rutas /local/… solo existen en el propio equipo y solo para páginas de este mismo origen.
    def _permitido(self):
        if not self._anfitrion_local():
            self.send_error(404)                         # en la web publicada no hay funciones locales
            return False
        if self.client_address[0] not in LOOPBACK:
            self.send_error(403, "Solo desde este equipo")
            return False
        origen = self.headers.get("Origin")
        if origen and origen not in ORIGENES:
            self.send_error(403, "Origen no permitido")
            return False
        return True

    def _json(self, datos, codigo=200):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _es_local(self):
        return self.path.split("?")[0].startswith("/local/")

    def do_GET(self):
        if urlsplit(self.path).path == '/api/fide/foto':
            return self._foto_fide(enviar_cuerpo=True)
        if not self._es_local():
            return super().do_GET()                      # los archivos de la web no necesitan permiso
        if not self._permitido():
            return
        if self.path.split("?")[0] == "/local/copias/destino":
            return self._json(copias_local.leer_destino())
        if self.path.split("?")[0].startswith("/local/mega"):
            return self._mega(enviar_cuerpo=True)
        if self.path.split("?")[0].startswith("/local/libro"):
            return self._libro(enviar_cuerpo=True)
        super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path == '/api/fide/foto':
            return self._foto_fide(enviar_cuerpo=False)
        if not self._es_local():
            return super().do_HEAD()
        if not self._permitido():
            return
        if self.path.split("?")[0].startswith("/local/mega"):
            return self._mega(enviar_cuerpo=False)
        if self.path.split("?")[0].startswith("/local/libro"):
            return self._libro(enviar_cuerpo=False)
        super().do_HEAD()

    def _foto_fide(self, enviar_cuerpo):
        parametros = parse_qs(urlsplit(self.path).query)
        try:
            datos, tipo = fotos_fide.obtener_foto(parametros.get('id', [''])[0])
        except fotos_fide.FotoNoDisponible as ex:
            if enviar_cuerpo:
                return self._json({'error': str(ex)}, ex.estado)
            self.send_response(ex.estado)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(datos)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if enviar_cuerpo:
            self.wfile.write(datos)

    def do_POST(self):
        if not self._es_local():
            return self.send_error(404)
        if not self._permitido():
            return
        # La cabecera propia obliga a una petición «con permiso previo» que otras webs no pueden hacer.
        if self.headers.get("X-ChessRival") != "1":
            return self.send_error(403, "Falta la cabecera de seguridad")
        ruta = self.path.split("?")[0]
        longitud = int(self.headers.get("Content-Length") or 0)
        if ruta.startswith('/local/copias/'):
            try:
                if ruta == '/local/copias/elegir':
                    return self._json(copias_local.elegir_destino(_cuadro))
                if ruta == '/local/copias/guardar':
                    if longitud <= 0 or longitud > 512 * 1024 * 1024:
                        return self._json({'error': 'El archivo supera el tamaño permitido.'}, 413)
                    datos = json.loads(self.rfile.read(longitud).decode('utf-8'))
                    if not isinstance(datos, dict):
                        raise ValueError('La copia no es válida.')
                    return self._json(copias_local.guardar_copia(datos))
                return self.send_error(404)
            except (OSError, ValueError, ImportError) as ex:
                return self._json({'error': str(ex)}, 400)
        cuerpo = {}
        if longitud:
            try:
                cuerpo = json.loads(self.rfile.read(min(longitud, 65536)).decode("utf-8"))
            except ValueError:
                pass

        if ruta == "/local/mega/elegir":
            elegida = elegir_con_cuadro()
            if elegida is None:
                return self._json({"sinInterfaz": True})
            if elegida == "":
                return self._json({"cancelado": True})
            nuevo = validar_y_guardar(elegida)
            if not nuevo.get("error"):
                _cerrar_bridge()
            return self._json(nuevo)
        if ruta == "/local/mega/ruta":
            nuevo = validar_y_guardar(str(cuerpo.get("ruta", "")).strip().strip('"'))
            if not nuevo.get("error"):
                _cerrar_bridge()
            return self._json(nuevo)
        if ruta == "/local/mega/buscar":
            try:
                base = leer_config().get("ruta", "")
                if base.lower().endswith(".sqlite"):
                    if not os.path.isfile(base):
                        raise ValueError("No encuentro la base SQLite elegida.")
                    return self._json(mega_sqlite.buscar(base, cuerpo.get("nombre", ""), cuerpo.get("elo", 0), cuerpo.get("fide")))
                resultado = buscar_2cbh(cuerpo.get("nombre", ""), cuerpo.get("elo", 0))
                return self._json(resultado)
            except (OSError, ValueError, RuntimeError, KeyError, TimeoutError, sqlite3.Error) as ex:
                return self._json({"error": str(ex)}, 400)
        if ruta == "/local/mega/olvidar":
            guardar_config({k: v for k, v in leer_config().items() if k != "ruta"})
            _cerrar_bridge()
            return self._json(estado_mega())
        if ruta == "/local/libro/elegir":
            elegida = elegir_libro_con_cuadro()
            if elegida is None:
                return self._json({"sinInterfaz": True})
            if elegida == "":
                return self._json({"cancelado": True})
            return self._json(validar_y_guardar_libro(elegida))
        if ruta == "/local/libro/olvidar":
            guardar_config({k: v for k, v in leer_config().items() if k != "libro"})
            return self._json(estado_libro())
        self.send_error(404)

    def _mega(self, enviar_cuerpo):
        ruta = self.path.split("?")[0]
        if ruta == "/local/mega":
            return self._json(estado_mega())
        if not ruta.startswith("/local/mega/archivo/"):
            return self.send_error(404)
        ext = ruta.rsplit("/", 1)[1].lower()
        configurada = leer_config().get("ruta", "")
        rutas, faltan = archivos_de(configurada) if configurada else ({}, [])
        if ext not in EXTENSIONES or ext not in rutas:
            return self.send_error(404)

        return self._enviar_archivo(rutas[ext], enviar_cuerpo)

    def _libro(self, enviar_cuerpo):
        ruta = self.path.split("?")[0]
        if ruta == "/local/libro":
            return self._json(estado_libro())
        if not ruta.startswith("/local/libro/archivo/"):
            return self.send_error(404)
        ext = ruta.rsplit("/", 1)[1].lower()
        configurado = leer_config().get("libro", "")
        rutas, _ = archivos_libro(configurado) if configurado else ({}, [])
        if ext not in EXTENSIONES_LIBRO or ext not in rutas:
            return self.send_error(404)
        return self._enviar_archivo(rutas[ext], enviar_cuerpo)

    def _enviar_archivo(self, archivo, enviar_cuerpo):
        """Entrega un archivo entero o el trozo que pida la cabecera Range."""
        tam = os.path.getsize(archivo)
        inicio, fin, codigo = 0, tam - 1, 200
        rango = self.headers.get("Range", "")
        if rango.startswith("bytes="):
            a, _, b = rango[6:].partition("-")
            try:
                inicio = int(a) if a else max(0, tam - int(b))
                fin = min(int(b), tam - 1) if a and b else tam - 1
            except ValueError:
                return self.send_error(416)
            if inicio >= tam or inicio > fin:
                return self.send_error(416)
            codigo = 206

        self.send_response(codigo)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(fin - inicio + 1))
        if codigo == 206:
            self.send_header("Content-Range", f"bytes {inicio}-{fin}/{tam}")
        self.end_headers()
        if not enviar_cuerpo:
            return
        try:
            with open(archivo, "rb") as f:
                f.seek(inicio)
                restante = fin - inicio + 1
                while restante > 0:
                    datos = f.read(min(TROZO, restante))
                    if not datos:
                        break
                    self.wfile.write(datos)
                    restante -= len(datos)
        except (ConnectionError, OSError):
            pass                                       # la página cerró la lectura antes de tiempo


class Servidor(http.server.ThreadingHTTPServer):
    daemon_threads = True          # varias conexiones a la vez: el navegador abre varias y alguna queda ociosa
    allow_reuse_address = True
    address_family = socket.AF_INET6   # «localhost» prueba primero IPv6: se escucha en IPv6 e IPv4 a la vez

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    print(f"ChessRival en http://localhost:{PUERTO}  (cierra esta ventana para detenerlo)")
    Servidor(("::", PUERTO), SinCache).serve_forever()
