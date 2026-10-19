// GENERADO por scripts/build-n8n.js - NO editar a mano (editar src/models/*.js)
// Nodo "Reglas de negocio POO"
// Pegar en un nodo Code (modo: Run Once for All Items, JavaScript)

/**
 * Proveedor: modela al proveedor y encapsula las validaciones de cédula
 * y de riesgo fiscal (datos de la API del Ministerio de Hacienda).
 */
class Proveedor {
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

/**
 * Pago: modela el pago a un proveedor, aplica los límites de monto,
 * evalúa las reglas de negocio y genera el comprobante QR.
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

  /** Regla 4: solo se procesan registros en estado "pendiente". */
  estaPendiente() {
    return this.#datos.estado === 'pendiente';
  }

  /**
   * Error 1: falta ID, monto <= 0 o cédula inválida.
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
    if (!new Proveedor({ cedula: this.#datos.cedula }).tieneCedulaValida()) {
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
   * Indica si vale la pena consultar a Hacienda: solo pagos pendientes con datos válidos.
   * Evita llamadas innecesarias a la API externa.
   */
  requiereConsultaHacienda() {
    return this.estaPendiente() && this.validarDatosPago().valido;
  }

  /**
   * Ejecuta todas las reglas de negocio.
   * @param {object|null} respuestaHacienda Respuesta de Hacienda; null/inválida si la API falló.
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

    // Error 2: Hacienda caída / cédula inexistente -> Fail-Safe
    const proveedor = Proveedor.desdeHacienda(this.#datos.cedula, respuestaHacienda);
    if (!proveedor.tieneDatosTributarios()) {
      return resultado(
        'pendiente_verificacion_manual',
        'API de Hacienda no disponible o sin datos tributarios (Fail-Safe)'
      );
    }

    // Regla 2: riesgo fiscal
    const riesgo = proveedor.evaluarRiesgoFiscal();
    if (!riesgo.apto) {
      return resultado('retenido', `Retenido por riesgo fiscal: ${riesgo.motivo}`);
    }

    // Regla 3: auditoría por monto alto
    if (this.requiereAuditoriaPorMonto()) {
      return resultado(
        'retenido_auditoria',
        `Monto supera ${Pago.LIMITE_AUDITORIA} CRC; requiere revisión gerencial`
      );
    }

    // Regla 5: aprobado con comprobante QR
    return resultado('aprobado', riesgo.motivo, this.generarComprobanteQR());
  }
}

// ---------------------------------------------------------------
// ADAPTADOR n8n: combina cada pago (nodo "Pre-validación POO") con la
// respuesta de Hacienda (nodo "Consultar Hacienda"). itemMatching(i) sigue
// el linaje de ítems, por lo que es correcto aunque el IF filtre registros.
// ---------------------------------------------------------------
return $input.all().map((item, i) => {
  // Se descartan los campos auxiliares de la pre-validación.
  const { consultarHacienda, registroActualizado, ...registro } = $('Pre-validación POO').itemMatching(i).json;
  // Si la API falló, n8n entrega { error: ... }; se trata como "sin datos".
  const hacienda = item.json && !item.json.error ? item.json : null;
  const actualizado = new Pago(registro).procesar(hacienda);
  return { json: { registroActualizado: actualizado, estado: actualizado.estado, id: actualizado.id } };
});
