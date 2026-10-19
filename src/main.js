import { readFile } from 'node:fs/promises';
import { Pago } from './models/Pago.js';

const HACIENDA_URL = 'https://api.hacienda.go.cr/fe/ae?identificacion=';
const TIMEOUT_MS = 8000;
const OFFLINE = process.argv.includes('--offline');

/** Hacienda simulada (modo --offline): datos para pruebas reproducibles sin conexión */
function haciendaSimulada(cedula) {
  if (cedula === '3101012009') {
    return {
      nombre: 'BANCO BAC SAN JOSE SOCIEDAD ANONIMA',
      situacion: { moroso: 'NO', omiso: 'NO', estado: 'Inscrito' },
    };
  }
  if (cedula === '3101307520') {
    return {
      nombre: 'TRANSPORTES REY DEL SUR SOCIEDAD ANONIMA',
      situacion: { moroso: 'SI', omiso: 'SI', estado: 'Inscrito' },
    };
  }
  return null;
}

/** Consulta Hacienda; devuelve null si falla, hace timeout o no hay datos. */
async function consultarHacienda(cedula) {
  if (OFFLINE) return haciendaSimulada(cedula);
  try {
    const res = await fetch(`${HACIENDA_URL}${encodeURIComponent(cedula)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function imprimir(titulo, entrada, salida) {
  console.log(`\n=== ${titulo} ===`);
  console.log(`Entrada : id=${entrada.id} cedula=${entrada.cedula} monto=${entrada.monto} estado=${entrada.estado}`);
  console.log(`Estado  : ${salida.estado}`);
  console.log(`Motivo  : ${salida.motivo}`);
  const ultima = salida.historial?.at(-1);
  if (ultima) console.log(`Auditoría: [${ultima.fecha}] ${ultima.de} -> ${ultima.a}`);
  if (salida.qrUrl) {
    console.log(`Ref.    : ${salida.referenciaAutorizacion}`);
    console.log(`QR      : ${salida.qrUrl}`);
  }
}

const db = JSON.parse(await readFile(new URL('../database/db.json', import.meta.url), 'utf-8'));

console.log(`Panel de riesgo de proveedores - pruebas por consola (sin n8n) [Hacienda: ${OFFLINE ? 'simulada' : 'real'}]`);

// 1 a 5: Registros oficiales de la base de datos local
const resultadosDB = [];
for (const pagoRaw of db.pagos) {
  const pago = new Pago(pagoRaw);
  const respHacienda = pago.requiereConsultaHacienda() ? await consultarHacienda(pago.cedula) : null;
  const res = pago.procesar(respHacienda);
  resultadosDB.push(res);
  imprimir(`Caso DB #${pagoRaw.id}: ${pagoRaw.proveedor}`, pagoRaw, res);
}

// Casos adicionales de resiliencia y borde:
const exito = db.pagos[0];
const yaProcesado = { ...exito, id: 98, estado: 'aprobado' };
imprimir('Extra 1. Registro ya procesado (se respeta estado previo)', yaProcesado, new Pago(yaProcesado).procesar(null));

const sinId = { cedula: '3101012009', monto: 1000, fecha: '2026-10-19', estado: 'pendiente' };
imprimir('Extra 2. Falta ID', sinId, new Pago(sinId).procesar(null));

const sinFecha = { id: 99, cedula: '3101012009', monto: 1000, estado: 'pendiente' };
imprimir('Extra 3. Falta fecha', sinFecha, new Pago(sinFecha).procesar(null));

// --- TABLA RESUMEN EJECUTIVA DE TELEMETRÍA ---
console.log('\n=================================================================');
console.log('       RESUMEN EJECUTIVO - TELEMETRÍA DE PAGOS (DATABASE)        ');
console.log('=================================================================');

const conteo = {
  aprobado: 0,
  retenido: 0,
  retenido_auditoria: 0,
  pendiente_verificacion_manual: 0,
  error_datos: 0,
};
let montoTotalAprobado = 0;

for (const r of resultadosDB) {
  if (conteo[r.estado] !== undefined) conteo[r.estado]++;
  if (r.estado === 'aprobado' && r.monto) montoTotalAprobado += Number(r.monto);
}

const tablaMetricas = [
  { 'Métrica Operativa': 'Total pagos procesados en DB', 'Resultado': resultadosDB.length },
  { 'Métrica Operativa': 'Aprobados con comprobante QR', 'Resultado': conteo.aprobado },
  { 'Métrica Operativa': 'Retenidos por riesgo fiscal (Hacienda)', 'Resultado': conteo.retenido },
  { 'Métrica Operativa': 'Retenidos por auditoría gerencial (>2.5M)', 'Resultado': conteo.retenido_auditoria },
  { 'Métrica Operativa': 'Pendientes de verificación manual (Fail-Safe)', 'Resultado': conteo.pendiente_verificacion_manual },
  { 'Métrica Operativa': 'Errores de datos corruptos', 'Resultado': conteo.error_datos },
  { 'Métrica Operativa': 'Monto total aprobado (CRC)', 'Resultado': `${montoTotalAprobado.toLocaleString('es-CR')} CRC` },
];

console.table(tablaMetricas);
console.log(`Balance: ${conteo.aprobado} de ${resultadosDB.length} pagos aprobados con QR. ${resultadosDB.length - conteo.aprobado} requieren revisión.\n`);
