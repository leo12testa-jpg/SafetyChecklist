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
 * Schermata "Nuovo sopralluogo": popola Cliente/Sede/Tecnico (valori già usati in precedenza,
 * ma editabili come testo libero) e l'elenco checklist disponibili, poi crea il sopralluogo
 * e avvia la compilazione (PROJECT.md §7.2).
 */
const nuovoSopralluogoScreen = (() => {
  const form = document.getElementById('form-nuovo-sopralluogo');
  const listaClienti = document.getElementById('lista-clienti');
  const listaSedi = document.getElementById('lista-sedi');
  const listaTecnici = document.getElementById('lista-tecnici');
  const selectChecklist = document.getElementById('select-checklist');

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
    popolaDatalist(listaClienti, sopralluoghi.map((s) => s.cliente));
    popolaDatalist(listaSedi, sopralluoghi.map((s) => s.sede));
    popolaDatalist(listaTecnici, sopralluoghi.map((s) => s.tecnico));
  }

  async function popolaChecklistDisponibili() {
    const response = await fetch('checklists/index.json');
    const { checklists } = await response.json();
    selectChecklist.innerHTML = '';
    checklists.forEach(({ id, titolo }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = titolo;
      selectChecklist.appendChild(option);
    });
  }

  async function onEnterScreen() {
    form.reset();
    await Promise.all([popolaSuggerimenti(), popolaChecklistDisponibili()]);
  }

  async function onSubmit(event) {
    event.preventDefault();

    const cliente = document.getElementById('input-cliente').value.trim();
    const sede = document.getElementById('input-sede').value.trim();
    const tecnico = document.getElementById('input-tecnico').value.trim();
    const checklistId = selectChecklist.value;

    const sopralluogo = await db.creaSopralluogo({ cliente, sede, tecnico, checklist_id: checklistId });
    const checklist = await checklistEngine.carica(checklistId);
    checklistEngine.avvia(checklist, sopralluogo);

    router.navigate('compilazione');
    compilazioneScreen.renderDomandaCorrente();
  }

  function init() {
    form.addEventListener('submit', onSubmit);
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
  const opzioniRisposta = Array.from(document.querySelectorAll('input[name="risposta"]'));
  const btnNote = document.getElementById('btn-note');
  const btnFoto = document.getElementById('btn-foto');
  const notaEditor = document.getElementById('nota-editor');
  const notaTesto = document.getElementById('nota-testo');
  const ncForm = document.getElementById('nc-form');
  const ncDescrizione = document.getElementById('nc-descrizione');
  const ncPriorita = document.getElementById('nc-priorita');
  const ncScadenza = document.getElementById('nc-scadenza');
  const btnNcConferma = document.getElementById('btn-nc-conferma');
  const btnNcFoto = document.getElementById('btn-nc-foto');
  const ncFotoCount = document.getElementById('nc-foto-count');
  const erroreValidazione = document.getElementById('errore-validazione');
  const btnIndietro = document.getElementById('btn-indietro');
  const btnAvanti = document.getElementById('btn-avanti');

  let fotoDomandaCorrente = [];
  let ncFotoCorrente = [];

  function aggiornaContatoriFoto() {
    btnFoto.textContent = fotoDomandaCorrente.length ? `📷 Foto (${fotoDomandaCorrente.length})` : '📷 Foto';
    ncFotoCount.textContent = ncFotoCorrente.length ? `${ncFotoCorrente.length} foto allegate` : '';
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
    notaEditor.hidden = true;
    notaTesto.value = '';
    ncForm.hidden = true;
    ncDescrizione.value = '';
    ncPriorita.value = '';
    ncScadenza.value = '';
    fotoDomandaCorrente = [];
    ncFotoCorrente = [];
    aggiornaContatoriFoto();
    nascondiErrore();
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

    if (risposta) {
      const radio = opzioniRisposta.find((input) => input.value === risposta.risposta);
      if (radio) {
        radio.checked = true;
      }
      if (risposta.note) {
        notaTesto.value = risposta.note;
        notaEditor.hidden = false;
      }
      fotoDomandaCorrente = risposta.foto || [];
      if (risposta.risposta === 'NC' && risposta.nc_dettaglio) {
        ncForm.hidden = false;
        ncDescrizione.value = risposta.nc_dettaglio.descrizione || '';
        ncPriorita.value = risposta.nc_dettaglio.priorita || '';
        ncScadenza.value = risposta.nc_dettaglio.scadenza || '';
        ncFotoCorrente = risposta.nc_dettaglio.foto || [];
      }
      aggiornaContatoriFoto();
    }
  }

  async function salvaRispostaCorrente(valore, ncDettaglio = null) {
    try {
      await checklistEngine.rispondi({
        valore,
        note: notaTesto.value.trim() || null,
        foto: fotoDomandaCorrente,
        nc_dettaglio: ncDettaglio
      });
      nascondiErrore();
      return true;
    } catch (errore) {
      mostraErrore(errore.message);
      return false;
    }
  }

  async function onCambioRisposta(event) {
    const valore = event.target.value;

    if (valore === 'NC') {
      ncForm.hidden = false;
      nascondiErrore();
      return;
    }

    ncForm.hidden = true;
    await salvaRispostaCorrente(valore);
  }

  async function onConfermaNC() {
    const dettaglio = {
      descrizione: ncDescrizione.value.trim(),
      priorita: ncPriorita.value,
      foto: ncFotoCorrente,
      scadenza: ncScadenza.value || null
    };
    await salvaRispostaCorrente('NC', dettaglio);
  }

  function onToggleNote() {
    notaEditor.hidden = !notaEditor.hidden;
    if (!notaEditor.hidden) {
      notaTesto.focus();
    }
  }

  /** Foto collegata alla domanda corrente: richiede una risposta già selezionata (§7.3). */
  async function onFoto() {
    const corrente = checklistEngine.domandaCorrente();
    if (!corrente.risposta) {
      mostraErrore('Seleziona una risposta prima di aggiungere una foto.');
      return;
    }
    try {
      const sopralluogoId = checklistEngine.sopralluogoCorrente().id;
      const fotoId = await camera.scattaFoto({ sopralluogo_id: sopralluogoId, domanda_id: corrente.domanda.id });
      fotoDomandaCorrente = [...fotoDomandaCorrente, fotoId];
      aggiornaContatoriFoto();
      await salvaRispostaCorrente(corrente.risposta.risposta, corrente.risposta.nc_dettaglio || null);
    } catch (errore) {
      mostraErrore(errore.message);
    }
  }

  /** Foto collegata alla Non Conformità in compilazione (§7.4), allegata al momento della Conferma. */
  async function onNcFoto() {
    try {
      const sopralluogoId = checklistEngine.sopralluogoCorrente().id;
      const domanda = checklistEngine.domandaCorrente().domanda;
      const fotoId = await camera.scattaFoto({ sopralluogo_id: sopralluogoId, domanda_id: domanda.id });
      ncFotoCorrente = [...ncFotoCorrente, fotoId];
      aggiornaContatoriFoto();
    } catch (errore) {
      mostraErrore(errore.message);
    }
  }

  async function onNotaModificata() {
    const corrente = checklistEngine.domandaCorrente();
    if (corrente && corrente.risposta) {
      await salvaRispostaCorrente(corrente.risposta.risposta, corrente.risposta.nc_dettaglio || null);
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
      router.navigate('riepilogo');
      riepilogoScreen.render();
      return;
    }

    if (!checklistEngine.avanti()) {
      mostraErrore('Seleziona una risposta prima di procedere.');
      return;
    }
    renderDomandaCorrente();
  }

  function init() {
    opzioniRisposta.forEach((input) => input.addEventListener('change', onCambioRisposta));
    btnNcConferma.addEventListener('click', onConfermaNC);
    btnNcFoto.addEventListener('click', onNcFoto);
    btnNote.addEventListener('click', onToggleNote);
    btnFoto.addEventListener('click', onFoto);
    notaTesto.addEventListener('change', onNotaModificata);
    btnIndietro.addEventListener('click', onIndietro);
    btnAvanti.addEventListener('click', onAvanti);
  }

  return { init, renderDomandaCorrente };
})();

/**
 * Schermata di Riepilogo: conteggi per stato ed elenco delle Non Conformità rilevate,
 * per revisione rapida prima della firma (PROJECT.md §7.5).
 */
const riepilogoScreen = (() => {
  const listaConteggi = document.getElementById('riepilogo-conteggi');
  const listaNC = document.getElementById('riepilogo-nc-lista');
  const ncContainer = document.getElementById('riepilogo-nc-container');
  const btnVaiFirma = document.getElementById('btn-vai-firma');

  const ETICHETTE = { C: '✔ Conformi', PC: '⚠ Parz. conformi', NC: '✘ Non conformi', NA: '– Non applicabili' };

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
      el.innerHTML = `<strong>${nc.sezione}</strong> — ${nc.testo}<br>Priorità: ${nc.priorita}`;
      listaNC.appendChild(el);
    });
  }

  function onVaiFirma() {
    router.navigate('firma');
    firmaScreen.prepara();
  }

  function init() {
    btnVaiFirma.addEventListener('click', onVaiFirma);
  }

  return { init, render };
})();

/**
 * Schermata di Firma e generazione PDF (PROJECT.md §7.6, §7.7): firma su canvas, generazione
 * del report con pdf.js, salvataggio/condivisione e passaggio del sopralluogo a "completato".
 */
const firmaScreen = (() => {
  const canvas = document.getElementById('firma-canvas');
  const ctx = canvas.getContext('2d');
  const btnCancella = document.getElementById('btn-firma-cancella');
  const btnConferma = document.getElementById('btn-firma-conferma');
  const firmaArea = document.getElementById('firma-area');
  const pdfArea = document.getElementById('pdf-area');
  const pdfEsito = document.getElementById('pdf-esito');
  const btnGeneraPdf = document.getElementById('btn-genera-pdf');
  const btnSalvaCondividi = document.getElementById('btn-salva-condividi');
  const erroreEl = document.getElementById('firma-errore');

  let disegnando = false;
  let pdfBlob = null;
  let pdfFilename = null;

  function mostraErrore(messaggio) {
    erroreEl.textContent = messaggio;
    erroreEl.hidden = false;
  }

  function nascondiErrore() {
    erroreEl.hidden = true;
  }

  function ridimensionaCanvas() {
    const rapporto = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * rapporto;
    canvas.height = canvas.clientHeight * rapporto;
    ctx.scale(rapporto, rapporto);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }

  function posizione(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event) {
    disegnando = true;
    const { x, y } = posizione(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function onPointerMove(event) {
    if (!disegnando) {
      return;
    }
    const { x, y } = posizione(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onPointerUp() {
    disegnando = false;
  }

  function canvasVuoto() {
    const vuoto = document.createElement('canvas');
    vuoto.width = canvas.width;
    vuoto.height = canvas.height;
    return canvas.toDataURL() === vuoto.toDataURL();
  }

  function onCancella() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function onConfermaFirma() {
    if (canvasVuoto()) {
      mostraErrore('Disegna la firma prima di confermare.');
      return;
    }
    nascondiErrore();

    const firmaDataURL = canvas.toDataURL('image/png');
    const sopralluogo = checklistEngine.sopralluogoCorrente();
    await db.aggiornaSopralluogo(sopralluogo.id, { firma: firmaDataURL });

    firmaArea.hidden = true;
    pdfArea.hidden = false;
    pdfEsito.hidden = true;
    pdfBlob = null;
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

  /** Ripristina la schermata allo stato iniziale (canvas vuoto) ogni volta che si entra in Firma. */
  function prepara() {
    firmaArea.hidden = false;
    pdfArea.hidden = true;
    pdfEsito.hidden = true;
    pdfBlob = null;
    nascondiErrore();
    ridimensionaCanvas();
    onCancella();
  }

  function init() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    btnCancella.addEventListener('click', onCancella);
    btnConferma.addEventListener('click', onConfermaFirma);
    btnGeneraPdf.addEventListener('click', onGeneraPdf);
    btnSalvaCondividi.addEventListener('click', onSalvaCondividi);
  }

  return { init, prepara };
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
    titolo.textContent = `${sopralluogo.cliente} – ${sopralluogo.sede}`;

    const dettaglio = document.createElement('span');
    dettaglio.textContent = `${formattaData(sopralluogo.data)} · ${sopralluogo.stato}`;

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
  riepilogoScreen.init();
  firmaScreen.init();
  storicoScreen.init();
  impostazioniScreen.init();
});
