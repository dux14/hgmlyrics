// scripts/loadtest.mjs — carga ligera a endpoints de lectura.
// Uso: BASE=https://tu-deploy node scripts/loadtest.mjs
import autocannon from 'autocannon';

const BASE = process.env.BASE || 'http://localhost:3000';
const targets = ['/api/songs/all', '/api/auth/me'];

for (const path of targets) {
  console.log(`\n== ${path} ==`);
  const result = await autocannon({ url: BASE + path, connections: 10, duration: 10 });
  console.log(`p95 latency: ${result.latency.p97_5} ms | req/s: ${result.requests.average}`);
}
