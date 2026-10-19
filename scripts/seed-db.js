import { copyFileSync, readFileSync } from 'node:fs';

const seedPath = new URL('../database/db.seed.json', import.meta.url);
const destPath = new URL('../database/db.json', import.meta.url);

// 1. Restaurar archivo en disco
copyFileSync(seedPath, destPath);
console.log('✔ Base de datos database/db.json restaurada con éxito desde db.seed.json');

// 2. Si json-server está corriendo en el puerto 3000, sincronizar su memoria por API
try {
  const seed = JSON.parse(readFileSync(seedPath, 'utf-8'));
  const res = await fetch('http://localhost:3000/pagos', { signal: AbortSignal.timeout(1000) });
  if (res.ok) {
    for (const p of seed.pagos) {
      await fetch(`http://localhost:3000/pagos/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
    }
    console.log('✔ Memoria de JSON Server (puerto 3000) sincronizada con los 5 casos en estado pendiente.');
  }
} catch {
  // json-server no está corriendo; no pasa nada, leerá de disco al iniciar.
}
