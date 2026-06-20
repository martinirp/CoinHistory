require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const COINS_API_URL = process.env.COINS_API_URL || 'http://127.0.0.1:5001';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Confirmar pagamento e adicionar licença no GitHub keys.txt
app.post('/api/confirm-payment', async (req, res) => {
  const { character, uuid } = req.body;
  console.log(`[*] Recebida requisicao de confirmacao: Personagem='${character}', UUID='${uuid}'`);

  if (!character || !uuid) {
    return res.status(400).json({ error: 'Dados incompletos. Nome do personagem e UUID da maquina sao obrigatorios.' });
  }

  const cleanChar = character.trim();
  const cleanUuid = uuid.trim().toUpperCase();

  // Validar formato básico de UUID
  if (cleanUuid.length < 10) {
    return res.status(400).json({ error: 'UUID de maquina invalido.' });
  }

  try {
    const requiredAmount = parseInt(process.env.COINS_AMOUNT || '25', 10);
    
    // 1. Consultar a Coins API para ver se o pagamento existe e está pendente
    console.log(`[*] Consultando Coins API para '${cleanChar}' (Mínimo: ${requiredAmount} TC)...`);
    const checkUrl = `${COINS_API_URL}/api/check-payment?character=${encodeURIComponent(cleanChar)}&amount=${requiredAmount}`;
    const checkRes = await fetch(checkUrl);
    
    if (!checkRes.ok) {
      const errData = await checkRes.json();
      return res.status(checkRes.status).json({ 
        error: errData.error || 'Erro ao comunicar com a API de moedas.' 
      });
    }
    
    const checkData = await checkRes.json();
    if (!checkData.found || !checkData.payment) {
      return res.status(404).json({ 
        error: `Pagamento nao encontrado no nosso historico de Nora Fylap. Certifique-se de ter enviado ${requiredAmount} Tibia Coins de '${character}' e tente novamente.` 
      });
    }
    
    const payment = checkData.payment;
    const officialCharName = payment.character;
    
    // 2. Marcar a transação como usada na Coins API
    console.log(`[*] Marcando transacao ${payment.id} como usada na Coins API...`);
    const useUrl = `${COINS_API_URL}/api/use-payment`;
    const useRes = await fetch(useUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: payment.id,
        metadata: {
          uuid: cleanUuid,
          activatedAt: new Date().toISOString()
        }
      })
    });
    
    if (!useRes.ok) {
      const errData = await useRes.json();
      return res.status(useRes.status).json({ 
        error: errData.error || 'Erro ao resgatar a transacao de moedas na API.' 
      });
    }
    
    // 3. Adicionar a licença no GitHub
    console.log(`[*] Pagamento de '${officialCharName}' localizado e validado. Atualizando chaves no GitHub para UUID: ${cleanUuid}...`);
    await addUuidToGithub(cleanUuid, officialCharName);

    res.json({ status: 'success', message: 'Licenca ativada com sucesso!' });
  } catch (err) {
    console.error('[-] Erro ao confirmar pagamento:', err.message);
    res.status(500).json({ error: err.message || 'Erro ao processar ativacao da licenca no GitHub.' });
  }
});

// Envia a UUID autorizada para a keys.txt no GitHub
async function addUuidToGithub(uuid, character = 'Unknown') {
  const token = (process.env.MAUTH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  const owner = (process.env.HWID_REPO_OWNER || '').trim() || 'martinirp';
  const repo = (process.env.HWID_REPO_NAME || '').trim() || 'licenses';
  const path = (process.env.HWID_FILE_PATH || '').trim() || 'mauth.txt';

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

  // 1. Baixar o arquivo de licenças atual do GitHub (ou preparar criação caso não exista)
  console.log(`[*] Buscando sha do arquivo ${path} no GitHub...`);
  const getRes = await fetch(url, { headers });
  
  let currentSha = undefined;
  let contentText = "";

  if (getRes.status === 404) {
    console.log(`[*] Arquivo ${path} nao existe no GitHub. Ele sera criado automaticamente.`);
  } else if (!getRes.ok) {
    throw new Error(`Falha ao ler ${path} do GitHub: ${getRes.status} ${getRes.statusText}`);
  } else {
    const getJson = await getRes.json();
    currentSha = getJson.sha;
    contentText = Buffer.from(getJson.content, 'base64').toString('utf8');
  }

  // 2. Verificar se o UUID já está lá
  const cleanUuid = uuid.trim().toUpperCase();
  const lines = contentText.split('\n').map(l => l.trim().toUpperCase());
  if (lines.includes(cleanUuid)) {
    console.log(`[*] UUID ${cleanUuid} ja cadastrado no arquivo ${path} do GitHub.`);
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
  console.log(`[*] Gravando novo UUID no arquivo ${path} do GitHub...`);
  const putBody = {
    message: `Add authorized license key: ${cleanUuid} (${character})`,
    content: Buffer.from(updatedText, 'utf8').toString('base64'),
    branch: 'main'
  };
  
  if (currentSha) {
    putBody.sha = currentSha;
  }

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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`🚀 M-Auth Sales Server is running on port ${PORT}`);
  console.log(`🌐 Acesse localmente: http://127.0.0.1:${PORT}`);
  console.log(`==================================================`);
  
  // Keep event loop alive (necessário para evitar encerramento no PRoot/Termux)
  setInterval(() => {}, 60000);
});
