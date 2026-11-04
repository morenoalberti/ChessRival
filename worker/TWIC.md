# TWIC: índice compartido del último año

La tarjeta ya consulta el Worker y reutiliza el importador y la deduplicación existentes.
El servidor guarda PGN públicos e índices por ID FIDE y nombre normalizado; no almacena
las tarjetas, análisis ni claves de los usuarios. Sus importaciones siguen en IndexedDB.

## Demostración local, sin contratar servicios

Desde la raíz del proyecto, en dos terminales:

```powershell
python servidor.py
```

```powershell
npm --prefix worker run twic:demo
```

El segundo comando crea/aplica las migraciones de TWIC y Lumbra **solo en el disco local**
y abre el Worker en el puerto 8787, el mismo del Worker habitual. No ejecutes ambos a la vez.
No contiene credenciales ni llama a la API de facturación de Cloudflare.

En otra terminal, preparar una entrega real o completar el histórico:

```powershell
npm --prefix worker run twic:cargar -- 1
npm --prefix worker run twic:cargar -- 54
```

Es reanudable: salta las entregas completas y no crea copias. La primera carga anual
puede superar los 100 MB de descarga y tardar varios minutos; las siguientes solo
necesitan las entregas pendientes. Si una ejecución se interrumpe puede quedar una
reserva de hasta 20 minutos; vuelve a ejecutar el comando después. Los errores de
descarga tienen una espera de una hora y no convierten la entrega en una lista vacía.

Vista previa aislada: <http://127.0.0.1:8765/worker/test/twic-demo.html>.
La ficha normal usa el mismo cuadro. La vista previa propone a Nakamura como jugador;
el recuento procede de la base local real, no de datos inventados. No importes en un
perfil de navegador con datos que no quieras modificar: «Importar» funciona de verdad.
La prueba local de Lumbra está descrita en [LUMBRA.md](LUMBRA.md).

Los archivos SQLite de desarrollo están en `worker/.wrangler/`, ignorado por Git.
La ruta de actualización manual solo responde en loopback y con `TWIC_LOCAL=1`.
No se debe desplegar `wrangler.twic.local.toml`.

## Activación pública pendiente

No se ha creado una base remota, cambiado de plan, programado una tarea remota ni
desplegado el índice. El Worker normal funciona sin D1: la tarjeta muestra
«TWIC está pendiente de activar en el servidor» y las otras fuentes siguen operativas.

Antes de activarlo hay que decidir el plan y aclarar el uso público/comercial de la
colección: [TWIC anuncia uso personal gratuito](https://theweekinchess.com/twic), lo que
no confirma autorización para redistribuirla desde un servicio comercial.

Pasos de configuración, **solo cuando se decida activar el servicio**:

1. Crear una D1 denominada `chessrival-twic` en la cuenta del propietario.
2. Añadir a `wrangler.toml` el binding con el UUID real, sin copiar el UUID local:

   ```toml
   [[d1_databases]]
   binding = "TWIC_DB"
   database_name = "chessrival-twic"
   database_id = "UUID_REAL_DEVUELTO_POR_CLOUDFLARE"
   migrations_dir = "migrations"

   [triggers]
   crons = ["*/15 * * * *"]

   [limits]
   cpu_ms = 30000
   ```

3. Aplicar las migraciones remotas antes de publicar: desde `worker/`,
   `npx wrangler d1 migrations apply TWIC_DB --remote`.
4. Desplegar con `npm run deploy` desde `worker/`.

El cron comprueba el archivo cada 15 minutos, pero descarga **solo una entrega
pendiente por turno**. Descubre el número y fecha reales en la tabla oficial, sin
suponer una numeración fija. Prepara primero las más recientes. La carga inicial
de unas 52 entregas requiere aproximadamente 13 horas con ese ritmo; no bloquea
las consultas de las entregas ya completas. Después se incorpora la nueva entrega
semanal. Un bloqueo de descarga puede alargar esos tiempos. El cron elimina del
índice las entregas publicadas hace más de un año, sin borrar importaciones personales.

La ventana es de **12 meses naturales de entregas publicadas**, no 12 entregas ni
una garantía de que toda partida jugada en ese periodo haya sido publicada por TWIC.
El PGN puede contener partidas antiguas incorporadas recientemente. No se infiere
un ritmo de juego ni una identidad a partir de la web de procedencia.

## Consumo y límites

- Ninguna visita descarga ni indexa el histórico. GET solo consulta D1.
- Caché pública de cinco minutos por jugador/página; se añaden las cabeceras CORS
  después de recuperar la respuesta para no mezclar orígenes.
- Máximo global de **5.000 consultas sin caché al día UTC**. Al agotarse se devuelve
  429 antes de leer el índice de partidas. La cuota no se controla desde el cliente.
- **100 partidas por página**; el formulario prepara hasta 2.000 por búsqueda y
  muestra un aviso si hay más. Solo se leen los PGN de la página devuelta.
- Descargas limitadas a 16 MB comprimidos, 48 MB descomprimidos y 30.000 partidas
  por entrega; una fuente que supere el límite muestra un error y necesita revisión.
- Actualizaciones reservadas para impedir ejecuciones solapadas y publicación solo
  tras completar todos los lotes. Una carga fallida se reintenta sin duplicar filas.
- La interfaz informa del histórico parcial, errores y comprobaciones con más de
  48 horas de antigüedad. Un fallo no se presenta como «no tiene partidas».

Estos controles **no son un tope monetario absoluto de Cloudflare**: incluso las
solicitudes rechazadas consumen recursos. Antes de publicar se deben revisar los
límites del resto de Workers de la cuenta, las alertas y las opciones de protección
de tráfico. Desactivar el cron no apaga las consultas; retirar el binding o la ruta
de TWIC detiene el acceso al índice. No hay ninguna compra automática en este código.

Pruebas: `npm --prefix worker test`. Cubren SQL real con SQLite, ventana anual,
identidad por FIDE, ambos colores, paginación, cuotas, fallos de fuente, estados
parciales y deduplicación con PGN. Requieren una versión de Node con `node:sqlite`.
