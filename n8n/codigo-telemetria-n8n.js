// GENERADO por scripts/build-n8n.js - NO editar a mano
// Nodo de Telemetría: recopila todos los pagos procesados y genera un balance ejecutivo.
const items = $input.all();
const total = items.length;
const conteo = {
  aprobado: 0,
  retenido: 0,
  retenido_auditoria: 0,
  pendiente_verificacion_manual: 0,
  error_datos: 0,
};
let montoAprobado = 0;

for (const item of items) {
  const reg = item.json;
  const est = reg.estado || 'otro';
  if (conteo[est] !== undefined) {
    conteo[est]++;
  } else {
    conteo[est] = (conteo[est] || 0) + 1;
  }
  if (est === 'aprobado' && reg.monto) {
    montoAprobado += Number(reg.monto);
  }
}

return [{
  json: {
    resumenEjecutivo: {
      totalPagosProcesados: total,
      aprobadosConQR: conteo.aprobado || 0,
      retenidosRiesgoFiscal: conteo.retenido || 0,
      retenidosAuditoriaMonto: conteo.retenido_auditoria || 0,
      pendientesVerificacionManual: conteo.pendiente_verificacion_manual || 0,
      erroresDatos: conteo.error_datos || 0,
      montoTotalAprobadoCRC: montoAprobado,
      fechaEjecucion: new Date().toISOString(),
      resultadoGeneral: total === 0
        ? 'No se encontraron pagos pendientes por procesar'
        : `${conteo.aprobado || 0} de ${total} pagos aprobados satisfactoriamente con QR`,
    },
    detallesPagos: items.map(it => ({
      id: it.json.id,
      proveedor: it.json.proveedor,
      cedula: it.json.cedula,
      monto: it.json.monto,
      estado: it.json.estado,
      motivo: it.json.motivo,
      referenciaAutorizacion: it.json.referenciaAutorizacion,
      qrUrl: it.json.qrUrl
    }))
  }
}];
