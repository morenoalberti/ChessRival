import json
import os
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import copias_local
from servidor import SinCache


class DestinoCopias(unittest.TestCase):
    def setUp(self):
        proyecto = os.path.dirname(os.path.abspath(__file__))
        self.temporal = tempfile.TemporaryDirectory(prefix='.prueba-copias-', dir=proyecto)
        self.assertEqual(os.path.commonpath([proyecto, os.path.abspath(self.temporal.name)]), proyecto)
        self.addCleanup(self.temporal.cleanup)
        self.ruta = os.path.join(self.temporal.name, 'Mis copias con espacios')
        os.mkdir(self.ruta)
        self.config = os.path.join(self.temporal.name, 'destino.json')
        self.parche = patch.object(copias_local, 'CONFIG', self.config)
        self.parche.start()
        self.addCleanup(self.parche.stop)
        with open(self.config, 'w', encoding='utf-8') as archivo:
            json.dump({'ruta': self.ruta}, archivo)
        self.datos = {'ruta': self.ruta, 'nombre': 'ChessRival-manual-2026-10-15.json',
                      'paquete': {'formato': 'ChessRival-web', 'contenido': 'áé ♔'}}

    def test_recuerda_ruta_completa_y_guarda_sin_sobrescribir(self):
        self.assertEqual(copias_local.leer_destino()['ruta'], self.ruta)
        primera = copias_local.guardar_copia(self.datos)
        segunda = copias_local.guardar_copia(self.datos)
        self.assertEqual(segunda['nombre'], 'ChessRival-manual-2026-10-15 (2).json')
        for info in (primera, segunda):
            with open(os.path.join(self.ruta, info['nombre']), encoding='utf-8') as archivo:
                self.assertEqual(json.load(archivo), self.datos['paquete'])

    def test_rechaza_otras_rutas_nombres_y_archivos(self):
        for cambio in ({'ruta': self.temporal.name}, {'nombre': '../escape.json'},
                       {'nombre': 'otro.txt'}, {'paquete': {'formato': 'otro'}}):
            with self.subTest(cambio=cambio), self.assertRaises(ValueError):
                copias_local.guardar_copia({**self.datos, **cambio})
        self.assertEqual(os.listdir(self.ruta), [])

    def test_borra_archivo_incompleto_si_falla_la_escritura(self):
        with patch.object(copias_local.json, 'dump', side_effect=OSError('Disco lleno')):
            with self.assertRaises(OSError):
                copias_local.guardar_copia(self.datos)
        self.assertEqual(os.listdir(self.ruta), [])

    def test_carpeta_eliminada_no_se_recrea(self):
        os.rmdir(self.ruta)
        with self.assertRaisesRegex(ValueError, 'no está disponible'):
            copias_local.guardar_copia(self.datos)
        self.assertFalse(os.path.exists(self.ruta))

    def test_api_entrega_ruta_y_guarda_copia_grande_solo_desde_el_origen_permitido(self):
        servidor = ThreadingHTTPServer(('127.0.0.1', 0), SinCache)
        hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
        hilo.start()
        try:
            base = f'http://127.0.0.1:{servidor.server_port}/local/copias/'
            with urllib.request.urlopen(base + 'destino') as respuesta:
                self.assertEqual(json.load(respuesta)['ruta'], self.ruta)
            datos = {**self.datos, 'paquete': {'formato': 'ChessRival-web', 'contenido': 'a' * 70000}}
            cuerpo = json.dumps(datos).encode()
            for cabeceras in ({}, {'X-ChessRival': '1', 'Origin': 'https://otra-web.example'}):
                peticion = urllib.request.Request(base + 'guardar', data=cuerpo, headers=cabeceras)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(peticion)
                self.assertEqual(error.exception.code, 403)
            self.assertEqual(os.listdir(self.ruta), [])
            peticion = urllib.request.Request(base + 'guardar', data=cuerpo,
                                              headers={'X-ChessRival': '1', 'Origin': 'http://localhost:8765'})
            with urllib.request.urlopen(peticion) as respuesta:
                guardada = json.load(respuesta)
            with open(os.path.join(self.ruta, guardada['nombre']), encoding='utf-8') as archivo:
                self.assertEqual(json.load(archivo), datos['paquete'])
        finally:
            servidor.shutdown()
            servidor.server_close()
            hilo.join()


if __name__ == '__main__':
    unittest.main()
