// GENERADO por scripts/build-n8n.js - NO editar a mano (editar src/models/*.js)
// Nodo Code: Reglas de Negocio POO con Polimorfismo (Fuente Única de Verdad)
// Modo: Run Once for All Items, JavaScript

/**
 * Jerarquía de Clases con Herencia y Polimorfismo (Laboratorio #1 - Reto 1)
 * Clase Base: Proveedor
 * Clases Hijas: ProveedorNacional, ProveedorInternacional
 */

/**
 * Clase Base: modela un proveedor genérico con atributos y comportamiento base.
 */
class Proveedor {
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
class ProveedorNacional extends Proveedor {
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
class ProveedorInternacional extends Proveedor {
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

/**
 * Pago: modela el pago a un proveedor, aplica los límites de monto,
 * evalúa las reglas de negocio con polimorfismo y genera el comprobante QR.
 */
class Pago {
  static LIMITE_AUDITORIA = 2500000;
  static QR_BASE_URL = 'https://api.qrserver.com/v1/create-qr-code/';

  #datos;

  /** @param {object} datos Registro tal cual viene de JSON Server. */
  constructor(datos = {}) {
    this.#datos = { ...datos };
  }

  get id() {
    return this.#datos.id;
  }

  get cedula() {
    return this.#datos.cedula;
  }

  get monto() {
    return this.#datos.monto;
  }

  get fecha() {
    return this.#datos.fecha;
  }

  get estado() {
    return this.#datos.estado;
  }

  get proveedor() {
    return this.#datos.proveedor;
  }

  get pais() {
    return this.#datos.pais || 'CR';
  }

  /** Regla 4: solo se procesan registros en estado "pendiente". */
  estaPendiente() {
    return this.#datos.estado === 'pendiente';
  }

  /**
   * Error 1: falta ID, monto <= 0 o identificación inválida.
   * @returns {{valido: boolean, errores: string[]}}
   */
  validarDatosPago() {
    const errores = [];
    const id = this.#datos.id;
    if (id === undefined || id === null || id === '') errores.push('Falta el ID del pago');
    const monto = Number(this.#datos.monto);
    if (this.#datos.monto === undefined || this.#datos.monto === null || !Number.isFinite(monto) || monto <= 0) {
      errores.push('El monto debe ser mayor a 0');
    }
    const prov = Proveedor.crear(this.#datos);
    if (!prov.tieneIdentificacionValida()) {
      errores.push('La cédula debe tener entre 9 y 12 dígitos numéricos');
    }
    const fecha = this.#datos.fecha;
    if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(fecha) || Number.isNaN(Date.parse(fecha))) {
      errores.push('La fecha es obligatoria con formato AAAA-MM-DD');
    }
    return { valido: errores.length === 0, errores };
  }

  /** Regla 3: montos superiores a 2,500,000 CRC requieren revisión gerencial. */
  requiereAuditoriaPorMonto() {
    return Number(this.#datos.monto) > Pago.LIMITE_AUDITORIA;
  }

  /**
   * Regla 5: referencia de autorización única + URL del QR que codifica
   * ID, cédula, monto y fecha.
   */
  generarComprobanteQR() {
    const payload = `PAGO_APROBADO|ID:${this.#datos.id}|CED:${this.#datos.cedula}|MONTO:${this.#datos.monto}|FECHA:${this.#datos.fecha}`;
    let hash = 5381;
    for (let i = 0; i < payload.length; i++) {
      hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
    }
    const referencia = `AUT-${String(this.#datos.id).toUpperCase()}-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
    const data = encodeURIComponent(`${payload}|REF:${referencia}`);
    return {
      referenciaAutorizacion: referencia,
      qrUrl: `${Pago.QR_BASE_URL}?size=250x250&data=${data}`,
    };
  }

  /**
   * Indica si vale la pena consultar a Hacienda: solo pagos nacionales pendientes con datos válidos.
   */
  requiereConsultaHacienda() {
    const prov = Proveedor.crear(this.#datos);
    return this.estaPendiente() && this.validarDatosPago().valido && prov instanceof ProveedorNacional;
  }

  /**
   * Ejecuta todas las reglas de negocio aprovechando el polimorfismo de Proveedor.
   * @param {object|null} respuestaHacienda Respuesta de Hacienda; null/inválida si la API falló.
   * @param {Date} ahora Marca de tiempo para la auditoría.
   * @returns {object} Registro actualizado listo para el PUT a JSON Server.
   */
  procesar(respuestaHacienda = null, ahora = new Date()) {
    const base = { ...this.#datos };
    const resultado = (estado, motivo, extra = {}) => ({
      ...base,
      estado,
      motivo,
      fechaProceso: ahora.toISOString(),
      // Bitácora de auditoría: cada decisión queda registrada con motivo y fecha.
      historial: [
        ...(Array.isArray(base.historial) ? base.historial : []),
        { fecha: ahora.toISOString(), de: base.estado, a: estado, motivo },
      ],
      ...extra,
    });

    // Regla 4: respetar estado previo
    if (!this.estaPendiente()) {
      return { ...base, motivo: base.motivo ?? 'Registro ya procesado; se respeta su estado' };
    }

    // Error 1: datos corruptos (no interrumpe el flujo)
    const validacion = this.validarDatosPago();
    if (!validacion.valido) {
      return resultado('error_datos', validacion.errores.join('; '));
    }

    // Polimorfismo: instanciar la subclase adecuada (Nacional o Internacional)
    const proveedor = Proveedor.crear(this.#datos, respuestaHacienda);

    // Error 2: Hacienda caída / cédula inexistente en proveedores nacionales -> Fail-Safe
    if (proveedor instanceof ProveedorNacional && !proveedor.tieneDatosTributarios()) {
      return resultado(
        'pendiente_verificacion_manual',
        'API de Hacienda no disponible o sin datos tributarios (Fail-Safe)'
      );
    }

    // Regla 2 (Polimórfica): evaluación de riesgo (nacional ante Hacienda o internacional)
    const riesgo = proveedor.evaluarRiesgo(respuestaHacienda);
    const metaPolimorfica = {
      tipoProveedor: proveedor.tipo,
      tiempoEntregaDias: proveedor.calcularTiempoEntregaDias(),
      nivelRiesgo: riesgo.nivelRiesgo || 'DESCONOCIDO',
    };

    if (!riesgo.apto) {
      return resultado('retenido', `Retenido por riesgo fiscal: ${riesgo.motivo}`, metaPolimorfica);
    }

    // Regla 3: auditoría por monto alto
    if (this.requiereAuditoriaPorMonto()) {
      return resultado(
        'retenido_auditoria',
        `Monto supera ${Pago.LIMITE_AUDITORIA} CRC; requiere revisión gerencial`,
        metaPolimorfica
      );
    }

    // Regla 5: aprobado con comprobante QR
    return resultado('aprobado', riesgo.motivo, {
      ...this.generarComprobanteQR(),
      ...metaPolimorfica,
    });
  }
}

// ---------------------------------------------------------------
// ADAPTADOR n8n: combina cada pago (nodo "Obtener pagos pendientes")
// con la respuesta de Hacienda (nodo "Consultar Hacienda").
// ---------------------------------------------------------------
const pagosOriginales = $('Obtener pagos pendientes').all();
const respuestasHacienda = $input.all();

return respuestasHacienda.map((item, i) => {
  const idx = item.pairedItem?.item ?? i;
  const registro = pagosOriginales[idx].json;
  // Si la API de Hacienda falló, hizo timeout o no existe, n8n entrega error:
  const hacienda = item.json && !item.json.error && item.json.situacion ? item.json : null;
  const actualizado = new Pago(registro).procesar(hacienda);
  return {
    json: {
      registroActualizado: actualizado,
      estado: actualizado.estado,
      id: actualizado.id,
      monto: actualizado.monto,
      proveedor: actualizado.proveedor,
      cedula: actualizado.cedula,
      motivo: actualizado.motivo,
      qrUrl: actualizado.qrUrl,
      referenciaAutorizacion: actualizado.referenciaAutorizacion,
      fechaProceso: actualizado.fechaProceso,
      tipoProveedor: actualizado.tipoProveedor,
      tiempoEntregaDias: actualizado.tiempoEntregaDias,
      nivelRiesgo: actualizado.nivelRiesgo,
    },
  };
});
