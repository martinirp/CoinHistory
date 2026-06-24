document.addEventListener('DOMContentLoaded', () => {
    // Referências dos Elementos
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    const step4 = document.getElementById('step-4');

    const dot1 = document.getElementById('dot-1');
    const dot2 = document.getElementById('dot-2');
    const dot3 = document.getElementById('dot-3');

    const inputCharName = document.getElementById('char-name');
    const inputHwidUuid = document.getElementById('hwid-uuid');

    const btnNext1 = document.getElementById('btn-next-1');
    const btnNext2 = document.getElementById('btn-next-2');
    const btnBack2 = document.getElementById('btn-back-2');
    const btnBack3 = document.getElementById('btn-back-3');
    const btnConfirm = document.getElementById('btn-confirm');

    const previewName = document.getElementById('preview-name');
    const previewWorld = document.getElementById('preview-world');
    const previewLevel = document.getElementById('preview-level');
    const previewVocation = document.getElementById('preview-vocation');

    const paymentLoader = document.getElementById('payment-loader');
    const paymentError = document.getElementById('payment-error');
    const successUuid = document.getElementById('success-uuid');

    // Dados Locais do Checkout
    let checkoutData = {
        character: '',
        uuid: ''
    };

    let activeProduct = 'mauth';

    const PRODUCTS_DATA = {
        mauth: {
            title: 'M·Auth',
            description: 'Desbloqueie o poder do autenticador de contas definitivo. Uma ferramenta portátil, criptografada localmente e integrada ao Windows para automação instantânea sem perda de contas.',
            downloadUrl: 'https://github.com/martinirp/mauth-public/releases/latest/download/mauth-setup.exe',
            coinsAmount: 25,
            uuidDesc: 'UUID exibida na tela vermelha de bloqueio do seu M-Auth.',
            fileLabel: 'UUID Habilitada no mauth.txt:',
            infoNote: 'Você já pode abrir o seu M·Auth. A tela de bloqueio sumirá e o app iniciará normalmente.',
            features: [
                {
                    icon: '🛡️',
                    title: 'Segurança Offline e Criptografia',
                    desc: 'As contas e senhas mestras ficam salvas apenas no seu computador com proteção AES-256.'
                },
                {
                    icon: '⚡',
                    title: 'Automação PowerShell Avançada',
                    desc: 'Otimize sua gameplay com o Login Automatizado stealth, Loot Splitter de alta precisão e Smart Exit de resposta instantânea para situações críticas.'
                },
                {
                    icon: '🔄',
                    title: 'Sincronização Integrada',
                    desc: 'Acompanhe level, vocação e status de login dos seus personagens diretamente no grid do app.'
                }
            ]
        },
        bossbot: {
            title: 'BossBot 2',
            description: 'Gerencie inscrições de bosses no WhatsApp e dispare alertas de emergência via Pushover com extrema facilidade, estabilidade e sirenes de alta prioridade.',
            downloadUrl: 'https://github.com/martinirp/bossbot-releases/releases/latest/download/bossbot-setup.exe',
            coinsAmount: 1000,
            uuidDesc: 'UUID exibida na tela de bloqueio do seu BossBot.',
            fileLabel: 'UUID Habilitada no bossbot.txt:',
            infoNote: 'Você já pode abrir o seu BossBot 2. A tela de ativação sumirá e o bot iniciará normalmente.',
            features: [
                {
                    icon: '🐲',
                    title: 'Integração com WhatsApp',
                    desc: 'Conecte o bot via QR Code e gerencie as inscrições em bosses diretamente de qualquer grupo ou chat privado.'
                },
                {
                    icon: '📢',
                    title: 'Alertas de Emergência Pushover',
                    desc: 'Dispare notificações persistentes que tocam sirenes repetidamente no celular, ignorando o modo Não Perturbe.'
                },
                {
                    icon: '⚙️',
                    title: 'Comandos Simples de Admin',
                    desc: 'Adicione grupos com !addgroup, gerencie bosses com !boss e confirme aparições facilmente no jogo.'
                }
            ]
        }
    };

    // Função genérica de navegação de etapa
    function goToStep(fromStep, toStep, activeDotId, removeDotId) {
        fromStep.classList.remove('active');
        toStep.classList.add('active');

        if (activeDotId) {
            document.getElementById(activeDotId).classList.add('active');
        }
        if (removeDotId) {
            document.getElementById(removeDotId).classList.remove('active');
        }
    }

    // Gerenciador de Abas de Produto
    const tabButtons = document.querySelectorAll('.tab-btn');
    const productInfo = document.querySelector('.product-info');
    const cardInner = document.querySelector('.card-inner');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const selectedProduct = btn.getAttribute('data-product');
            if (selectedProduct === activeProduct) return;

            // Transição visual suave (fade-out)
            productInfo.classList.add('fade-out');
            cardInner.classList.add('fade-out');

            setTimeout(() => {
                // Alternar botão ativo
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                activeProduct = selectedProduct;
                updateProductUI(selectedProduct);

                // Resetar inputs e voltar para etapa 1
                inputCharName.value = '';
                inputHwidUuid.value = '';
                hideError();
                
                // Voltar de onde estiver para a Etapa 1
                const activeStep = document.querySelector('.step-content.active');
                if (activeStep) {
                    activeStep.classList.remove('active');
                }
                step1.classList.add('active');
                
                // Reset dos dots de progresso
                dot1.classList.add('active');
                dot2.classList.remove('active');
                dot3.classList.remove('active');

                // Fade-in
                productInfo.classList.remove('fade-out');
                cardInner.classList.remove('fade-out');
            }, 250);
        });
    });

    function updateProductUI(prodKey) {
        const prod = PRODUCTS_DATA[prodKey];
        if (!prod) return;

        // Atualizar textos principais
        document.getElementById('product-title').textContent = prod.title;
        document.getElementById('product-desc').textContent = prod.description;
        
        // Atualizar link de download
        const dlLink = document.getElementById('download-link');
        if (dlLink) {
            dlLink.href = prod.downloadUrl;
        }

        // Atualizar características/recursos
        for (let i = 0; i < 3; i++) {
            const feat = prod.features[i];
            const iconEl = document.getElementById(`feat-icon-${i + 1}`);
            const titleEl = document.getElementById(`feat-title-${i + 1}`);
            const descEl = document.getElementById(`feat-desc-${i + 1}`);
            
            if (iconEl) iconEl.textContent = feat.icon;
            if (titleEl) titleEl.textContent = feat.title;
            if (descEl) descEl.textContent = feat.desc;
        }

        // Atualizar checkout card (etapa 1)
        document.getElementById('uuid-desc-text').textContent = prod.uuidDesc;

        // Atualizar instruções de pagamento (etapa 3)
        document.getElementById('coins-amount-text').textContent = `${prod.coinsAmount} Tibia Coins`;

        // Atualizar tela de sucesso (etapa 4)
        document.getElementById('success-coins-amount').textContent = prod.coinsAmount;
        document.getElementById('success-file-label').textContent = prod.fileLabel;
        document.getElementById('success-info-note').textContent = prod.infoNote;
    }


    // Função auxiliar para mostrar erro de validação
    function showError(message) {
        // Encontra ou cria caixa de erro da Etapa 1
        let errBox = step1.querySelector('.error-msg');
        if (!errBox) {
            errBox = document.createElement('div');
            errBox.className = 'error-msg';
            step1.insertBefore(errBox, btnNext1);
        }
        errBox.textContent = message;
        errBox.style.display = 'block';
    }

    function hideError() {
        const errBox = step1.querySelector('.error-msg');
        if (errBox) {
            errBox.style.display = 'none';
        }
    }

    // ETAPA 1 -> ETAPA 2 (Consulta TibiaData)
    btnNext1.addEventListener('click', async () => {
        const name = inputCharName.value.trim();
        const uuid = inputHwidUuid.value.trim();

        hideError();

        if (!name) {
            showError('Por favor, informe o nome do seu personagem.');
            return;
        }
        if (!uuid) {
            showError('Por favor, informe o UUID de hardware da sua máquina.');
            return;
        }

        checkoutData.character = name;
        checkoutData.uuid = uuid;

        // Mostrar estado de carregando no botão
        btnNext1.disabled = true;
        btnNext1.textContent = 'Buscando personagem...';

        try {
            console.log(`Buscando personagem: ${name}`);
            const response = await fetch(`/api/character/${encodeURIComponent(name)}`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    showError('Personagem não encontrado no Tibia oficial. Verifique a grafia.');
                } else {
                    showError('Erro ao consultar os servidores do Tibia. Tente novamente mais tarde.');
                }
                btnNext1.disabled = false;
                btnNext1.textContent = 'Continuar';
                return;
            }

            const data = await response.json();
            
            // Preencher preview da etapa 2
            previewName.textContent = data.name;
            previewWorld.textContent = data.world;
            previewLevel.textContent = data.level;
            previewVocation.textContent = data.vocation;

            // Salvar nome formatado oficial retornado pela API
            checkoutData.character = data.name;

            // Ir para etapa 2
            goToStep(step1, step2, 'dot-2');
        } catch (err) {
            console.error(err);
            showError('Falha na conexão de rede ao buscar dados do personagem.');
        } finally {
            btnNext1.disabled = false;
            btnNext1.textContent = 'Continuar';
        }
    });

    // ETAPA 2 -> ETAPA 1 (Voltar)
    btnBack2.addEventListener('click', () => {
        goToStep(step2, step1, null, 'dot-2');
    });

    // ETAPA 2 -> ETAPA 3 (Tudo Certo, ir para instruções de pagamento)
    btnNext2.addEventListener('click', () => {
        goToStep(step2, step3, 'dot-3');
    });

    // ETAPA 3 -> ETAPA 2 (Voltar)
    btnBack3.addEventListener('click', () => {
        // Limpar estados de erro se houver
        paymentError.style.display = 'none';
        goToStep(step3, step2, null, 'dot-3');
    });

    // ETAPA 3: Confirmar Envio de Moedas
    btnConfirm.addEventListener('click', async () => {
        paymentError.style.display = 'none';
        paymentLoader.style.display = 'flex';
        btnConfirm.disabled = true;
        btnBack3.disabled = true;

        try {
            console.log('Solicitando confirmação de pagamento...', checkoutData);
            const response = await fetch('/api/confirm-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    character: checkoutData.character,
                    uuid: checkoutData.uuid,
                    product: activeProduct
                })
            });

            const result = await response.json();

            if (!response.ok) {
                // Pagamento não localizado ou outro erro
                paymentError.textContent = result.error || 'Erro ao processar ativação.';
                paymentError.style.display = 'block';
                return;
            }

            // Sucesso! Ir para etapa 4
            successUuid.textContent = checkoutData.uuid;
            goToStep(step3, step4);
            // Pintar todas as bolinhas de progresso como ativas/sucesso
            dot1.classList.add('active');
            dot2.classList.add('active');
            dot3.classList.add('active');

        } catch (err) {
            console.error(err);
            paymentError.textContent = 'Erro de conexão de rede ao validar pagamento.';
            paymentError.style.display = 'block';
        } finally {
            paymentLoader.style.display = 'none';
            btnConfirm.disabled = false;
            btnBack3.disabled = false;
        }
    });
});
