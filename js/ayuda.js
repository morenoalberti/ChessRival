import { abrirPanel } from './panel-utilidad.js';
import { svg } from './iconos.js';
import { t as tr, IDIOMA } from './i18n.js';

const p = texto => ({ tipo: 'parrafo', texto });
const h = texto => ({ tipo: 'subtitulo', texto });
const lista = (...items) => ({ tipo: 'lista', items });
const pasos = (...items) => ({ tipo: 'pasos', items });
const nota = texto => ({ tipo: 'nota', texto });

// Manual de escritorio adaptado a la web: conserva la jerarquía de apartados, pasos y notas.
export const SECCIONES = [
  ['inicio', 'Primeros pasos', 'Empezar', [
    p('Reúne las partidas de un rival, estúdialas con Stockfish y prepara qué jugarle con blancas y con negras.'),
    h('Tu primera preparación'),
    pasos('Pega una URL de Chess-Results o Info64 y pulsa «Cargar». También puedes escribir un nombre o ID FIDE y pulsar «Añadir».',
      'Abre la ficha del jugador con doble clic en su tarjeta.',
      'Pulsa «Importar partidas» y elige sus archivos PGN o busca en la MegaDatabase conectada.',
      'Pulsa «Analizar» y consulta sus aperturas, debilidades y preparación.'),
    nota('Pulsa F1 en cualquier pantalla para abrir la ayuda del lugar en el que estás trabajando.')
  ]],
  ['principal', 'Pantalla principal y torneos', 'Empezar', [
    p('Aquí se reúnen las tarjetas de tus jugadores. Desde esta pantalla puedes cargar torneos, añadir rivales y conectar la MegaDatabase.'),
    h('Cabecera y accesos'),
    lista('Caja de búsqueda: admite la URL de un torneo, el nombre de un jugador o su ID FIDE.',
      '«Cargar» trae un torneo; «Añadir» busca un jugador en la FIDE.',
      'Los avisos de la MegaDatabase y del libro de aperturas se conectan con «Elegir»: ChessRival solo lee esos archivos, nunca los modifica. El libro es el Power Book de ChessBase u otro libro .ctg (necesita los tres archivos .ctg, .ctb y .cto).',
      'Arriba a la derecha, las banderas cambian el idioma de ChessRival (español o inglés) al instante; a su derecha, los iconos abren las copias de seguridad y esta ayuda.'),
    h('Organizar las tarjetas'),
    lista('«Todos» reúne todas las tarjetas. «Jugadores» contiene los jugadores sueltos.',
      'Puedes abrir hasta seis torneos y elegir cuántos jugadores cargar con el deslizador superior.',
      'Arrastra las tarjetas para ordenarlas o llevarlas a otra pestaña. Arrastra las pestañas de torneo para cambiar su orden.',
      'Pulsa el ojo de la tarjeta (arriba a la derecha, bajo la zona azul) para consultar su ficha FIDE, evolución del ELO, estadísticas y rankings. La gráfica muestra Standard, Rapid y Blitz; pasa el ratón sobre ella para consultar cada mes. Puedes desplazarte dentro de la ficha; se oculta al pulsar fuera de ella. Si no tiene ID FIDE, no aparece.'),
    nota('Quitar una tarjeta conserva las partidas y anotaciones del jugador mientras tenga otra tarjeta. Al quitar la última, sus datos se borran previa confirmación.')
  ]],
  ['ficha', 'Ficha del jugador', 'Empezar', [
    p('La ficha reúne sus datos FIDE, la evolución del ELO y todas las herramientas para estudiar su juego.'),
    h('Qué encontrarás'),
    lista('«Resumen»: resultados, tendencias y debilidades principales.',
      '«Partidas»: la lista de todos sus encuentros. «Borrar partidas» las quita todas.',
      '«Aperturas»: qué abre y cómo le va. «Árbol»: las jugadas que elige en cada posición.',
      '«Debilidades»: sus puntos flacos según Stockfish. «Preparación»: qué jugarle con blancas y con negras.',
      '«Informe»: fiabilidad de la muestra, rivales y patrones. «Entrenar»: ejercicios con sus errores.',
      '«IA»: preguntas al asistente sobre el resumen del jugador.'),
    p('Cada pestaña tiene su apartado en este manual: Resumen, Lista de partidas, Árbol de aperturas, Análisis y debilidades, Aperturas y preparación, Informe y Entrenamiento con ejercicios.'),
    h('Calidad e informe'),
    p('«Calidad de la muestra» cuenta las partidas válidas, duplicadas y dudosas. «Revisar partidas» muestra las incidencias conservando todos los originales. En «Informe» puedes consultar la fiabilidad, el ajuste por rivales, los patrones con pruebas y guardar un informe de texto.'),
    nota('La fiabilidad es un nivel descriptivo según las partidas independientes. Con pocas partidas, interpreta los resultados como pistas y compruébalos en el visor.')
  ]],
  ['resumen', 'Resumen del jugador', 'Estudiar al rival', [
    p('La pestaña «Resumen» reúne en una sola pantalla lo más importante de sus partidas.'),
    h('Las cifras'),
    lista('«Partidas»: cuántas partidas tiene guardadas.',
      '«Con blancas» y «Con negras»: su puntuación con cada color (victoria 1 punto, tablas ½, derrota 0).',
      '«Pérdida media»: los puntos que pierde de media por jugada respecto a la mejor opción de Stockfish. Aparece cuando hay partidas analizadas.'),
    h('Debilidades y aperturas'),
    lista('«Debilidades principales» enseña las tres más graves; la lista completa está en la pestaña «Debilidades».',
      '«Aperturas» muestra las que más juega con blancas o con negras (usa los botones «Blancas» y «Negras»), con su número de partidas y su puntuación. «Otras» suma las que menos juega.'),
    nota('Si todavía no hay análisis, pulsa «Analizar» en la cabecera de la ficha para que Stockfish revise sus partidas.')
  ]],
  ['informe', 'Informe del estudio', 'Estudiar al rival', [
    p('La pestaña «Informe» resume cuánto se puede fiar uno de lo que dicen las partidas y qué patrones aparecen.'),
    h('Qué contiene'),
    lista('«Calidad de la muestra»: partidas válidas, duplicadas y dudosas. «Revisar partidas» muestra las incidencias sin borrar los originales.',
      '«Cobertura y fiabilidad»: cuántas partidas hay con cada color y el nivel de fiabilidad (muy baja, baja, media o alta).',
      '«Resultados y actualidad»: su puntuación, dando más peso a lo reciente.',
      '«Fuerza de los rivales»: compara el resultado real con el esperado según los ELO.',
      '«Apertura y resultado final», «Patrones con ejemplos» y «Cambios de repertorio»: dónde empezaron los problemas, qué errores se repiten y cómo ha cambiado lo que juega.'),
    p('«Guardar informe» descarga un archivo de texto con todo el informe.'),
    nota('Con pocas partidas, interpreta los resultados como pistas y compruébalos en el visor.')
  ]],
  ['importar', 'Importar partidas y MegaDatabase', 'Estudiar al rival', [
    p('Añade las partidas del jugador desde archivos PGN o desde tu MegaDatabase de ChessBase.'),
    h('Importar paso a paso'),
    pasos('Conecta la MegaDatabase con «Elegir» en la pantalla principal, si quieres utilizarla.',
      'Abre la ficha y pulsa «Importar partidas». Elige o arrastra los archivos PGN, o utiliza la base conectada.',
      'Si aún no tienes un PGN con sus partidas, pulsa «YottaChess o PGN»: copia el ID FIDE del jugador y abre YottaChess, donde puedes descargarlas. Vuelve a ChessRival, pulsa «Importar partidas» y elige ese archivo. Sirve cualquier PGN: de YottaChess, ChessBase, Lichess…'),
    nota('Las partidas repetidas no se duplican y se conservan sus distintas fuentes. La MegaDatabase se lee sin modificar sus archivos.'),
    h('Herramientas incluidas'),
    p('Stockfish y la clasificación de aperturas vienen incluidos. Las consultas a FIDE y a los torneos utilizan el servicio local que inicia el BAT.')
  ]],
  ['partidas', 'Lista de partidas', 'Estudiar al rival', [
    p('La pestaña «Partidas» muestra todos los encuentros guardados del jugador y los abre en el visor.'),
    h('Leer la lista'),
    lista('Cada fila muestra la fecha, el rival con su ELO, el color, el resultado, el evento y la apertura.',
      'Pulsa el título de una columna para ordenar por ella; pulsa otra vez para invertir el orden.',
      'Pasa el ratón por una fila para ver una vista previa de la partida junto a la lista.'),
    h('Abrir una partida'),
    p('Haz doble clic en una fila para abrirla en el visor, donde puedes seguir las jugadas y consultar las variantes del motor.'),
    h('Borrar partidas'),
    p('El botón «Borrar partidas» quita todas las partidas importadas del jugador, con sus análisis, previa confirmación. Solo está activo mientras ves la lista.'),
    nota('Las partidas se comparten entre todas las tarjetas del jugador. «Borrar partidas» en su ficha afecta a todas ellas.')
  ]],
  ['arbol', 'Árbol de aperturas', 'Estudiar al rival', [
    p('El árbol muestra, posición a posición, qué juega el rival y cómo le va con cada jugada.'),
    h('Moverte por el árbol'),
    lista('Elige «Blancas» o «Negras» para ver su árbol con ese color.',
      'Cada fila es una jugada posible: cuántas partidas la han jugado, cuántas ganó, empató y perdió, la evaluación de Stockfish («Motor») y los puntos que saca.',
      'Pulsa una jugada para avanzar. La barra de arriba muestra el camino recorrido: pulsa una jugada anterior (o «Inicio») para volver, o usa «Atrás».',
      'Con «Ocultar las de una sola partida» quedan solo las jugadas que se repiten.',
      '«Ver partidas» lista las partidas que pasan por la posición actual; haz clic en una para abrirla en el visor.'),
    h('La línea que te conviene jugarle'),
    p('«Buscar la línea» usa Stockfish para proponer, a partir de la posición actual, una línea con tus mejores jugadas frente a sus respuestas más habituales. Tus jugadas salen en azul y las de él en gris. «Ir a la línea» coloca el árbol al final de esa línea.'),
    p('Cuando sus partidas se acaban, la línea sigue con la teoría del libro de aperturas que hayas elegido en la pantalla principal (por ejemplo el PowerBook de ChessBase): sus jugadas salen en cursiva. Si el libro no tiene la posición, sigue con Stockfish (subrayado).'),
    nota('Una línea con pocas partidas puede deberse a la casualidad: el propio árbol avisa de cuál es la parte menos fiable.')
  ]],
  ['analizar', 'Análisis y debilidades', 'Estudiar al rival', [
    p('Stockfish revisa las partidas y mide lo que pierde el jugador en cada jugada frente a la mejor opción del motor.'),
    h('Iniciar el análisis'),
    pasos('Pulsa «Analizar» en la ficha del jugador.', 'Elige cuántas partidas analizar y la profundidad, y comienza. «Actualizar análisis anteriores para el estudio» incorpora las nuevas comprobaciones a las partidas que ya estaban analizadas. Puedes cancelar; los análisis terminados se conservan.'),
    p('Cuantas más partidas analices, más ejercicios de entrenamiento se podrán generar: de cada partida pueden salir varios, uno por cada error grave confirmado.'),
    p('Los errores críticos se vuelven a calcular con 4 niveles más de profundidad, hasta 28. También se evalúa la posición tras 12 jugadas completas para separar la salida de apertura del resultado final. Por eso puede tardar más que la estimación.'),
    h('La pestaña «Debilidades»'),
    p('Muestra cada debilidad detectada con una explicación y una barra de gravedad de 0 a 100: cuanto más larga, peor. «Alta» (rojo), «Media» (naranja) o «Baja» (azul) es lo mismo dicho con palabras.'),
    h('Interpretar las debilidades'),
    lista('La pérdida por jugada ayuda a comparar la calidad de su juego.',
      'Los errores graves y las ventajas que no convirtió señalan posiciones que conviene revisar.',
      'Un punto de evaluación equivale aproximadamente a un peón.'),
    nota('La comparación entre blancas y negras requiere al menos 5 partidas independientes y 30 jugadas medidas con cada color. Un episodio aislado no se presenta como una diferencia entre colores.')
  ]],
  ['preparacion', 'Aperturas y preparación', 'Estudiar al rival', [
    p('Descubre qué líneas repite el rival y revisa cómo le funcionan antes de elegir tu preparación.'),
    h('Aperturas que juega'),
    p('«Aperturas» agrupa sus líneas con cada color y sus resultados. Explora las respuestas y abre partidas concretas para comprobarlas.'),
    h('Qué jugarle'),
    p('«Preparación» distingue tu color del suyo. Sigue las jugadas hasta identificar la apertura y su variante, y muestra el nombre, el ECO y la línea con figuritas. Cuenta sus victorias, tablas y derrotas en todas las partidas que alcanzan esa posición, también por otro orden de jugadas. La frecuencia se calcula sobre sus partidas con ese color. Una variante puede estar incluida en una línea más general. Para sugerir una revisión exige al menos 5 partidas. Cuando dispone de ambos ELO históricos, contrasta el resultado con un modelo ELO aproximado.'),
    h('Pruebas y entrenamiento'),
    p('Los botones de posición del informe y «Preparar» abren la partida en la posición concreta. «Entrenar» reúne los errores confirmados del rival en ejercicios (consulta el apartado «Entrenamiento con ejercicios»).'),
    nota('Los resultados históricos y el ajuste ELO orientativo no garantizan una ventaja ni calculan el ELO oficial.')
  ]],
  ['entrenar', 'Entrenamiento con ejercicios', 'Estudiar al rival', [
    p('La pestaña «Entrenar» convierte los errores graves confirmados del rival en ejercicios: tienes que encontrar la jugada que los aprovecha o la que mejora su partida.'),
    h('Cuántos ejercicios hay'),
    p('El título indica el número exacto de ejercicios, por ejemplo «Entrenamiento con sus partidas - 12 ejercicios». Salen solo de las partidas ya analizadas: cuantas más partidas analices con «Analizar», más ejercicios se generan, y de cada partida pueden salir varios.'),
    h('Resolver un ejercicio'),
    pasos('Pulsa «Resolver» en la fila que quieras. Arriba se indica qué bando juega y gana, con el ELO de cada jugador.',
      'Haz la jugada moviendo la pieza en el tablero. Si es correcta, Stockfish responde con la jugada del rival y espera la tuya, y así hasta terminar la variante.',
      'Al terminarla aparece «Variante correcta», con las jugadas hechas y la valoración de Stockfish de la posición final. El botón de la lista cambia a «Resuelto».'),
    lista('«Pista» marca en el tablero la pieza que debes mover, sin hacer la jugada.',
      '«Siguiente ejercicio» abre el siguiente de la lista.',
      'El reloj de la esquina cuenta los segundos hasta que lo resuelves.',
      'Si te equivocas aparece «No es la solución» en rojo, la jugada se deshace y puedes intentarlo otra vez. Cada fallo cuenta como intento.'),
    h('Empezar de nuevo'),
    p('La flecha circular azul de la esquina de la tarjeta pone todos los ejercicios otra vez en «Resolver» y borra los intentos, previa confirmación.'),
    nota('Las valoraciones de Stockfish se dan siempre desde las blancas: un valor positivo las favorece.')
  ]],
  ['visor', 'Visor y controles', 'Herramientas', [
    p('Sigue la partida, explora sus posiciones y consulta el análisis sin perder la jugada seleccionada.'),
    h('Moverte por la partida'),
    lista('Los botones bajo el tablero llevan al inicio, retroceden, reproducen o pausan, avanzan, llevan al final y giran el tablero.',
      'Pulsa una jugada de la planilla para ir directamente a esa posición.'),
    h('Atajos de teclado'),
    lista('Flechas izquierda y derecha: jugada anterior y siguiente.',
      'Inicio y Fin: primera y última posición.', 'Espacio: reproducir o pausar. F: girar el tablero.'),
    nota('Los atajos respetan la escritura de comentarios. Si el visor no se abre, permite las ventanas emergentes de ChessRival.')
  ]],
  ['variantes', 'Variantes, comentarios y figuritas', 'Herramientas', [
    p('Explora alternativas y deja anotadas las ideas que quieras recordar.'),
    h('Añadir una variante o comentario'),
    pasos('Explora jugadas en el tablero y utiliza el menú de la planilla para anotar variantes.',
      'Desde el menú de una jugada puedes añadir texto, símbolos y diagramas.',
      'En el cuadro de comentarios, pulsa una de las seis figuritas para insertarla donde esté el cursor.'),
    h('Color y organización'),
    p('El color elegido se aplica al comentario y a sus figuritas. Puedes plegar y desplegar las variantes con su signo lateral.'),
    nota('Las ediciones y anotaciones se guardan automáticamente.')
  ]],
  ['motor', 'Motor y conclusiones', 'Herramientas', [
    p('El módulo muestra cinco variantes de Stockfish desde la posición seleccionada.'),
    h('Cómo leer la valoración'),
    lista('La evaluación se expresa desde las blancas: un valor positivo las favorece y uno negativo favorece a las negras.',
      'Un punto equivale aproximadamente a un peón. Los símbolos indican si la posición está igualada o si un bando tiene ventaja.'),
    h('Ver las variantes en el tablero'),
    p('Pasa el ratón por una jugada de una variante para ver su posición. Al retirar el cursor se recupera la posición de la partida.'),
    h('Revisar la partida completa'),
    p('«Analizar partida» revisa la partida del visor. «Conclusiones» muestra lo más relevante e inicia el análisis si todavía no está disponible.')
  ]],
  ['ia', 'Preguntar al asistente', 'Herramientas', [
    p('Consulta al asistente sobre el resumen del jugador y utiliza las respuestas como apoyo a tu preparación.'),
    h('Configurar y preguntar'),
    pasos('En la pestaña «IA», elige tu proveedor y modelo y configura tu clave.',
      'Escribe una pregunta sobre el jugador y revisa la respuesta junto a sus datos y partidas.'),
    p('El asistente recibe el informe de la muestra filtrada con sus referencias. Se le exige citar las partidas y distinguir las observaciones sin confirmar. Las referencias válidas pueden abrirse en el visor.'),
    nota('Las preguntas, el resumen y el informe se envían al proveedor elegido cuando pulsas Enviar. La clave se guarda en este navegador y no se incluye en las copias de seguridad.')
  ]],
  ['copias', 'Copias de seguridad', 'Herramientas', [
    p('Protege tus torneos, jugadores, partidas, análisis, variantes y anotaciones.'),
    h('Guardar una copia'),
    p('El icono de carpeta elige el destino predeterminado. En la versión local, «Carpeta:» muestra debajo la ruta completa en gris y se recuerda al volver a abrir ChessRival. Si no has elegido una carpeta, se utilizan las descargas del navegador. Pulsa «Crear y guardar» para guardar una copia JSON en la carpeta elegida, o «Crear y descargar» si usas las descargas.'),
    h('Restaurar con revisión previa'),
    pasos('Pulsa la flecha hacia arriba de una copia reciente o pulsa el campo «Archivo de copia» para elegir un archivo guardado. Su nombre aparecerá en ese campo.',
      'Comprueba la fecha y el contenido antes de pulsar «Restaurar copia».',
      'La aplicación guarda primero una copia preventiva en «Copias recientes» y después sustituye los datos. Las ventanas abiertas se recargan.'),
    h('Copias automáticas'),
    p('Se guardan cada cinco minutos si hay cambios mientras la web está abierta. Se conservan las 15 automáticas más recientes; las manuales y preventivas se conservan.'),
    h('Borrar una copia'),
    p('Pulsa la papelera roja de una copia reciente y confirma el borrado. Se elimina del historial; tus datos actuales y los archivos que hayas descargado se conservan.'),
    nota('El historial pertenece al navegador. Descarga los archivos que quieras conservar fuera de él. Las copias no incluyen claves de IA ni la MegaDatabase, y no son compatibles con los ZIP de escritorio.')
  ]],
  ['licencias', 'Licencias y créditos', 'Herramientas', [
    p('ChessRival es de código abierto y usa software de terceros con sus propias licencias.'),
    h('Stockfish'),
    p('El motor es Stockfish 19 (versión «lite» de un solo hilo) compilado a WebAssembly por stockfish.js, bajo licencia GNU GPL versión 3. Su código fuente está en [stockfish.js](https://github.com/nmrugg/stockfish.js) y en [Stockfish](https://github.com/official-stockfish/Stockfish). El texto de la licencia está en [este archivo](https://chessrival.net/assets/motor/LICENCIA-Stockfish-GPL3.txt).'),
    h('Datos y fotos de los jugadores'),
    p('Los datos de cada jugador (título, edad, Elo y su evolución) vienen de la FIDE y, cuando la FIDE no responde, de [Lichess](https://lichess.org/fide). Las fotos, de la FIDE, de Lichess o de [Wikimedia Commons](https://commons.wikimedia.org), cada una con la licencia que indique su autor.'),
    h('Código de ChessRival'),
    p('El código de ChessRival está publicado en [GitHub](https://github.com/morenoalberti/ChessRival).'),
    h('Otros componentes'),
    lista('Reglas del ajedrez: [chess.js](https://github.com/jhlywa/chess.js), licencia BSD.',
      'Nombres de aperturas: [chess-openings](https://github.com/lichess-org/chess-openings) de Lichess, dominio público (CC0).',
      'Banderas de los países: [Flagcdn](https://flagcdn.com).',
      'Las imágenes de las piezas llevan su licencia en el archivo LICENSE.txt de la carpeta de piezas.'),
    nota('MegaDatabase, PowerBook y ChessBase son marcas y productos de ChessBase GmbH. ChessRival solo lee los archivos que tú tienes y no los incluye ni los distribuye.')
  ]],
  ['datos', 'Dónde se guardan los datos', 'Herramientas', [
    p('Tus datos se guardan en el navegador y en la dirección desde la que abres la web.'),
    h('Usa siempre la misma dirección'),
    p('localhost y 127.0.0.1, distintos puertos o perfiles de navegador tienen datos independientes. Para trasladarlos, crea una copia y restáurala en el otro navegador o equipo.'),
    h('Si la web no abre'),
    pasos('Reinicia ChessRival',
      'Después de una actualización, utiliza Ctrl+F5 para recargar los archivos de la web.'),
    nota('Antes de borrar los datos del navegador, descarga una copia de seguridad.')
  ]]
];
const normalizar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function ponerTexto(elemento, texto) {
  // Los nombres de controles escritos entre comillas se destacan y [texto](https://…) es un enlace; el resto es texto.
  for (const [i, parte] of texto.split(/«([^»]+)»/g).entries()) {
    if (i % 2) { const fuerte = document.createElement('strong'); fuerte.textContent = parte; elemento.append(fuerte); continue; }
    for (const [j, trozo] of parte.split(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g).entries()) {
      if (j % 3 === 0) elemento.append(document.createTextNode(trozo));
      else if (j % 3 === 1) { const a = document.createElement('a'); a.textContent = trozo; a.target = '_blank'; a.rel = 'noopener noreferrer'; elemento.append(a); }
      else elemento.lastChild.href = trozo;
    }
  }
}

/** Las secciones en el idioma activo (el buscador trabaja con el texto traducido). */
const traducidas = () => SECCIONES.map(([k, titulo, grupo, bloques]) => [k, tr(titulo), tr(grupo), bloques.map(b => (
  b.items ? { ...b, items: b.items.map(tr) } : { ...b, texto: tr(b.texto) }))]);

export function abrirAyuda(inicial = 'inicio') {
  const secciones = traducidas();
  const panel = abrirPanel(tr('Manual de usuario'), `<div class="ayuda-distribucion">
    <nav class="ayuda-indice" aria-label="Índice de ayuda">
      <div class="ayuda-marca"><img src="assets/icon.png" alt="" width="30" height="30"><div><b>ChessRival</b><span>Guía de preparación</span></div></div>
      <label for="buscarAyuda">Buscar en la ayuda</label><input id="buscarAyuda" type="search" placeholder="Buscar un tema…">
      <div class="ayuda-resultados" data-resultados role="status"></div><div class="ayuda-temas" data-indice></div>
    </nav>
    <div class="ayuda-lector"><article class="ayuda-contenido" data-contenido tabindex="0" aria-label="Contenido del manual"></article>
      <nav class="ayuda-paginacion" aria-label="Navegar por el manual">
        <button type="button" data-anterior title="Apartado anterior">${svg('atras', 16)} Anterior</button><span data-pagina></span>
        <button type="button" data-siguiente title="Apartado siguiente">Siguiente ${svg('flecha', 16)}</button>
      </nav></div></div>`, 'panel-ayuda');
  if (!panel) return;
  const esEditable = evento => !!evento.target.closest?.('input, textarea, [contenteditable="true"]');
  for (const tipo of ['selectstart', 'copy', 'cut']) {
    panel.velo.addEventListener(tipo, evento => { if (!esEditable(evento)) evento.preventDefault(); });
  }
  panel.velo.addEventListener('keydown', evento => {
    if (!esEditable(evento) && (evento.ctrlKey || evento.metaKey) && ['a', 'c', 'x'].includes(evento.key.toLowerCase())) {
      evento.preventDefault();
      evento.stopPropagation();
    }
  });
  const $ = s => panel.velo.querySelector(s);
  const indice = $('[data-indice]'), contenido = $('[data-contenido]');
  let filtradas = secciones, actual = inicial;
  function seleccionar(s) {
    actual = s[0]; contenido.replaceChildren();
    const cabecera = document.createElement('header'); cabecera.className = 'ayuda-cabecera-tema';
    const etiqueta = document.createElement('div'); etiqueta.className = 'ayuda-apartado'; etiqueta.textContent = `${s[2]} · ${tr('Apartado')} ${String(secciones.indexOf(s) + 1).padStart(2, '0')}`;
    const titulo = document.createElement('h2'); titulo.textContent = s[1]; cabecera.append(etiqueta, titulo); contenido.append(cabecera);
    for (const bloque of s[3]) {
      const elemento = document.createElement(({ parrafo: 'p', subtitulo: 'h3', lista: 'ul', pasos: 'ol', nota: 'aside' })[bloque.tipo]);
      if (bloque.items) {
        if (bloque.tipo === 'pasos') elemento.className = 'ayuda-pasos';
        for (const texto of bloque.items) { const li = document.createElement('li'); ponerTexto(li, texto); elemento.append(li); }
      } else {
        if (bloque.tipo === 'nota') {
          elemento.className = 'ayuda-nota';
          const rotulo = document.createElement('b'); rotulo.textContent = 'Ten en cuenta'; elemento.append(rotulo);
        }
        ponerTexto(elemento, bloque.texto);
      }
      contenido.append(elemento);
    }
    for (const b of indice.querySelectorAll('button')) b.setAttribute('aria-current', b.dataset.clave === actual ? 'page' : 'false');
    indice.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
    const posicion = filtradas.indexOf(s);
    $('[data-anterior]').disabled = posicion <= 0;
    $('[data-siguiente]').disabled = posicion >= filtradas.length - 1;
    $('[data-pagina]').textContent = `${secciones.indexOf(s) + 1} ${IDIOMA === 'en' ? 'of' : 'de'} ${secciones.length}`;
    contenido.scrollTop = 0;
  }
  function pintar(busqueda = '') {
    const consulta = normalizar(busqueda.trim());
    filtradas = secciones.filter(s => normalizar([s[1], s[2], ...s[3].flatMap(b => b.items ?? b.texto)].join(' ')).includes(consulta));
    indice.replaceChildren();
    let grupo = '';
    for (const s of filtradas) {
      if (s[2] !== grupo) {
        grupo = s[2]; const rotulo = document.createElement('div'); rotulo.className = 'ayuda-grupo'; rotulo.textContent = grupo; indice.append(rotulo);
      }
      const b = document.createElement('button'); b.type = 'button'; b.dataset.clave = s[0];
      const numero = document.createElement('span'); numero.className = 'ayuda-numero'; numero.textContent = String(secciones.indexOf(s) + 1).padStart(2, '0'); numero.setAttribute('aria-hidden', 'true');
      const texto = document.createElement('span'); texto.textContent = s[1]; b.append(numero, texto);
      b.addEventListener('click', () => seleccionar(s)); indice.append(b);
    }
    $('[data-resultados]').textContent = consulta ? `${filtradas.length} ${tr(filtradas.length === 1 ? 'apartado encontrado' : 'apartados encontrados')}` : `${secciones.length} ${tr('apartados')}`;
    if (!filtradas.length) {
      contenido.replaceChildren(); const h = document.createElement('h2'); h.textContent = 'Sin resultados'; contenido.append(h);
      const texto = document.createElement('p'); texto.textContent = 'Prueba con otra palabra, como partidas, variantes o copias.'; contenido.append(texto);
      $('[data-anterior]').disabled = $('[data-siguiente]').disabled = true; $('[data-pagina]').textContent = ''; return;
    }
    seleccionar(filtradas.find(s => s[0] === actual) ?? filtradas[0]);
  }
  $('[data-anterior]').addEventListener('click', () => { const i = filtradas.findIndex(s => s[0] === actual); if (i > 0) seleccionar(filtradas[i - 1]); });
  $('[data-siguiente]').addEventListener('click', () => { const i = filtradas.findIndex(s => s[0] === actual); if (i < filtradas.length - 1) seleccionar(filtradas[i + 1]); });
  $('#buscarAyuda').addEventListener('input', e => pintar(e.target.value));
  pintar();
}

export function abrirVideo() {
  const panel = abrirPanel('Vídeo tutorial', `<p class="suave utilidad-intro">Cómo añadir jugadores (nombre, ID FIDE y URL de Chess-Results o Info64), cargar y analizar sus partidas y entender cada apartado del estudio. Los jugadores y datos del vídeo son inventados.</p><video class="tutorial-video" controls playsinline preload="metadata" aria-label="Vídeo tutorial de ChessRival"><source src="assets/Video/${IDIOMA === 'en' ? 'Tutorial-en' : 'Tutorial'}.mp4" type="video/mp4"></video><p class="error" data-error-video hidden>No se ha podido reproducir el vídeo.</p>`, 'panel-video');
  if (!panel) return;
  panel.velo.querySelector('source').addEventListener('error', () => { panel.velo.querySelector('[data-error-video]').hidden = false; });
  panel.velo.querySelector('video').addEventListener('error', () => { panel.velo.querySelector('[data-error-video]').hidden = false; });
}
