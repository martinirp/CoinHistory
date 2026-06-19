require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const puppeteer = require('puppeteer');
const fs = require('fs');
const crypto = require('crypto');
const OTPAuth = require('otpauth');

// Carregar variáveis de ambiente
const { TIBIA_EMAIL, TIBIA_PASSWORD, TIBIA_TOTP_KEY, WEBHOOK_URL, PUPPETEER_EXECUTABLE_PATH } = process.env;
const POLL_INTERVAL_SECONDS = parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10);
const HEADLESS = process.env.HEADLESS === 'true';
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 OPR/95.0.0.0';

// Arquivos de persistência
const COOKIES_FILE = 'cookies.json';
const LAST_SEEN_FILE = 'last_seen_tx.json';

// Gerador de Token TOTP (2FA)
function getTotpToken(secret) {
  if (!secret) return null;
  try {
    const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
    const totp = new OTPAuth.TOTP({
      secret: cleanSecret
    });
    return totp.generate();
  } catch (err) {
    console.error(`[-] Erro ao gerar token TOTP: ${err.message}`);
    return null;
  }
}

// Fluxo de login e salvamento de sessão
// Renova a sessão usando o SeleniumBase UC Mode (script em Python)
function renewSession() {
  const { execSync } = require('child_process');
  const path = require('path');
  const scriptPath = path.join(__dirname, '..', 'TibiaScraperTest', 'sb_login.py');
  
  console.log(`[*] Executando sb_login.py para renovar a sessao no Tibia...`);
  try {
    const stdout = execSync(`python "${scriptPath}"`, { encoding: 'utf8' });
    console.log(stdout);
    return stdout.includes('Cookies de sessao salvos com sucesso');
  } catch (err) {
    console.error(`[-] Erro ao executar sb_login.py: ${err.message}`);
    return false;
  }
}

// Recuperar e parsear a página de moedas usando a sessão ativa
async function fetchCoinsTransactions() {
  const { exec } = require('child_process');
  
  return new Promise((resolve) => {
    console.log('[*] Executando scraper.py em segundo plano...');
    exec('python scraper.py', (error, stdout, stderr) => {
      if (error) {
        console.error(`[-] Erro ao executar scraper.py: ${error.message}`);
        return resolve(null);
      }
      if (stderr && stderr.trim()) {
        console.warn(`[!] Aviso no stderr do scraper.py: ${stderr}`);
      }
      
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error === 'session_expired') {
          console.log('[*] A sessao expirou ou e invalida. Por favor, atualize o session_cookie.txt.');
          return resolve(null);
        }
        if (result.error) {
          console.error(`[-] Erro retornado pelo scraper.py: ${result.error}`);
          return resolve(null);
        }
        if (result.status === 'success') {
          return resolve(result.transactions);
        }
        return resolve(null);
      } catch (err) {
        console.error(`[-] Erro ao decodificar saida do scraper.py: ${err.message}. Saida bruta: ${stdout}`);
        return resolve(null);
      }
    });
  });
}

// Disparo de Webhook
async function triggerWebhook(tx) {
  if (!WEBHOOK_URL) {
    console.log('[*] WEBHOOK_URL nao configurada no arquivo .env. Pulando envio.');
    return;
  }

  try {
    console.log(`[*] Disparando webhook para transacao ${tx.id}...`);
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tx)
    });
    
    const text = await response.text();
    if (response.ok) {
      console.log(`[*] Webhook enviado com sucesso! Resposta: ${text}`);
    } else {
      console.log(`[*] Webhook retornou status ${response.status}: ${text}`);
    }
  } catch (err) {
    console.error(`[*] Erro ao disparar Webhook: ${err.message}`);
  }
}

// Carregar e salvar histórico local
function loadLastSeenTx() {
  if (fs.existsSync(LAST_SEEN_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(LAST_SEEN_FILE, 'utf8'));
    } catch (err) {
      return {};
    }
  }
  return {};
}

function saveLastSeenTx(txMap) {
  try {
    fs.writeFileSync(LAST_SEEN_FILE, JSON.stringify(txMap, null, 2), 'utf8');
  } catch (err) {
    console.error(`[-] Erro ao salvar log de transacoes: ${err.message}`);
  }
}

// Loop de Monitoramento
async function monitorLoop() {
  console.log('==================================================');
  console.log('[*] INICIANDO MONITOR DE TIBIA COINS (NODE.JS)');
  console.log('==================================================');
  console.log(`Configuracoes:`);
  console.log(`  E-mail: ${TIBIA_EMAIL}`);
  console.log(`  Webhook: ${WEBHOOK_URL}`);
  console.log(`  Verificacao a cada: ${POLL_INTERVAL_SECONDS} segundos`);
  console.log(`  Headless: ${HEADLESS}`);
  console.log('==================================================');

  if (!TIBIA_EMAIL || !TIBIA_PASSWORD) {
    console.error('[*] ERRO: TIBIA_EMAIL e TIBIA_PASSWORD devem estar configurados no .env');
    process.exit(1);
  }

  // Login primario se session_cookie nao existir
  if (!fs.existsSync('session_cookie.txt')) {
    console.log('[*] Sessao nao encontrada. Executando primeiro login...');
    const loginOk = renewSession();
    if (!loginOk) {
      console.error('[*] Nao foi possivel iniciar o monitor sem logar.');
      process.exit(1);
    }
  }

  let lastSeen = loadLastSeenTx();
  let firstRun = Object.keys(lastSeen).length === 0;

  if (firstRun) {
    console.log('[*] Primeira execucao detectada. Sincronizando transacoes atuais (nao enviara webhooks)...');
  }

  while (true) {
    try {
      console.log(`\n[*] [${new Date().toLocaleTimeString()}] Verificando historico de Tibia Coins...`);
      let transactions = await fetchCoinsTransactions();

      // Se der sessão expirada (retornar null), renova o login usando o SeleniumBase UC Mode
      if (transactions === null) {
        console.log('[*] Tentando renovar a sessao realizando login automatico...');
        const loginOk = renewSession();
        if (loginOk) {
          transactions = await fetchCoinsTransactions();
        }
      }

      if (transactions) {
        console.log(`[*] ${transactions.length} transacoes encontradas na pagina.`);
        let newTxFound = false;

        // Iterar de tras para frente para seguir a ordem cronológica
        for (let i = transactions.length - 1; i >= 0; i--) {
          const tx = transactions[i];
          if (!lastSeen[tx.id]) {
            lastSeen[tx.id] = tx;
            newTxFound = true;

            if (!firstRun) {
              if (tx.amount > 0) {
                console.log(`[*] [NOVO RECEBIMENTO] ${tx.amount} TC de '${tx.character}'!`);
                await triggerWebhook(tx);
              } else {
                console.log(`[*] [NOVO GASTO] ${tx.amount} TC detectado. Pulando Webhook.`);
              }
            } else {
              console.log(`Sincronizado historico antigo: ${tx.date} | ${tx.amount} TC`);
            }
          }
        }

        if (newTxFound) {
          saveLastSeenTx(lastSeen);
        }

        if (firstRun) {
          firstRun = false;
          console.log('[*] Sincronizacao inicial concluida com sucesso! Escutando novos recebimentos...');
        }
      } else {
        console.log('[*] Nao foi possivel ler o historico nesta iteracao.');
      }
    } catch (err) {
      console.error(`[*] Erro inesperado na verificacao: ${err.message}`);
    }

    console.log(`[*] Aguardando ${POLL_INTERVAL_SECONDS} segundos para a proxima verificacao...`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_SECONDS * 1000));
  }
}

// Executar loop
monitorLoop().catch(err => {
  console.error(`[-] Falha critica no monitor: ${err.message}`);
  process.exit(1);
});
