// Menjalankan game dan mencetak alamat untuk peserta di jaringan yang sama.
const { spawn } = require('node:child_process');
const os = require('node:os');

const game = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: 'inherit' });
const ips = Object.values(os.networkInterfaces()).flat()
  .filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
console.log('\n=== MISI PASAR PIXEL ===');
console.log('Pemain di PC ini : http://localhost:3003');
for (const ip of ips) console.log(`Pemain di PC lain: http://${ip}:3003`);
console.log('');
const stop = () => game.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
game.on('exit', (kode) => { process.exitCode = kode || 0; });
