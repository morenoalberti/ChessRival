# ChessRival

Aplicación local para preparar partidas contra un rival: fichas de jugadores y torneos, importación de PGN y MegaDatabase, aperturas, visor y análisis con Stockfish.

## Puesta en marcha en Windows

Necesita Python 3 y Node.js con npm. El Worker utiliza Wrangler; sus requisitos de Node.js se indican al instalar las dependencias.

Desde la carpeta del proyecto:

```powershell
cd worker
npm install
cd ..
```

Abre `ChessRival.vbs` para iniciar la aplicación sin ventanas de consola. `iniciar.bat` inicia la web en el puerto 8765 y el Worker en el 8787. `detener.bat` detiene los servicios.

El arranque comprueba que Python funciona y espera a que los servicios respondan antes de abrir el navegador. Si falla, muestra un aviso: el registro de la web está en `.web.log` y el del Worker en `.worker.log`.

Para ejecutar los servicios manualmente, abre dos terminales:

```powershell
python servidor.py
```

```powershell
cd worker
npm run dev
```

Después visita `http://localhost:8765/index.html`. El parámetro `?demo` crea tarjetas de demostración únicamente cuando no hay tarjetas; los recuentos de esas tarjetas son ilustrativos.

Las consultas a FIDE, Chess-Results e Info64 necesitan el Worker. Stockfish y el libro de clasificación de aperturas están incluidos en `assets/`. La MegaDatabase debe seleccionarse desde la aplicación y se lee sin modificar sus archivos. Lo mismo vale para el libro de aperturas de ChessBase (Power Book): hacen falta sus archivos `.ctg`, `.ctb` y `.cto`, que se leen por trozos (`js/libro-ctg.js`) y completan con teoría la línea recomendada del árbol cuando las partidas del rival se acaban. Con `iniciar.bat` el cuadro de Windows elige el `.ctg`; en la web publicada se elige la carpeta del libro con el selector del navegador.

«AhoraAjedrez», en la cabecera de la ficha, consulta su buscador público por nombre y abre la ficha si hay una única coincidencia exacta de nombre y federación. Si la fuente falla o la coincidencia es ambigua, abre la búsqueda por nombre. Al pulsar copia el ID FIDE (o el nombre si no hay ID); solo confirma la copia cuando el navegador la permite.

En «Importar partidas», «Archivos PGN» abre un selector de archivos .pgn (uno o varios), sin recordar ni revisar una carpeta. Las tarjetas «YottaChess» y «AhoraAjedrez» sí recuerdan su carpeta, elegida con «Cambiar» en Edge o Chrome, y muestran solo su nombre. Al abrir el cuadro se revisan sus .pgn directos (no subcarpetas), comprobando que el nombre del archivo corresponda al jugador completo y que las partidas sean suyas por ID FIDE o nombre. Así se excluyen descargas de otros jugadores que lo incluyan como rival. Ambas webs pueden compartir carpeta: se lee una vez y los archivos se reparten por sus etiquetas de origen o el sufijo _todas_N.pgn de AhoraAjedrez. Las copias «(1)», «(2)», etc. con el mismo nombre base y contenido idéntico (SHA-256) se muestran y cuentan una sola vez, prefiriendo el original. Si cambia el contenido, se conservan ambas versiones. La MegaDatabase conectada también se busca automáticamente al abrir, mostrando el total encontrado y las partidas preparadas (hasta las 300 más recientes). La búsqueda es de solo lectura y se cancela al cerrar; sus resultados se reutilizan al pulsar «Importar», sin volver a recorrer la base. Si hace falta renovar el acceso del navegador, «Permitir» inicia la búsqueda tras autorizarlo; un error permite «Reintentar». Las partidas solo se guardan al pulsar «Importar». Se comprueban todos los PGN, MegaDatabase y las partidas ya guardadas: las repetidas identificables se unen conservando fuentes, análisis y anotaciones. Las carpetas recordadas pertenecen a este navegador y no se incluyen en copias portátiles. Se admiten PGN de AhoraAjedrez sin Event, con corchetes escapados y con iniciales de nombres adicionales cuando coinciden apellidos y primer nombre completo.

El visor se abre desde la ficha en una ventana de 1160 × 917 píxeles, centrada horizontalmente y alineada con el borde inferior del área útil del monitor. Se reduce si no cabe en la pantalla y se puede mover o redimensionar después. El navegador debe permitir las ventanas emergentes de ChessRival.

## Estudio del jugador

La ficha estudia siempre todas las partidas importadas del jugador. Las fechas futuras se excluyen y las incompletas no entran en los periodos recientes. Los datos FIDE de la parte superior son globales; no dependen de las partidas importadas.

El jugador estudiado se identifica por su ID FIDE (o, si no lo tiene, por su nombre), de modo que sus partidas se comparten entre todas sus tarjetas.

«Calidad de la muestra» reconstruye las jugadas legales y señala PGN ilegibles, resultados incompatibles con mate/ahogado/material insuficiente e IDs FIDE que contradicen al jugador. Identifica duplicados por fecha completa, jugadores, posición inicial, resultado y secuencia de jugadas, aunque cambie el evento. Se conserva el registro original y todos los archivos, análisis y anotaciones: las incidencias y duplicados existentes se excluyen del estudio sin borrarlos y se pueden consultar con «Revisar partidas». Al importar un duplicado se unen las fuentes sin sustituir las anotaciones. Sin fecha completa no se presume que dos secuencias idénticas sean el mismo encuentro.

El nivel de fiabilidad cuenta partidas independientes: menos de 5, muy baja; 5–14, baja; 15–29, media; desde 30, alta. Es un indicador descriptivo, no una probabilidad de acierto. La comparación entre colores exige 5 partidas y 30 jugadas por color; las fases requieren también 5 partidas. La conversión exige una ventaja mantenida en dos decisiones próximas.

Los nuevos análisis vuelven a evaluar errores críticos y pérdidas de ventaja a profundidad base +4 (máximo 28), registran si se han confirmado y evalúan la posición tras 12 jugadas completas. En este modo también se evalúan las jugadas de libro. Los análisis anteriores se conservan; «Actualizar análisis anteriores para el estudio» permite incorporar las comprobaciones a la muestra elegida. Cancelar conserva los trabajos terminados y el progreso no depende de volver a analizar toda la base.

«Informe» incluye resultados con peso temporal (semivida de un año), comparación de resultados y expectativas usando exactamente las partidas con ambos ELO históricos, salida de apertura frente a resultado, patrones observables con pruebas y cambios de repertorio (últimos 12 meses frente a los 24 anteriores; mínimo 5 decisiones en cada periodo de la misma posición). La expectativa usa la aproximación logística de escala 400, no las tablas oficiales ni el ELO actual como sustituto de datos ausentes. «Guardar informe» exporta texto con filtros, límites y referencias.

En «Preparación», se recorren las jugadas hasta la última posición identificada en el libro y se muestran el nombre completo de la apertura o variante, su ECO y la secuencia con figuritas. No se asigna una defensa concreta solo por 1.d4 Cf6. Si no hay una posición reconocida suficientemente avanzada, se muestra «Apertura aún sin identificar» con su secuencia real. «Ver línea» y «Preparar» abren el tablero en la posición que termina la secuencia mostrada.

En «¿Qué debemos jugar?», «Ver sus partidas en esta línea» abre «Partidas» con la muestra exacta que sustenta los resultados de esa recomendación. Un aviso identifica el filtro activo y permite volver a la recomendación o ver todas las partidas. Ordenar la tabla y cambiar el color conservan el filtro de línea; abrir otra recomendación lo sustituye.

Los resultados incluyen todas las partidas de la muestra que alcanzan esa posición, también por transposición o continuando hacia una variante posterior. La frecuencia indica cuántas de sus partidas con ese color alcanzan la línea, dentro de la muestra. Una línea general y una variante pueden compartir partidas; sus frecuencias no tienen que sumar el 100 %. La frecuencia es distinta de la puntuación obtenida en las partidas.

Cada línea destaca cuántas partidas gana el jugador estudiado y su porcentaje de victorias, junto con las tablas y derrotas. Se cuentan únicamente las partidas terminadas de esa línea y desde el color del jugador estudiado. Las tablas no cuentan como victoria; en la «puntuación» sí aportan medio punto.

Las líneas y los puntos débiles indican explícitamente quién lleva blancas y quién negras, con el nombre y título del jugador estudiado. Las referencias del informe y de los ejercicios también conservan el color de ambos lados. Una primera jugada de blancas no se atribuye al jugador cuando este juega con negras.

En los ejercicios se juega moviendo las piezas del tablero: arrastrándolas o pulsando origen y destino. Un peón que llega a la última fila corona en dama, salvo que la solución sea otra pieza.

«Preparación» agrupa posiciones iguales y sus órdenes de llegada, distingue el color del usuario y el del jugador y exige 5 partidas para sugerir posiciones a revisar. Las propuestas son condicionales a alcanzar esas posiciones; un porcentaje bajo no demuestra una debilidad causal. Cuando hay 5 partidas con ambos ELO, se contrasta con esa expectativa. Los patrones identifican errores en fases, capturas, movimientos de peón, jaques, finales de torres y ventajas; se indican como repetidos desde 3 partidas, con muestras y posiciones concretas.

«Entrenar» genera un ejercicio por cada error grave confirmado (más de 1,5 puntos, comprobado a mayor profundidad) de las partidas analizadas, preferentemente desde el bando rival para aprovechar el error; el título indica el número exacto. Cada ejercicio es una variante completa: si la jugada es la propuesta de Stockfish (o una alternativa equivalente, con tolerancia de 0,30 peones, o con mate forzado), Stockfish responde con la jugada del rival y el jugador debe seguir hasta terminar la variante; entonces aparece «Variante correcta», con las jugadas y la valoración de la posición final desde las blancas. Si falla, se muestra «No es la solución» un segundo y la jugada se deshace, sin revelar la solución. «Pista» marca la pieza que hay que mover, «Siguiente ejercicio» pasa al siguiente y un reloj cuenta el tiempo. Los intentos y la resolución se guardan en los ajustes locales y la flecha circular de la tarjeta reinicia todos los ejercicios. Un fallo del motor no cuenta como intento; el motor se libera al cerrar el ejercicio. La IA recibe, al enviar una pregunta, el informe con evidencias y la instrucción de citarlas; solo se convierten en accesos las referencias a partidas presentes en la muestra.

La clasificación desde `TimeControl` interpreta segundos y 60 incrementos según los [apéndices A y B de las Leyes FIDE](https://handbook.fide.com/chapter/e012023). Un control por periodos corto que no permite deducir el ritmo queda como desconocido; si no hay control utilizable, se intenta inferirlo por evento y lugar.

Pruebas del estudio: `npm --prefix worker test` (motor simulado e IndexedDB en memoria). Pruebas de destino de copias: `python -m unittest test_copias_local.py`.

## Idiomas

Las banderas de la barra superior cambian el idioma (español o inglés) al instante, sin recargar, y la elección se recuerda. El texto de la aplicación está escrito en español y `js/i18n.js` lo traduce al mostrarlo con los diccionarios `js/i18n-en-*.js` (frases exactas y plantillas con huecos `{}`). Las frases que se componen por trozos (preparación, conclusiones del visor) llaman a `t()` al construirse. Para encontrar textos sin traducir, ejecuta `textosSinTraducir()` en la consola del navegador con el inglés activado.

## Datos y borrado

Las fotos se consultan primero en `/api/fide/foto` del servidor Python de la web (Render o equipo local) y, si falla, en el Worker. Así la descarga FIDE no depende exclusivamente de Cloudflare. Solo se guardan imágenes válidas: una respuesta vacía no se conserva como ausencia permanente de foto. Al publicar cambios en esta ruta hay que usar `python servidor.py` como comando de inicio de Render.

`assets/fotos-fide/` contiene copias FIDE verificadas de Diego Borrego Gil, Sergio Cardoso García y Francisco Miguel Terrón Elena, identificadas por su ID y con su procedencia en `fuentes.json`. El servidor entrega estas imágenes sin consultar la red. Este respaldo cubre esos tres jugadores; los demás siguen utilizando las fuentes externas. Si una descarga falla en Render, el registro del servidor identifica el ID y la causa de conexión para distinguirla de un perfil sin foto.

El ojo de las tarjetas con ID FIDE abre una ficha con foto, datos del perfil, evolución del ELO antes de las estadísticas, resultados por color y ritmo y rankings; se cierra al pulsar fuera de ella. La gráfica de Standard, Rapid y Blitz permite consultar el ELO de cada mes con el ratón. El contenido se puede desplazar sin cerrar la ficha. Las tarjetas sin ID FIDE no tienen ojo. Utiliza el Worker para consultar FIDE y conserva las respuestas durante 15 minutos para evitar consultas repetidas. Las estadísticas y el historial se cargan de forma independiente; si no hay historial o falla su consulta, se indica en la gráfica sin ocultar los resultados.

Los datos se guardan en IndexedDB, en el navegador y origen utilizados. `localhost` y `127.0.0.1`, distintos puertos o distintos perfiles de navegador tienen bases de datos independientes.

- Quitar una tarjeta afecta solo a esa tarjeta. Si el jugador sigue en otra pestaña, conserva todas sus partidas, análisis y anotaciones.
- Al quitar su última tarjeta se borran también esos datos compartidos.
- Cerrar un torneo sigue la misma regla para cada jugador.
- La acción «Borrar partidas» de la ficha borra las partidas del jugador en todas sus tarjetas.

Las claves de IA se guardan en los ajustes del navegador. No deben incluirse en archivos compartidos. La configuración local de MegaDatabase (`.mega.json`) y los registros están excluidos por `.gitignore`.

## Barra superior, ayuda y copias

La pantalla principal, las fichas y el visor incluyen los accesos a copias de seguridad y ayuda. F1 abre el manual, con índice y búsqueda.

«Crear y descargar» exporta un archivo JSON con torneos, tarjetas, partidas, análisis, variantes, comentarios y preferencias. La pantalla muestra sus recuentos y conserva un historial en una base independiente (`chessrival-copias`). Las claves de IA, los permisos a archivos y los archivos de MegaDatabase quedan fuera de la copia.

La flecha hacia arriba de una copia reciente carga su nombre en «Archivo de copia». También puedes pulsar ese campo para elegir un archivo del disco. Tras comprobarlo, «Restaurar copia» queda disponible y solicita confirmación.

El icono de carpeta selecciona el destino predeterminado para guardar los archivos de copia. En local se utiliza el selector de Windows y «Carpeta:» muestra la ruta completa en gris; el servidor la recuerda en `.copias-destino.json`. Solo permite guardar copias JSON en esa carpeta y conserva los archivos existentes. Tras actualizar desde el selector del navegador, reinicia ChessRival y vuelve a elegir la carpeta una vez para obtener su ruta completa. En la web publicada se mantiene el selector de Edge o Chrome, que solo facilita el nombre y puede pedir renovar el permiso. Sin carpeta elegida, se utilizan las descargas del navegador. Con carpeta elegida, «Crear y guardar» y la flecha hacia abajo de una copia reciente escriben allí directamente. La restauración y las copias automáticas del historial no generan descargas ni archivos adicionales en esa carpeta.

Antes de restaurar se comprueban el formato, la huella SHA-256 y las relaciones entre registros. Se puede revisar el contenido y cancelar. La restauración guarda primero una copia preventiva en «Copias recientes» y sustituye los datos en una única transacción; conserva las claves y los permisos locales. No se inicia ninguna descarga durante la restauración: la copia preventiva puede descargarse después desde el historial. Si otra ventana cambió los datos mientras se preparaba la copia preventiva, la restauración se cancela sin sustituirlos. Las otras ventanas de la web se recargan, y una comprobación de revisión impide que una ventana antigua escriba sobre datos restaurados.

Las copias automáticas son opcionales: se comprueban durante el uso y se guardan cada cinco minutos si los datos cambian, conservando las 15 últimas. No se depende del cierre de la pestaña. Las manuales y preventivas se conservan en el historial.

El historial pertenece a este navegador y origen; borrarlo también borra las copias internas. Descarga los archivos que quieras conservar fuera del navegador. Las copias JSON de la web no son compatibles con los ZIP de la base SQLite de escritorio.

## Pruebas

```powershell
cd worker
npm test
```

Las pruebas no consultan servicios externos ni modifican los datos del navegador. Usan una base IndexedDB en memoria (`fake-indexeddb`) y un motor simulado para comprobar los casos de evaluación.

Cubren mate y tablas con ambos colores, PGN truncado, muestras insuficientes para comparar colores, conservación de datos entre torneos, limpieza al quitar la última tarjeta, transacciones atómicas, versiones del análisis y estados HTTP de la API.

La versión 2 del cálculo de análisis distingue mate de tablas. Los análisis de la versión anterior se conservan en la base, pero quedan pendientes de recalcular con «Analizar» y no se utilizan en estadísticas ni en el resumen de IA.

## Publicación

`js/config.js` usa el Worker local en `localhost` y `127.0.0.1`. Para otro alojamiento hay que configurar la URL del Worker desplegado y ajustar `ORIGENES_PERMITIDOS` en `worker/wrangler.toml` al origen de la web. La selección local de MegaDatabase mediante `servidor.py` es específica de la ejecución local.
