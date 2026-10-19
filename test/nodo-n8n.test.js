import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Ejecuta el código REAL de los nodos Code de n8n (n8n/*.js) simulando los helpers
 * $() / $input / itemMatching, para validar adaptadores y flujo de dos nodos.
 */
const leer = (r) => readFileSync(new URL(r, import.meta.url), 'utf-8');
const ejecutar = (archivo, contexto) => vm.runInNewContext(`(() => {\n${leer(archivo)}\n})()`, contexto);

const pagos = [
  { id: 1, cedula: '3101012009', monto: 350000, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 2, cedula: '3101012009', monto: 5000000, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 3, cedula: '999999999999', monto: 120000, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 4, cedula: 'ABC-123', monto: -500, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 5, cedula: '3101012009', monto: 1000, estado: 'pendiente' }, // sin fecha
];
const alDia = { nombre: 'BAC', situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito' } };

test('Flujo de dos nodos n8n: pre-validación evita Hacienda en datos corruptos', () => {
  // Nodo 1: Pre-validación POO
  const pre = ejecutar('../n8n/codigo-prevalidacion-n8n.js', {
    $input: { all: () => pagos.map((json) => ({ json })) },
  });
  assert.deepEqual(pre.map((p) => p.json.consultarHacienda), [true, true, true, false, false]);
  assert.equal(pre[3].json.registroActualizado.estado, 'error_datos');
  assert.equal(pre[4].json.registroActualizado.estado, 'error_datos');
  assert.equal(pre[0].json.registroActualizado, null);

  // IF + HTTP Hacienda: solo pasan los 3 primeros; el 3.º falla (error continuado)
  const alIf = pre.filter((p) => p.json.consultarHacienda);
  const respuestas = [{ json: alDia }, { json: alDia }, { json: { error: { message: 'Not Found' } } }];

  // Nodo 2: Reglas de negocio POO
  const salida = ejecutar('../n8n/codigo-nodo-n8n.js', {
    $: (nombre) => {
      assert.equal(nombre, 'Pre-validación POO');
      return { itemMatching: (i) => alIf[i] };
    },
    $input: { all: () => respuestas },
  });
  assert.deepEqual(
    salida.map((s) => s.json.estado),
    ['aprobado', 'retenido_auditoria', 'pendiente_verificacion_manual']
  );
  assert.deepEqual(salida.map((s) => s.json.id), [1, 2, 3]);
  const ok = salida[0].json.registroActualizado;
  assert.ok(ok.qrUrl.startsWith('https://api.qrserver.com/'));
  // Los campos auxiliares de la pre-validación no contaminan el registro guardado
  assert.equal('consultarHacienda' in ok, false);
  assert.equal(ok.historial.length, 1);
});

test('Workflow exportado: nodos, bifurcaciones y conexiones coherentes', () => {
  const wf = JSON.parse(leer('../n8n/workflow-exportado.json'));
  const nombres = new Set(wf.nodes.map((n) => n.name));
  for (const [origen, c] of Object.entries(wf.connections)) {
    assert.ok(nombres.has(origen), `origen inexistente: ${origen}`);
    for (const rama of c.main) for (const d of rama) assert.ok(nombres.has(d.node), `destino inexistente: ${d.node}`);
  }
  const tipos = wf.nodes.map((n) => n.type);
  assert.ok(tipos.includes('n8n-nodes-base.manualTrigger'));
  assert.equal(tipos.filter((t) => t === 'n8n-nodes-base.if').length, 2);
  assert.equal(wf.nodes.filter((n) => n.parameters.method === 'PUT').length, 2);
  assert.equal(wf.nodes.find((n) => n.name === 'Consultar Hacienda').onError, 'continueRegularOutput');
  const codeNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
  assert.equal(codeNodes.find((n) => n.name === 'Reglas de negocio POO').parameters.jsCode, leer('../n8n/codigo-nodo-n8n.js'));
  assert.equal(codeNodes.find((n) => n.name === 'Pre-validación POO').parameters.jsCode, leer('../n8n/codigo-prevalidacion-n8n.js'));
  assert.equal(codeNodes.find((n) => n.name === 'Resumen y Telemetría Ejecutiva').parameters.jsCode, leer('../n8n/codigo-telemetria-n8n.js'));

  // Validar sticky notes de documentación visual
  const notes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
  assert.equal(notes.length, 5, 'Deben existir 5 sticky notes en el canvas');

  // Validar nodos de extensión Enterprise
  assert.ok(wf.nodes.find((n) => n.name === 'Auditor IA (OpenAI)'), 'Debe existir nodo de IA');
  assert.ok(wf.nodes.find((n) => n.name === 'Registrar en Google Sheets'), 'Debe existir nodo de Google Sheets');

  // Validar reintentos en Hacienda
  const hacienda = wf.nodes.find((n) => n.name === 'Consultar Hacienda');
  assert.equal(hacienda.parameters.options.retryOnFail, true);
  assert.equal(hacienda.parameters.options.maxTries, 2);
});

test('Nodo de Telemetría: calcula métricas ejecutivas consolidadas', () => {
  const items = [
    { json: { id: 1, estado: 'aprobado', monto: 350000 } },
    { json: { id: 2, estado: 'retenido_auditoria', monto: 5000000 } },
    { json: { id: 3, estado: 'retenido', monto: 180000 } },
    { json: { id: 4, estado: 'pendiente_verificacion_manual', monto: 120000 } },
    { json: { id: 5, estado: 'error_datos', monto: -500 } },
  ];
  const resultado = ejecutar('../n8n/codigo-telemetria-n8n.js', {
    $input: { all: () => items },
  });
  const res = resultado[0].json.resumenEjecutivo;
  assert.equal(res.totalPagosProcesados, 5);
  assert.equal(res.aprobadosConQR, 1);
  assert.equal(res.retenidosAuditoriaMonto, 1);
  assert.equal(res.retenidosRiesgoFiscal, 1);
  assert.equal(res.pendientesVerificacionManual, 1);
  assert.equal(res.erroresDatos, 1);
  assert.equal(res.montoTotalAprobadoCRC, 350000);
});
