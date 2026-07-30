/**
 * Router minimale a singola pagina: mostra/nasconde le sezioni "schermata"
 * già presenti nel DOM (nessun reload, nessun framework).
 */
const router = (() => {
  const screens = Array.from(document.querySelectorAll('.screen'));
  const DEFAULT_SCREEN = 'home';
  const onEnterCallbacks = {};

  function getScreen(name) {
    return screens.find((el) => el.dataset.screen === name);
  }

  /** Registra una callback da eseguire ogni volta che si entra nella schermata indicata. */
  function onEnter(name, callback) {
    onEnterCallbacks[name] = callback;
  }

  function navigate(name, { pushState = true } = {}) {
    const target = getScreen(name) ? name : DEFAULT_SCREEN;

    screens.forEach((el) => {
      el.hidden = el.dataset.screen !== target;
    });

    if (pushState) {
      history.pushState({ screen: target }, '', `#${target}`);
    }

    if (onEnterCallbacks[target]) {
      onEnterCallbacks[target]();
    }
  }

  function init() {
    const initial = location.hash.replace('#', '') || DEFAULT_SCREEN;
    navigate(initial, { pushState: false });
    history.replaceState({ screen: getScreen(initial) ? initial : DEFAULT_SCREEN }, '');

    window.addEventListener('popstate', (event) => {
      const screen = event.state && event.state.screen ? event.state.screen : DEFAULT_SCREEN;
      navigate(screen, { pushState: false });
    });

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-nav]');
      if (!trigger) {
        return;
      }
      navigate(trigger.dataset.nav);
    });
  }

  return { init, navigate, onEnter };
})();

/**
 * Schermata "Nuovo sopralluogo": popola i campi editabili come testo libero (valori già usati
 * in precedenza), filtra la Checklist in base al punto vendita digitato (checklists/clients.json),
 * poi crea il sopralluogo e avvia la compilazione (PROJECT.md §7.2).
 */
const nuovoSopralluogoScreen = (() => {
  const form = document.getElementById('form-nuovo-sopralluogo');
  const inputPuntoVendita = document.getElementById('input-punto-vendita');
  const inputIndirizzo = document.getElementById('input-indirizzo-punto-vendita');
  const inputNumeroDipendenti = document.getElementById('input-numero-dipendenti');
  const inputTecnico = document.getElementById('input-tecnico');
  const inputDataSopralluogo = document.getElementById('input-data-sopralluogo');
  const inputResponsabile = document.getElementById('input-responsabile');
  const selectPresenzaResponsabile = document.getElementById('select-presenza-responsabile');
  const selectPresenzaRls = document.getElementById('select-presenza-rls');
  const selectChecklist = document.getElementById('select-checklist');

  const listaPuntiVendita = document.getElementById('lista-punti-vendita');
  const listaIndirizzi = document.getElementById('lista-indirizzi');
  const listaTecnici = document.getElementById('lista-tecnici');
  const listaResponsabili = document.getElementById('lista-responsabili');

  let checklistDisponibili = [];
  let associazioniClienti = [];

  function popolaDatalist(datalist, valori) {
    datalist.innerHTML = '';
    Array.from(new Set(valori.filter(Boolean))).forEach((valore) => {
      const option = document.createElement('option');
      option.value = valore;
      datalist.appendChild(option);
    });
  }

  async function popolaSuggerimenti() {
    const sopralluoghi = await db.elencaSopralluoghi();
    popolaDatalist(listaPuntiVendita, sopralluoghi.map((s) => s.punto_vendita));
    popolaDatalist(listaIndirizzi, sopralluoghi.map((s) => s.indirizzo_punto_vendita));
    popolaDatalist(listaTecnici, sopralluoghi.map((s) => s.tecnico));
    popolaDatalist(listaResponsabili, sopralluoghi.map((s) => s.responsabile_punto_vendita));
  }

  function oggiISO() {
    const oggi = new Date();
    const mese = String(oggi.getMonth() + 1).padStart(2, '0');
    const giorno = String(oggi.getDate()).padStart(2, '0');
    return `${oggi.getFullYear()}-${mese}-${giorno}`;
  }

  function popolaSelectChecklist(elenco) {
    const valorePrecedente = selectChecklist.value;
    selectChecklist.innerHTML = '';
    elenco.forEach(({ id, titolo }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = titolo;
      selectChecklist.appendChild(option);
    });
    if (elenco.some((c) => c.id === valorePrecedente)) {
      selectChecklist.value = valorePrecedente;
    }
  }

  /** Filtra le checklist disponibili in base al punto vendita digitato (associazioni in clients.json). */
  function filtraChecklistPerCliente() {
    const nome = inputPuntoVendita.value.trim().toLowerCase();
    const associazione = associazioniClienti.find((c) => c.nome.toLowerCase() === nome);

    if (!associazione) {
      popolaSelectChecklist(checklistDisponibili);
      return;
    }

    const filtrate = checklistDisponibili.filter((c) => associazione.checklist_ids.includes(c.id));
    popolaSelectChecklist(filtrate.length ? filtrate : checklistDisponibili);
  }

  async function caricaChecklistECliente() {
    const [risChecklist, risClienti] = await Promise.all([
      fetch('checklists/index.json'),
      fetch('checklists/clients.json')
    ]);
    checklistDisponibili = (await risChecklist.json()).checklists;
    associazioniClienti = (await risClienti.json()).clienti;
    // Riapplica il filtro (non solo popolare con tutte le checklist): se l'utente ha già digitato
    // il punto vendita prima che questo fetch si completasse, non deve perdere il filtro applicato.
    filtraChecklistPerCliente();
  }

  async function onEnterScreen() {
    form.reset();
    inputDataSopralluogo.value = oggiISO();
    await Promise.all([popolaSuggerimenti(), caricaChecklistECliente()]);
  }

  async function onSubmit(event) {
    event.preventDefault();

    const sopralluogo = await db.creaSopralluogo({
      punto_vendita: inputPuntoVendita.value.trim(),
      indirizzo_punto_vendita: inputIndirizzo.value.trim(),
      numero_dipendenti: inputNumeroDipendenti.value,
      tecnico: inputTecnico.value.trim(),
      data_sopralluogo: inputDataSopralluogo.value,
      responsabile_punto_vendita: inputResponsabile.value.trim(),
      presenza_responsabile: selectPresenzaResponsabile.value,
      presenza_rls: selectPresenzaRls.value,
      checklist_id: selectChecklist.value
    });

    const checklist = await checklistEngine.carica(sopralluogo.checklist_id);
    checklistEngine.avvia(checklist, sopralluogo);

    router.navigate('compilazione');
    compilazioneScreen.renderDomandaCorrente();
  }

  function init() {
    form.addEventListener('submit', onSubmit);
    inputPuntoVendita.addEventListener('input', filtraChecklistPerCliente);
    router.onEnter('new-inspection', onEnterScreen);
  }

  return { init };
})();

/**
 * Schermata di Compilazione: una domanda alla volta, con opzioni C/PC/NC/NA, note, sotto-form
 * Non Conformità e navigazione avanti/indietro (PROJECT.md §7.3, §7.4).
 */
const compilazioneScreen = (() => {
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');
  const sezioneEl = document.getElementById('compilazione-sezione');
  const domandaEl = document.getElementById('compilazione-domanda');
  const opzioniRispostaContainer = document.getElementById('risposte-opzioni');
  const opzioniRisposta = Array.from(document.querySelectorAll('input[name="risposta"]'));
  const contenitoreRD = document.getElementById('raccolta-dati-controllo');
  const btnNote = document.getElementById('btn-note');
  const btnFoto = document.getElementById('btn-foto');
  const notaEditor = document.getElementById('nota-editor');
  const notaTesto = document.getElementById('nota-testo');
  const erroreValidazione = document.getElementById('errore-validazione');
  const btnIndietro = document.getElementById('btn-indietro');
  const btnAvanti = document.getElementById('btn-avanti');

  let fotoDomandaCorrente = [];

  /** Etichette visive delle risposte: un solo punto per cambiarle in futuro senza toccare il resto. */
  const ETICHETTE_RISPOSTA = { C: 'C', PC: 'PC', NC: 'NC', NA: 'N.P.' };

  function applicaEtichetteRisposta() {
    opzioniRisposta.forEach((input) => {
      const etichetta = input.nextElementSibling;
      if (etichetta) {
        etichetta.textContent = ETICHETTE_RISPOSTA[input.value] || input.value;
      }
    });
  }

  function isStileRaccoltaDati() {
    const checklist = checklistEngine.getChecklist();
    return Boolean(checklist && checklist.stile === 'raccolta-dati');
  }

  function aggiornaContatoreFoto() {
    btnFoto.textContent = fotoDomandaCorrente.length ? `📷 Foto (${fotoDomandaCorrente.length})` : '📷 Foto';
  }

  function mostraErrore(messaggio) {
    erroreValidazione.textContent = messaggio;
    erroreValidazione.hidden = false;
  }

  function nascondiErrore() {
    erroreValidazione.hidden = true;
  }

  function resetControlli() {
    opzioniRisposta.forEach((input) => { input.checked = false; });
    contenitoreRD.innerHTML = '';
    notaEditor.hidden = true;
    notaTesto.value = '';
    fotoDomandaCorrente = [];
    aggiornaContatoreFoto();
    nascondiErrore();
  }

  async function salvaRispostaCorrente(valore) {
    try {
      await checklistEngine.rispondi({
        valore,
        note: notaTesto.value.trim() || null,
        foto: fotoDomandaCorrente
      });
      nascondiErrore();
      return true;
    } catch (errore) {
      mostraErrore(errore.message);
      return false;
    }
  }

  // --- Rendering dinamico dei controlli per checklist "stile": "raccolta-dati" ---

  function creaOpzioneVerticale(inputEl, testoEtichetta) {
    const label = document.createElement('label');
    label.className = 'opzione-verticale';
    label.appendChild(inputEl);
    label.appendChild(document.createTextNode(` ${testoEtichetta}`));
    return label;
  }

  function renderTesto(valoreEsistente) {
    const label = document.createElement('label');
    label.className = 'campo-form';
    label.textContent = 'Risposta';
    const textarea = document.createElement('textarea');
    textarea.value = typeof valoreEsistente === 'string' ? valoreEsistente : '';
    textarea.addEventListener('change', () => salvaRispostaCorrente(textarea.value.trim()));
    label.appendChild(textarea);
    contenitoreRD.appendChild(label);
  }

  function renderNumero(valoreEsistente) {
    const label = document.createElement('label');
    label.className = 'campo-form';
    label.textContent = 'Risposta';
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.value = valoreEsistente != null ? valoreEsistente : '';
    input.addEventListener('change', () => salvaRispostaCorrente(input.value));
    label.appendChild(input);
    contenitoreRD.appendChild(label);
  }

  function renderSiNo(valoreEsistente) {
    const div = document.createElement('div');
    div.className = 'opzioni-verticali';
    ['Sì', 'No'].forEach((opzione) => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'rd-si-no';
      input.value = opzione;
      input.checked = valoreEsistente === opzione;
      input.addEventListener('change', () => salvaRispostaCorrente(opzione));
      div.appendChild(creaOpzioneVerticale(input, opzione));
    });
    contenitoreRD.appendChild(div);
  }

  function renderSceltaSingola(domanda, valoreEsistente) {
    const div = document.createElement('div');
    div.className = 'opzioni-verticali';
    (domanda.opzioni || []).forEach((opzione) => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'rd-scelta-singola';
      input.value = opzione.label;
      input.checked = valoreEsistente === opzione.label;
      input.addEventListener('change', () => salvaRispostaCorrente(opzione.label));
      div.appendChild(creaOpzioneVerticale(input, opzione.label));
    });
    contenitoreRD.appendChild(div);
  }

  function renderCheckboxMulti(domanda, valoreEsistente) {
    const selezioniEsistenti = Array.isArray(valoreEsistente) ? valoreEsistente : [];
    const div = document.createElement('div');
    div.className = 'opzioni-verticali';

    const stato = new Map();
    (domanda.opzioni || []).forEach((opzione) => {
      const esistente = selezioniEsistenti.find((s) => s.label === opzione.label);
      stato.set(opzione.label, {
        checked: Boolean(esistente),
        sottoCampoValore: esistente ? esistente.sottoCampoValore || '' : ''
      });
    });

    function emettiValore() {
      const risultato = [];
      stato.forEach((info, label) => {
        if (!info.checked) {
          return;
        }
        const voce = { label };
        if (info.sottoCampoValore) {
          voce.sottoCampoValore = info.sottoCampoValore;
        }
        risultato.push(voce);
      });
      salvaRispostaCorrente(risultato);
    }

    (domanda.opzioni || []).forEach((opzione) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'checkbox-multi-voce';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = stato.get(opzione.label).checked;

      const label = document.createElement('label');
      label.className = 'opzione-checkbox';
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(` ${opzione.label}`));
      wrapper.appendChild(label);

      let inputSottoCampo = null;
      if (opzione.sotto_campo) {
        inputSottoCampo = document.createElement('input');
        inputSottoCampo.type = opzione.sotto_campo_tipo === 'numero' ? 'number' : 'text';
        inputSottoCampo.placeholder = opzione.sotto_campo_label || 'Dettaglio';
        inputSottoCampo.className = 'input-sotto-campo';
        inputSottoCampo.value = stato.get(opzione.label).sottoCampoValore;
        inputSottoCampo.hidden = !stato.get(opzione.label).checked;
        inputSottoCampo.addEventListener('change', () => {
          stato.get(opzione.label).sottoCampoValore = inputSottoCampo.value.trim();
          emettiValore();
        });
        wrapper.appendChild(inputSottoCampo);
      }

      checkbox.addEventListener('change', () => {
        stato.get(opzione.label).checked = checkbox.checked;
        if (inputSottoCampo) {
          inputSottoCampo.hidden = !checkbox.checked;
        }
        emettiValore();
      });

      div.appendChild(wrapper);
    });

    contenitoreRD.appendChild(div);
  }

  function renderGruppoTesto(domanda, valoreEsistente) {
    const valori = valoreEsistente && typeof valoreEsistente === 'object' && !Array.isArray(valoreEsistente)
      ? valoreEsistente
      : {};
    const stato = {};
    (domanda.campi || []).forEach((campo) => { stato[campo.label] = valori[campo.label] || ''; });

    function emettiValore() {
      salvaRispostaCorrente({ ...stato });
    }

    (domanda.campi || []).forEach((campo) => {
      const label = document.createElement('label');
      label.className = 'campo-form';
      label.textContent = campo.label;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = stato[campo.label];
      input.addEventListener('change', () => {
        stato[campo.label] = input.value.trim();
        emettiValore();
      });
      label.appendChild(input);
      contenitoreRD.appendChild(label);
    });
  }

  /** Renderizza il controllo giusto in base al tipo della domanda corrente (checklist "raccolta-dati"). */
  function renderControlloRaccoltaDati(domanda, risposta) {
    const valoreEsistente = risposta ? risposta.risposta : undefined;

    switch (domanda.tipo) {
      case 'testo':
        renderTesto(valoreEsistente);
        break;
      case 'numero':
        renderNumero(valoreEsistente);
        break;
      case 'si-no':
        renderSiNo(valoreEsistente);
        break;
      case 'scelta-singola':
        renderSceltaSingola(domanda, valoreEsistente);
        break;
      case 'checkbox-multi':
        renderCheckboxMulti(domanda, valoreEsistente);
        break;
      case 'gruppo-testo':
        renderGruppoTesto(domanda, valoreEsistente);
        break;
      default: {
        const avviso = document.createElement('p');
        avviso.className = 'placeholder-text';
        avviso.textContent = `Tipo domanda non supportato: ${domanda.tipo}`;
        contenitoreRD.appendChild(avviso);
      }
    }
  }

  /** Ridisegna la schermata in base alla domanda corrente del motore checklist. */
  function renderDomandaCorrente() {
    const corrente = checklistEngine.domandaCorrente();
    if (!corrente) {
      return;
    }

    resetControlli();

    const { sezione, domanda, indice, totale, risposta } = corrente;

    progressFill.style.width = `${((indice + 1) / totale) * 100}%`;
    progressLabel.textContent = `Domanda ${indice + 1} di ${totale}`;
    sezioneEl.textContent = sezione;
    domandaEl.textContent = domanda.testo;

    btnNote.hidden = !domanda.note;
    btnFoto.hidden = !domanda.foto;

    const isUltima = indice === totale - 1;
    btnAvanti.textContent = isUltima ? 'Fine' : 'Avanti →';
    btnIndietro.disabled = indice === 0;

    const raccoltaDati = isStileRaccoltaDati();
    opzioniRispostaContainer.hidden = raccoltaDati;
    contenitoreRD.hidden = !raccoltaDati;

    if (raccoltaDati) {
      renderControlloRaccoltaDati(domanda, risposta);
    } else if (risposta) {
      const radio = opzioniRisposta.find((input) => input.value === risposta.risposta);
      if (radio) {
        radio.checked = true;
      }
    }

    if (risposta) {
      if (risposta.note) {
        notaTesto.value = risposta.note;
        notaEditor.hidden = false;
      }
      fotoDomandaCorrente = risposta.foto || [];
      aggiornaContatoreFoto();
    }
  }

  async function onCambioRisposta(event) {
    await salvaRispostaCorrente(event.target.value);
  }

  function onToggleNote() {
    notaEditor.hidden = !notaEditor.hidden;
    if (!notaEditor.hidden) {
      notaTesto.focus();
    }
  }

  /**
   * Foto collegata alla domanda corrente. Per checklist "raccolta-dati" (risposte facoltative)
   * si può allegare una foto anche senza aver ancora inserito un valore; per le altre serve
   * prima selezionare una risposta (§7.3), uguale per C/PC/NC/N.P.
   */
  async function onFoto() {
    const corrente = checklistEngine.domandaCorrente();
    const raccoltaDati = isStileRaccoltaDati();

    if (!corrente.risposta && !raccoltaDati) {
      mostraErrore('Seleziona una risposta prima di aggiungere una foto.');
      return;
    }
    try {
      const sopralluogoId = checklistEngine.sopralluogoCorrente().id;
      const fotoId = await camera.scattaFoto({ sopralluogo_id: sopralluogoId, domanda_id: corrente.domanda.id });
      fotoDomandaCorrente = [...fotoDomandaCorrente, fotoId];
      aggiornaContatoreFoto();
      const valoreCorrente = corrente.risposta ? corrente.risposta.risposta : null;
      await salvaRispostaCorrente(valoreCorrente);
    } catch (errore) {
      mostraErrore(errore.message);
    }
  }

  async function onNotaModificata() {
    const corrente = checklistEngine.domandaCorrente();
    if (corrente && (corrente.risposta || isStileRaccoltaDati())) {
      const valoreCorrente = corrente.risposta ? corrente.risposta.risposta : null;
      await salvaRispostaCorrente(valoreCorrente);
    }
  }

  function onIndietro() {
    if (checklistEngine.indietro()) {
      renderDomandaCorrente();
    }
  }

  function onAvanti() {
    const corrente = checklistEngine.domandaCorrente();
    const isUltima = corrente.indice === corrente.totale - 1;

    if (isUltima) {
      if (!checklistEngine.puoAvanzare()) {
        mostraErrore('Completa la risposta prima di terminare.');
        return;
      }
      router.navigate('altri-aspetti');
      altriAspettiScreen.prepara();
      return;
    }

    if (!checklistEngine.avanti()) {
      mostraErrore('Seleziona una risposta prima di procedere.');
      return;
    }
    renderDomandaCorrente();
  }

  function init() {
    applicaEtichetteRisposta();
    opzioniRisposta.forEach((input) => input.addEventListener('change', onCambioRisposta));
    btnNote.addEventListener('click', onToggleNote);
    btnFoto.addEventListener('click', onFoto);
    notaTesto.addEventListener('change', onNotaModificata);
    btnIndietro.addEventListener('click', onIndietro);
    btnAvanti.addEventListener('click', onAvanti);
  }

  return { init, renderDomandaCorrente };
})();

/**
 * Schermata "Altri aspetti da evidenziare": una nota libera opzionale, raggiunta dopo l'ultima
 * domanda della checklist e prima del Riepilogo, salvata nel sopralluogo.
 */
const altriAspettiScreen = (() => {
  const textarea = document.getElementById('altri-aspetti-testo');
  const btnAvanti = document.getElementById('btn-altri-aspetti-avanti');

  /** Precompila il campo con quanto eventualmente già salvato (riapertura di un sopralluogo). */
  function prepara() {
    const sopralluogo = checklistEngine.sopralluogoCorrente();
    textarea.value = sopralluogo.altri_aspetti || '';
  }

  async function onAvanti() {
    const sopralluogo = checklistEngine.sopralluogoCorrente();
    await db.aggiornaSopralluogo(sopralluogo.id, { altri_aspetti: textarea.value.trim() || null });
    router.navigate('riepilogo');
    riepilogoScreen.render();
  }

  function init() {
    btnAvanti.addEventListener('click', onAvanti);
  }

  return { init, prepara };
})();

/**
 * Schermata di Riepilogo: conteggi per stato ed elenco delle Non Conformità rilevate,
 * per revisione rapida prima della firma (PROJECT.md §7.5).
 */
/**
 * Schermata di Riepilogo (PROJECT.md §7.5): conteggi per stato ed elenco delle Non Conformità,
 * seguiti direttamente dalla generazione del PDF (nessuna firma nel flusso), salvataggio/
 * condivisione e passaggio del sopralluogo a "completato".
 */
const riepilogoScreen = (() => {
  const listaConteggi = document.getElementById('riepilogo-conteggi');
  const listaNC = document.getElementById('riepilogo-nc-lista');
  const ncContainer = document.getElementById('riepilogo-nc-container');
  const pdfEsito = document.getElementById('pdf-esito');
  const btnGeneraPdf = document.getElementById('btn-genera-pdf');
  const btnSalvaCondividi = document.getElementById('btn-salva-condividi');
  const erroreEl = document.getElementById('riepilogo-errore');

  const ETICHETTE = { C: '✔ Conformi', PC: '⚠ Parz. conformi', NC: '✘ Non conformi', NA: '– Non applicabili' };

  let pdfBlob = null;
  let pdfFilename = null;

  function mostraErrore(messaggio) {
    erroreEl.textContent = messaggio;
    erroreEl.hidden = false;
  }

  function nascondiErrore() {
    erroreEl.hidden = true;
  }

  /** Ricalcola e mostra i conteggi e l'elenco NC del sopralluogo in compilazione. */
  function render() {
    const checklist = checklistEngine.getChecklist();
    const sopralluogo = checklistEngine.sopralluogoCorrente();
    const { totale, conteggi, nonConformita } = checklistEngine.calcolaRiepilogo(checklist, sopralluogo);

    listaConteggi.innerHTML = '';
    const totaleEl = document.createElement('li');
    totaleEl.innerHTML = `<span>Totale domande</span><span>${totale}</span>`;
    listaConteggi.appendChild(totaleEl);

    Object.keys(ETICHETTE).forEach((chiave) => {
      const el = document.createElement('li');
      el.innerHTML = `<span>${ETICHETTE[chiave]}</span><span>${conteggi[chiave]}</span>`;
      listaConteggi.appendChild(el);
    });

    listaNC.innerHTML = '';
    ncContainer.hidden = nonConformita.length === 0;
    nonConformita.forEach((nc) => {
      const el = document.createElement('li');
      const titolo = document.createElement('strong');
      titolo.textContent = nc.sezione;
      el.appendChild(titolo);
      el.appendChild(document.createTextNode(` — ${nc.testo}`));
      el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(nc.note || ''));
      listaNC.appendChild(el);
    });

    pdfEsito.hidden = true;
    pdfBlob = null;
    btnGeneraPdf.disabled = false;
    btnGeneraPdf.textContent = 'Genera PDF';
    nascondiErrore();
  }

  async function onGeneraPdf() {
    btnGeneraPdf.disabled = true;
    btnGeneraPdf.textContent = 'Generazione in corso…';
    nascondiErrore();

    try {
      const checklist = checklistEngine.getChecklist();
      const sopralluogoId = checklistEngine.sopralluogoCorrente().id;
      const sopralluogo = await db.leggiSopralluogo(sopralluogoId);

      pdfBlob = await pdf.generaReport(checklist, sopralluogo);
      pdfFilename = pdf.nomeFile(sopralluogo);

      await db.aggiornaSopralluogo(sopralluogoId, { stato: 'completato' });

      pdfEsito.hidden = false;
    } catch (errore) {
      mostraErrore(`Generazione PDF non riuscita: ${errore.message}`);
    } finally {
      btnGeneraPdf.disabled = false;
      btnGeneraPdf.textContent = 'Genera PDF';
    }
  }

  async function onSalvaCondividi() {
    if (!pdfBlob) {
      return;
    }
    try {
      await pdf.salvaOCondividi(pdfBlob, pdfFilename);
      nascondiErrore();
    } catch (errore) {
      if (errore.name !== 'AbortError') {
        mostraErrore(`Salvataggio/condivisione non riuscita: ${errore.message}`);
      }
    }
  }

  function init() {
    btnGeneraPdf.addEventListener('click', onGeneraPdf);
    btnSalvaCondividi.addEventListener('click', onSalvaCondividi);
  }

  return { init, render };
})();

/**
 * Schermata Storico: elenco sopralluoghi salvati, ordinati per data decrescente, con
 * possibilità di riaprire il PDF (rigenerato dai dati salvati) (PROJECT.md §7.8).
 */
const storicoScreen = (() => {
  const lista = document.getElementById('storico-lista');
  const vuoto = document.getElementById('storico-vuoto');

  function formattaData(iso) {
    return new Date(iso).toLocaleDateString('it-IT');
  }

  async function apriPdf(sopralluogoId, bottone) {
    const testoOriginale = bottone.textContent;
    bottone.disabled = true;
    bottone.textContent = 'Generazione…';

    try {
      const sopralluogo = await db.leggiSopralluogo(sopralluogoId);
      const checklist = await db.leggiChecklistCache(sopralluogo.checklist_id);
      if (!checklist) {
        throw new Error('Checklist non disponibile in cache.');
      }

      const blob = await pdf.generaReport(checklist, sopralluogo);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (errore) {
      alert(`Impossibile aprire il PDF: ${errore.message}`);
    } finally {
      bottone.disabled = false;
      bottone.textContent = testoOriginale;
    }
  }

  function creaVoce(sopralluogo) {
    const li = document.createElement('li');
    li.className = 'storico-voce';

    const info = document.createElement('div');
    info.className = 'storico-info';

    const titolo = document.createElement('strong');
    titolo.textContent = sopralluogo.punto_vendita;

    const dettaglio = document.createElement('span');
    dettaglio.textContent = `${sopralluogo.indirizzo_punto_vendita || ''} · ${formattaData(sopralluogo.data)} · ${sopralluogo.stato}`;

    info.appendChild(titolo);
    info.appendChild(dettaglio);

    const bottone = document.createElement('button');
    bottone.type = 'button';
    bottone.className = 'btn-secondario';
    bottone.textContent = 'Apri PDF';
    bottone.addEventListener('click', () => apriPdf(sopralluogo.id, bottone));

    li.appendChild(info);
    li.appendChild(bottone);
    return li;
  }

  async function render() {
    const sopralluoghi = await db.elencaSopralluoghi();
    lista.innerHTML = '';
    vuoto.hidden = sopralluoghi.length > 0;
    sopralluoghi.forEach((sopralluogo) => lista.appendChild(creaVoce(sopralluogo)));
  }

  function init() {
    router.onEnter('history', render);
  }

  return { init };
})();

/**
 * Schermata Impostazioni: dati azienda (nome, indirizzo, logo) usati nell'intestazione del PDF,
 * ed elenco in sola lettura delle checklist disponibili (PROJECT.md §7.9).
 */
const impostazioniScreen = (() => {
  const form = document.getElementById('form-impostazioni');
  const nomeInput = document.getElementById('azienda-nome');
  const indirizzoInput = document.getElementById('azienda-indirizzo');
  const logoInput = document.getElementById('azienda-logo-input');
  const logoAnteprima = document.getElementById('azienda-logo-anteprima');
  const salvatoMsg = document.getElementById('impostazioni-salvato');
  const listaChecklist = document.getElementById('lista-checklist-disponibili');

  function mostraAnteprimaLogo(logo) {
    if (!(logo instanceof Blob)) {
      logoAnteprima.hidden = true;
      return;
    }
    logoAnteprima.src = URL.createObjectURL(logo);
    logoAnteprima.hidden = false;
  }

  async function popolaChecklistDisponibili() {
    const response = await fetch('checklists/index.json');
    const { checklists } = await response.json();
    listaChecklist.innerHTML = '';
    checklists.forEach(({ titolo, id }) => {
      const li = document.createElement('li');
      li.textContent = `${titolo} (${id}.json)`;
      listaChecklist.appendChild(li);
    });
  }

  async function onEnterScreen() {
    salvatoMsg.hidden = true;
    form.reset();

    const azienda = (await db.leggiImpostazione('azienda')) || {};
    nomeInput.value = azienda.nome || '';
    indirizzoInput.value = azienda.indirizzo || '';
    mostraAnteprimaLogo(azienda.logo);

    await popolaChecklistDisponibili();
  }

  async function onSubmit(event) {
    event.preventDefault();

    const esistente = (await db.leggiImpostazione('azienda')) || {};
    const nuovoFile = logoInput.files[0];
    const azienda = {
      nome: nomeInput.value.trim(),
      indirizzo: indirizzoInput.value.trim(),
      logo: nuovoFile || esistente.logo || null
    };

    await db.salvaImpostazione('azienda', azienda);
    mostraAnteprimaLogo(azienda.logo);
    logoInput.value = '';
    salvatoMsg.hidden = false;
  }

  function init() {
    form.addEventListener('submit', onSubmit);
    router.onEnter('settings', onEnterScreen);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  router.init();
  nuovoSopralluogoScreen.init();
  compilazioneScreen.init();
  altriAspettiScreen.init();
  riepilogoScreen.init();
  storicoScreen.init();
  impostazioniScreen.init();
});
