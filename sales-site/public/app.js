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
                    uuid: checkoutData.uuid
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
