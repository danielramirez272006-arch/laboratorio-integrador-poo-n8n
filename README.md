# Panel de riesgo de proveedores con comprobante QR

Laboratorio Integrador #1 — Soluciones de Negocio (POO + n8n) · Escenario 4.
Solución 100 % backend: JavaScript ES Modules (POO), Node.js, JSON Server y n8n.

## Estructura

```
database/db.json                 BD local (5 pagos pendientes)
database/db.seed.json            Copia limpia inicial para reinicio (db:reset)
src/models/Proveedor.js          Clase Proveedor (cédula y riesgo fiscal)
src/models/Pago.js               Clase Pago (reglas, auditoría, QR)
src/main.js                      Pruebas por consola con telemetría (sin n8n)
scripts/build-n8n.js             Genera el código n8n desde src/models
scripts/seed-db.js               Restaura la base de datos (npm run db:reset)
scripts/verify-all.js            Verificación integral pre-defensa (npm run verify)
n8n/codigo-nodo-n8n.js           Código del nodo "Reglas de negocio POO" (generado)
n8n/codigo-prevalidacion-n8n.js  Código del nodo "Pre-validación POO" (generado)
n8n/codigo-telemetria-n8n.js     Código del nodo "Resumen y Telemetría" (generado)
n8n/workflow-exportado.json      Workflow importable en n8n (generado)
test/                            15 pruebas automáticas (npm test)
```

## Requisitos

- Node.js 18 o superior (usa `fetch` nativo)
- n8n (local con `npx n8n`, o Docker) — solo para el workflow
- Conexión a Internet (API de Hacienda y qrserver)

## Pasos

1. Clonar e instalar:
   ```bash
   git clone <url-del-repositorio>
   cd <carpeta>
   npm install
   ```
2. Probar la lógica POO y verificar el proyecto completo:
   ```bash
   npm run verify               # Verificación integral pre-entrega (db + build + 15 tests + runner)
   npm run start:poo            # Consulta Hacienda en tiempo real
   npm run start:poo:offline    # Simulación local determinista con telemetría ejecutiva
   npm test                     # 15 pruebas automáticas (POO + nodos n8n + E2E)
   ```
3. Levantar JSON Server (puerto 3000):
   ```bash
   npm run start:api
   ```
   Verificar en <http://localhost:3000/pagos>.
4. Iniciar n8n (`npx n8n`, <http://localhost:5678>), menú **Import from file** →
   `n8n/workflow-exportado.json`.
   > **Nota Docker:** Si ejecutas n8n en Docker, compila el workflow con:
   > ```bash
   > npm run build:n8n:docker
   > ```
   > Esto configura automáticamente `host.docker.internal:3000` en los nodos HTTP.
5. Pulsar **Execute workflow**. Los pagos quedan actualizados en `database/db.json`
   (estado, motivo, historial de auditoría, referencia y URL del QR).
6. Para reiniciar los datos de prueba en cualquier momento tras una ejecución:
   ```bash
   npm run db:reset
   ```

## Fuente única de verdad

La lógica vive solo en `src/models/`. Tras cualquier cambio ejecute:

```bash
npm run build:n8n
```

Esto regenera `n8n/codigo-nodo-n8n.js` y el workflow, con las mismas clases (sin `import`/`export`).
`npm test` falla si esos archivos quedan desincronizados de `src/models/`.

## Bifurcación del workflow

El flujo tiene dos nodos IF:

1. `¿Datos válidos? (consultar Hacienda)`: tras el nodo `Pre-validación POO`, los pagos con datos
   corruptos (o ya procesados) **no consultan a Hacienda** y van directo al PUT de revisión.
2. `¿Pago aprobado?`: la rama aprobada guarda el pago con
`requiereRevision: false`; la otra (retenido, retenido_auditoria, error_datos,
pendiente_verificacion_manual) lo guarda con `requiereRevision: true`, para que una
persona lo revise. Cada decisión se agrega a `historial` (bitácora con fecha y motivo).
Limitación: el nodo Code depende del nombre `Pre-validación POO`; no lo renombre.

## Estados posibles

| Estado | Causa |
|---|---|
| `aprobado` | Al día en Hacienda y monto ≤ 2,500,000 CRC; genera QR |
| `retenido` | Moroso, omiso, desinscrito o suspendido |
| `retenido_auditoria` | Monto > 2,500,000 CRC |
| `pendiente_verificacion_manual` | Hacienda caída/timeout/sin datos (Fail-Safe) |
| `error_datos` | Falta ID, monto ≤ 0 o cédula inválida |

## Casos de prueba en database/db.json

| ID | Proveedor | Cédula | Monto | Resultado esperado |
|---|---|---|---|---|
| 1 | Banco BAC San José | 3101012009 | 350,000 | `aprobado` + QR generado |
| 2 | Banco BAC San José | 3101012009 | 5,000,000 | `retenido_auditoria` (monto > 2.5M) |
| 3 | Transportes Rey del Sur S.A. | 3101307520 | 180,000 | `retenido` (moroso y omiso real en Hacienda) |
| 4 | Proveedor Fantasma S.A. | 999999999999 | 120,000 | `pendiente_verificacion_manual` (Fail-Safe) |
| 5 | Proveedor con datos corruptos | ABC-123 | -500 | `error_datos` (cédula y monto inválidos) |
