require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const crypto = require('crypto');
const OTPAuth = require('otpauth');

// Carregar variáveis de ambiente
const { TIBIA_EMAIL, TIBIA_PASSWORD, TIBIA_TOTP_KEY, WEBHOOK_URL } = process.env;
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
async function loginAndSaveSession() {
  console.log('[*] Iniciando navegador para realizar login...');
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    const loginUrl = 'https://www.tibia.com/account/?subtopic=accountmanagement';
    console.log(`[*] Navegando para ${loginUrl}...`);
    await page.goto(loginUrl, { waitUntil: 'load' });

    // Espera até 15 segundos pela caixa de login ou pela confirmação de logado
    try {
      await Promise.race([
        page.waitForSelector('input[name="loginemail"]', { visible: true, timeout: 15000 }),
        page.waitForSelector('a[href*="page=logout"]', { visible: true, timeout: 15000 })
      ]);
    } catch (err) {
      console.log(`[*] Timeout ao esperar tela de login/logout: ${err.message}`);
    }

    const content = await page.content();
    if (content.includes('Logout')) {
      console.log('[*] Ja logado! Salvando cookies...');
      const cookies = await page.cookies();
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
      await browser.close();
      return true;
    }

    console.log('[*] Preenchendo e-mail e senha...');
    await page.type('input[name="loginemail"]', TIBIA_EMAIL);
    await page.type('input[name="loginpassword"]', TIBIA_PASSWORD);

    console.log('[*] Clicando no login...');
    await Promise.all([
      page.click('form[action*="accountmanagement"] input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {})
    ]);

    // Verificar se a tela de 2FA (token) é exibida
    const tokenInput = await page.$('input[name="token"]');
    if (tokenInput) {
      console.log('[*] Campo de token 2FA detectado. Gerando codigo TOTP...');
      const code = getTotpToken(TIBIA_TOTP_KEY);
      if (!code) {
        throw new Error('Chave TOTP invalida ou ausente no .env');
      }
      console.log(`[*] Token gerado: ${code}. Preenchendo...`);
      await page.type('input[name="token"]', code);

      console.log('[*] Enviando token 2FA...');
      await Promise.all([
        page.click('form[action*="accountmanagement"] input[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {})
      ]);
    }

    const contentAfterLogin = await page.content();
    if (contentAfterLogin.includes('Logout')) {
      console.log('[*] Login efetuado com sucesso!');
      const cookies = await page.cookies();
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
      await browser.close();
      return true;
    } else {
      console.log('[*] Falha no login. Verifique as credenciais ou a chave TOTP.');
      await page.screenshot({ path: 'login_failed.png' });
      console.log('[*] Screenshot da tela de erro salva como "login_failed.png".');
      await browser.close();
      return false;
    }
  } catch (err) {
    console.error(`[*] Erro durante o login: ${err.message}`);
    try {
      await page.screenshot({ path: 'login_error.png' });
      console.log('[*] Screenshot do erro salva como "login_error.png".');
    } catch (scre) {}
    await browser.close();
    return false;
  }
}

// Recuperar e parsear a página de moedas usando a sessão ativa
async function fetchCoinsTransactions() {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    if (fs.existsSync('session_cookie.txt')) {
      const cookieStr = fs.readFileSync('session_cookie.txt', 'utf8').trim();
      
      // Converte a string de cookie "chave=valor; chave2=valor2" em objetos que o Puppeteer entende no Cookie Jar
      const cookies = cookieStr.split(';').map(pair => {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) return null;
        const name = pair.substring(0, eqIdx).trim();
        const value = pair.substring(eqIdx + 1).trim();
        return {
          name,
          value,
          domain: '.tibia.com',
          path: '/',
          secure: true,
          sameSite: 'Lax'
        };
      }).filter(Boolean);
      
      await page.setCookie(...cookies);
    } else if (fs.existsSync(COOKIES_FILE)) {
      const cookiesString = fs.readFileSync(COOKIES_FILE, 'utf8');
      const cookies = JSON.parse(cookiesString);
      await page.setCookie(...cookies);
    } else {
      console.log('[*] cookies.json ou session_cookie.txt nao encontrados.');
      await browser.close();
      return null;
    }

    const historyUrl = 'https://www.tibia.com/account/?subtopic=accountmanagement&page=tibiacoinshistory';
    console.log(`[*] Acessando historico de coins: ${historyUrl}...`);
    await page.goto(historyUrl, { waitUntil: 'load' });

    // Verificar se a sessão expirou
    const content = await page.content();
    if (content.includes('input[name="loginemail"]') || !content.includes('Logout')) {
      console.log('[*] Sessao expirada ou cookies invalidos!');
      await page.screenshot({ path: 'history_error.png' });
      await browser.close();
      return null;
    }

    console.log(`[*] Pagina carregada com sucesso. Titulo: "${await page.title()}".`);
    try {
      await page.screenshot({ path: 'history_success.png' });
    } catch (e) {
      console.log(`[-] Erro ao salvar screenshot de sucesso: ${e.message}`);
    }

    // Extrair tabela do site dentro do contexto do navegador
    const tableData = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const targetTable = tables.find(t => {
        const text = t.innerText.toLowerCase();
        return text.includes('date') && (text.includes('balance') || text.includes('description'));
      });
      if (!targetTable) return [];

      const rows = Array.from(targetTable.querySelectorAll('tr')).slice(1); // Pular cabecalho
      return rows.map(row => {
        const cols = Array.from(row.querySelectorAll('td'));
        // A linha correta tem 6 colunas: #, Date, Description, Character, Balance, Info
        if (cols.length < 5) return null;
        return {
          date: cols[1].innerText.trim(),
          description: cols[2].innerText.trim(),
          amountStr: cols[4].innerText.trim()
        };
      }).filter(Boolean);
    });

    await browser.close();

    // Limpar e formatar transações no contexto do Node.js
    return tableData.map(tx => {
      const amountClean = tx.amountStr.replace(/[^0-9+-]/g, '');
      const amount = parseInt(amountClean, 10) || 0;
      const combined = `${tx.date}-${tx.description}-${amount}`;
      const id = crypto.createHash('md5').update(combined).digest('hex');

      let character = 'System';
      const desc = tx.description.toLowerCase();
      if (desc.includes('gifted to')) {
        character = tx.description.split(/ gifted to/i)[0].trim();
      } else if (desc.includes('gifted from')) {
        character = tx.description.split(/from /i)[1]?.trim() || 'System';
      } else if (desc.includes('sent to')) {
        character = tx.description.split(/to /i)[1]?.trim() || 'System';
      }

      return { id, date: tx.date, description: tx.description, character, amount };
    });

  } catch (err) {
    console.error(`[*] Erro ao acessar historico de moedas: ${err.message}`);
    await browser.close();
    return null;
  }
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

  // Login primario se cookies ou session_cookie nao existirem
  if (!fs.existsSync('session_cookie.txt') && !fs.existsSync(COOKIES_FILE)) {
    console.log('[*] Sessao nao encontrada. Executando primeiro login...');
    const loginOk = await loginAndSaveSession();
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

      // Se der sessão expirada (retornar null), renova o login
      if (transactions === null) {
        if (fs.existsSync('session_cookie.txt')) {
          console.log('[*] A sessao do seu session_cookie.txt expirou ou e invalida! Por favor, atualize o cookie no arquivo.');
        } else {
          console.log('[*] Tentando renovar a sessao realizando novo login...');
          const loginOk = await loginAndSaveSession();
          if (loginOk) {
            transactions = await fetchCoinsTransactions();
          }
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
