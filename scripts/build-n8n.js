/**
 * Genera n8n/codigo-nodo-n8n.js y n8n/workflow-exportado.json a partir de
 * src/models/*.js, garantizando la Fuente Única de Verdad.
 * Incluye:
 * - Reto 1: Jerarquía de clases con herencia y polimorfismo (Proveedor -> ProveedorNacional / ProveedorInternacional)
 * - Reto 3: Notificaciones automáticas por Gmail a danielramirez272006@gmail.com (Comprobante QR para aprobados + Alerta Crítica para morosos)
 * - Agente IA (@n8n/n8n-nodes-langchain.agent) con DeepSeek Chat Model
 * - Registro en Google Sheets
 * - Auto-recuperación: consulta /pagos para no detenerse nunca por falta de registros pendientes
 * - Lienzo 100% limpio (sin sticky notes de fondo)
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

const encabezado = `// GENERADO por scripts/build-n8n.js - NO editar a mano (editar src/models/*.js)\n// Nodo Code: Reglas de Negocio POO con Polimorfismo (Fuente Única de Verdad)\n// Modo: Run Once for All Items, JavaScript\n\n`;
const clases = `${proveedor}\n\n${pago}\n`;

// Adaptador limpio n8n: empareja cada pago con la respuesta de Hacienda
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
      fechaProceso: actualizado.fechaProceso,
      tipoProveedor: actualizado.tipoProveedor,
      tiempoEntregaDias: actualizado.tiempoEntregaDias,
      nivelRiesgo: actualizado.nivelRiesgo,
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
      position: [100, 320],
    },
    {
      parameters: {
        method: 'GET',
        url: `${API}/pagos`,
        options: {},
      },
      id: 'n2',
      name: 'Obtener pagos pendientes',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [300, 320],
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
      position: [500, 320],
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
      position: [700, 320],
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
      position: [900, 320],
    },
    putNode('n6', 'PUT Aprobado (con QR)', [1140, 180], false),
    {
      parameters: {
        method: 'GET',
        url: '={{ $json.qrUrl }}',
        options: {
          response: {
            response: {
              responseFormat: 'file',
              outputPropertyName: 'comprobante_qr',
            },
          },
        },
      },
      id: 'n6_qr',
      name: 'Generar Comprobante QR',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1360, 180],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        resource: 'message',
        operation: 'send',
        sendTo: 'danielramirez272006@gmail.com',
        subject: '=Comprobante de Pago Aprobado: {{ $json.proveedor }} (#{{ $json.id }})',
        message: '=Estimado(a) {{ $json.proveedor }},\n\nLe informamos que su pago por un monto de {{ $json.monto }} CRC ha sido APROBADO tras validar su condición tributaria al día con el Ministerio de Hacienda.\n\nNúmero de autorización: {{ $json.referenciaAutorizacion }}\nFecha de proceso: {{ $json.fechaProceso }}\n\nPuede acceder y verificar su comprobante oficial con código QR en el siguiente enlace:\n{{ $json.qrUrl }}\n\nAdjunto encontrará el comprobante generado.\n\nAtentamente,\nDepartamento Financiero',
        options: {
          attachmentsUi: {
            attachmentsBinary: [
              {
                property: 'comprobante_qr',
              },
            ],
          },
        },
      },
      id: 'n6_gmail',
      name: 'Enviar Comprobante por Gmail',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [1580, 180],
      onError: 'continueRegularOutput',
    },
    putNode('n7', 'PUT Retenido / Error / Manual', [1140, 460], true),
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [
            {
              id: 'c_critico',
              leftValue: '={{ $json.estado }}',
              rightValue: 'retenido',
              operator: { type: 'string', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'n7_if_critico',
      name: '¿Alerta Crítica?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [1360, 460],
    },
    {
      parameters: {
        resource: 'message',
        operation: 'send',
        sendTo: 'danielramirez272006@gmail.com',
        subject: '=🚨 ALERTA CRÍTICA: Pago Retenido por Morosidad - {{ $json.proveedor }} (#{{ $json.id }})',
        message: '=URGENTE - GERENCIA FINANCIERA:\n\nSe ha retenido el pago #{{ $json.id }} del proveedor {{ $json.proveedor }} (Cédula: {{ $json.cedula }}) por un monto de {{ $json.monto }} CRC.\n\nMotivo de la retención: {{ $json.motivo }}\nNivel de riesgo detectado: {{ $json.nivelRiesgo }}\nFecha de detección: {{ $json.fechaProceso }}\n\nEl pago ha sido bloqueado en el sistema y requiere regularización tributaria inmediata.',
        options: {},
      },
      id: 'n7_alerta_gmail',
      name: 'Alerta Moroso por Gmail',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [1580, 460],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        promptType: 'define',
        text: '=Analiza el pago {{ $json.id }} del proveedor {{ $json.proveedor }} (Tipo: {{ $json.tipoProveedor }}, Cédula: {{ $json.cedula }}). Estado final asignado por POO: {{ $json.estado }}. Motivo: {{ $json.motivo }}. Monto: {{ $json.monto }} CRC. Nivel de riesgo: {{ $json.nivelRiesgo }}. Genera un breve dictamen ejecutivo de auditoría para la gerencia financiera.',
        hasOutputParser: false,
      },
      id: 'n8_agent',
      name: 'Agente IA Auditor',
      type: '@n8n/n8n-nodes-langchain.agent',
      typeVersion: 1.7,
      position: [1840, 320],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        model: 'deepseek-chat',
        options: {},
      },
      id: 'n8_model',
      name: 'DeepSeek Chat Model',
      type: '@n8n/n8n-nodes-langchain.lmChatDeepSeek',
      typeVersion: 1,
      position: [1840, 500],
    },
    {
      parameters: {
        operation: 'append',
        documentId: {
          __rl: true,
          value: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
          mode: 'url',
        },
        sheetName: {
          __rl: true,
          value: 'gid=0',
          mode: 'list',
          cachedResultName: 'Auditoria_Pagos',
        },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            id: '={{ $json.id }}',
            proveedor: '={{ $json.proveedor }}',
            monto: '={{ $json.monto }}',
            estado: '={{ $json.estado }}',
            motivo: '={{ $json.motivo }}',
            auditoria_ia: '={{ $json.output || $json.text || "Auditado por IA" }}',
          },
        },
        options: {},
      },
      id: 'n9_sheets',
      name: 'Registrar en Google Sheets',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [2080, 320],
      onError: 'continueRegularOutput',
    },
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
    'PUT Aprobado (con QR)': {
      main: [[{ node: 'Generar Comprobante QR', type: 'main', index: 0 }]],
    },
    'Generar Comprobante QR': {
      main: [[{ node: 'Enviar Comprobante por Gmail', type: 'main', index: 0 }]],
    },
    'Enviar Comprobante por Gmail': {
      main: [[{ node: 'Agente IA Auditor', type: 'main', index: 0 }]],
    },
    'PUT Retenido / Error / Manual': {
      main: [[{ node: '¿Alerta Crítica?', type: 'main', index: 0 }]],
    },
    '¿Alerta Crítica?': {
      main: [
        [{ node: 'Alerta Moroso por Gmail', type: 'main', index: 0 }],
        [{ node: 'Agente IA Auditor', type: 'main', index: 0 }],
      ],
    },
    'Alerta Moroso por Gmail': {
      main: [[{ node: 'Agente IA Auditor', type: 'main', index: 0 }]],
    },
    'DeepSeek Chat Model': {
      ai_languageModel: [
        [{ node: 'Agente IA Auditor', type: 'ai_languageModel', index: 0 }],
      ],
    },
    'Agente IA Auditor': {
      main: [[{ node: 'Registrar en Google Sheets', type: 'main', index: 0 }]],
    },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

writeFileSync(new URL('../n8n/workflow-exportado.json', import.meta.url), JSON.stringify(workflow, null, 2));
console.log(`Generados n8n/codigo-nodo-n8n.js y n8n/workflow-exportado.json (API: ${API})`);
