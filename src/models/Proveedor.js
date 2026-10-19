/**
 * Proveedor: modela al proveedor y encapsula las validaciones de cédula
 * y de riesgo fiscal (datos de la API del Ministerio de Hacienda).
 */
export class Proveedor {
  #cedula;
  #nombre;
  #situacion;

  /**
   * @param {{cedula: string, nombre?: string, situacion?: object}} datos
   */
  constructor({ cedula, nombre = '', situacion = null } = {}) {
    this.#cedula = cedula === undefined || cedula === null ? '' : String(cedula).trim();
    this.#nombre = nombre;
    this.#situacion = situacion && typeof situacion === 'object' ? Object.freeze({ ...situacion }) : null;
  }

  get cedula() {
    return this.#cedula;
  }

  get nombre() {
    return this.#nombre;
  }

  get situacion() {
    return this.#situacion;
  }

  /** Construye un Proveedor a partir de la respuesta de Hacienda (o null si no hay datos). */
  static desdeHacienda(cedula, respuesta) {
    const valida = respuesta && typeof respuesta === 'object' && !respuesta.error && respuesta.situacion;
    return new Proveedor({
      cedula,
      nombre: valida ? respuesta.nombre || '' : '',
      situacion: valida ? respuesta.situacion : null,
    });
  }

  /** Regla 1: la cédula debe tener entre 9 y 12 dígitos numéricos. */
  tieneCedulaValida() {
    return /^\d{9,12}$/.test(this.#cedula);
  }

  /** Indica si Hacienda devolvió datos tributarios utilizables. */
  tieneDatosTributarios() {
    return this.#situacion !== null && typeof this.#situacion === 'object';
  }

  /**
   * Regla 2: apto solo si moroso === "NO", omiso === "NO" y estado
   * no es desinscrito ni suspendido.
   * @returns {{apto: boolean, motivo: string}}
   */
  evaluarRiesgoFiscal() {
    if (!this.tieneDatosTributarios()) {
      return { apto: false, motivo: 'Sin datos tributarios' };
    }
    const moroso = String(this.#situacion.moroso ?? '').trim().toUpperCase();
    const omiso = String(this.#situacion.omiso ?? '').trim().toUpperCase();
    const estado = String(this.#situacion.estado ?? '').trim().toLowerCase();

    const motivos = [];
    if (moroso !== 'NO') motivos.push('proveedor moroso');
    if (omiso !== 'NO') motivos.push('proveedor omiso');
    if (estado.includes('desinscrit') || estado.includes('suspendid')) {
      motivos.push(`estado tributario: ${this.#situacion.estado}`);
    }
    return motivos.length === 0
      ? { apto: true, motivo: 'Al día con Hacienda' }
      : { apto: false, motivo: motivos.join('; ') };
  }
}
