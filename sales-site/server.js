require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PAYMENTS_FILE = path.join(__dirname, 'payments.json');

// Carrega os pagamentos recebidos pelo webhook
function loadPayments() {
  if (fs.existsSync(PAYMENTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8'));
    } catch (err) {
      return [];
    }
  }
  return [];
}

// Salva os pagamentos
function savePayments(payments) {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2), 'utf8');
  } catch (err) {
    console.error('[-] Erro ao salvar banco de pagamentos:', err.message);
  }
}

// Proxy para buscar dados do personagem no TibiaData (para evitar CORS)
app.get('/api/character/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const url = `https://api.tibiadata.com/v4/character/${encodeURIComponent(name)}`;
    console.log(`[*] Buscando personagem '${name}' na API TibiaData...`);
    
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Erro ao consultar a API TibiaData' });
    }
    
    const data = await response.json();
    if (!data.character || !data.character.character || !data.character.character.name) {
      return res.status(404).json({ error: 'Personagem nao encontrado' });
    }
    
    // Retornar dados simplificados
    const char = data.character.character;
    res.json({
      name: char.name,
      world: char.world,
      level: char.level,
      vocation: char.vocation
    });
  } catch (err) {
    console.error('[-] Erro no proxy do TibiaData:', err.message);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Receber webhook do script de monitoramento
app.post('/api/webhook-payment', (req, res) => {
  try {
    const tx = req.body;
    console.log(`[*] Webhook recebido:`, tx);

    if (!tx || !tx.id || !tx.character || !tx.amount) {
      return res.status(400).json({ error: 'Payload invalido' });
    }

    const payments = loadPayments();
    
    // Evitar duplicidade de transações
    const exists = payments.some(p => p.id === tx.id);
    if (!exists) {
      payments.push({
        id: tx.id,
        date: tx.date,
        character: tx.character,
        amount: tx.amount,
        used: false,
        receivedAt: new Date().toISOString()
      });
      savePayments(payments);
      console.log(`[+] Pagamento registrado com sucesso: ${tx.amount} TC de '${tx.character}'`);
    } else {
      console.log(`[*] Pagamento ${tx.id} ja estava registrado.`);
    }

    res.json({ status: 'success' });
  } catch (err) {
    console.error('[-] Erro ao processar webhook:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Confirmar pagamento e adicionar licença no GitHub keys.txt
app.post('/api/confirm-payment', async (req, res) => {
  const { character, uuid } = req.body;

  if (!character || !uuid) {
    return res.status(400).json({ error: 'Dados incompletos. Nome do personagem e UUID da maquina sao obrigatorios.' });
  }

  const cleanChar = character.trim().toLowerCase();
  const cleanUuid = uuid.trim().toUpperCase();

  // Validar formato básico de UUID
  if (cleanUuid.length < 10) {
    return res.status(400).json({ error: 'UUID de maquina invalido.' });
  }

  try {
    const payments = loadPayments();
    
    // Procurar uma transação válida (não usada) do personagem correto, com valor de moedas maior ou igual ao configurado
    const requiredAmount = parseInt(process.env.COINS_AMOUNT || '25', 10);
    const paymentIdx = payments.findIndex(p => 
      p.character.trim().toLowerCase() === cleanChar && 
      p.amount >= requiredAmount && 
      !p.used
    );

    if (paymentIdx === -1) {
      return res.status(404).json({ 
        error: `Pagamento nao encontrado no nosso historico de Nora Fylap. Certifique-se de ter enviado ${requiredAmount} Tibia Coins de '${character}' e aguarde alguns segundos.` 
      });
    }

    const officialCharName = payments[paymentIdx].character;
    // Pagamento encontrado! Adicionar a licença no GitHub
    console.log(`[*] Pagamento de '${officialCharName}' localizado. Atualizando chaves no GitHub para UUID: ${cleanUuid}...`);
    await addUuidToGithub(cleanUuid, officialCharName);

    // Marcar pagamento como usado e salvar
    payments[paymentIdx].used = true;
    payments[paymentIdx].usedByUuid = cleanUuid;
    payments[paymentIdx].usedAt = new Date().toISOString();
    savePayments(payments);

    res.json({ status: 'success', message: 'Licenca ativada com sucesso!' });
  } catch (err) {
    console.error('[-] Erro ao confirmar pagamento:', err.message);
    res.status(500).json({ error: err.message || 'Erro ao processar ativacao da licenca no GitHub.' });
  }
});

// Envia a UUID autorizada para a keys.txt no GitHub
async function addUuidToGithub(uuid, character = 'Unknown') {
  const token = (process.env.MAUTH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  const owner = (process.env.HWID_REPO_OWNER || '').trim();
  const repo = (process.env.HWID_REPO_NAME || '').trim();
  const path = (process.env.HWID_FILE_PATH || '').trim();

  console.log(`[*] addUuidToGithub configs: owner='${owner}', repo='${repo}', path='${path}', tokenLength=${token.length}`);

  if (!token || token.includes('insira_seu_token')) {
    throw new Error('Chave de API do GitHub (MAUTH_GITHUB_TOKEN) nao configurada no .env do servidor de vendas.');
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Mauth-Sales-App'
  };

  // 1. Baixar o keys.txt atual do GitHub
  console.log(`[*] Buscando sha do arquivo ${path} no GitHub...`);
  const getRes = await fetch(url, { headers });
  if (!getRes.ok) {
    throw new Error(`Falha ao ler keys.txt do GitHub: ${getRes.status} ${getRes.statusText}`);
  }
  const getJson = await getRes.json();
  const currentSha = getJson.sha;
  const contentText = Buffer.from(getJson.content, 'base64').toString('utf8');

  // 2. Verificar se o UUID já está lá
  const cleanUuid = uuid.trim().toUpperCase();
  const lines = contentText.split('\n').map(l => l.trim().toUpperCase());
  if (lines.includes(cleanUuid)) {
    console.log(`[*] UUID ${cleanUuid} ja cadastrado no keys.txt do GitHub.`);
    return true;
  }

  // 3. Adicionar o UUID ao arquivo
  let updatedText = contentText;
  if (!updatedText.endsWith('\n') && updatedText.length > 0) {
    updatedText += '\n';
  }
  updatedText += `# Boneco: ${character}\n`;
  updatedText += `${cleanUuid}\n`;

  // 4. Salvar de volta no GitHub (PUT)
  console.log(`[*] Gravando novo UUID no arquivo keys.txt do GitHub...`);
  const putBody = {
    message: `Add authorized license key: ${cleanUuid} (${character})`,
    content: Buffer.from(updatedText, 'utf8').toString('base64'),
    sha: currentSha,
    branch: 'main'
  };

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(putBody)
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`Erro ao gravar dados no GitHub: ${putRes.status} - ${errText}`);
  }

  console.log('[*] Licenca gravada e commitada com sucesso!');
  return true;
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 M-Auth Sales Server is running on port ${PORT}`);
  console.log(`🌐 Acesse localmente: http://127.0.0.1:${PORT}`);
  console.log(`==================================================`);
});
