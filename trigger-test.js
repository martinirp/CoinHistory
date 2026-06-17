const mockTx = {
  id: 'nora_fylap_payment_test_id_123',
  date: 'Jun 17 2026, 01:40:00 CEST',
  description: 'Nora Fylap gifted to you',
  character: 'Nora Fylap',
  amount: 250
};

const WEBHOOK_URL = 'http://127.0.0.1:5000/api/webhook-payment';

console.log('[*] Iniciando teste de simulacao do Webhook em Node.js...');
console.log(`[*] Enviando POST JSON para ${WEBHOOK_URL}...`);

fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(mockTx)
})
  .then(res => {
    console.log(`Status Code: ${res.status}`);
    return res.json();
  })
  .then(data => {
    console.log('Resposta do servidor:', JSON.stringify(data, null, 2));
  })
  .catch(err => {
    console.error(`[-] Erro ao conectar no webhook local: ${err.message}`);
    console.log('Certifique-se de que o servidor test-webhook.js esta rodando em outro terminal.');
  });
