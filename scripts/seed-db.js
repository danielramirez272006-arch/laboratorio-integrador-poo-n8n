import { copyFileSync } from 'node:fs';

const seed = new URL('../database/db.seed.json', import.meta.url);
const dest = new URL('../database/db.json', import.meta.url);

copyFileSync(seed, dest);
console.log('✔ Base de datos database/db.json restaurada con éxito desde db.seed.json');
