/**
 * Genera n8n/codigo-nodo-n8n.js y n8n/workflow-exportado.json a partir de
 * src/models/*.js, garantizando la Fuente Única de Verdad.
 * Uso: npm run build:n8n (o npm run build:n8n:docker)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf-8');

// En n8n no hay import/export: se eliminan, el resto del código queda idéntico.
const limpiar = (src) =>
  src
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
    .trim();

const proveedor = limpiar(leer('../src/models/Proveedor.js'));
const pago = limpiar(leer('../src/models/Pago.js'));

const encabezado = `// GENERADO por scripts/build-n8n.js - NO editar a mano (editar src/models/*.js)\n// Nodo Code: Reglas de Negocio POO (Fuente Única de Verdad)\n// Modo: Run Once for All Items, JavaScript\n\n`;
const clases = `${proveedor}\n\n${pago}\n`;

// Adaptador limpio n8n: empareja cada pago pendiente con la respuesta de Hacienda
const adaptador = `
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
    },
  };
});
`;

const codigo = encabezado + clases + adaptador;

mkdirSync(new URL('../n8n/', import.meta.url), { recursive: true });
writeFileSync(new URL('../n8n/codigo-nodo-n8n.js', import.meta.url), codigo);

const isDocker = process.argv.includes('--docker') || process.env.API_HOST === 'docker';
const API = isDocker ? 'http://host.docker.internal:3000' : (process.env.API_BASE_URL || 'http://localhost:3000');

const putNode = (id, name, position, requiereRevision) => ({
  parameters: {
    method: 'PUT',
    url: `=${API}/pagos/{{ $json.id }}`,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ ...$json.registroActualizado, requiereRevision: ${requiereRevision} }) }}`,
    options: {
      batching: {
        batch: {
          batchSize: 1,
          batchInterval: 150,
        },
      },
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 500,
    },
  },
  id,
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
});

const workflow = {
  name: 'Panel de riesgo de proveedores con comprobante QR',
  nodes: [
    {
      parameters: {},
      id: 'n1',
      name: 'Iniciar manualmente',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [180, 240],
    },
    {
      parameters: {
        method: 'GET',
        url: `${API}/pagos?estado=pendiente`,
        options: {},
      },
      id: 'n2',
      name: 'Obtener pagos pendientes',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [400, 240],
    },
    {
      parameters: {
        method: 'GET',
        url: '=https://api.hacienda.go.cr/fe/ae?identificacion={{ encodeURIComponent($json.cedula) }}',
        options: {
          timeout: 8000,
          retryOnFail: true,
          maxTries: 2,
          waitBetweenTries: 1500,
        },
      },
      id: 'n3',
      name: 'Consultar Hacienda',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [620, 240],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: codigo,
      },
      id: 'n4',
      name: 'Reglas de negocio POO',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [840, 240],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [
            {
              id: 'c1',
              leftValue: '={{ $json.estado }}',
              rightValue: 'aprobado',
              operator: { type: 'string', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'n5',
      name: '¿Pago aprobado?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [1060, 240],
    },
    putNode('n6', 'PUT Aprobado (con QR)', [1300, 140], false),
    putNode('n7', 'PUT Retenido / Error / Manual', [1300, 340], true),
  ],
  connections: {
    'Iniciar manualmente': {
      main: [[{ node: 'Obtener pagos pendientes', type: 'main', index: 0 }]],
    },
    'Obtener pagos pendientes': {
      main: [[{ node: 'Consultar Hacienda', type: 'main', index: 0 }]],
    },
    'Consultar Hacienda': {
      main: [[{ node: 'Reglas de negocio POO', type: 'main', index: 0 }]],
    },
    'Reglas de negocio POO': {
      main: [[{ node: '¿Pago aprobado?', type: 'main', index: 0 }]],
    },
    '¿Pago aprobado?': {
      main: [
        [{ node: 'PUT Aprobado (con QR)', type: 'main', index: 0 }],
        [{ node: 'PUT Retenido / Error / Manual', type: 'main', index: 0 }],
      ],
    },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

writeFileSync(new URL('../n8n/workflow-exportado.json', import.meta.url), JSON.stringify(workflow, null, 2));
console.log(`Generados n8n/codigo-nodo-n8n.js y n8n/workflow-exportado.json (API: ${API})`);
