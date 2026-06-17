const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('==================================================');
console.log('[*] INICIANDO TODOS OS SERVIÇOS (MONITOR + SERVIDOR)');
console.log('==================================================\n');

// 1. Iniciar o Servidor de Vendas (sales-site) local
const salesSiteDir = path.join(__dirname, 'sales-site');
console.log(`[*] Iniciando Servidor de Vendas em: ${salesSiteDir}`);

if (!fs.existsSync(salesSiteDir)) {
  console.error(`\n[-] ERRO CRÍTICO: A pasta do Servidor de Vendas não foi encontrada em: ${salesSiteDir}\n`);
  process.exit(1);
}

const serverProc = spawn(process.execPath, ['server.js'], {
  cwd: salesSiteDir,
  stdio: 'inherit'
});

// 2. Iniciar o Monitor de Coins
console.log(`[*] Iniciando Monitor de Coins em: ${__dirname}`);
const monitorProc = spawn(process.execPath, ['monitor.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});

// Garante que ambos morram se o processo principal for interrompido (ex: Ctrl+C)
process.on('SIGINT', () => {
  console.log('\n[*] Finalizando processos...');
  serverProc.kill('SIGINT');
  monitorProc.kill('SIGINT');
  process.exit();
});

serverProc.on('exit', (code) => {
  console.log(`[-] Servidor de Vendas finalizou com código ${code}`);
  monitorProc.kill('SIGINT');
  process.exit(code || 0);
});

monitorProc.on('exit', (code) => {
  console.log(`[-] Monitor de Coins finalizou com código ${code}`);
  serverProc.kill('SIGINT');
  process.exit(code || 0);
});
