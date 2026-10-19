import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Ejecuta el código REAL del nodo Code de n8n (n8n/codigo-nodo-n8n.js)
 * simulando los helpers $('Obtener pagos pendientes').all() y $input.all().
 */
const leer = (r) => readFileSync(new URL(r, import.meta.url), 'utf-8');
const ejecutar = (archivo, contexto) => vm.runInNewContext(`(() => {\n${leer(archivo)}\n})()`, contexto);

const pagosOriginales = [
  { id: 1, cedula: '3101012009', monto: 350000, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 2, cedula: '3101012009', monto: 5000000, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 3, cedula: '3101307520', monto: 180000, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 4, cedula: '999999999999', monto: 120000, fecha: '2026-10-19', estado: 'pendiente' },
  { id: 5, cedula: 'ABC-123', monto: -500, fecha: '2026-10-19', estado: 'pendiente' },
];

const alDia = { nombre: 'BAC SAN JOSE', situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito' } };
const moroso = { nombre: 'TRANSPORTES REY DEL SUR', situacion: { moroso: 'SI', omiso: 'NO', estado: 'Inscrito' } };
const noExiste = { error: { message: 'Not Found' } };

test('Adaptador del nodo Code n8n: procesa pagos combinando Hacienda y POO', () => {
  const respuestasHacienda = [
    { json: alDia, pairedItem: { item: 0 } },
    { json: alDia, pairedItem: { item: 1 } },
    { json: moroso, pairedItem: { item: 2 } },
    { json: noExiste, pairedItem: { item: 3 } },
    { json: noExiste, pairedItem: { item: 4 } },
  ];

  const salida = ejecutar('../n8n/codigo-nodo-n8n.js', {
    $: (nombre) => {
      assert.equal(nombre, 'Obtener pagos pendientes');
      return { all: () => pagosOriginales.map((p) => ({ json: p })) };
    },
    $input: { all: () => respuestasHacienda },
  });

  assert.equal(salida.length, 5);
  assert.deepEqual(
    salida.map((s) => s.json.estado),
    ['aprobado', 'retenido_auditoria', 'retenido', 'pendiente_verificacion_manual', 'error_datos']
  );
  assert.deepEqual(salida.map((s) => s.json.id), [1, 2, 3, 4, 5]);

  // Aprobado genera QR con URL válida y referencia única
  const aprobado = salida[0].json;
  assert.ok(aprobado.qrUrl.startsWith('https://api.qrserver.com/'));
  assert.ok(aprobado.referenciaAutorizacion.startsWith('AUT-1-'));
  assert.equal(aprobado.registroActualizado.historial.length, 1);
});

test('Workflow exportado: Agente IA, Google Sheets, Comprobante QR y sin notas de fondo', () => {
  const wf = JSON.parse(leer('../n8n/workflow-exportado.json'));
  const nombres = new Set(wf.nodes.map((n) => n.name));

  // No debe haber notas de fondo que ensucien el lienzo
  const stickyNotes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
  assert.equal(stickyNotes.length, 0, 'El lienzo debe estar limpio, sin notas adhesivas');

  // Validar nombres exactos de los nodos requeridos
  const nombresEsperados = [
    'Iniciar manualmente',
    'Obtener pagos pendientes',
    'Consultar Hacienda',
    'Reglas de negocio POO',
    '¿Pago aprobado?',
    'PUT Aprobado (con QR)',
    'Generar Comprobante QR',
    'Enviar Comprobante por Gmail',
    'PUT Retenido / Error / Manual',
    '¿Alerta Crítica?',
    'Alerta Moroso por Gmail',
    'Agente IA Auditor',
    'OpenAI Chat Model',
    'Registrar en Google Sheets',
  ];
  for (const n of nombresEsperados) {
    assert.ok(nombres.has(n), `Falta el nodo requerido: ${n}`);
  }

  // Reto 3: Dos nodos Gmail (Confirmación QR a proveedores aprobados + Alerta Crítica a gerencia por morosos)
  const gmailQr = wf.nodes.find((n) => n.name === 'Enviar Comprobante por Gmail');
  assert.equal(gmailQr.type, 'n8n-nodes-base.gmail');
  assert.equal(gmailQr.onError, 'continueRegularOutput');

  const gmailAlerta = wf.nodes.find((n) => n.name === 'Alerta Moroso por Gmail');
  assert.equal(gmailAlerta.type, 'n8n-nodes-base.gmail');
  assert.equal(gmailAlerta.onError, 'continueRegularOutput');

  // Agente IA: debe ser un agente de langchain (@n8n/n8n-nodes-langchain.agent), no un simple HTTP Request
  const agente = wf.nodes.find((n) => n.name === 'Agente IA Auditor');
  assert.equal(agente.type, '@n8n/n8n-nodes-langchain.agent');
  assert.equal(agente.onError, 'continueRegularOutput');

  // Modelo de lenguaje conectado como sub-nodo al Agente IA
  const modelo = wf.nodes.find((n) => n.name === 'OpenAI Chat Model');
  assert.equal(modelo.type, '@n8n/n8n-nodes-langchain.lmChatOpenAi');
  assert.deepEqual(wf.connections['OpenAI Chat Model'].ai_languageModel[0][0], {
    node: 'Agente IA Auditor',
    type: 'ai_languageModel',
    index: 0,
  });

  // Nodo Google Sheets
  const sheets = wf.nodes.find((n) => n.name === 'Registrar en Google Sheets');
  assert.equal(sheets.type, 'n8n-nodes-base.googleSheets');
  assert.equal(sheets.onError, 'continueRegularOutput');

  // Generación real de la imagen QR en el flujo aprobado
  const nodoQR = wf.nodes.find((n) => n.name === 'Generar Comprobante QR');
  assert.equal(nodoQR.parameters.url, '={{ $json.qrUrl }}');
  assert.equal(nodoQR.parameters.options.response.response.responseFormat, 'file');

  // Resiliencia en consulta a Hacienda
  const hacienda = wf.nodes.find((n) => n.name === 'Consultar Hacienda');
  assert.equal(hacienda.onError, 'continueRegularOutput');
  assert.equal(hacienda.parameters.options.retryOnFail, true);
  assert.equal(hacienda.parameters.options.maxTries, 2);

  // Código del nodo Code idéntico a n8n/codigo-nodo-n8n.js
  const nodoCode = wf.nodes.find((n) => n.name === 'Reglas de negocio POO');
  assert.equal(nodoCode.parameters.jsCode, leer('../n8n/codigo-nodo-n8n.js'));

  // Batching en los PUT para proteger JSON Server en Windows contra colisiones
  const puts = wf.nodes.filter((n) => n.parameters?.method === 'PUT');
  assert.equal(puts.length, 2);
  for (const p of puts) {
    assert.equal(p.parameters.options.batching.batch.batchSize, 1);
    assert.equal(p.parameters.options.batching.batch.batchInterval, 150);
  }
});
