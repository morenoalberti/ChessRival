// Cuadro para configurar el asistente (AsistenteConfigDialog.xaml): proveedor (ChatGPT o Claude), claves de API y modelo.
import { contenidoBoton } from './iconos.js';
import { Proveedor, nombreProveedor, modeloPorDefecto, modelosConocidos, proveedorDe, listarModelos } from './asistente.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Devuelve los ajustes nuevos, o null si se cancela. */
export function abrirConfigIa(actual) {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    const vivos = {};
    const OTRO_MODELO = '__otro_modelo__';
    let cerrado = false;
    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo dialogo-importar" role="dialog" aria-modal="true" aria-label="Configurar el asistente">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Configurar el asistente de IA</span></div>
        <div class="importar-cuerpo">
          <p class="importar-intro">Elige qué servicio contesta, pon tu clave de API y el modelo. Las preguntas viajan por el servidor intermedio de ChessRival directamente al proveedor; tu clave se guarda solo en este navegador.</p>
          <div class="ia-campos">
            <label>Usar</label>
            <select data-proveedor><option value="${Proveedor.OpenAI}">ChatGPT (OpenAI)</option><option value="${Proveedor.Anthropic}">Claude (Anthropic)</option></select>
            <label>Clave de ChatGPT</label><input type="password" data-clave-openai autocomplete="off" spellcheck="false" placeholder="sk-…">
            <label>Clave de Claude</label><input type="password" data-clave-anthropic autocomplete="off" spellcheck="false" placeholder="sk-ant-…">
            <label for="iaModelo">Modelo</label>
            <div class="ia-modelo"><select id="iaModelo" data-modelo></select>
              <button type="button" class="btn btn-secundario btn-chico" data-actualizar title="Pide al proveedor la lista de modelos que tiene tu clave"></button></div>
            <label for="iaModeloManual" data-modelo-manual-label hidden>Otro modelo</label>
            <input id="iaModeloManual" type="text" data-modelo-manual autocomplete="off" spellcheck="false" aria-label="Nombre de otro modelo" hidden>
          </div>
          <p class="suave ia-ayuda" data-ayuda>Abre la lista para ver todos los modelos. Para escribir otro, elige «Otro modelo…».</p>
          <div class="importar-botones">
            <button type="button" class="btn btn-primario" data-guardar></button>
            <button type="button" class="btn btn-secundario" data-cancelar></button>
          </div>
        </div>
      </div>`;
    const $ = (s) => velo.querySelector(s);
    $('[data-actualizar]').innerHTML = contenidoBoton('cambiar', 'Actualizar lista');
    $('[data-guardar]').innerHTML = contenidoBoton('guardar', 'Guardar');
    $('[data-cancelar]').innerHTML = contenidoBoton('equis', 'Cancelar');
    $('[data-proveedor]').value = actual.proveedor;
    $('[data-clave-openai]').value = actual.claveOpenAI;
    $('[data-clave-anthropic]').value = actual.claveAnthropic;

    const proveedor = () => $('[data-proveedor]').value;
    const claveActual = () => (proveedor() === Proveedor.OpenAI ? $('[data-clave-openai]') : $('[data-clave-anthropic]')).value.trim();
    const modeloActual = () => $('[data-modelo]').value === OTRO_MODELO ? $('[data-modelo-manual]').value.trim() : $('[data-modelo]').value;
    const mostrarManual = () => {
      const manual = $('[data-modelo]').value === OTRO_MODELO;
      $('[data-modelo-manual]').hidden = !manual;
      $('[data-modelo-manual-label]').hidden = !manual;
    };
    const llenar = (modelo = modeloActual()) => {
      const modelos = vivos[proveedor()] ?? modelosConocidos(proveedor());
      $('[data-modelo]').innerHTML = modelos.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
        + `<option value="${OTRO_MODELO}">Otro modelo…</option>`;
      $('[data-modelo]').value = modelos.includes(modelo) ? modelo : OTRO_MODELO;
      $('[data-modelo-manual]').value = modelo;
      mostrarManual();
    };
    const ayuda = (t) => { $('[data-ayuda]').textContent = t; };
    llenar(actual.modelo || modeloPorDefecto(proveedor()));

    $('[data-modelo]').addEventListener('change', () => {
      mostrarManual();
      if ($('[data-modelo]').value === OTRO_MODELO) $('[data-modelo-manual]').focus();
    });

    $('[data-proveedor]').addEventListener('change', () => {
      const m = modeloActual(), de = proveedorDe(m);
      llenar((de && de !== proveedor()) || !m.trim() ? modeloPorDefecto(proveedor()) : m);
      ayuda('Abre la lista para ver todos los modelos. Para escribir otro, elige «Otro modelo…».');
    });

    $('[data-actualizar]').addEventListener('click', async () => {
      const p = proveedor(), clave = claveActual();
      if (!clave) { ayuda(`Escribe primero la clave de API de ${nombreProveedor(p)} para poder pedir la lista.`); return; }
      $('[data-actualizar]').disabled = true;
      ayuda('Consultando los modelos disponibles…');
      try {
        const modelos = await listarModelos(p, clave);
        if (cerrado) return;
        if (!modelos.length) { if (p === proveedor()) ayuda('El proveedor no devolvió ningún modelo de chat; se mantiene la lista habitual.'); return; }
        vivos[p] = modelos;
        if (p === proveedor()) {
          llenar();
          ayuda(`${modelos.length} modelos de ${nombreProveedor(p)} disponibles con tu clave. Abre «Modelo» para verlos todos.`);
        }
      } catch (ex) { if (!cerrado && p === proveedor()) ayuda(ex.message); } finally { $('[data-actualizar]').disabled = false; }
    });

    const cerrar = (valor) => {
      if (cerrado) return;
      cerrado = true;
      document.removeEventListener('keydown', teclas, true);
      velo.classList.add('saliendo');
      setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
      resolver(valor);
    };
    const teclas = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); } };

    $('[data-guardar]').addEventListener('click', () => {
      const p = proveedor();
      const modelo = modeloActual().trim() || modeloPorDefecto(p);
      const de = proveedorDe(modelo);
      if (de && de !== p) { ayuda(`Ese modelo es de ${nombreProveedor(de)}. Cambia «Usar» o elige un modelo de ${nombreProveedor(p)}.`); return; }
      if (!claveActual()) { ayuda(`Falta la clave de API de ${nombreProveedor(p)}.`); return; }
      cerrar({ proveedor: p, modelo, claveOpenAI: $('[data-clave-openai]').value.trim(), claveAnthropic: $('[data-clave-anthropic]').value.trim() });
    });
    $('[data-cancelar]').addEventListener('click', () => cerrar(null));
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(null); });
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(velo);
    (claveActual() ? $('[data-modelo]') : (proveedor() === Proveedor.OpenAI ? $('[data-clave-openai]') : $('[data-clave-anthropic]'))).focus();
  });
}
