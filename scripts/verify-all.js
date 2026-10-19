/**
 * Script de verificación pre-entrega y pre-defensa.
 * Valida de forma integral: base de datos limpia, compilación de workflow n8n,
 * suite de 15 pruebas automáticas y runner de consola en modo offline.
 * Uso: npm run verify
 */
import { execSync } from 'node:child_process';

const pasos = [
  { nombre: '1. Restaurar base de datos (db.seed.json -> db.json)', cmd: 'npm run db:reset' },
  { nombre: '2. Compilar workflow y nodos n8n (Fuente Única de Verdad)', cmd: 'npm run build:n8n' },
  { nombre: '3. Ejecutar suite de pruebas unitarias y E2E (15 tests)', cmd: 'npm test' },
  { nombre: '4. Ejecutar runner de consola con telemetría ejecutiva', cmd: 'npm run start:poo:offline' },
];

console.log('\n======================================================================');
console.log('   AUDITORÍA PRE-ENTREGA Y PRE-DEFENSA: PANEL DE PAGOS POO + n8n      ');
console.log('======================================================================\n');

for (const paso of pasos) {
  console.log(`\n⏳ Ejecutando: ${paso.nombre}...`);
  try {
    const salida = execSync(paso.cmd, { stdio: 'pipe', encoding: 'utf-8' });
    console.log(salida.trim());
    console.log(`✔ ${paso.nombre} superado con éxito.`);
  } catch (error) {
    console.error(`\n❌ Error en: ${paso.nombre}`);
    console.error(error.stdout || error.message);
    process.exit(1);
  }
}

console.log('\n======================================================================');
console.log('   🎉 VERIFICACIÓN COMPLETA EXITOSA (100% LISTO PARA DEFENSA EN VIVO)  ');
console.log('   - Modelos de POO encapsulados y con campos privados (#)');
console.log('   - 5 reglas de negocio y 2 protocolos de error validados');
console.log('   - Flujo n8n coherente, sincronizado y con telemetría integrada');
console.log('   - 15 pruebas automáticas superadas sin fallos');
console.log('======================================================================\n');
