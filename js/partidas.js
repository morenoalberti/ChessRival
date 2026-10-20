// Una partida del jugador, tal como está guardada (Models/PartidaGuardada.cs).
import { leerPgn, jugadasDe, numerar, Ritmo, textoRitmo } from './pgn.js';
import { convertirFiguras } from './figuritas.js';
import * as Aperturas from './aperturas.js';
import { nombreConTitulo, normalizarTitulo } from './nombre-jugador.js';

import { IDIOMA } from './i18n.js';
const MESES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export class PartidaGuardada {
  constructor(d) {
    Object.assign(this, {
      id: 0, evento: '', sitio: '', fecha: '', ronda: '', blancas: '', negras: '', resultado: '*', eco: '', apertura: '',
      colorJugador: 'B', pgn: '', primerMovimiento: '', ritmo: Ritmo.Desconocido, origen: ''
    }, d);
  }

  get _leida() { return this.__leida ??= leerPgn(this.pgn)[0] ?? null; }

  /** Puntos que sacó el jugador (1, ½ o 0); null si la partida no ha terminado. */
  get puntos() {
    switch (this.resultado) {
      case '1-0': return this.colorJugador === 'B' ? 1 : 0;
      case '0-1': return this.colorJugador === 'N' ? 1 : 0;
      case '1/2-1/2': return 0.5;
      default: return null;
    }
  }

  /** La segunda jugada de la partida (la respuesta a la primera), por ejemplo «d5». */
  get respuesta() {
    if (this.__respuesta === undefined) this.__respuesta = this._leida ? (jugadasDe(this._leida.jugadas)[1] ?? '') : '';
    return this.__respuesta;
  }

  _elo(cab) { const m = new RegExp(`\\[${cab}\\s+"(\\d+)"\\s*\\]`).exec(this.pgn); return m && m[1] !== '0' ? m[1] : ''; }
  get eloBlancas() { return this._elo('WhiteElo'); }
  get eloNegras() { return this._elo('BlackElo'); }
  get rival() { return this.colorJugador === 'B' ? this.negras : this.blancas; }
  get tituloBlancas() { return normalizarTitulo(this._leida?.cab('WhiteTitle')); }
  get tituloNegras() { return normalizarTitulo(this._leida?.cab('BlackTitle')); }
  get rivalConTitulo() { return nombreConTitulo({ name: this.rival }, this.colorJugador === 'B' ? this.tituloNegras : this.tituloBlancas); }

  get resultadoJugador() {
    switch (this.puntos) { case 1: return 'Victoria'; case 0.5: return 'Tablas'; case 0: return 'Derrota'; default: return 'Sin terminar'; }
  }

  get aperturaEtiqueta() { return Aperturas.etiqueta(this); }
  get aperturaNombre() { return Aperturas.nombreCorto(Aperturas.familia(this.eco, this.apertura)); }

  /** Nombre completo, código ECO y nombre detallado, para la ayuda de la celda. */
  get aperturaDetalle() {
    const fam = Aperturas.familia(this.eco, this.apertura);
    const detalle = [this.eco ? `ECO ${this.eco}` : '', Aperturas.nombreCompleto(this.apertura)].filter(Boolean).join(' · ');
    return detalle ? `${fam}\n${detalle}` : fam;
  }

  /** Las primeras jugadas con figuritas («1.e4 e5 2.♘f3 ♘c6 3.♗b5 a6»). */
  get comienzo() {
    if (this.__comienzo === undefined) {
      const l = this._leida;
      this.__comienzo = !l || l.cab('FEN') ? '' : convertirFiguras(numerar(jugadasDe(l.jugadas).slice(0, 6)));
    }
    return this.__comienzo;
  }

  get fechaMostrada() {
    const p = this.fecha.split('.');
    if (p.length !== 3 || p[0].length !== 4 || !/^\d+$/.test(p[0])) return '';          // sin año de 4 cifras no es fiable
    if (!/^\d+$/.test(p[1]) || !/^\d+$/.test(p[2])) return p[0];
    return `${p[2]}/${p[1]}/${p[0]}`;
  }

  get fechaLarga() {
    const p = this.fecha.split('.').map(Number);
    if (p.length === 3 && p.every(Number.isInteger) && p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= 31) return IDIOMA === 'en' ? `${p[2]} ${MESES_EN[p[1] - 1]} ${p[0]}` : `${p[2]} de ${MESES[p[1] - 1]} de ${p[0]}`;
    return this.fechaMostrada;
  }

  get textoRitmo() { return textoRitmo(this.ritmo); }

  /** Datos del evento para la ayuda de la fila: torneo, lugar, ronda, fecha completa y ritmo. */
  get eventoDetalle() {
    const hay = (t) => t && t !== '?' && t !== '-';
    const lineas = [hay(this.evento) ? this.evento : 'Evento desconocido'];
    if (hay(this.sitio)) lineas.push(this.sitio);
    if (hay(this.ronda)) lineas.push(`Ronda ${this.ronda}`);
    if (this.fechaLarga) lineas.push(this.fechaLarga);
    if (this.ritmo !== Ritmo.Desconocido) lineas.push(`Ritmo ${this.textoRitmo.toLowerCase()}`);
    return lineas.join('\n');
  }
}
