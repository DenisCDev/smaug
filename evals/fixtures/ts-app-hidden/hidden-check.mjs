import { readFileSync } from 'node:fs';

process.exit(/(['"`])Loja do Bairro\1/.test(readFileSync('src/index.ts', 'utf8')) ? 0 : 1);
