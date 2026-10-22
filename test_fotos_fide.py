import base64
from io import BytesIO
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import fotos_fide
from servidor import SinCache


PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHVEAAAAASUVORK5CYII=')


def perfil(src=None):
    foto = f'<img class="perfil profile-top__photo" src="{src}">' if src else ''
    return ('<html><body>' + ' ' * 120 + foto + '</body></html>').encode()


def perfil_con_foto():
    # FIDE puede etiquetar PNG como JPEG: el tipo se deduce de los bytes reales.
    return perfil('data:image/jpeg;base64,' + base64.b64encode(PNG).decode())


class FotosFide(unittest.TestCase):
    def setUp(self):
        fotos_fide._cache.clear()

    def test_recupera_foto_y_reutiliza_solo_imagenes_validas(self):
        with patch('fotos_fide._descargar', return_value=perfil_con_foto()) as descargar:
            self.assertEqual(fotos_fide.obtener_foto('2256657'), (PNG, 'image/png'))
            self.assertEqual(fotos_fide.obtener_foto('2256657'), (PNG, 'image/png'))
            self.assertEqual(descargar.call_count, 1)
            self.assertTrue(descargar.call_args.args[0].startswith('https://ratings.fide.com/profile/2256657?_foto='))

    def test_respuesta_vacia_se_reintenta_en_la_siguiente_consulta(self):
        with patch('fotos_fide._descargar', side_effect=[b'', perfil_con_foto()]):
            with self.assertRaises(fotos_fide.FotoNoDisponible) as ex:
                fotos_fide.obtener_foto('2256657')
            self.assertEqual(ex.exception.estado, 503)
            self.assertEqual(fotos_fide.obtener_foto('2256657'), (PNG, 'image/png'))

    def test_un_perfil_sin_foto_no_se_guarda_como_ausencia_permanente(self):
        with patch('fotos_fide._descargar', side_effect=[perfil(), perfil_con_foto()]):
            with self.assertRaises(fotos_fide.FotoNoDisponible) as ex:
                fotos_fide.obtener_foto('2256657')
            self.assertEqual(ex.exception.estado, 404)
            self.assertEqual(fotos_fide.obtener_foto('2256657'), (PNG, 'image/png'))

    def test_id_invalido_no_hace_consultas(self):
        with patch('fotos_fide._descargar') as descargar:
            for valor in ['', '../2256657', 'https://example.com', '0', '1&url=x', None]:
                with self.subTest(id=valor), self.assertRaises(fotos_fide.FotoNoDisponible) as ex:
                    fotos_fide.obtener_foto(valor)
                self.assertEqual(ex.exception.estado, 400)
            descargar.assert_not_called()

    def test_imagen_externa_no_admite_otro_servidor(self):
        with patch('fotos_fide._descargar', return_value=perfil('https://example.com/foto.jpg')) as descargar:
            with self.assertRaises(fotos_fide.FotoNoDisponible):
                fotos_fide.obtener_foto('2256657')
            self.assertEqual(descargar.call_count, 1)

    def test_foto_relativa_se_descarga_y_html_disfrazado_no_se_guarda(self):
        with patch('fotos_fide._descargar', side_effect=[perfil('/foto.jpg'), PNG]):
            self.assertEqual(fotos_fide.obtener_foto('2256657'), (PNG, 'image/png'))
        fotos_fide._cache.clear()
        with patch('fotos_fide._descargar', return_value=perfil('data:image/jpeg;base64,' + base64.b64encode(b'<html>Error</html>').decode())):
            with self.assertRaises(fotos_fide.FotoNoDisponible):
                fotos_fide.obtener_foto('2256657')
        self.assertNotIn('2256657', fotos_fide._cache)

    def test_descarga_limitada(self):
        with patch('fotos_fide.urlopen', return_value=BytesIO(b'x' * 11)):
            with self.assertRaises(fotos_fide.FotoNoDisponible):
                fotos_fide._descargar('https://ratings.fide.com/profile/2256657', 10)


class RutaPublicaFotos(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.servidor = ThreadingHTTPServer(('127.0.0.1', 0), SinCache)
        cls.hilo = threading.Thread(target=cls.servidor.serve_forever, daemon=True)
        cls.hilo.start()
        cls.url = f'http://127.0.0.1:{cls.servidor.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.servidor.shutdown()
        cls.servidor.server_close()
        cls.hilo.join()

    def pedir(self, ruta, metodo='GET'):
        return urlopen(Request(self.url + ruta, method=metodo, headers={'Host': 'chessrival.net'}), timeout=3)

    def test_foto_disponible_en_dominio_publicado_get_y_head(self):
        with patch('fotos_fide.obtener_foto', return_value=(PNG, 'image/png')) as obtener:
            with self.pedir('/api/fide/foto?id=2256657') as r:
                self.assertEqual(r.status, 200)
                self.assertEqual(r.headers['Content-Type'], 'image/png')
                self.assertEqual(r.read(), PNG)
            with self.pedir('/api/fide/foto?id=2256657', 'HEAD') as r:
                self.assertEqual(r.status, 200)
                self.assertEqual(int(r.headers['Content-Length']), len(PNG))
                self.assertEqual(r.read(), b'')
            obtener.assert_called_with('2256657')

    def test_error_temporal_se_comunica_y_no_expone_rutas_locales(self):
        with patch('fotos_fide.obtener_foto', side_effect=fotos_fide.FotoNoDisponible('FIDE no responde', 503)):
            with self.assertRaises(HTTPError) as ex:
                self.pedir('/api/fide/foto?id=2256657')
            self.assertEqual(ex.exception.code, 503)
        with self.assertRaises(HTTPError) as ex:
            self.pedir('/local/copias/destino')
        self.assertEqual(ex.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
