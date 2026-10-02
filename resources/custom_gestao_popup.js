(function () {
    'use strict';

    if (typeof map === 'undefined' || typeof ol === 'undefined') return;

    var WHATSAPP_NUMERO = '5584996743107';

    // Esta exportação do MA veio com nomes de campos encurtados pelo QGIS/DBF.
    // O mapa abaixo liga esses nomes curtos aos campos gerados pela V1.4.
    var SHORT = {
        UF: 'mapa_situa',
        MUNICIPIO: 'mapa_sit_1',
        ANO_INICIAL: 'mapa_sit_2',
        ANO_FINAL: 'mapa_sit_3',
        QTD_TOTAL: 'mapa_sit_4',
        QTD_EM_EXECUCAO: 'mapa_sit_5',
        LINK_WHATSAPP: 'mapa_sit_9',

        MUN_QTD_TOTAL: 'mapa_sit24',
        MUN_QTD_EM_EXECUCAO: 'mapa_sit25',
        MUN_RESUMO_SITUACOES: 'mapa_sit26',
        MUN_VL_GLOBAL_EXEC_FMT: 'mapa_sit34',
        MUN_VL_REPASSE_EXEC_FMT: 'mapa_sit35',
        MUN_VL_CONTRAP_EXEC_FMT: 'mapa_sit36',
        MUN_VL_DESEMB_EXEC_FMT: 'mapa_sit37',
        MUN_VL_SALDO_EXEC_FMT: 'mapa_sit38',
        MUN_PERC_SALDO_REP_FMT: 'mapa_sit39',
        MUN_QTD_PROPONENTES: 'mapa_sit40',

        OUT_QTD_TOTAL: 'mapa_sit44',
        OUT_QTD_EM_EXECUCAO: 'mapa_sit45',
        OUT_RESUMO_SITUACOES: 'mapa_sit46',
        OUT_QTD_PROPONENTES: 'mapa_sit47',
        OUT_QTD_PROPOSTAS_PROPONENTES: 'mapa_sit48',
        OUT_VL_REPASSE_PROPONENTES_FMT: 'mapa_sit50',
        OUT_RESUMO_PROPONENTES: 'mapa_sit51'
    };

    var STATE_NAMES = {
        PR: 'Paraná',
        SC: 'Santa Catarina',
        RS: 'Rio Grande do Sul',
        MA: 'Maranhão'
    };

    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function intValue(value) {
        var n = parseInt(value, 10);
        return isNaN(n) ? 0 : n;
    }

    function discoverPrefix(feature) {
        var keys = feature.getKeys ? feature.getKeys() : [];
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].endsWith('MUN_QTD_TOTAL')) {
                return keys[i].slice(0, -'MUN_QTD_TOTAL'.length);
            }
        }
        // Sinaliza a estrutura curta desta exportação.
        if (feature.get('mapa_sit24') !== undefined) return '__SHORT__';
        return '';
    }

    function getProp(feature, prefix, suffix, fallback) {
        var value = '';
        if (prefix === '__SHORT__') {
            var shortKey = SHORT[suffix];
            if (shortKey) value = feature.get(shortKey);
        } else {
            value = feature.get(prefix + suffix);
        }
        if (value === null || value === undefined || value === '') {
            return fallback === undefined ? '' : fallback;
        }
        return value;
    }

    function prettyStatus(item) {
        var s = String(item || '').trim();
        if (!s) return '';
        var replacements = [
            [/Emexecução/gi, 'Em execução'],
            [/Proposta\/PlanodeTrabalho/gi, 'Proposta/Plano de Trabalho'],
            [/PropostaAprovadaePlanodeTrabalho/gi, 'Proposta Aprovada e Plano de Trabalho'],
            [/PrestaçãodeContas/gi, 'Prestação de Contas'],
            [/EnviadoparaAnálise/gi, 'Enviado para Análise'],
            [/enviadaparaAnálise/gi, 'enviada para Análise'],
            [/RejeitadosporImpedimentotécnico/gi, 'Rejeitados por Impedimento técnico'],
            [/Rejeitados/gi, 'Rejeitados'],
            [/Cadastrados/gi, 'Cadastrados'],
            [/emComplementação/gi, ' em Complementação'],
            [/emAnálise/gi, ' em Análise'],
            [/ComprovadaemAnálise/gi, 'Comprovada em Análise'],
            [/ComplementadoemAnálise/gi, 'Complementado em Análise'],
            [/AprovadocomRessalvas/gi, 'Aprovada com Ressalvas'],
            [/Aprovado/gi, 'Aprovado'],
            [/Concluída/gi, 'Concluída'],
            [/AguardandoPrestaçãodeContas/gi, 'Aguardando Prestação de Contas']
        ];
        replacements.forEach(function (pair) { s = s.replace(pair[0], pair[1]); });
        s = s.replace(/\s*:\s*/g, ': ');
        return s.replace(/\s{2,}/g, ' ').trim();
    }

    function summaryList(text) {
        if (!text) return '<div class="gestao-empty">Nenhuma situação registrada no período.</div>';
        var items = String(text).split(/\s*\|\s*/).filter(function (x) { return x.trim() !== ''; });
        if (!items.length) return '<div class="gestao-empty">Nenhuma situação registrada no período.</div>';
        return '<ul class="gestao-list">' + items.map(function (item) {
            return '<li>' + esc(prettyStatus(item)) + '</li>';
        }).join('') + '</ul>';
    }

    function formatCnpj(value) {
        var raw = String(value || '').trim();
        var digits = raw.replace(/\D/g, '');
        if (digits.length === 14) {
            return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
        }
        return raw;
    }

    function parseEntity(raw) {
        var text = String(raw || '').trim();
        if (!text) return null;

        // Tolera exportações que removeram espaços ao gravar campos longos.
        var m = text.match(/^(.*?)\s*\[([^\]]+)\]\s*—\s*(\d+)\s*propostas?\s*—\s*repasse\s*(R\$\s*[0-9.]+,[0-9]{2})(?:\s*—\s*CNPJ\/ID:\s*(.+))?$/i);
        if (!m) {
            // Fragmentos truncados no fim do campo são omitidos para não exibir lixo.
            if (text.length > 210 && text.indexOf('[') < 0) return null;
            return { name: text, type: 'Outro proponente', qtd: '', repasse: '', cnpj: '' };
        }
        return {
            name: m[1].trim(),
            type: m[2].trim().toUpperCase() === 'MUNICIPAL' ? 'Proponente municipal' : 'Outro proponente',
            qtd: m[3],
            repasse: m[4].trim(),
            cnpj: formatCnpj(m[5] || '')
        };
    }

    function entitiesHtml(text) {
        if (!text) return '';
        var entities = String(text).split(/\s*\|\|\s*/).filter(function (x) { return x.trim() !== ''; });
        var parsed = entities.map(parseEntity).filter(Boolean);
        if (!parsed.length) return '';

        return '<div class="gestao-entity-list">' + parsed.map(function (e) {
            var qtdText = e.qtd ? (e.qtd + (e.qtd === '1' ? ' proposta/instrumento' : ' propostas/instrumentos')) : '';
            var nums = [qtdText, e.repasse ? ('Repasse: ' + e.repasse) : ''].filter(Boolean).join(' · ');
            return '<div class="gestao-entity">' +
                '<div class="gestao-entity-name">' + esc(e.name) + '</div>' +
                '<div class="gestao-entity-type">' + esc(e.type) + '</div>' +
                (nums ? '<div class="gestao-entity-numbers">' + esc(nums) + '</div>' : '') +
                (e.cnpj ? '<div class="gestao-entity-cnpj">CNPJ/ID: ' + esc(e.cnpj) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>';
    }

    function moneyRow(label, value) {
        if (!value) return '';
        return '<div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div>';
    }

    function municipalFinance(feature, prefix) {
        var global = getProp(feature, prefix, 'MUN_VL_GLOBAL_EXEC_FMT', '');
        var repasse = getProp(feature, prefix, 'MUN_VL_REPASSE_EXEC_FMT', '');
        var contrap = getProp(feature, prefix, 'MUN_VL_CONTRAP_EXEC_FMT', '');
        var desemb = getProp(feature, prefix, 'MUN_VL_DESEMB_EXEC_FMT', '');
        var saldo = getProp(feature, prefix, 'MUN_VL_SALDO_EXEC_FMT', '');
        var perc = getProp(feature, prefix, 'MUN_PERC_SALDO_REP_FMT', '');

        if (!global && !repasse && !contrap && !desemb && !saldo && !perc) return '';

        return '<div class="gestao-card financeiro">' +
            '<div class="gestao-card-title">Valores dos convênios municipais em execução</div>' +
            '<div class="gestao-fin-grid">' +
                moneyRow('Valor global', global) +
                moneyRow('Repasse', repasse) +
                moneyRow('Contrapartida', contrap) +
                moneyRow('Desembolsado', desemb) +
                moneyRow('Saldo em conta', saldo) +
                moneyRow('Saldo sobre o repasse', perc) +
            '</div>' +
        '</div>';
    }

    function buildWhatsapp(municipio, uf, munExec, anoIni, anoFim) {
        var periodo = anoIni && anoFim ? (anoIni + '–' + anoFim) : 'período informado no mapa';
        var msg = 'Olá! Gostaria de solicitar uma análise detalhada sobre os convênios do município de ' + municipio + '/' + uf + '.\n\n' +
            'Convênios municipais em execução indicados no mapa: ' + munExec + '.\n' +
            'Período analisado: ' + periodo + '.\n\n' +
            'Gostaria de receber mais informações.';
        return 'https://wa.me/' + WHATSAPP_NUMERO + '?text=' + encodeURIComponent(msg);
    }

    function buildPopup(feature) {
        var prefix = discoverPrefix(feature);
        if (!prefix) return '';

        var municipio = feature.get('NM_MUN') || getProp(feature, prefix, 'MUNICIPIO', 'Município');
        var uf = getProp(feature, prefix, 'UF', feature.get('SIGLA_UF') || 'MA');
        var anoIni = getProp(feature, prefix, 'ANO_INICIAL', '');
        var anoFim = getProp(feature, prefix, 'ANO_FINAL', '');

        var totalAll = intValue(getProp(feature, prefix, 'QTD_TOTAL', 0));
        var execAll = intValue(getProp(feature, prefix, 'QTD_EM_EXECUCAO', 0));

        var munTotal = intValue(getProp(feature, prefix, 'MUN_QTD_TOTAL', 0));
        var munExec = intValue(getProp(feature, prefix, 'MUN_QTD_EM_EXECUCAO', 0));
        var munProponentes = intValue(getProp(feature, prefix, 'MUN_QTD_PROPONENTES', 0));
        var munSituacoes = getProp(feature, prefix, 'MUN_RESUMO_SITUACOES', '');

        var outTotal = intValue(getProp(feature, prefix, 'OUT_QTD_TOTAL', 0));
        var outExec = intValue(getProp(feature, prefix, 'OUT_QTD_EM_EXECUCAO', 0));
        var outProp = intValue(getProp(feature, prefix, 'OUT_QTD_PROPONENTES', 0));
        var outSituacoes = getProp(feature, prefix, 'OUT_RESUMO_SITUACOES', '');
        var outRepasse = getProp(feature, prefix, 'OUT_VL_REPASSE_PROPONENTES_FMT', '');
        var outEntidades = getProp(feature, prefix, 'OUT_RESUMO_PROPONENTES', '');

        var periodo = anoIni && anoFim ? (esc(anoIni) + '–' + esc(anoFim)) : '';
        var territorio = '<div class="gestao-territorio">' +
            '<strong>Visão do território:</strong> ' + totalAll + ' propostas/instrumentos no período · ' +
            '<strong>' + execAll + ' em execução</strong>' +
        '</div>';

        var municipal = '<div class="gestao-card municipal">' +
            '<div class="gestao-card-title-row">' +
                '<div class="gestao-card-title">Gestão Municipal</div>' +
                '<div class="gestao-badge">' + munExec + ' em execução</div>' +
            '</div>' +
            '<div class="gestao-meta"><strong>' + munTotal + '</strong> propostas/instrumentos · ' +
                '<strong>' + munProponentes + '</strong> ' + (munProponentes === 1 ? 'proponente municipal' : 'proponentes municipais') +
            '</div>' +
            '<div class="gestao-section-label">Situações da gestão municipal</div>' +
            summaryList(munSituacoes) +
            municipalFinance(feature, prefix) +
        '</div>';

        var outros;
        if (outProp > 0 || outTotal > 0) {
            var details = entitiesHtml(outEntidades);
            outros = '<div class="gestao-card outros">' +
                '<div class="gestao-card-title-row">' +
                    '<div class="gestao-card-title">Outros Proponentes no Município</div>' +
                    '<div class="gestao-badge">' + outExec + ' em execução</div>' +
                '</div>' +
                '<div class="gestao-meta"><strong>' + outProp + '</strong> ' + (outProp === 1 ? 'entidade/proponente' : 'entidades/proponentes') +
                    ' · <strong>' + outTotal + '</strong> propostas/instrumentos</div>' +
                (outRepasse ? '<div class="gestao-repasse-outros"><strong>Repasse associado às propostas:</strong> ' + esc(outRepasse) + '</div>' : '') +
                '<div class="gestao-section-label">Situações dos outros proponentes</div>' +
                summaryList(outSituacoes) +
                (details ? '<details class="gestao-details"><summary>Ver entidades (' + outProp + ')</summary>' + details + '</details>' : '') +
            '</div>';
        } else {
            outros = '<div class="gestao-card outros">' +
                '<div class="gestao-card-title">Outros Proponentes no Município</div>' +
                '<div class="gestao-empty">Nenhum outro proponente encontrado no período analisado.</div>' +
            '</div>';
        }

        // O link é montado aqui para evitar o limite de 254 caracteres do campo DBF.
        var wa = buildWhatsapp(municipio, uf, munExec, anoIni, anoFim);
        var action = '<div class="gestao-action">' +
            '<a class="gestao-whatsapp" href="' + esc(wa) + '" target="_blank" rel="noopener">💬 Solicitar análise detalhada</a>' +
            '<div class="gestao-action-note">Consulte o detalhamento dos instrumentos e informações complementares.</div>' +
        '</div>';

        return '<div class="gestao-popup">' +
            '<div class="gestao-header">' +
                '<div class="gestao-title">' + esc(municipio) + '</div>' +
                '<div class="gestao-subtitle">' + esc(STATE_NAMES[uf] || uf) + (periodo ? ' · ' + periodo : '') + '</div>' +
                territorio +
            '</div>' +
            '<div class="gestao-body">' + municipal + outros + '</div>' +
            action +
        '</div>';
    }

    function customGestaoPopup(evt) {
        var selected = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (selected) return;
            if (!layer || !(feature instanceof ol.Feature)) return;
            if (!(layer.get('interactive') || layer.get('interactive') === undefined)) return;
            if (!discoverPrefix(feature)) return;
            selected = feature;
        });

        if (!selected) {
            if (typeof container !== 'undefined') {
                container.style.display = 'none';
                container.classList.remove('gestao-popup-active');
            }
            return;
        }

        var html = buildPopup(selected);
        if (!html) return;

        if (typeof popupContent !== 'undefined') popupContent = html;
        if (typeof popupCoord !== 'undefined') popupCoord = evt.coordinate;
        if (typeof featuresPopupActive !== 'undefined') featuresPopupActive = true;

        if (typeof container !== 'undefined') container.classList.add('gestao-popup-active');
        if (typeof updatePopup === 'function') {
            updatePopup();
        } else if (typeof content !== 'undefined' && typeof overlayPopup !== 'undefined') {
            content.innerHTML = html;
            container.style.display = 'block';
            overlayPopup.setPosition(evt.coordinate);
        }
    }

    if (typeof onSingleClickFeatures === 'function') map.un('singleclick', onSingleClickFeatures);
    if (typeof onSingleClickWMS === 'function') map.un('singleclick', onSingleClickWMS);
    map.on('singleclick', customGestaoPopup);
})();
