import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pago } from '../src/models/Pago.js';

test('E2E: flujo integral sobre la base de datos completa (5 casos de negocio)', async () => {
  const db = JSON.parse(readFileSync(new URL('../database/db.seed.json', import.meta.url), 'utf-8'));
  assert.equal(db.pagos.length, 5, 'Deben existir 5 registros de prueba');

  const respuestasHacienda = {
    '3101012009': {
      nombre: 'BANCO BAC SAN JOSE SOCIEDAD ANONIMA',
      situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito' },
    },
    '3101307520': {
      nombre: 'TRANSPORTES REY DEL SUR SOCIEDAD ANONIMA',
      situacion: { moroso: 'SI', omiso: 'SI', estado: 'Inscrito' },
    },
    '999999999999': null,
  };

  const resultados = db.pagos.map((pagoRaw) => {
    const pago = new Pago(pagoRaw);
    const requiere = pago.requiereConsultaHacienda();
    const respHacienda = requiere ? respuestasHacienda[pago.cedula] ?? null : null;
    const actualizado = pago.procesar(respHacienda);
    const requiereRevision = actualizado.estado !== 'aprobado';
    return { ...actualizado, requiereRevision };
  });

  // 1. Caso éxito: aprobado con QR y no requiere revisión
  const [exito, montoAlto, moroso, inexistente, corrupto] = resultados;

  assert.equal(exito.estado, 'aprobado');
  assert.equal(exito.requiereRevision, false);
  assert.ok(exito.qrUrl.includes('api.qrserver.com'));
  assert.match(exito.referenciaAutorizacion, /^AUT-1-/);
  assert.equal(exito.historial[0].de, 'pendiente');
  assert.equal(exito.historial[0].a, 'aprobado');

  // 2. Caso monto alto: retenido_auditoria y requiere revisión
  assert.equal(montoAlto.estado, 'retenido_auditoria');
  assert.equal(montoAlto.requiereRevision, true);
  assert.ok(montoAlto.motivo.includes('2500000'));

  // 3. Caso moroso real: retenido por riesgo fiscal y requiere revisión
  assert.equal(moroso.estado, 'retenido');
  assert.equal(moroso.requiereRevision, true);
  assert.ok(moroso.motivo.includes('moroso'));

  // 4. Caso inexistente: Fail-Safe y requiere revisión
  assert.equal(inexistente.estado, 'pendiente_verificacion_manual');
  assert.equal(inexistente.requiereRevision, true);

  // 5. Caso corrupto: error_datos sin consultar Hacienda y requiere revisión
  assert.equal(corrupto.estado, 'error_datos');
  assert.equal(corrupto.requiereRevision, true);
});
