# Prueba local de Lumbra’s Gigabase

La tarjeta del importador consulta un índice local de la colección OTB de Lumbra.
La carga inicial descarga los paquetes oficiales **OTB 2025** y **OTB partial 2026**;
el indexador conserva solo partidas con fecha completa dentro de los doce meses
anteriores. Deja fuera el paquete OTB Lichess Broadcast, que se publica aparte con
CC BY-SA 4.0. Las partidas que se importan mantienen sus etiquetas de origen,
calidad, identidad y `DeduplicatorId`.

## Ejecutar la prueba

Desde la raíz del proyecto, en terminales separadas:

```powershell
python servidor.py
```

```powershell
npm --prefix worker run twic:demo
```

```powershell
npm --prefix worker run lumbra:cargar
```

La última orden comprueba la versión disponible en Lumbra, descarga los dos archivos
si aún no están guardados, descomprime en memoria con 7-Zip y carga el índice local.
El primer uso descarga unos 230 MB y procesa archivos PGN bastante mayores al
descomprimirlos. Repetir la orden es seguro: `DeduplicatorId` evita filas duplicadas.
La orden de estado es:

```powershell
npm --prefix worker run lumbra:estado
```

Vista de prueba: <http://127.0.0.1:8765/worker/test/lumbra-demo.html>. Nakamura está
cargado como ejemplo y los campos permiten probar otro jugador. La tarjeta consulta
por ID FIDE y nombre; al importar se vuelve a verificar que cada partida pertenezca
al jugador y el almacenamiento personal elimina duplicados con otras fuentes.

Los paquetes originales quedan en `.lumbra/` y la base D1 local en `worker/.wrangler/`;
ambos destinos están excluidos de Git. No se crean recursos remotos ni se programan
descargas automáticas. El Worker normal de producción no tiene el binding `LUMBRA_DB`,
por tanto la fuente aparece pendiente de activar y no consulta ni almacena datos.

## Condiciones del ensayo

La página B2B de Lumbra anuncia evaluación gratuita durante el desarrollo interno y
beta privada por hasta seis meses y 50 evaluadores que no paguen. También prohíbe las
descargas masivas y las descargas PGN sin procesar para usuarios finales; permite el
uso de datos derivados y funciones internas. Mantener esta prueba local no activa el
servicio para usuarios públicos. Antes de publicar ChessRival con esta fuente se debe
confirmar por escrito el alcance del uso y el precio comercial.

- [Condiciones B2B y evaluación](https://lumbrasgigabase.com/en/commercial-licenses-en/)
- [Descargas PGN y versiones](https://lumbrasgigabase.com/en/download-in-pgn-format-en/)
- [Procedencia y licencias de los conjuntos](https://lumbrasgigabase.com/en/sources/)
