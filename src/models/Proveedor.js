/**
 * Jerarquía de Clases con Herencia y Polimorfismo (Laboratorio #1 - Reto 1)
 * Clase Base: Proveedor
 * Clases Hijas: ProveedorNacional, ProveedorInternacional
 */

/**
 * Clase Base: modela un proveedor genérico con atributos y comportamiento base.
 */
export class Proveedor {
  #cedula;
  #nombre;
  #pais;
  #tipo;

  /**
   * @param {{cedula: string, nombre?: string, pais?: string, tipo?: string}} datos
   */
  constructor({ cedula = '', nombre = '', pais = 'CR', tipo = 'nacional' } = {}) {
    this.#cedula = cedula === undefined || cedula === null ? '' : String(cedula).trim();
    this.#nombre = nombre;
    this.#pais = String(pais || 'CR').trim().toUpperCase();
    this.#tipo = tipo;
  }

  get cedula() {
    return this.#cedula;
  }

  get nombre() {
    return this.#nombre;
  }

  get pais() {
    return this.#pais;
  }

  get tipo() {
    return this.#tipo;
  }

  /**
   * Validación base de identificación. Sobreescrito por las subclases.
   */
  tieneIdentificacionValida() {
    return /^\d{9,12}$/.test(this.#cedula);
  }

  /** Alias para compatibilidad con Regla 1 */
  tieneCedulaValida() {
    return this.tieneIdentificacionValida();
  }

  /**
   * Método polimórfico base: cada subclase evalúa el riesgo según su contexto.
   * @param {object|null} _respuestaHacienda
   * @returns {{apto: boolean, motivo: string, nivelRiesgo: string}}
   */
  evaluarRiesgo(_respuestaHacienda = null) {
    return { apto: false, motivo: 'Método evaluarRiesgo debe ser implementado por la subclase', nivelRiesgo: 'DESCONOCIDO' };
  }

  /** Alias para compatibilidad */
  evaluarRiesgoFiscal(respuestaHacienda = null) {
    return this.evaluarRiesgo(respuestaHacienda);
  }

  /**
   * Método polimórfico base: cálculo del tiempo de entrega o compensación en días.
   * Sobreescrito por cada subclase.
   */
  calcularTiempoEntregaDias() {
    return 3;
  }

  /**
   * Factory Method: instancia la subclase correcta según el país o tipo.
   */
  static crear(datos = {}, respuestaHacienda = null) {
    const pais = String(datos.pais || 'CR').trim().toUpperCase();
    const tipo = String(datos.tipo || '').toLowerCase();
    if (tipo === 'internacional' || (pais !== 'CR' && pais !== 'CRI' && pais !== 'COSTA RICA')) {
      return new ProveedorInternacional(datos);
    }
    return ProveedorNacional.desdeHacienda(datos.cedula, respuestaHacienda, datos);
  }

  /**
   * Compatibilidad: construye la instancia adecuada desde Hacienda.
   */
  static desdeHacienda(cedula, respuesta, datosAdicionales = {}) {
    return Proveedor.crear({ ...datosAdicionales, cedula }, respuesta);
  }
}

/**
 * Subclase 1: Proveedor Nacional (Costa Rica).
 * Aplica validaciones tributarias ante el Ministerio de Hacienda (Reglas 1 y 2).
 */
export class ProveedorNacional extends Proveedor {
  #situacion;

  constructor({ cedula, nombre = '', situacion = null } = {}) {
    super({ cedula, nombre, pais: 'CR', tipo: 'nacional' });
    this.#situacion = situacion && typeof situacion === 'object' ? Object.freeze({ ...situacion }) : null;
  }

  get situacion() {
    return this.#situacion;
  }

  static desdeHacienda(cedula, respuesta, datos = {}) {
    const valida = respuesta && typeof respuesta === 'object' && !respuesta.error && respuesta.situacion;
    return new ProveedorNacional({
      cedula,
      nombre: valida ? respuesta.nombre || datos.proveedor || '' : datos.proveedor || '',
      situacion: valida ? respuesta.situacion : null,
    });
  }

  /**
   * Regla 1 (Polimórfica): Cédula nacional costarricense de 9 a 12 dígitos numéricos.
   */
  tieneIdentificacionValida() {
    return /^\d{9,12}$/.test(this.cedula);
  }

  tieneDatosTributarios() {
    return this.#situacion !== null && typeof this.#situacion === 'object';
  }

  /**
   * Regla 2 (Polimórfica): Evaluación de riesgo fiscal ante Hacienda de Costa Rica.
   */
  evaluarRiesgo() {
    if (!this.tieneDatosTributarios()) {
      return { apto: false, motivo: 'Sin datos tributarios', nivelRiesgo: 'DESCONOCIDO' };
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
      ? { apto: true, motivo: 'Al día con Hacienda', nivelRiesgo: 'BAJO' }
      : { apto: false, motivo: motivos.join('; '), nivelRiesgo: 'ALTO' };
  }

  /**
   * Tiempo de entrega local / compensación bancaria SINPE: 1-2 días hábiles.
   */
  calcularTiempoEntregaDias() {
    return 2;
  }
}

/**
 * Subclase 2: Proveedor Internacional.
 * No depende de Hacienda CR; evalúa Tax ID internacional y jurisdicciones no cooperantes.
 */
export class ProveedorInternacional extends Proveedor {
  #taxId;
  #jurisdiccionCooperante;

  constructor({ cedula, taxId, nombre = '', pais = 'US', jurisdiccionCooperante = true } = {}) {
    const id = taxId || cedula || '';
    super({ cedula: id, nombre, pais, tipo: 'internacional' });
    this.#taxId = String(id).trim();
    this.#jurisdiccionCooperante = Boolean(jurisdiccionCooperante);
  }

  get taxId() {
    return this.#taxId;
  }

  get jurisdiccionCooperante() {
    return this.#jurisdiccionCooperante;
  }

  /**
   * Validación polimórfica: Tax ID internacional (EIN, VAT, TIN) de 5 a 20 caracteres alfanuméricos.
   */
  tieneIdentificacionValida() {
    return /^[A-Z0-9-]{5,20}$/i.test(this.#taxId);
  }

  /**
   * Evaluación de riesgo polimórfica internacional:
   * Valida lista de jurisdicciones cooperantes fiscales y certificación tributaria externa.
   */
  evaluarRiesgo() {
    if (!this.tieneIdentificacionValida()) {
      return { apto: false, motivo: 'Tax ID internacional inválido', nivelRiesgo: 'ALTO' };
    }
    if (!this.#jurisdiccionCooperante) {
      return { apto: false, motivo: `Jurisdicción fiscal no cooperante (${this.pais})`, nivelRiesgo: 'CRITICO' };
    }
    return {
      apto: true,
      motivo: `Proveedor internacional verificado (${this.pais}) con Tax ID válido`,
      nivelRiesgo: 'MEDIO',
    };
  }

  /**
   * Tiempo de entrega internacional / compensación SWIFT: 7 días hábiles.
   */
  calcularTiempoEntregaDias() {
    return 7;
  }
}
