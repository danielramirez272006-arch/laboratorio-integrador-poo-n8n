import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pago } from '../src/models/Pago.js';
import { Proveedor } from '../src/models/Proveedor.js';

const AL_DIA = { nombre: 'X', situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito' } };
const base = { id: 1, cedula: '3101012009', monto: 100000, fecha: '2026-10-19', estado: 'pendiente' };
const procesar = (o, ...h) => new Pago({ ...base, ...o }).procesar(h.length ? h[0] : AL_DIA);

test('Regla 1: validación de cédula', () => {
  assert.equal(new Proveedor({ cedula: '123456789' }).tieneCedulaValida(), true);
  assert.equal(new Proveedor({ cedula: '123456789012' }).tieneCedulaValida(), true);
  assert.equal(new Proveedor({ cedula: '12345678' }).tieneCedulaValida(), false);
  assert.equal(new Proveedor({ cedula: '1234567890123' }).tieneCedulaValida(), false);
  assert.equal(new Proveedor({ cedula: 'ABC123456' }).tieneCedulaValida(), false);
});

test('Regla 2: riesgo fiscal -> retenido', () => {
  for (const situacion of [
    { moroso: 'SI', omiso: 'NO', estado: 'Inscrito' },
    { moroso: 'NO', omiso: 'SI', estado: 'Inscrito' },
    { moroso: 'NO', omiso: 'NO', estado: 'Desinscrito' },
    { moroso: 'NO', omiso: 'NO', estado: 'Suspendido' },
  ]) {
    assert.equal(procesar({}, { situacion }).estado, 'retenido');
  }
});

test('Regla 3: monto alto -> retenido_auditoria (el tope exacto sí se aprueba)', () => {
  assert.equal(procesar({ monto: 2500001 }).estado, 'retenido_auditoria');
  assert.equal(procesar({ monto: 2500000 }).estado, 'aprobado');
});

test('Regla 4: estado previo se respeta', () => {
  const r = procesar({ estado: 'aprobado' }, null);
  assert.equal(r.estado, 'aprobado');
  assert.equal(r.qrUrl, undefined);
});

test('Regla 5: comprobante QR con ID, cédula, monto y fecha', () => {
  const r = procesar({});
  assert.equal(r.estado, 'aprobado');
  assert.match(r.referenciaAutorizacion, /^AUT-1-[0-9A-F]{8}$/);
  const data = decodeURIComponent(new URL(r.qrUrl).searchParams.get('data'));
  for (const v of ['ID:1', 'CED:3101012009', 'MONTO:100000', 'FECHA:2026-10-19']) assert.ok(data.includes(v));
  assert.notEqual(procesar({ id: 2 }).referenciaAutorizacion, r.referenciaAutorizacion);
});

test('Error 1: datos corruptos -> error_datos', () => {
  for (const o of [{ id: undefined }, { monto: 0 }, { monto: -5 }, { monto: 'abc' }, { cedula: 'ABC' }, { fecha: undefined }]) {
    assert.equal(procesar(o).estado, 'error_datos');
  }
});

test('Error 2: Hacienda caída / sin datos -> pendiente_verificacion_manual', () => {
  for (const h of [null, undefined, { error: 'timeout' }, { code: 404, message: 'no existe' }]) {
    assert.equal(procesar({}, h).estado, 'pendiente_verificacion_manual');
  }
});

test('Bitácora de auditoría: cada decisión registra fecha, estados y motivo', () => {
  const ahora = new Date('2026-10-19T12:00:00Z');
  const r = new Pago({ ...base }).procesar(AL_DIA, ahora);
  assert.deepEqual(r.historial, [{ fecha: ahora.toISOString(), de: 'pendiente', a: 'aprobado', motivo: 'Al día con Hacienda' }]);
  assert.equal(procesar({ estado: 'aprobado' }).historial, undefined);
});

test('requiereConsultaHacienda: solo pendientes con datos válidos', () => {
  assert.equal(new Pago(base).requiereConsultaHacienda(), true);
  assert.equal(new Pago({ ...base, monto: 0 }).requiereConsultaHacienda(), false);
  assert.equal(new Pago({ ...base, estado: 'aprobado' }).requiereConsultaHacienda(), false);
});

test('Proveedor.situacion es inmutable', () => {
  const p = Proveedor.desdeHacienda('3101012009', AL_DIA);
  assert.throws(() => { 'use strict'; p.situacion.moroso = 'SI'; }, TypeError);
});

test('Single Source of Truth: n8n/codigo-nodo-n8n.js contiene las clases vigentes', () => {
  const limpiar = (s) => s.replace(/^import .*$/gm, '').replace(/^export /gm, '').trim();
  const leer = (r) => readFileSync(new URL(r, import.meta.url), 'utf-8');
  const n8n = leer('../n8n/codigo-nodo-n8n.js');
  const pre = leer('../n8n/codigo-prevalidacion-n8n.js');
  assert.ok(n8n.includes(limpiar(leer('../src/models/Proveedor.js'))), 'Proveedor desincronizado: ejecute npm run build:n8n');
  assert.ok(n8n.includes(limpiar(leer('../src/models/Pago.js'))), 'Pago desincronizado: ejecute npm run build:n8n');
  assert.ok(pre.includes(limpiar(leer('../src/models/Proveedor.js'))) && pre.includes(limpiar(leer('../src/models/Pago.js'))), 'Pre-validación desincronizada');
});
