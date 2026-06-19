import os
import sys
import json
import time
import pyotp
from seleniumbase import SB

def load_env(env_path):
    env_vars = {}
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    key_val = line.split('=', 1)
                    if len(key_val) == 2:
                        key = key_val[0].strip()
                        val = key_val[1].strip()
                        if val.startswith(('"', "'")) and val.endswith(('"', "'")):
                            val = val[1:-1]
                        env_vars[key] = val
    return env_vars

# Configurações de credenciais
env = load_env('.env')
email = env.get('TIBIA_EMAIL')
password = env.get('TIBIA_PASSWORD')
totp_secret = env.get('TIBIA_TOTP_KEY')

if not email or not password or not totp_secret:
    print("[-] ERRO: Credenciais ou chave TOTP ausentes no arquivo .env.")
    sys.exit(1)

url = "https://www.tibia.com/account/?subtopic=accountmanagement"
print(f"[*] Iniciando SeleniumBase UC Mode para {url}...")

# UC=True ativa o Undetected-Chromedriver para burlar Cloudflare Turnstile
# xvfb=True roda o navegador real em um display virtual na memoria (melhor para burlar Cloudflare)
# chromium_arg="--no-sandbox,--disable-dev-shm-usage" e essencial para rodar no Termux PRoot
with SB(uc=True, xvfb=True, browser="chrome", chromium_arg="--no-sandbox,--disable-dev-shm-usage,--disable-gpu,--single-process") as sb:
    print("[*] Acessando a pagina do Tibia...")
    # reconnect_time maior para dispositivos ARM lentos (Termux)
    sb.uc_open_with_reconnect(url, reconnect_time=8)
    sb.sleep(3)
    sb.save_screenshot("sb_step0_after_open.png")
    print("[*] Screenshot salvo: sb_step0_after_open.png")

    print("[*] Verificando se o Cloudflare Turnstile apareceu...")
    try:
        # uc_gui_handle_captcha() e mais robusto que uc_gui_click_captcha() em headless/ARM
        sb.uc_gui_handle_captcha()
        print("[+] Captcha tratado ou nao encontrado (seguindo adiante)...")
    except Exception as e:
        print(f"[*] Nota do Captcha: {e}")

    # Pausa extra para o Cloudflare liberar e a pagina redirecionar
    sb.sleep(4)
    sb.save_screenshot("sb_step0b_after_captcha.png")

    # Verifica se ainda esta preso no challenge do Cloudflare
    page_source_check = sb.get_page_source()
    if "Just a moment" in page_source_check or "Checking your browser" in page_source_check:
        print("[!] Cloudflare ainda ativo. Tentando reconexao adicional...")
        sb.uc_open_with_reconnect(url, reconnect_time=6)
        sb.sleep(4)
        try:
            sb.uc_gui_handle_captcha()
        except Exception:
            pass
        sb.sleep(4)
        sb.save_screenshot("sb_step0c_retry_captcha.png")

    print("[*] Aguardando o carregamento dos campos de login...")
    try:
        sb.wait_for_element('input[name="loginemail"]', timeout=45)
        print("[+] Pagina de login carregada com sucesso!")
        sb.save_screenshot("sb_step1_login_ready.png")
    except Exception as e:
        sb.save_screenshot("sb_step1_error.png")
        print("[-] Timeout: Nao foi possivel carregar a tela de login.")
        print("    Verifique: sb_step0_after_open.png, sb_step0b_after_captcha.png, sb_step1_error.png")
        # Imprime o titulo da pagina e URL atual para diagnostico
        try:
            print(f"    URL atual: {sb.get_current_url()}")
            print(f"    Titulo da pagina: {sb.get_title()}")
        except Exception:
            pass
        raise e
        
    print("[*] Preenchendo e-mail e senha...")
    sb.type('input[name="loginemail"]', email)
    # Enviamos a senha seguida de \n para submeter o formulário pressionando Enter
    sb.type('input[name="loginpassword"]', password + '\n')
    sb.save_screenshot("sb_step2_credentials_submitted.png")
    sb.sleep(4)
    
    # Verifica se a autenticacao 2FA (TOTP) e solicitada
    is_totp_requested = False
    try:
        sb.wait_for_element('input[name="totp"]', timeout=6)
        is_totp_requested = True
    except Exception:
        # Se não achou, lista os inputs presentes para depuração
        print("[*] Campo totp nao encontrado na checagem inicial. Inputs presentes na pagina:")
        try:
            inputs = sb.find_elements('input')
            for inp in inputs:
                print(f"  - name='{inp.get_attribute('name')}', type='{inp.get_attribute('type')}'")
        except Exception as e:
            print(f"  Erro ao listar inputs: {e}")
            
    if is_totp_requested:
        print("[*] 2FA (TOTP) solicitado! Gerando token...")
        clean_secret = totp_secret.replace(" ", "").upper()
        totp = pyotp.TOTP(clean_secret)
        totp_code = totp.now()
        print(f"[*] Token gerado: {totp_code}. Preenchendo...")
        # Enviamos o token seguido de \n para submeter pressionando Enter
        sb.type('input[name="totp"]', totp_code + '\n')
        sb.save_screenshot("sb_step3_totp_submitted.png")
        sb.sleep(5)
        
    sb.save_screenshot("sb_step4_final.png")
    page_source = sb.get_page_source()
    
    if "Logout" in page_source:
        print("[+] LOGIN BEM SUCEDIDO!")
        
        # Navega até o histórico de coins
        history_url = "https://www.tibia.com/account/?subtopic=accountmanagement&page=tibiacoinshistory"
        print(f"[*] Navegando ate o historico de coins: {history_url}...")
        sb.open(history_url)
        sb.sleep(4)
        sb.save_screenshot("sb_step5_coins_history.png")
        
        # Extrai os cookies e formata para o session_cookie.txt
        cookies = sb.get_cookies()
        cookie_parts = []
        for cookie in cookies:
            cookie_parts.append(f"{cookie['name']}={cookie['value']}")
        cookie_string = "; ".join(cookie_parts)
        
        cookie_file_path = "session_cookie.txt"
        with open(cookie_file_path, "w", encoding="utf-8") as f:
            f.write(cookie_string)
            
        print(f"[+] Cookies de sessao salvos com sucesso em {cookie_file_path}!")
    else:
        print("[-] Falha no login. Verifique sb_step4_final.png para entender o que aconteceu.")
