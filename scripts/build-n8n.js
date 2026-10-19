/**
 * Genera n8n/codigo-nodo-n8n.js, n8n/codigo-prevalidacion-n8n.js,
 * n8n/codigo-telemetria-n8n.js y n8n/workflow-exportado.json a partir de
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

const encabezado = (titulo) =>
  `// GENERADO por scripts/build-n8n.js - NO editar a mano (editar src/models/*.js)\n// ${titulo}\n// Pegar en un nodo Code (modo: Run Once for All Items, JavaScript)\n\n`;
const clases = `${proveedor}\n\n${pago}\n`;

// Nodo 1 (antes de Hacienda): usa las MISMAS clases para decidir si se consulta la API.
const adaptadorPrevalidacion = `
// ---------------------------------------------------------------
// ADAPTADOR n8n (pre-validación): los pagos con datos corruptos o ya procesados
// no consultan a Hacienda; su resultado se calcula aquí con la clase Pago.
// ---------------------------------------------------------------
return $input.all().map((item) => {
  const pago = new Pago(item.json);
  const consultar = pago.requiereConsultaHacienda();
  const actualizado = consultar ? null : pago.procesar(null);
  return {
    json: {
      ...item.json,
      consultarHacienda: consultar,
      registroActualizado: actualizado,
    },
  };
});
`;

// Nodo 2 (después de Hacienda): reglas de negocio completas.
const adaptador = `
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
`;

// Nodo 3 (telemetría final): reporte ejecutivo consolidado
const codigoTelemetria = `// GENERADO por scripts/build-n8n.js - NO editar a mano
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
        : \`\${conteo.aprobado || 0} de \${total} pagos aprobados satisfactoriamente con QR\`,
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
`;

const codigo = encabezado('Nodo "Reglas de negocio POO"') + clases + adaptador;
const codigoPrevalidacion = encabezado('Nodo "Pre-validación POO"') + clases + adaptadorPrevalidacion;

mkdirSync(new URL('../n8n/', import.meta.url), { recursive: true });
writeFileSync(new URL('../n8n/codigo-nodo-n8n.js', import.meta.url), codigo);
writeFileSync(new URL('../n8n/codigo-prevalidacion-n8n.js', import.meta.url), codigoPrevalidacion);
writeFileSync(new URL('../n8n/codigo-telemetria-n8n.js', import.meta.url), codigoTelemetria);

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
    // --- STICKY NOTES (Documentación visual en Canvas) ---
    {
      parameters: {
        content: '## 1. Ingesta & Pre-validación POO\nRecupera pagos `estado=pendiente` de JSON Server y evalúa `Pago.requiereConsultaHacienda()`. Los registros con datos corruptos no consumen la API externa y van directo a revisión.',
        height: 380,
        width: 820,
        color: 5,
      },
      id: 'note1',
      name: 'Nota: Ingesta y Pre-validación',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-60, -30],
    },
    {
      parameters: {
        content: '## 2. Consulta Resiliente\nConsulta la API tributaria oficial con reintentos y timeout de 8s. Con `onError: continueRegularOutput`, las caídas o cédulas inexistentes no detienen el flujo sino que activan el protocolo Fail-Safe.',
        height: 380,
        width: 250,
        color: 6,
      },
      id: 'note2',
      name: 'Nota: Consulta Hacienda',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [800, -30],
    },
    {
      parameters: {
        content: '## 3. Motor POO & Bifurcación\nEjecuta las clases puras de ES6 (`Proveedor` y `Pago`). Evalúa riesgo fiscal, tope de auditoría gerencial (> 2.5M CRC) y genera el comprobante QR único con hash determinista.',
        height: 380,
        width: 440,
        color: 4,
      },
      id: 'note3',
      name: 'Nota: Reglas de Negocio',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [1060, -30],
    },
    {
      parameters: {
        content: '## 4. Persistencia & Telemetría\nActualiza JSON Server vía PUT con `requiereRevision` diferenciado y consolida un reporte ejecutivo de métricas para auditoría y notificaciones.',
        height: 440,
        width: 580,
        color: 7,
      },
      id: 'note4',
      name: 'Nota: Persistencia',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [1510, -80],
    },
    {
      parameters: {
        content: '## 5. Fase Enterprise: IA & Google Sheets\n- **Auditor IA (OpenAI gpt-4o-mini):** Recibe la telemetría consolidada de las clases POO y genera automáticamente un memorando ejecutivo y borradores de notificación.\n- **Google Sheets:** Añade la bitácora histórica en una hoja de cálculo en la nube.\n*(Cuentan con tolerancia a fallos para no bloquear el flujo si no se conectan API keys)*',
        height: 440,
        width: 560,
        color: 3,
      },
      id: 'note5',
      name: 'Nota: IA y Google Sheets',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [2110, -80],
    },

    // --- NODOS DE EJECUCIÓN ---
    {
      parameters: {},
      id: 'n1',
      name: 'Iniciar manualmente',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 200],
    },
    {
      parameters: { method: 'GET', url: `${API}/pagos?estado=pendiente`, options: {} },
      id: 'n2',
      name: 'Obtener pagos pendientes',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [220, 200],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: codigoPrevalidacion },
      id: 'n8',
      name: 'Pre-validación POO',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [440, 200],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [
            {
              id: 'c0',
              leftValue: '={{ $json.consultarHacienda }}',
              rightValue: '',
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'n9',
      name: '¿Datos válidos? (consultar Hacienda)',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [660, 200],
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
      position: [880, 100],
      onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: codigo },
      id: 'n4',
      name: 'Reglas de negocio POO',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1100, 100],
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
      position: [1320, 100],
    },
    putNode('n6', 'PUT Aprobado (con QR)', [1540, 0], false),
    putNode('n7', 'PUT Retenido / Error / Manual (requiere revisión)', [1540, 250], true),
    {
      parameters: {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: codigoTelemetria,
      },
      id: 'n10',
      name: 'Resumen y Telemetría Ejecutiva',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1800, 120],
    },
    {
      parameters: {
        resource: 'chat',
        operation: 'complete',
        model: 'gpt-4o-mini',
        prompt: {
          messages: [
            {
              role: 'system',
              content: 'Eres un Auditor Financiero Senior. Con base en la telemetría del motor POO, genera: 1) Memorando ejecutivo formal para Gerencia resumiendo aprobaciones y retenciones, y 2) Borrador de notificación a proveedores retenidos por riesgo fiscal o monto extraordinario.',
            },
            {
              role: 'user',
              content: '=Resumen de pagos:\n{{ JSON.stringify($json.resumenEjecutivo, null, 2) }}\n\nDetalles:\n{{ JSON.stringify($json.detallesPagos, null, 2) }}',
            },
          ],
        },
        options: {},
      },
      id: 'n11',
      name: 'Auditor IA (OpenAI)',
      type: 'n8n-nodes-base.openAi',
      typeVersion: 1.4,
      position: [2160, 120],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        operation: 'append',
        documentId: {
          __rl: true,
          value: '',
          mode: 'url',
        },
        sheetName: {
          __rl: true,
          value: 'Auditoria_Pagos',
          mode: 'name',
        },
        columns: {
          mappingMode: 'autoMapInputData',
          value: {},
        },
        options: {},
      },
      id: 'n12',
      name: 'Registrar en Google Sheets',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [2440, 120],
      onError: 'continueRegularOutput',
    },
  ],
  connections: {
    'Iniciar manualmente': { main: [[{ node: 'Obtener pagos pendientes', type: 'main', index: 0 }]] },
    'Obtener pagos pendientes': { main: [[{ node: 'Pre-validación POO', type: 'main', index: 0 }]] },
    'Pre-validación POO': { main: [[{ node: '¿Datos válidos? (consultar Hacienda)', type: 'main', index: 0 }]] },
    '¿Datos válidos? (consultar Hacienda)': {
      main: [
        [{ node: 'Consultar Hacienda', type: 'main', index: 0 }],
        [{ node: 'PUT Retenido / Error / Manual (requiere revisión)', type: 'main', index: 0 }],
      ],
    },
    'Consultar Hacienda': { main: [[{ node: 'Reglas de negocio POO', type: 'main', index: 0 }]] },
    'Reglas de negocio POO': { main: [[{ node: '¿Pago aprobado?', type: 'main', index: 0 }]] },
    '¿Pago aprobado?': {
      main: [
        [{ node: 'PUT Aprobado (con QR)', type: 'main', index: 0 }],
        [{ node: 'PUT Retenido / Error / Manual (requiere revisión)', type: 'main', index: 0 }],
      ],
    },
    'PUT Aprobado (con QR)': { main: [[{ node: 'Resumen y Telemetría Ejecutiva', type: 'main', index: 0 }]] },
    'PUT Retenido / Error / Manual (requiere revisión)': {
      main: [[{ node: 'Resumen y Telemetría Ejecutiva', type: 'main', index: 0 }]],
    },
    'Resumen y Telemetría Ejecutiva': { main: [[{ node: 'Auditor IA (OpenAI)', type: 'main', index: 0 }]] },
    'Auditor IA (OpenAI)': { main: [[{ node: 'Registrar en Google Sheets', type: 'main', index: 0 }]] },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

writeFileSync(new URL('../n8n/workflow-exportado.json', import.meta.url), JSON.stringify(workflow, null, 2));
console.log(`Generados n8n/codigo-nodo-n8n.js, n8n/codigo-prevalidacion-n8n.js, n8n/codigo-telemetria-n8n.js y n8n/workflow-exportado.json (API: ${API})`);
