"""Búsqueda en la MegaDatabase convertida a SQLite (tools/mega_a_sqlite.py). La base solo se lee.

El jugador se busca por su FIDE ID (índice «jugadores_fide»). Si no lo tiene o no figura en la base, por su nombre exacto (índice
«jugadores_nombre») y, en último caso, como al leer el .cbh en la página (js/chessbase.js): por las palabras del nombre. Al buscar por
nombre, el ELO de cada partida descarta a los homónimos.
"""
import os
import re
import sqlite3
import threading
import unicodedata
from pathlib import Path

MAX_PARTIDAS = 300          # las más recientes
MARGEN_ELO = 250
FEN_INICIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

# Un mismo nombre de pila escrito de dos maneras (la misma lista que js/chessbase.js).
NOMBRES_EQUIVALENTES = [set(g.split()) for g in (
    "joan juan jan", "josep jose", "jordi jorge", "jaume jaime", "pere pedro", "miquel miguel", "lluis luis", "xavier javier",
    "enric enrique", "francesc francisco", "antoni antonio", "albert alberto", "ferran fernando", "rafel rafael", "sergi sergio",
    "joaquim joaquin", "esteve esteban", "carles carlos", "ramon raimon", "pau pablo", "vicenc vicente", "eduard eduardo",
    "ricard ricardo", "guillem guillermo", "ignasi ignacio", "isidre isidro", "jeroni jeronimo", "gerard gerardo", "anna ana",
    "montserrat montse", "merce mercedes", "joana juana", "lluisa luisa", "concepcio concepcion")]

_cerrojo = threading.Lock()
_indice = {"clave": None, "palabras": None}      # palabra → [(id, apellido, nombre)] de todos los jugadores


def _abrir(ruta):
    return sqlite3.connect(Path(ruta).resolve().as_uri() + "?mode=ro", uri=True)


def total_partidas(ruta):
    """Cuántas partidas tiene la base. Lanza ValueError si el archivo no es una base creada por el conversor."""
    try:
        db = _abrir(ruta)
        try:
            db.execute("SELECT blancas, negras, torneo, jugadas FROM partidas LIMIT 0")
            db.execute("SELECT id, san FROM san LIMIT 0")
            return db.execute("SELECT coalesce(max(id), 0) FROM partidas").fetchone()[0]
        finally:
            db.close()
    except sqlite3.Error as ex:
        raise ValueError("El archivo no es una base SQLite de ChessRival, o está dañado.") from ex


def decodificar(blob, san):
    """Las jugadas de la columna «partidas.jugadas»; san es {id: texto} (formato en tools/mega_a_sqlite.py)."""
    i = 0
    while i < len(blob):
        b = blob[i]
        if b < 128:
            n, i = b, i + 1
        elif b < 0xFF:
            n, i = ((b & 0x7F) << 8) | blob[i + 1], i + 2
        else:
            n, i = (blob[i + 1] << 8) | blob[i + 2], i + 3
        yield san[n]


def palabras(texto):
    """Como «palabras» de js/pgn.js: sin tildes ni signos y con las transliteraciones unificadas («Yurii», «Yuri», «Yuriy»)."""
    if not texto.isascii():
        texto = "".join(c for c in unicodedata.normalize("NFD", texto) if not unicodedata.category(c).startswith("M"))
    salida = set()
    for p in re.sub(r"[\W\d_]+", " ", texto.lower()).split():
        for par in ("ij", "iy", "ii", "yi", "yj", "yy"):
            p = p.replace(par, "i")
        salida.add(p.replace("y", "i"))
    return salida


def _compatible(a, b):
    return (a == b or (len(a) == 1 and b.startswith(a)) or (len(b) == 1 and a.startswith(b))
            or any(a in g and b in g for g in NOMBRES_EQUIVALENTES))


def coincide(buscado, apellido, nombre):
    """¿El jugador de la base (apellido, nombre) es la persona buscada («Apellidos, Nombre»)?"""
    apellidos_b, coma, nombres_b = buscado.partition(",")
    ap = palabras(apellido)
    if not ap:
        return False
    nom = palabras(nombre)
    if not coma:
        todos, pedidos = ap | nom, palabras(buscado)
        return len(todos) >= 2 and (todos <= pedidos or pedidos <= todos)
    if not ap <= palabras(apellidos_b):
        return False
    if not nom:
        return len(ap) >= 2                      # sin nombre de pila solo si el apellido es compuesto
    pila = palabras(nombres_b)
    return all(any(_compatible(n, g) for g in pila) for n in nom)


def _indice_de(db, ruta):
    """El índice de jugadores por palabra. Se prepara en la primera búsqueda y se reutiliza mientras no cambie el archivo."""
    clave = (ruta, os.path.getmtime(ruta), os.path.getsize(ruta))
    with _cerrojo:
        if _indice["clave"] != clave:
            por_palabra = {}
            for n, completo in db.execute("SELECT id, nombre FROM jugadores"):
                apellido, _, nombre = completo.partition(",")
                jugador = (n, apellido.strip(), nombre.strip())
                for p in palabras(completo):
                    por_palabra.setdefault(p, []).append(jugador)
            _indice.update(clave=clave, palabras=por_palabra)
        return _indice["palabras"]


def _por_fide(db, fide):
    """Las fichas con ese FIDE ID. Vacío si no hay ID o la base no los tiene."""
    if not fide:
        return []
    try:
        return [n for (n,) in db.execute("SELECT id FROM jugadores WHERE fide_id = ?", (fide,))]
    except sqlite3.OperationalError:
        return []


def _jugadores(db, ruta, buscado):
    """Las fichas que corresponden a un nombre."""
    exactas = [n for (n,) in db.execute("SELECT id FROM jugadores WHERE nombre = ? COLLATE NOCASE", (buscado,))]
    if exactas:
        return exactas
    indice = _indice_de(db, ruta)
    candidatos = {j for p in palabras(buscado) for j in indice.get(p, ())}
    return [j[0] for j in candidatos if coincide(buscado, j[1], j[2])]


def _escapar(valor):
    return str(valor).replace("\\", "\\\\").replace('"', '\\"')


def _pgn(fila, jugadas):
    fecha, blancas, negras, resultado, elo_b, elo_n, evento, sitio, ronda, eco, fen, fide_b, fide_n = fila
    cabeceras = [("Event", evento), ("Site", sitio), ("Date", fecha), ("Round", ronda or "?"), ("White", blancas), ("Black", negras),
                 ("Result", resultado), ("WhiteElo", elo_b), ("BlackElo", elo_n), ("ECO", eco),
                 ("WhiteFideId", fide_b), ("BlackFideId", fide_n)]
    if fen and fen != FEN_INICIAL:
        cabeceras += [("SetUp", "1"), ("FEN", fen)]
    texto = "".join(f'[{k} "{_escapar(v)}"]\n' for k, v in cabeceras if v) + "\n"
    campos = (fen or FEN_INICIAL).split()
    juegan_blancas = len(campos) < 2 or campos[1] == "w"
    numero = int(campos[5]) if len(campos) > 5 and campos[5].isdigit() and int(campos[5]) > 0 else 1
    partes = []
    for i, san in enumerate(jugadas):
        if juegan_blancas:
            partes.append(f"{numero}.")
        elif i == 0:
            partes.append(f"{numero}...")
        partes.append(san)
        if not juegan_blancas:
            numero += 1
        juegan_blancas = not juegan_blancas
    return f"{texto}{' '.join(partes)} {resultado}\n\n"


def buscar(ruta, jugador, elo, fide=None, maximo=MAX_PARTIDAS):
    """{candidatas, noLegibles, partidas: [{pgn, color}]} con las partidas más recientes del jugador."""
    jugador = str(jugador or "").strip()
    if not jugador:
        raise ValueError("No se recibió el nombre del jugador.")
    try:
        elo = int(elo or 0)
    except (TypeError, ValueError):
        elo = 0
    fide = int(fide) if str(fide or "").strip().isdigit() else 0
    db = _abrir(ruta)
    try:
        ids = _por_fide(db, fide)
        if ids:
            elo = 0                              # identificado sin dudas: sirven también las partidas con un ELO muy distinto
        else:
            ids = _jugadores(db, ruta, jugador)
        con_fide = any(c[1] == "fide_id" for c in db.execute("PRAGMA table_info(jugadores)"))
        columnas_fide = "b.fide_id, n.fide_id" if con_fide else "NULL, NULL"
        aciertos = []
        for color, columna, columna_elo in (("B", "blancas", "elo_blancas"), ("N", "negras", "elo_negras")):
            for i in range(0, len(ids), 500):
                lote = ids[i:i + 500]
                sql = f"SELECT id, fecha, length(jugadas) FROM partidas WHERE {columna} IN ({','.join('?' * len(lote))})"
                parametros = list(lote)
                if elo > 0:                      # mismo nombre pero otra persona: el ELO de la partida debe ser parecido al actual
                    sql += f" AND (coalesce({columna_elo}, 0) = 0 OR abs({columna_elo} - ?) <= ?)"
                    parametros += [elo, MARGEN_ELO]
                aciertos += [(fecha.replace("?", "0"), n, largo, color) for n, fecha, largo in db.execute(sql, parametros)]
        aciertos.sort(reverse=True)
        san = dict(db.execute("SELECT id, san FROM san"))
        partidas, no_legibles = [], 0
        for _, n, largo, color in aciertos:
            if len(partidas) >= maximo:
                break
            if not largo:                        # en la base solo figura el resultado
                no_legibles += 1
                continue
            fila = db.execute(f"""SELECT p.fecha, b.nombre, n.nombre, p.resultado, p.elo_blancas, p.elo_negras, t.evento, t.sitio, p.ronda,
                                        p.eco, p.fen, {columnas_fide}, p.jugadas
                                 FROM partidas p JOIN jugadores b ON b.id = p.blancas JOIN jugadores n ON n.id = p.negras
                                 JOIN torneos t ON t.id = p.torneo WHERE p.id = ?""", (n,)).fetchone()
            jugadas = list(decodificar(fila[-1], san))
            if "--" in jugadas:                  # jugada nula: la página no la admite
                no_legibles += 1
                continue
            partidas.append({"pgn": _pgn(fila[:-1], jugadas), "color": color})
        return {"candidatas": len(aciertos), "noLegibles": no_legibles, "partidas": partidas}
    finally:
        db.close()
