"""Añade el FIDE ID de cada jugador a una base creada con mega_a_sqlite.py a partir de un .2cbh. La original solo se lee.

    python tools/mega_fide.py "ruta/Mega Database 2027.2cbh" BaseDatos/MegaDatabase2027.sqlite

El PGN que exporta cbtool no lleva el FIDE ID: se lee de la ficha del jugador (.2lid), y las cabeceras (.2cbh) dicen qué ficha juega cada
partida. Dos fichas con el mismo nombre y distinto FIDE ID quedan como jugadores distintos.
"""
import argparse
import mmap
import os
import sqlite3
import struct
import sys

AÑO_MINIMO = 1900
REGISTRO = 208          # tamaño de la cabecera en Mega Database 2027


def fichas_fide(ruta_2lid):
    """Una función ficha → FIDE ID (0 si no tiene)."""
    f = open(ruta_2lid, "rb")
    m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
    cabecera, tipos = struct.unpack_from(">ii", m, 0)
    contenedor = struct.unpack_from(">i", m, 8)[0]                 # los jugadores son el primer tipo de cada bloque
    total = struct.unpack_from(">q", m, 12)[0]
    bloque = sum(struct.unpack_from(">i", m, 8 + 20 * t)[0] for t in range(tipos))

    def fide(n):
        if not 0 <= n < total:
            return 0
        i = cabecera + n * bloque
        largo = struct.unpack_from("<i", m, i)[0]
        if not 0 < largo <= contenedor - 4:
            return 0
        fin, p = i + 4 + largo, i + 4
        for _ in range(2):                                         # apellido y nombre
            p += 4 + struct.unpack_from("<i", m, p)[0]
        # Detrás: 8 bytes, un entero, la longitud del campo (8) y el FIDE ID.
        if p + 24 > fin or struct.unpack_from("<i", m, p + 12)[0] != 8:
            return 0
        n = struct.unpack_from("<q", m, p + 16)[0]
        return n if 0 < n < 10 ** 10 else 0

    return fide


def añadir_fide(db, origen):
    """Rellena «jugadores.fide_id» y crea su índice. Comprueba que cada cabecera corresponde a su partida."""
    base = os.path.splitext(origen)[0]
    fide = fichas_fide(base + ".2lid")
    if "fide_id" not in [c[1] for c in db.execute("PRAGMA table_info(jugadores)")]:
        db.execute("ALTER TABLE jugadores ADD COLUMN fide_id INTEGER")
    elif db.execute("SELECT 1 FROM jugadores WHERE fide_id IS NOT NULL LIMIT 1").fetchone():
        raise ValueError("La base ya tiene los FIDE ID.")

    cache = {}
    asignado = {}       # id de jugador → primer FIDE ID visto
    otros = {}          # (id de jugador, otro FIDE ID) → id nuevo
    cambios = {"blancas": [], "negras": []}
    siguiente = db.execute("SELECT max(id) FROM jugadores").fetchone()[0] + 1
    filas = db.cursor().execute("SELECT id, blancas, negras, elo_blancas, elo_negras, fecha FROM partidas ORDER BY id")
    hechas = 0
    with open(origen, "rb") as f:
        f.read(REGISTRO)
        while trozo := f.read(REGISTRO * 50000):
            for p in range(0, len(trozo) - REGISTRO + 1, REGISTRO):
                if trozo[p + 2] != 1 or trozo[p] & 2:              # no es una partida
                    continue
                año = struct.unpack_from("<i", trozo, p + 0xBC)[0] >> 9
                if 0 < año < AÑO_MINIMO:
                    continue
                fila = filas.fetchone()
                if fila is None:
                    raise ValueError("Hay más partidas en el original que en la base SQLite.")
                n, blancas, negras, elo_b, elo_n, fecha = fila
                elo = struct.unpack_from("<h", trozo, p + 0x60)[0], struct.unpack_from("<h", trozo, p + 0x70)[0]
                if (max(elo[0], 0), max(elo[1], 0)) != (elo_b or 0, elo_n or 0) or (año > 0 and fecha[:4] != f"{año:04d}"):
                    raise ValueError(f"La partida {n} no corresponde con su cabecera: ¿es la misma base?")
                for columna, jugador, desplazamiento in (("blancas", blancas, 0x18), ("negras", negras, 0x20)):
                    ficha = struct.unpack_from("<q", trozo, p + desplazamiento)[0]
                    valor = cache.get(ficha)
                    if valor is None:
                        valor = cache[ficha] = fide(ficha)
                    primero = asignado.setdefault(jugador, valor)
                    if primero != valor:
                        nuevo = otros.get((jugador, valor))
                        if nuevo is None:
                            nuevo = otros[(jugador, valor)] = siguiente
                            siguiente += 1
                        cambios[columna].append((nuevo, n))
                hechas += 1
                if hechas % 2000000 == 0:
                    print(f"FIDE ID: {hechas:,} partidas revisadas", flush=True)
    if filas.fetchone() is not None:
        raise ValueError("Hay más partidas en la base SQLite que en el original.")

    nombres = dict(db.execute("SELECT id, nombre FROM jugadores"))
    db.executemany("INSERT INTO jugadores (id, nombre, fide_id) VALUES (?,?,?)",
                   ((nuevo, nombres[j], valor or None) for (j, valor), nuevo in otros.items()))
    db.executemany("UPDATE jugadores SET fide_id = ? WHERE id = ?", ((v, j) for j, v in asignado.items() if v))
    for columna, lista in cambios.items():
        db.executemany(f"UPDATE partidas SET {columna} = ? WHERE id = ?", lista)
    db.execute("CREATE INDEX IF NOT EXISTS jugadores_fide ON jugadores (fide_id)")
    db.execute("ANALYZE")
    con = db.execute("SELECT count(*), count(DISTINCT fide_id) FROM jugadores WHERE fide_id IS NOT NULL").fetchone()
    print(f"partidas={hechas} jugadores_con_fide={con[0]} fide_distintos={con[1]} homónimos_separados={len(otros)}")


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("origen")
    p.add_argument("destino")
    a = p.parse_args()
    if not os.path.isfile(a.destino):
        sys.exit(f"No existe {a.destino}.")
    db = sqlite3.connect(a.destino)
    db.execute("PRAGMA cache_size=-262144")
    try:
        with db:                       # todo o nada: si algo no cuadra, la base queda como estaba
            añadir_fide(db, a.origen)
    finally:
        db.close()


if __name__ == "__main__":
    main()
