// Diccionario español → inglés: junta las partes de cada zona de la aplicación.
import * as principal from './i18n-en-principal.js';
import * as ficha from './i18n-en-ficha.js';
import * as visor from './i18n-en-visor.js';
import * as estudio from './i18n-en-estudio.js';
import * as comun from './i18n-en-comun.js';
import * as ayuda from './i18n-en-ayuda.js';

const partes = [principal, ficha, visor, estudio, comun, ayuda];
export default {
  exactas: Object.assign({}, ...partes.map(p => p.exactas)),
  plantillas: Object.assign({}, ...partes.map(p => p.plantillas))
};
