"""Destino de las copias elegidas con el selector de Windows."""
import json
import os
import re

CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.copias-destino.json')


def leer_destino():
    try:
        with open(CONFIG, encoding='utf-8') as archivo:
            ruta = json.load(archivo).get('ruta', '')
    except (OSError, ValueError, AttributeError):
        ruta = ''
    return {'disponible': True, 'ruta': ruta, 'name': os.path.basename(ruta), 'local': True}


def elegir_destino(cuadro):
    import tkinter
    from tkinter import filedialog
    with cuadro:
        raiz = tkinter.Tk()
        raiz.withdraw()
        raiz.attributes('-topmost', True)
        try:
            ruta = filedialog.askdirectory(parent=raiz, title='Carpeta para las copias de ChessRival',
                                          initialdir=leer_destino()['ruta'] or None, mustexist=True)
        finally:
            raiz.destroy()
    if not ruta:
        return {'cancelado': True}
    ruta = os.path.abspath(ruta)
    with open(CONFIG, 'w', encoding='utf-8') as archivo:
        json.dump({'ruta': ruta}, archivo, ensure_ascii=False)
    return leer_destino()


def guardar_copia(datos):
    ruta = leer_destino()['ruta']
    if not ruta or datos.get('ruta') != ruta:
        raise ValueError('Vuelve a elegir la carpeta de destino.')
    if not os.path.isdir(ruta):
        raise ValueError('La carpeta de destino no está disponible. Elige otra carpeta.')
    nombre = datos.get('nombre', '')
    if not isinstance(nombre, str) or not re.fullmatch(r'ChessRival-[A-Za-z0-9-]+\.json', nombre):
        raise ValueError('El nombre de la copia no es válido.')
    paquete = datos.get('paquete')
    if not isinstance(paquete, dict) or paquete.get('formato') != 'ChessRival-web':
        raise ValueError('El archivo no es una copia de ChessRival.')
    for intento in range(1000):
        candidato = nombre if not intento else f'{nombre[:-5]} ({intento + 1}).json'
        archivo = os.path.join(ruta, candidato)
        try:
            salida = open(archivo, 'x', encoding='utf-8')
        except FileExistsError:
            continue
        try:
            with salida:
                json.dump(paquete, salida, ensure_ascii=False, separators=(',', ':'))
        except Exception:
            os.remove(archivo)
            raise
        return {'nombre': candidato, 'descarga': False}
    raise ValueError('Hay demasiados archivos con ese nombre. Elige otra carpeta.')
