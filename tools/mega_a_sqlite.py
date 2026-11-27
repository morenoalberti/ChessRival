"""Convierte una base de ChessBase (.2cbh o .cbh) en una base SQLite para consultas rápidas. La original solo se lee.

    python tools/mega_a_sqlite.py "ruta/Mega Database 2027.2cbh" BaseDatos/MegaDatabase2027.sqlite [--limite N]

Las partidas salen de «cbtool pgn». Se excluyen las anteriores a 1900 (las de año desconocido se conservan).
Se guarda la línea principal: sin comentarios, variantes ni signos de valoración.

Columna «partidas.jugadas»: un número por jugada, que es su id en la tabla «san».
  id < 128      → 1 byte
  id < 32512    → 2 bytes: 0x80 | (id >> 8), id & 0xFF
  resto         → 3 bytes: 0xFF, id >> 8, id & 0xFF
La inversa es «decodificar», en mega_sqlite.py.
"""
import argparse
import io
import os
import re
import sqlite3
import subprocess
import sys
import time

from mega_fide import añadir_fide

AÑO_MINIMO = 1900
LOTE = 20000
CBTOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chessbase-2cbh", "cbtool.exe")

ESQUEMA = """
CREATE TABLE jugadores (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL);
CREATE TABLE torneos   (id INTEGER PRIMARY KEY, evento TEXT NOT NULL, sitio TEXT NOT NULL);
CREATE TABLE san       (id INTEGER PRIMARY KEY, san TEXT NOT NULL);
CREATE TABLE info      (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE partidas  (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,          -- AAAA.MM.DD, con «?» en lo desconocido
  blancas INTEGER NOT NULL REFERENCES jugadores,
  negras INTEGER NOT NULL REFERENCES jugadores,
  resultado TEXT NOT NULL,
  elo_blancas INTEGER,
  elo_negras INTEGER,
  torneo INTEGER NOT NULL REFERENCES torneos,
  ronda TEXT,
  eco TEXT,
  fen TEXT,                     -- solo si no empieza en la posición inicial
  jugadas BLOB NOT NULL
);
"""
INDICES = (
    "CREATE INDEX partidas_blancas ON partidas (blancas, fecha)",
    "CREATE INDEX partidas_negras ON partidas (negras, fecha)",
    "CREATE INDEX jugadores_nombre ON jugadores (nombre COLLATE NOCASE)",
)

CABECERA = re.compile(r'\[(\w+) "(.*)"\]$')
COMENTARIO = re.compile(r"\{[^}]*\}")
VARIANTE = re.compile(r"\([^()]*\)")


def leer_partidas(lineas):
    """(cabeceras, texto de las jugadas) de cada partida del PGN."""
    cab, jugadas, en_comentario = {}, [], False
    for linea in lineas:
        linea = linea.rstrip("\r\n")
        if not en_comentario and linea.startswith("["):
            m = CABECERA.match(linea)
            if m:
                if jugadas:
                    yield cab, " ".join(jugadas)
                    cab, jugadas = {}, []
                valor = m.group(2)
                if "\\" in valor:
                    valor = valor.replace('\\"', '"').replace("\\\\", "\\")
                cab[m.group(1)] = valor
                continue
        if linea:
            jugadas.append(linea)
            abre, cierra = linea.rfind("{"), linea.rfind("}")
            if abre > cierra:
                en_comentario = True
            elif cierra >= 0:
                en_comentario = False
    if cab:
        yield cab, " ".join(jugadas)


def linea_principal(texto):
    if "{" in texto:
        texto = COMENTARIO.sub(" ", texto)
    while "(" in texto:
        texto, n = VARIANTE.subn(" ", texto)
        if not n:
            break
    for t in texto.split():
        # Fuera los números de jugada, el resultado, «*» y los NAG ($n).
        if t[0] in "0123456789$*":
            continue
        t = t.rstrip("!?")
        if t:
            yield t


def codificar(jugadas, ids):
    salida = bytearray()
    for san in jugadas:
        n = ids.get(san)
        if n is None:
            n = ids[san] = len(ids)
        if n < 128:
            salida.append(n)
        elif n < 32512:
            salida += bytes((0x80 | (n >> 8), n & 0xFF))
        else:
            salida += bytes((0xFF, n >> 8, n & 0xFF))
    return bytes(salida)


def entero(valor):
    return int(valor) if valor and valor.isdigit() else None


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("origen")
    p.add_argument("destino")
    p.add_argument("--limite", type=int, help="convertir solo las primeras N partidas (para probar)")
    a = p.parse_args()
    if os.path.exists(a.destino):
        sys.exit(f"Ya existe {a.destino}. Bórralo o elige otro nombre.")
    temporal, registro = a.destino + ".tmp", a.destino + ".errores.log"
    if os.path.exists(temporal):
        os.remove(temporal)

    db = sqlite3.connect(temporal)
    db.executescript("PRAGMA page_size=8192; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-262144;" + ESQUEMA)
    insertar = "INSERT INTO partidas VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    jugadores, torneos, san, lote = {}, {}, {}, []
    leidas = guardadas = antiguas = 0
    inicio = time.time()

    with open(registro, "wb") as errores:
        proceso = subprocess.Popen([CBTOOL, "pgn", a.origen], stdout=subprocess.PIPE, stderr=errores, bufsize=1 << 20)
        try:
            for cab, texto in leer_partidas(io.TextIOWrapper(proceso.stdout, encoding="utf-8", errors="replace")):
                leidas += 1
                fecha = cab.get("Date", "????.??.??")
                año = fecha[:4]
                if año.isdigit() and 0 < int(año) < AÑO_MINIMO:
                    antiguas += 1
                else:
                    b = jugadores.setdefault(cab.get("White", "?"), len(jugadores) + 1)
                    n = jugadores.setdefault(cab.get("Black", "?"), len(jugadores) + 1)
                    t = torneos.setdefault((cab.get("Event", "?"), cab.get("Site", "?")), len(torneos) + 1)
                    ronda = cab.get("Round")
                    guardadas += 1
                    lote.append((guardadas, fecha, b, n, cab.get("Result", "*"), entero(cab.get("WhiteElo")), entero(cab.get("BlackElo")), t,
                                 None if ronda == "?" else ronda, cab.get("ECO"), cab.get("FEN"), codificar(linea_principal(texto), san)))
                    if len(lote) >= LOTE:
                        db.executemany(insertar, lote)
                        lote.clear()
                if leidas % 500000 == 0:
                    print(f"{leidas:,} leídas · {time.time() - inicio:.0f} s", flush=True)
                if a.limite and leidas >= a.limite:
                    break
        finally:
            if a.limite:
                proceso.kill()
        codigo = proceso.wait()

    db.executemany(insertar, lote)
    db.executemany("INSERT INTO jugadores VALUES (?,?)", ((i, nombre) for nombre, i in jugadores.items()))
    db.executemany("INSERT INTO torneos VALUES (?,?,?)", ((i, e, s) for (e, s), i in torneos.items()))
    db.executemany("INSERT INTO san VALUES (?,?)", ((i, s) for s, i in san.items()))
    with open(registro, "rb") as f:
        avisos = f.read().decode("utf-8", "replace").splitlines()
    fallidas = sum(1 for x in avisos if "annotations incomplete" not in x)
    # cbtool devuelve un error si alguna partida no se pudo leer; si no dijo cuál, la exportación se cortó.
    if codigo and not a.limite and not fallidas:
        sys.exit(f"cbtool terminó con el código {codigo}: la exportación no está completa.")
    db.executemany("INSERT INTO info VALUES (?,?)", [
        ("origen", os.path.basename(a.origen)), ("año_minimo", str(AÑO_MINIMO)), ("leidas", str(leidas)),
        ("guardadas", str(guardadas)), ("excluidas_antiguas", str(antiguas)), ("avisos_cbtool", str(len(avisos))),
        ("codigo_cbtool", str(codigo)),
    ])
    db.commit()
    if a.origen.lower().endswith(".2cbh") and not a.limite:
        print("Añadiendo los FIDE ID…", flush=True)
        añadir_fide(db, a.origen)
        db.commit()
    print("Creando índices…", flush=True)
    for indice in INDICES:
        db.execute(indice)
    db.execute("ANALYZE")
    db.commit()
    db.close()
    os.replace(temporal, a.destino)
    print(f"leídas={leidas} guardadas={guardadas} anteriores_a_{AÑO_MINIMO}={antiguas} jugadores={len(jugadores)} torneos={len(torneos)} "
          f"san={len(san)} avisos={len(avisos)} fallidas={fallidas} codigo={codigo}")
    print(f"{os.path.getsize(a.destino) / 1e9:.2f} GB en {time.time() - inicio:.0f} s")


if __name__ == "__main__":
    main()
