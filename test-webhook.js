const http = require('http');

const PORT = 8000;

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      console.log('\n==================================================');
      console.log(`[*] [${new Date().toLocaleTimeString()}] WEBHOOK RECEBIDO!`);
      console.log('==================================================');
      
      try {
        const payload = JSON.parse(body);
        console.log(JSON.stringify(payload, null, 2));
      } catch (err) {
        console.log(`Erro ao parsear JSON: ${err.message}`);
        console.log(`Dados brutos: ${body}`);
      }
      
      console.log('==================================================\n');
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'received', timestamp: new Date().toISOString() }));
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[*] Servidor de testes rodando na porta ${PORT}...`);
  console.log(`Envie requisicoes POST para http://127.0.0.1:${PORT}/webhook`);
});
