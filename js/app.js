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

  /** Rispondere è facoltativo: si può avanzare (e terminare) anche senza aver risposto alla domanda corrente. */
  function onAvanti() {
    const corrente = checklistEngine.domandaCorrente();
    const isUltima = corrente.indice === corrente.totale - 1;

    if (isUltima) {
      router.navigate('altri-aspetti');
      altriAspettiScreen.prepara();
      return;
    }

    checklistEngine.avanti();
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
    const { totale, conteggi, nonRisposte, nonConformita } = checklistEngine.calcolaRiepilogo(checklist, sopralluogo);

    listaConteggi.innerHTML = '';
    const totaleEl = document.createElement('li');
    totaleEl.innerHTML = `<span>Totale domande</span><span>${totale}</span>`;
    listaConteggi.appendChild(totaleEl);

    Object.keys(ETICHETTE).forEach((chiave) => {
      const el = document.createElement('li');
      el.innerHTML = `<span>${ETICHETTE[chiave]}</span><span>${conteggi[chiave]}</span>`;
      listaConteggi.appendChild(el);
    });

    const nonRisposteEl = document.createElement('li');
    nonRisposteEl.innerHTML = `<span>Domande non risposte</span><span>${nonRisposte}</span>`;
    listaConteggi.appendChild(nonRisposteEl);

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
      await db.salvaPdfReport({ sopralluogo_id: sopralluogoId, blob: pdfBlob, filename: pdfFilename });

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
 * possibilità di aprire o scaricare il PDF già generato e salvato al momento del
 * completamento del sopralluogo (PROJECT.md §7.8). Nessuna rigenerazione: se un
 * sopralluogo è stato completato prima dell'introduzione del salvataggio del PDF,
 * il file non è disponibile e viene segnalato come tale.
 *
 * Filtro cliente/testo applicato in memoria sull'elenco già caricato (nessuna nuova query
 * IndexedDB per digitazione); selezione multipla con export ZIP dei PDF già salvati.
 */
const storicoScreen = (() => {
  const lista = document.getElementById('storico-lista');
  const vuoto = document.getElementById('storico-vuoto');
  const nessunRisultato = document.getElementById('storico-nessun-risultato');
  const filtroClienteContainer = document.getElementById('storico-filtro-cliente');
  const inputRicerca = document.getElementById('storico-ricerca');
  const checkboxSelezionaTutti = document.getElementById('storico-seleziona-tutti');
  const bottoneScaricaSelezionati = document.getElementById('storico-scarica-selezionati');
  const bottoneVaiCestino = document.getElementById('storico-vai-cestino');

  const MESSAGGIO_PDF_NON_DISPONIBILE =
    'PDF non disponibile per questo sopralluogo (completato prima dell\'introduzione del salvataggio del PDF).';

  const DEBOUNCE_RICERCA_MS = 250;

  let sopralluoghiCache = [];
  let clienteAttivo = '';
  let testoRicerca = '';
  let timerDebounce = null;
  const selezionati = new Set();

  function formattaData(iso) {
    return new Date(iso).toLocaleDateString('it-IT');
  }

  /** Stesso criterio di match usato in pdf.js per i loghi cliente, applicato al checklist_id già presente sul sopralluogo. */
  function corrispondeCliente(sopralluogo, cliente) {
    if (!cliente) {
      return true;
    }
    return String(sopralluogo.checklist_id || '').toLowerCase().includes(cliente);
  }

  function corrispondeRicerca(sopralluogo, testo) {
    if (!testo) {
      return true;
    }
    return String(sopralluogo.punto_vendita || '').toLowerCase().includes(testo);
  }

  function elencoFiltrato() {
    return sopralluoghiCache.filter(
      (s) => corrispondeCliente(s, clienteAttivo) && corrispondeRicerca(s, testoRicerca)
    );
  }

  async function eseguiConBottone(bottone, azione) {
    const testoOriginale = bottone.textContent;
    bottone.disabled = true;
    try {
      await azione();
    } finally {
      bottone.disabled = false;
      bottone.textContent = testoOriginale;
    }
  }

  /**
   * Apre in una nuova scheda il PDF già salvato. La scheda viene aperta in modo sincrono,
   * prima di qualsiasi `await`, per non perdere il gesto utente del click: su mobile
   * (Safari iOS, WebView Android, PWA installate) un window.open dopo operazioni asincrone
   * viene spesso bloccato silenziosamente come popup.
   */
  async function apriPdf(sopralluogoId, bottone) {
    const finestra = window.open('', '_blank');
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Apertura…';
      try {
        const report = await db.leggiPdfReport(sopralluogoId);
        if (!report) {
          if (finestra) {
            finestra.close();
          }
          alert(MESSAGGIO_PDF_NON_DISPONIBILE);
          return;
        }
        const url = URL.createObjectURL(report.blob);
        if (finestra) {
          finestra.location.href = url;
        } else {
          window.open(url, '_blank');
        }
      } catch (errore) {
        if (finestra) {
          finestra.close();
        }
        alert(`Impossibile aprire il PDF: ${errore.message}`);
      }
    });
  }

  async function scaricaPdf(sopralluogoId, bottone) {
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Download…';
      try {
        const report = await db.leggiPdfReport(sopralluogoId);
        if (!report) {
          alert(MESSAGGIO_PDF_NON_DISPONIBILE);
          return;
        }
        await pdf.salvaOCondividi(report.blob, report.filename);
      } catch (errore) {
        if (errore.name !== 'AbortError') {
          alert(`Impossibile scaricare il PDF: ${errore.message}`);
        }
      }
    });
  }

  /** Aggiorna il contatore sul pulsante "Cestino" nello Storico. */
  async function aggiornaContatoreCestino() {
    const cestino = await db.elencaCestino();
    bottoneVaiCestino.textContent = `🗑️ Cestino (${cestino.length})`;
  }

  /** Chiede conferma, poi sposta il sopralluogo nel cestino (soft-delete) e aggiorna subito l'elenco a schermo. */
  async function spostaNelCestino(sopralluogo, bottone) {
    if (!confirm('Spostare questo sopralluogo nel cestino? Potrai ripristinarlo entro 30 giorni, dal Cestino nello Storico.')) {
      return;
    }
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Spostamento…';
      try {
        await db.spostaNelCestino(sopralluogo.id);
        sopralluoghiCache = sopralluoghiCache.filter((s) => s.id !== sopralluogo.id);
        selezionati.delete(sopralluogo.id);
        applicaFiltri();
        await aggiornaContatoreCestino();
      } catch (errore) {
        alert(`Impossibile spostare il sopralluogo nel cestino: ${errore.message}`);
      }
    });
  }

  function aggiornaBottoneScaricaSelezionati() {
    bottoneScaricaSelezionati.hidden = selezionati.size === 0;
    bottoneScaricaSelezionati.textContent = `Scarica selezionati (${selezionati.size})`;
  }

  function aggiornaCheckboxSelezionaTutti() {
    const visibili = elencoFiltrato();
    checkboxSelezionaTutti.checked =
      visibili.length > 0 && visibili.every((s) => selezionati.has(s.id));
  }

  function creaVoce(sopralluogo) {
    const li = document.createElement('li');
    li.className = 'storico-voce';

    const selezione = document.createElement('div');
    selezione.className = 'storico-voce-selezione';
    const checkboxSelezione = document.createElement('input');
    checkboxSelezione.type = 'checkbox';
    checkboxSelezione.checked = selezionati.has(sopralluogo.id);
    checkboxSelezione.setAttribute('aria-label', `Seleziona ${sopralluogo.punto_vendita}`);
    checkboxSelezione.addEventListener('change', () => {
      if (checkboxSelezione.checked) {
        selezionati.add(sopralluogo.id);
      } else {
        selezionati.delete(sopralluogo.id);
      }
      aggiornaBottoneScaricaSelezionati();
      aggiornaCheckboxSelezionaTutti();
    });
    selezione.appendChild(checkboxSelezione);

    const info = document.createElement('div');
    info.className = 'storico-info';

    const titolo = document.createElement('strong');
    titolo.textContent = sopralluogo.punto_vendita;

    const dettaglio = document.createElement('span');
    dettaglio.textContent = `${sopralluogo.indirizzo_punto_vendita || ''} · ${formattaData(sopralluogo.data)} · ${sopralluogo.stato}`;

    const tecnico = document.createElement('span');
    tecnico.textContent = `Tecnico: ${sopralluogo.tecnico || '—'}`;

    info.appendChild(titolo);
    info.appendChild(dettaglio);
    info.appendChild(tecnico);

    const azioni = document.createElement('div');
    azioni.className = 'storico-azioni';

    const bottoneApri = document.createElement('button');
    bottoneApri.type = 'button';
    bottoneApri.className = 'btn-secondario';
    bottoneApri.textContent = 'Apri';
    bottoneApri.addEventListener('click', () => apriPdf(sopralluogo.id, bottoneApri));

    const bottoneScarica = document.createElement('button');
    bottoneScarica.type = 'button';
    bottoneScarica.className = 'btn-secondario';
    bottoneScarica.textContent = 'Scarica';
    bottoneScarica.addEventListener('click', () => scaricaPdf(sopralluogo.id, bottoneScarica));

    const bottoneDuplica = document.createElement('button');
    bottoneDuplica.type = 'button';
    bottoneDuplica.className = 'btn-secondario';
    bottoneDuplica.textContent = '📋 Duplica';
    bottoneDuplica.setAttribute('aria-label', `Duplica ${sopralluogo.punto_vendita}`);
    bottoneDuplica.addEventListener('click', () => duplicaDialog.apri(sopralluogo));

    const bottoneElimina = document.createElement('button');
    bottoneElimina.type = 'button';
    bottoneElimina.className = 'btn-secondario btn-elimina';
    bottoneElimina.textContent = '🗑️';
    bottoneElimina.setAttribute('aria-label', `Sposta ${sopralluogo.punto_vendita} nel cestino`);
    bottoneElimina.title = 'Sposta nel cestino';
    bottoneElimina.addEventListener('click', () => spostaNelCestino(sopralluogo, bottoneElimina));

    azioni.appendChild(bottoneApri);
    azioni.appendChild(bottoneScarica);
    azioni.appendChild(bottoneDuplica);
    azioni.appendChild(bottoneElimina);

    li.appendChild(selezione);
    li.appendChild(info);
    li.appendChild(azioni);
    return li;
  }

  /** Ri-renderizza solo la lista in base ai filtri correnti, senza richiedere nulla a IndexedDB. */
  function applicaFiltri() {
    const filtrati = elencoFiltrato();
    lista.innerHTML = '';
    filtrati.forEach((sopralluogo) => lista.appendChild(creaVoce(sopralluogo)));

    vuoto.hidden = sopralluoghiCache.length > 0;
    nessunRisultato.hidden = sopralluoghiCache.length === 0 || filtrati.length > 0;

    aggiornaBottoneScaricaSelezionati();
    aggiornaCheckboxSelezionaTutti();
  }

  function onRicercaInput() {
    clearTimeout(timerDebounce);
    timerDebounce = setTimeout(() => {
      testoRicerca = inputRicerca.value.trim().toLowerCase();
      applicaFiltri();
    }, DEBOUNCE_RICERCA_MS);
  }

  function onFiltroClienteClick(event) {
    const bottone = event.target.closest('.filtro-cliente-btn');
    if (!bottone) {
      return;
    }
    clienteAttivo = bottone.dataset.cliente || '';
    Array.from(filtroClienteContainer.querySelectorAll('.filtro-cliente-btn')).forEach((btn) => {
      btn.classList.toggle('is-attivo', btn === bottone);
    });
    applicaFiltri();
  }

  /** "Seleziona tutti" agisce solo sui sopralluoghi attualmente visibili (che passano i filtri attivi). */
  function onSelezionaTuttiChange() {
    const visibili = elencoFiltrato();
    if (checkboxSelezionaTutti.checked) {
      visibili.forEach((s) => selezionati.add(s.id));
    } else {
      visibili.forEach((s) => selezionati.delete(s.id));
    }
    applicaFiltri();
  }

  /** Crea uno zip con i PDF già salvati (nessuna rigenerazione) dei sopralluoghi selezionati e lo scarica/condivide. */
  async function scaricaSelezionati() {
    const idSelezionati = Array.from(selezionati);
    if (!idSelezionati.length) {
      return;
    }

    const testoOriginale = bottoneScaricaSelezionati.textContent;
    bottoneScaricaSelezionati.disabled = true;
    bottoneScaricaSelezionati.textContent = 'Preparazione…';

    try {
      const zip = new JSZip();
      const nomiUsati = new Set();
      let trovati = 0;

      for (const id of idSelezionati) {
        const report = await db.leggiPdfReport(id);
        if (!report) {
          continue;
        }
        trovati += 1;

        let nomeFile = report.filename;
        let contatore = 2;
        while (nomiUsati.has(nomeFile)) {
          nomeFile = report.filename.replace(/\.pdf$/i, `_${contatore}.pdf`);
          contatore += 1;
        }
        nomiUsati.add(nomeFile);

        zip.file(nomeFile, report.blob);
      }

      if (trovati === 0) {
        alert('Nessun PDF disponibile tra i sopralluoghi selezionati.');
        return;
      }

      const blobZip = await zip.generateAsync({ type: 'blob' });
      const nomeZip = `Sopralluoghi_${new Date().toISOString().slice(0, 10)}.zip`;
      await pdf.salvaOCondividi(blobZip, nomeZip);

      const mancanti = idSelezionati.length - trovati;
      const messaggio =
        mancanti > 0
          ? `Scaricati ${trovati} PDF su ${idSelezionati.length} selezionati, ${mancanti} non disponibile${mancanti > 1 ? 'i' : ''}.`
          : `Scaricati ${trovati} PDF su ${idSelezionati.length} selezionati.`;
      alert(messaggio);
    } catch (errore) {
      if (errore.name !== 'AbortError') {
        alert(`Impossibile creare lo zip: ${errore.message}`);
      }
    } finally {
      bottoneScaricaSelezionati.disabled = false;
      bottoneScaricaSelezionati.textContent = testoOriginale;
      aggiornaBottoneScaricaSelezionati();
    }
  }

  async function render() {
    sopralluoghiCache = await db.elencaSopralluoghi();
    selezionati.clear();
    clienteAttivo = '';
    testoRicerca = '';
    inputRicerca.value = '';
    Array.from(filtroClienteContainer.querySelectorAll('.filtro-cliente-btn')).forEach((btn) => {
      btn.classList.toggle('is-attivo', !btn.dataset.cliente);
    });
    applicaFiltri();
    await aggiornaContatoreCestino();
  }

  /** Se un'altra scheda/dispositivo aggiorna dei dati via sync mentre siamo già nello Storico, aggiorna l'elenco a schermo. */
  function alRicevimentoDatiSync() {
    const schermata = document.getElementById('screen-history');
    if (schermata && !schermata.hidden) {
      render();
    }
  }

  function init() {
    inputRicerca.addEventListener('input', onRicercaInput);
    filtroClienteContainer.addEventListener('click', onFiltroClienteClick);
    checkboxSelezionaTutti.addEventListener('change', onSelezionaTuttiChange);
    bottoneScaricaSelezionati.addEventListener('click', scaricaSelezionati);
    router.onEnter('history', render);
    sync.onDatiAggiornati(alRicevimentoDatiSync);
  }

  return { init };
})();

/**
 * Dialogo "Duplica sopralluogo" (dallo Storico): permette di aggiornare Cliente/Sede/Tecnico/
 * Data prima di creare il duplicato (checklist_id e risposte già date copiate, senza foto né
 * stato/firma: il nuovo sopralluogo parte "in corso"), poi apre subito la Compilazione con le
 * risposte già precompilate, navigabili con avanti/indietro come una compilazione normale.
 */
const duplicaDialog = (() => {
  const dialog = document.getElementById('dialog-duplica');
  const form = document.getElementById('form-duplica');
  const inputPuntoVendita = document.getElementById('duplica-punto-vendita');
  const inputIndirizzo = document.getElementById('duplica-indirizzo');
  const inputTecnico = document.getElementById('duplica-tecnico');
  const inputData = document.getElementById('duplica-data');
  const bottoneAnnulla = document.getElementById('btn-duplica-annulla');

  let sopralluogoOriginale = null;

  function oggiISO() {
    const oggi = new Date();
    const mese = String(oggi.getMonth() + 1).padStart(2, '0');
    const giorno = String(oggi.getDate()).padStart(2, '0');
    return `${oggi.getFullYear()}-${mese}-${giorno}`;
  }

  /** Apre il dialogo precompilato con i dati del sopralluogo da duplicare (data proposta: oggi). */
  function apri(sopralluogo) {
    sopralluogoOriginale = sopralluogo;
    inputPuntoVendita.value = sopralluogo.punto_vendita || '';
    inputIndirizzo.value = sopralluogo.indirizzo_punto_vendita || '';
    inputTecnico.value = sopralluogo.tecnico || '';
    inputData.value = oggiISO();
    dialog.showModal();
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!sopralluogoOriginale) {
      return;
    }

    const nuovo = await db.duplicaSopralluogo(sopralluogoOriginale.id, {
      punto_vendita: inputPuntoVendita.value.trim(),
      indirizzo_punto_vendita: inputIndirizzo.value.trim(),
      tecnico: inputTecnico.value.trim(),
      data_sopralluogo: inputData.value
    });
    sopralluogoOriginale = null;
    dialog.close();

    const checklist = await checklistEngine.carica(nuovo.checklist_id);
    checklistEngine.avvia(checklist, nuovo);

    router.navigate('compilazione');
    compilazioneScreen.renderDomandaCorrente();
  }

  function init() {
    form.addEventListener('submit', onSubmit);
    bottoneAnnulla.addEventListener('click', () => dialog.close());
  }

  return { init, apri };
})();

/**
 * Schermata Cestino: sopralluoghi spostati nel cestino dallo Storico (soft-delete via
 * "eliminato_il"), con possibilità di ripristinarli o eliminarli definitivamente. Pulizia
 * automatica dei sopralluoghi più vecchi di 30 giorni gestita da db.pulisciCestino(),
 * chiamata silenziosamente all'avvio dell'app.
 */
const cestinoScreen = (() => {
  const lista = document.getElementById('cestino-lista');
  const vuoto = document.getElementById('cestino-vuoto');

  let cestinoCache = [];

  function formattaData(iso) {
    return new Date(iso).toLocaleString('it-IT');
  }

  async function eseguiConBottone(bottone, azione) {
    bottone.disabled = true;
    try {
      await azione();
    } finally {
      bottone.disabled = false;
    }
  }

  function render() {
    lista.innerHTML = '';
    cestinoCache.forEach((sopralluogo) => lista.appendChild(creaVoce(sopralluogo)));
    vuoto.hidden = cestinoCache.length > 0;
  }

  async function ricarica() {
    cestinoCache = await db.elencaCestino();
    render();
  }

  async function ripristina(sopralluogo, bottone) {
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Ripristino…';
      try {
        await db.ripristinaSopralluogo(sopralluogo.id);
        cestinoCache = cestinoCache.filter((s) => s.id !== sopralluogo.id);
        render();
      } catch (errore) {
        alert(`Impossibile ripristinare il sopralluogo: ${errore.message}`);
      }
    });
  }

  async function eliminaDefinitivamente(sopralluogo, bottone) {
    if (!confirm('Eliminare definitivamente questo sopralluogo? L\'operazione non è reversibile.')) {
      return;
    }
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Eliminazione…';
      try {
        await db.eliminaSopralluogo(sopralluogo.id);
        cestinoCache = cestinoCache.filter((s) => s.id !== sopralluogo.id);
        render();
      } catch (errore) {
        alert(`Impossibile eliminare il sopralluogo: ${errore.message}`);
      }
    });
  }

  function creaVoce(sopralluogo) {
    const li = document.createElement('li');
    li.className = 'storico-voce';

    const info = document.createElement('div');
    info.className = 'storico-info';

    const titolo = document.createElement('strong');
    titolo.textContent = sopralluogo.punto_vendita;

    const dettaglio = document.createElement('span');
    dettaglio.textContent = `${sopralluogo.indirizzo_punto_vendita || ''} · eliminato il ${formattaData(sopralluogo.eliminato_il)}`;

    info.appendChild(titolo);
    info.appendChild(dettaglio);

    const azioni = document.createElement('div');
    azioni.className = 'storico-azioni';

    const bottoneRipristina = document.createElement('button');
    bottoneRipristina.type = 'button';
    bottoneRipristina.className = 'btn-secondario';
    bottoneRipristina.textContent = 'Ripristina';
    bottoneRipristina.addEventListener('click', () => ripristina(sopralluogo, bottoneRipristina));

    const bottoneEliminaDefinitivo = document.createElement('button');
    bottoneEliminaDefinitivo.type = 'button';
    bottoneEliminaDefinitivo.className = 'btn-secondario btn-elimina';
    bottoneEliminaDefinitivo.textContent = 'Elimina definitivamente';
    bottoneEliminaDefinitivo.addEventListener('click', () => eliminaDefinitivamente(sopralluogo, bottoneEliminaDefinitivo));

    azioni.appendChild(bottoneRipristina);
    azioni.appendChild(bottoneEliminaDefinitivo);

    li.appendChild(info);
    li.appendChild(azioni);
    return li;
  }

  function init() {
    router.onEnter('trash', ricarica);
  }

  return { init };
})();

/**
 * Indicatore di connessione + sincronizzazione fisso nell'header, visibile in ogni schermata
 * (l'header non fa parte di #screens e non viene mai nascosto dal router). Riflette sia lo
 * stato online/offline del browser sia lo stato della sincronizzazione con Firestore (sync.js).
 */
const connessioneIndicatore = (() => {
  const contenitore = document.getElementById('stato-connessione');
  const testo = document.getElementById('stato-connessione-testo');

  const ETICHETTE = {
    offline: 'Offline - in attesa di connessione',
    sincronizzando: 'Sincronizzazione in corso…',
    sincronizzato: 'Sincronizzato'
  };

  function aggiorna() {
    const stato = navigator.onLine ? sync.statoAttuale() : 'offline';
    contenitore.classList.toggle('is-offline', stato === 'offline');
    contenitore.classList.toggle('is-sincronizzando', stato === 'sincronizzando');
    testo.textContent = ETICHETTE[stato] || ETICHETTE.offline;
  }

  function init() {
    aggiorna();
    window.addEventListener('online', aggiorna);
    window.addEventListener('offline', aggiorna);
    sync.onCambioStato(aggiorna);
  }

  return { init };
})();

/**
 * Schermata Impostazioni: elenco in sola lettura delle checklist disponibili (PROJECT.md §7.9).
 * I loghi (Colligo Ingegneria + un logo per cliente) sono fissi e bundled in assets/, non più
 * configurabili da qui: vedi pdf.js.
 */
const impostazioniScreen = (() => {
  const listaChecklist = document.getElementById('lista-checklist-disponibili');

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

  function init() {
    router.onEnter('settings', popolaChecklistDisponibili);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  router.init();
  connessioneIndicatore.init();
  nuovoSopralluogoScreen.init();
  compilazioneScreen.init();
  altriAspettiScreen.init();
  riepilogoScreen.init();
  storicoScreen.init();
  duplicaDialog.init();
  cestinoScreen.init();
  impostazioniScreen.init();
  sync.init();

  // Pulizia silenziosa all'avvio: elimina definitivamente i sopralluoghi nel cestino da oltre 30 giorni.
  db.pulisciCestino().catch((errore) => console.error('Pulizia automatica del cestino fallita:', errore));
});
