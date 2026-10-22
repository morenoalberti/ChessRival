"""Fotos FIDE desde el servidor de la web, sin depender de la salida de red de Cloudflare."""
import base64
from collections import OrderedDict
from html.parser import HTMLParser
import re
import threading
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

_cache = OrderedDict()
_lock = threading.Lock()
_MAX_IMAGEN = 1024 * 1024
_MAX_HTML = 4 * 1024 * 1024


class FotoNoDisponible(Exception):
    def __init__(self, mensaje, estado=503):
        super().__init__(mensaje)
        self.estado = estado


class _Perfil(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.foto = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'img' and 'profile-top__photo' in attrs.get('class', '').split():
            self.foto = attrs.get('src')


def _descargar(url, limite):
    peticion = Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': '*/*', 'Cache-Control': 'no-cache',
    })
    with urlopen(peticion, timeout=10) as respuesta:
        datos = respuesta.read(limite + 1)
    if len(datos) > limite:
        raise FotoNoDisponible('La respuesta de la FIDE supera el tamaño permitido.')
    return datos


def _tipo_imagen(datos):
    if datos.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if datos.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if datos[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if datos.startswith(b'RIFF') and datos[8:12] == b'WEBP':
        return 'image/webp'
    raise FotoNoDisponible('La FIDE no ha devuelto una imagen válida.')


def obtener_foto(id_fide):
    if not isinstance(id_fide, str) or not re.fullmatch(r'[1-9][0-9]{0,11}', id_fide):
        raise FotoNoDisponible('ID FIDE no válido.', 400)
    with _lock:
        guardada = _cache.get(id_fide)
        if guardada and time.monotonic() - guardada[0] < 3600:
            _cache.move_to_end(id_fide)
            return guardada[1], guardada[2]
    try:
        url = f'https://ratings.fide.com/profile/{id_fide}?_foto={time.time_ns()}'
        html = _descargar(url, _MAX_HTML).decode('utf-8-sig', errors='replace')
        if len(html.strip()) < 100:
            raise FotoNoDisponible('La FIDE no ha devuelto el perfil. Inténtalo de nuevo en un momento.')
        perfil = _Perfil()
        perfil.feed(html)
        if not perfil.foto:
            raise FotoNoDisponible('El perfil FIDE no incluye una foto.', 404)
        if perfil.foto.startswith('data:'):
            cabecera, contenido = perfil.foto.split(',', 1)
            if ';base64' not in cabecera or len(contenido) > (_MAX_IMAGEN * 4 // 3 + 4):
                raise FotoNoDisponible('La foto FIDE no tiene un formato válido.')
            datos = base64.b64decode(contenido, validate=True)
        else:
            foto_url = urljoin('https://ratings.fide.com/', perfil.foto)
            u = urlsplit(foto_url)
            if u.scheme != 'https' or u.netloc != 'ratings.fide.com':
                raise FotoNoDisponible('La foto no pertenece al servidor FIDE.')
            datos = _descargar(foto_url, _MAX_IMAGEN)
        tipo = _tipo_imagen(datos)
    except FotoNoDisponible:
        raise
    except (OSError, ValueError) as ex:
        raise FotoNoDisponible('No se pudo descargar la foto FIDE. Inténtalo de nuevo en un momento.') from ex
    # Solo se guardan imágenes válidas, nunca respuestas vacías ni fallos temporales.
    with _lock:
        _cache[id_fide] = (time.monotonic(), datos, tipo)
        _cache.move_to_end(id_fide)
        while len(_cache) > 64:
            _cache.popitem(last=False)
    return datos, tipo
