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
 * Id del sopralluogo appena creato via "Importa da PDF" (nuovoSopralluogoScreen), condiviso con
 * compilazioneScreen per mostrare il banner "dati importati" durante la revisione. `null` quando
 * non c'è nessuna importazione in corso o in attesa di revisione.
 */
let sopralluogoImportatoDaPdf = null;

/**
 * Etichette di visualizzazione personalizzate per checklist_id: solo il testo mostrato cambia,
 * mai i nomi dei campi salvati nel sopralluogo (punto_vendita/responsabile_punto_vendita/
 * presenza_responsabile restano gli stessi ovunque). Per checklist non elencate qui, o campi non
 * elencati per una checklist, resta il testo di default già presente nell'HTML. Mappa pensata per
 * essere estesa in futuro con altre checklist/campi senza toccare la logica che la applica.
 */
const ETICHETTE_PERSONALIZZATE_PER_CHECKLIST = {
  restage_sopralluogo: {
    puntoVendita: 'Unità produttiva',
    responsabile: 'Referente unità produttiva',
    presenzaResponsabile: 'Il sopralluogo è fatto alla presenza del referente?'
  }
};

/**
 * Applica le etichette personalizzate (o quelle di default, salvate la prima volta in un data-
 * attribute sull'elemento) per un dato checklist_id a un sottoinsieme degli <span> di testo-
 * etichetta elencati in ETICHETTE_PERSONALIZZATE_PER_CHECKLIST. `elementi` è un oggetto le cui
 * chiavi sono le stesse chiavi usate nella mappa (es. puntoVendita/responsabile/
 * presenzaResponsabile) e i valori gli <span> effettivi presenti in questo form/dialogo (non
 * tutti i form hanno tutti i campi: es. "Duplica" ha solo puntoVendita).
 */
function applicaEtichettePersonalizzate(checklistId, elementi) {
  const override = ETICHETTE_PERSONALIZZATE_PER_CHECKLIST[checklistId] || {};
  Object.entries(elementi).forEach(([chiave, span]) => {
    if (!span) {
      return;
    }
    if (!span.dataset.testoDefault) {
      span.dataset.testoDefault = span.textContent;
    }
    span.textContent = override[chiave] || span.dataset.testoDefault;
  });
}

/** Riempie una <datalist> con valori unici e non vuoti (usata per tutti i campi a suggerimento libero: Cliente/Sede/Tecnico/Responsabile/Area Manager). */
function popolaDatalist(datalist, valori) {
  datalist.innerHTML = '';
  Array.from(new Set(valori.filter(Boolean))).forEach((valore) => {
    const option = document.createElement('option');
    option.value = valore;
    datalist.appendChild(option);
  });
}

/**
 * Elenco tecnici predefinito (checklists/tecnici.json). Se il file non si carica (rete assente
 * e non ancora in cache), ritorna un elenco vuoto senza far fallire il resto della schermata.
 */
async function caricaTecniciPredefiniti() {
  try {
    const risposta = await fetch('checklists/tecnici.json');
    if (!risposta.ok) {
      throw new Error(`HTTP ${risposta.status}`);
    }
    return (await risposta.json()).tecnici || [];
  } catch (errore) {
    console.error('[app.js] Impossibile caricare l\'elenco tecnici predefinito (checklists/tecnici.json):', errore);
    return [];
  }
}

/**
 * Suggerimenti condivisi dei campi anagrafici a testo libero (Cliente/Sede/Responsabile/Area
 * Manager, che suggeriscono lo storico: valori già usati in sopralluoghi precedenti). Il campo
 * Tecnico non è più tra questi: è un <select> vero e proprio, gestito da popolaSelectTecnico.
 * Usata da "Nuovo sopralluogo" e dal dialogo "Modifica dati sopralluogo" (struttura identica).
 */
async function popolaSuggerimentiAnagrafica({ listaPuntiVendita, listaIndirizzi, listaResponsabili, listaAreaManager }) {
  const sopralluoghi = await db.elencaSopralluoghi();
  popolaDatalist(listaPuntiVendita, sopralluoghi.map((s) => s.punto_vendita));
  popolaDatalist(listaIndirizzi, sopralluoghi.map((s) => s.indirizzo_punto_vendita));
  popolaDatalist(listaResponsabili, sopralluoghi.map((s) => s.responsabile_punto_vendita));
  popolaDatalist(listaAreaManager, sopralluoghi.map((s) => s.area_manager));
}

/** Valore dell'opzione "Altro (scrivi il nome)" nel <select> Tecnico: sentinella, mai un nome reale. */
const VALORE_TECNICO_ALTRO = '__altro__';

/**
 * Popola un <select> "Tecnico" con l'elenco fisso predefinito (checklists/tecnici.json),
 * inserendo le opzioni tra "Seleziona…" e "Altro (scrivi il nome)" già presenti staticamente
 * nell'HTML. Idempotente (rimuove prima le opzioni inserite da una chiamata precedente): può
 * essere richiamata ogni volta che la schermata/il dialogo si apre senza duplicarle.
 */
async function popolaSelectTecnico(select) {
  Array.from(select.options).forEach((opzione) => {
    if (opzione.value !== '' && opzione.value !== VALORE_TECNICO_ALTRO) {
      opzione.remove();
    }
  });
  const opzioneAltro = select.querySelector(`option[value="${VALORE_TECNICO_ALTRO}"]`);
  (await caricaTecniciPredefiniti()).forEach((nome) => {
    const opzione = document.createElement('option');
    opzione.value = nome;
    opzione.textContent = nome;
    select.insertBefore(opzione, opzioneAltro);
  });
}

/**
 * Solo il campo "Nome del tecnico" del dialogo Duplica è `required` nel markup statico (Nuovo
 * sopralluogo e Modifica dati sopralluogo lo lasciano facoltativo): questa mappa ricorda, per
 * ciascun elemento, quel valore originale la prima volta che lo si incontra, PRIMA che
 * aggiornaVisibilitaTecnicoAltro/precompilaTecnico lo tocchino (altrimenti da quel momento in poi
 * `hasAttribute('required')` rifletterebbe solo l'ultimo valore impostato via JS, non l'originale).
 */
const obbligatorioAltroPerElemento = new WeakMap();

function tecnicoAltroEObbligatorioPerDefault(inputAltro) {
  if (!obbligatorioAltroPerElemento.has(inputAltro)) {
    obbligatorioAltroPerElemento.set(inputAltro, inputAltro.hasAttribute('required'));
  }
  return obbligatorioAltroPerElemento.get(inputAltro);
}

/**
 * Mostra/nasconde il campo di testo libero "Nome del tecnico" in base alla scelta "Altro" nel
 * <select> Tecnico. Quando il campo è nascosto va anche reso non `required`, altrimenti il
 * browser lo considera comunque parte della validazione del form (un elemento con `hidden` su un
 * antenato NON viene escluso automaticamente dalla constraint validation) e blocca il submit senza
 * alcun errore visibile, perché non può mostrare il popup di validazione su un campo non
 * renderizzato (in console compare solo "An invalid form control ... is not focusable").
 */
function aggiornaVisibilitaTecnicoAltro(select, labelAltro, inputAltro) {
  const mostraAltro = select.value === VALORE_TECNICO_ALTRO;
  labelAltro.hidden = !mostraAltro;
  inputAltro.required = mostraAltro && tecnicoAltroEObbligatorioPerDefault(inputAltro);
  if (!mostraAltro) {
    inputAltro.value = '';
  }
}

/** Valore effettivo del campo Tecnico: il nome scelto dal <select>, o il testo libero se è stato scelto "Altro". */
function leggiValoreTecnico(select, inputAltro) {
  return select.value === VALORE_TECNICO_ALTRO ? inputAltro.value.trim() : select.value;
}

/**
 * Precompila il <select> Tecnico (+ eventuale campo "Altro") con un valore già salvato: se
 * combacia con una delle opzioni predefinite la seleziona, altrimenti seleziona "Altro" e ci
 * scrive dentro il valore così com'è (nome storico non/non più in elenco). Va chiamata SOLO dopo
 * popolaSelectTecnico (deve conoscere le opzioni disponibili per capire se il valore combacia).
 */
function precompilaTecnico(select, labelAltro, inputAltro, valore) {
  const valoreEsistente = valore || '';
  const combacia = valoreEsistente !== '' && Array.from(select.options).some((o) => o.value === valoreEsistente);

  if (combacia) {
    select.value = valoreEsistente;
    labelAltro.hidden = true;
    inputAltro.required = false;
    inputAltro.value = '';
  } else if (valoreEsistente !== '') {
    select.value = VALORE_TECNICO_ALTRO;
    labelAltro.hidden = false;
    inputAltro.required = tecnicoAltroEObbligatorioPerDefault(inputAltro);
    inputAltro.value = valoreEsistente;
  } else {
    select.value = '';
    labelAltro.hidden = true;
    inputAltro.required = false;
    inputAltro.value = '';
  }
}

/**
 * Schermata "Nuovo sopralluogo": popola i campi editabili come testo libero (valori già usati
 * in precedenza), filtra la Checklist in base al punto vendita digitato (checklists/clients.json),
 * poi crea il sopralluogo e avvia la compilazione (PROJECT.md §7.2). Supporta anche l'importazione
 * delle risposte da un PDF già generato da questa app (js/pdf-import.js): precompila i campi del
 * form con l'anagrafica letta dal PDF e porta le risposte estratte fino alla creazione del
 * sopralluogo, che parte comunque sempre in revisione (mai un salvataggio diretto).
 */
const nuovoSopralluogoScreen = (() => {
  const form = document.getElementById('form-nuovo-sopralluogo');
  const inputPuntoVendita = document.getElementById('input-punto-vendita');
  const inputIndirizzo = document.getElementById('input-indirizzo-punto-vendita');
  const inputNumeroDipendenti = document.getElementById('input-numero-dipendenti');
  const inputTecnico = document.getElementById('input-tecnico');
  const labelTecnicoAltro = document.getElementById('label-input-tecnico-altro');
  const inputTecnicoAltro = document.getElementById('input-tecnico-altro');
  const inputDataSopralluogo = document.getElementById('input-data-sopralluogo');
  const inputResponsabile = document.getElementById('input-responsabile');
  const inputAreaManager = document.getElementById('input-area-manager');
  const selectPresenzaResponsabile = document.getElementById('select-presenza-responsabile');
  const selectPresenzaRls = document.getElementById('select-presenza-rls');
  const selectChecklist = document.getElementById('select-checklist');

  const labelPuntoVenditaTesto = document.getElementById('label-input-punto-vendita-testo');
  const labelResponsabileTesto = document.getElementById('label-input-responsabile-testo');
  const labelPresenzaResponsabileTesto = document.getElementById('label-select-presenza-responsabile-testo');

  const listaPuntiVendita = document.getElementById('lista-punti-vendita');
  const listaIndirizzi = document.getElementById('lista-indirizzi');
  const listaResponsabili = document.getElementById('lista-responsabili');
  const listaAreaManager = document.getElementById('lista-area-manager');

  const btnImportaPdf = document.getElementById('btn-importa-pdf');
  const inputImportaPdf = document.getElementById('input-importa-pdf');
  const esitoImportazione = document.getElementById('importa-pdf-esito');

  let checklistDisponibili = [];
  let associazioniClienti = [];
  let risposteImportate = null;
  let checklistIdImportato = null;

  async function popolaSuggerimenti() {
    await Promise.all([
      popolaSuggerimentiAnagrafica({ listaPuntiVendita, listaIndirizzi, listaResponsabili, listaAreaManager }),
      popolaSelectTecnico(inputTecnico)
    ]);
  }

  function oggiISO() {
    const oggi = new Date();
    const mese = String(oggi.getMonth() + 1).padStart(2, '0');
    const giorno = String(oggi.getDate()).padStart(2, '0');
    return `${oggi.getFullYear()}-${mese}-${giorno}`;
  }

  /** Etichette anagrafiche (Punto vendita/Responsabile/presenza responsabile) coerenti con la checklist attualmente selezionata. */
  function aggiornaEtichetteAnagrafica() {
    applicaEtichettePersonalizzate(selectChecklist.value, {
      puntoVendita: labelPuntoVenditaTesto,
      responsabile: labelResponsabileTesto,
      presenzaResponsabile: labelPresenzaResponsabileTesto
    });
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
    aggiornaEtichetteAnagrafica();
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

  /** Azzera lo stato di un'eventuale importazione PDF precedente (entrando di nuovo nella schermata, o cambiando checklist dopo un'importazione: le risposte importate valgono solo per la checklist con cui sono state lette). */
  function annullaImportazione(messaggio) {
    risposteImportate = null;
    checklistIdImportato = null;
    if (messaggio) {
      esitoImportazione.hidden = false;
      esitoImportazione.textContent = messaggio;
    } else {
      esitoImportazione.hidden = true;
      esitoImportazione.textContent = '';
    }
  }

  /** Imposta un <select> su un valore letto dal PDF solo se corrisponde a una delle opzioni esistenti (Sì/No). */
  function impostaSelectSeValido(select, valore) {
    if (valore && Array.from(select.options).some((opzione) => opzione.value === valore)) {
      select.value = valore;
    }
  }

  /**
   * Il menu "Checklist" ha sempre un valore (nessuna opzione vuota): prima di aprire il
   * selettore file chiediamo esplicita conferma di quale checklist useremo per interpretare le
   * colonne del PDF, così l'utente nota subito se il menu è rimasto sul valore sbagliato.
   */
  async function onClickImportaPdf() {
    const opzioneSelezionata = selectChecklist.options[selectChecklist.selectedIndex];
    const titoloChecklist = opzioneSelezionata ? opzioneSelezionata.textContent : '(nessuna)';
    const confermato = confirm(
      `Il PDF da importare corrisponde alla checklist "${titoloChecklist}"?\n\n` +
      'Serve a interpretare correttamente le colonne del report. Se non è quella giusta, annulla e selezionala prima qui sopra nel menu "Checklist".'
    );
    if (!confermato) {
      return;
    }
    inputImportaPdf.click();
  }

  async function onFileImportaPdfSelezionato(event) {
    const file = event.target.files[0];
    event.target.value = ''; // permette di riselezionare lo stesso file in un secondo tentativo
    if (!file) {
      return;
    }

    const checklistId = selectChecklist.value;
    const testoOriginale = btnImportaPdf.textContent;
    btnImportaPdf.disabled = true;
    btnImportaPdf.textContent = 'Importazione in corso…';
    esitoImportazione.hidden = true;

    try {
      const checklist = await checklistEngine.carica(checklistId);
      const risultato = await pdfImport.importaDaFile(file, checklist);

      risposteImportate = risultato.risposte;
      checklistIdImportato = checklistId;

      const anagrafica = risultato.anagrafica || {};
      if (anagrafica.punto_vendita) inputPuntoVendita.value = anagrafica.punto_vendita;
      if (anagrafica.indirizzo_punto_vendita) inputIndirizzo.value = anagrafica.indirizzo_punto_vendita;
      if (anagrafica.numero_dipendenti) inputNumeroDipendenti.value = anagrafica.numero_dipendenti;
      if (anagrafica.tecnico) precompilaTecnico(inputTecnico, labelTecnicoAltro, inputTecnicoAltro, anagrafica.tecnico);
      if (anagrafica.responsabile_punto_vendita) inputResponsabile.value = anagrafica.responsabile_punto_vendita;
      if (anagrafica.area_manager) inputAreaManager.value = anagrafica.area_manager;
      impostaSelectSeValido(selectPresenzaResponsabile, anagrafica.presenza_responsabile);
      impostaSelectSeValido(selectPresenzaRls, anagrafica.presenza_rls);
      // La Data del sopralluogo NON viene sovrascritta con quella letta dal PDF: il nuovo
      // sopralluogo importato riparte da oggi (di default, comunque modificabile qui sopra).

      const percentuale = risultato.totaleDomande
        ? Math.round((risultato.domandeRiconosciute / risultato.totaleDomande) * 100)
        : 0;
      esitoImportazione.hidden = false;
      esitoImportazione.textContent =
        `PDF importato: ${risultato.domandeRiconosciute}/${risultato.totaleDomande} domande riconosciute (${percentuale}%). ` +
        'Le foto non vengono importate, andranno ricaricate se necessario. ' +
        'Verifica/correggi i campi qui sopra, poi premi INIZIA: potrai rivedere ogni risposta domanda per domanda prima di generare il nuovo report.';
    } catch (errore) {
      annullaImportazione(`Importazione non riuscita: ${errore.message}`);
    } finally {
      btnImportaPdf.disabled = false;
      btnImportaPdf.textContent = testoOriginale;
    }
  }

  async function onEnterScreen() {
    form.reset();
    inputDataSopralluogo.value = oggiISO();
    aggiornaVisibilitaTecnicoAltro(inputTecnico, labelTecnicoAltro, inputTecnicoAltro);
    annullaImportazione(null);
    await Promise.all([popolaSuggerimenti(), caricaChecklistECliente()]);
  }

  async function onSubmit(event) {
    event.preventDefault();

    let sopralluogo = await db.creaSopralluogo({
      punto_vendita: inputPuntoVendita.value.trim(),
      indirizzo_punto_vendita: inputIndirizzo.value.trim(),
      numero_dipendenti: inputNumeroDipendenti.value,
      tecnico: leggiValoreTecnico(inputTecnico, inputTecnicoAltro),
      data_sopralluogo: inputDataSopralluogo.value,
      responsabile_punto_vendita: inputResponsabile.value.trim(),
      area_manager: inputAreaManager.value.trim() || null,
      presenza_responsabile: selectPresenzaResponsabile.value,
      presenza_rls: selectPresenzaRls.value,
      checklist_id: selectChecklist.value
    });

    if (risposteImportate && checklistIdImportato === sopralluogo.checklist_id) {
      sopralluogo = await db.impostaRisposte(sopralluogo.id, risposteImportate);
      sopralluogoImportatoDaPdf = sopralluogo.id;
    }
    annullaImportazione(null);

    const checklist = await checklistEngine.carica(sopralluogo.checklist_id);
    checklistEngine.avvia(checklist, sopralluogo);

    router.navigate('compilazione');
    compilazioneScreen.renderDomandaCorrente();
  }

  function init() {
    form.addEventListener('submit', onSubmit);
    inputPuntoVendita.addEventListener('input', filtraChecklistPerCliente);
    inputTecnico.addEventListener('change', () => aggiornaVisibilitaTecnicoAltro(inputTecnico, labelTecnicoAltro, inputTecnicoAltro));
    btnImportaPdf.addEventListener('click', onClickImportaPdf);
    inputImportaPdf.addEventListener('change', onFileImportaPdfSelezionato);
    selectChecklist.addEventListener('change', () => {
      if (risposteImportate && checklistIdImportato !== selectChecklist.value) {
        annullaImportazione('Importazione annullata: la checklist selezionata è cambiata rispetto a quella usata per leggere il PDF.');
      }
      aggiornaEtichetteAnagrafica();
    });
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
  const btnModificaAnagrafica = document.getElementById('btn-modifica-anagrafica-compilazione');
  const bannerImport = document.getElementById('compilazione-banner-import');

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

    bannerImport.hidden = checklistEngine.sopralluogoCorrente().id !== sopralluogoImportatoDaPdf;

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

  function onModificaAnagrafica() {
    anagraficaDialog.apri(checklistEngine.sopralluogoCorrente().id);
  }

  function init() {
    applicaEtichetteRisposta();
    opzioniRisposta.forEach((input) => input.addEventListener('change', onCambioRisposta));
    btnNote.addEventListener('click', onToggleNote);
    btnFoto.addEventListener('click', onFoto);
    notaTesto.addEventListener('change', onNotaModificata);
    btnIndietro.addEventListener('click', onIndietro);
    btnAvanti.addEventListener('click', onAvanti);
    btnModificaAnagrafica.addEventListener('click', onModificaAnagrafica);
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
  const btnFoto = document.getElementById('btn-altri-aspetti-foto');
  const erroreEl = document.getElementById('altri-aspetti-errore');

  // Foto collegate a questo campo speciale (non a una domanda): sopralluogo.altri_aspetti_foto,
  // stesso meccanismo di camera.js/db.salvaFoto già usato per le domande, con domanda_id null.
  let fotoAltriAspetti = [];

  function aggiornaContatoreFoto() {
    btnFoto.textContent = fotoAltriAspetti.length ? `📷 Foto (${fotoAltriAspetti.length})` : '📷 Foto';
  }

  function mostraErrore(messaggio) {
    erroreEl.textContent = messaggio;
    erroreEl.hidden = false;
  }

  /** Precompila il campo con quanto eventualmente già salvato (riapertura di un sopralluogo). */
  function prepara() {
    const sopralluogo = checklistEngine.sopralluogoCorrente();
    textarea.value = sopralluogo.altri_aspetti || '';
    fotoAltriAspetti = sopralluogo.altri_aspetti_foto || [];
    erroreEl.hidden = true;
    aggiornaContatoreFoto();
  }

  async function onFoto() {
    try {
      const sopralluogo = checklistEngine.sopralluogoCorrente();
      const fotoId = await camera.scattaFoto({ sopralluogo_id: sopralluogo.id, domanda_id: null });
      fotoAltriAspetti = [...fotoAltriAspetti, fotoId];
      aggiornaContatoreFoto();
      await db.aggiornaSopralluogo(sopralluogo.id, { altri_aspetti_foto: fotoAltriAspetti });
    } catch (errore) {
      mostraErrore(errore.message);
    }
  }

  async function onAvanti() {
    const sopralluogo = checklistEngine.sopralluogoCorrente();
    await db.aggiornaSopralluogo(sopralluogo.id, { altri_aspetti: textarea.value.trim() || null });
    router.navigate('riepilogo');
    riepilogoScreen.render();
  }

  function init() {
    btnAvanti.addEventListener('click', onAvanti);
    btnFoto.addEventListener('click', onFoto);
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
  const btnModificaAnagrafica = document.getElementById('btn-modifica-anagrafica-riepilogo');
  const bannerAnagrafica = document.getElementById('riepilogo-banner-anagrafica');
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

  /**
   * Mostra il banner "rigenera il PDF" se un PDF è già stato salvato per questo sopralluogo ma
   * i dati anagrafici sono stati modificati dopo, confrontando aggiornato_il del sopralluogo con
   * generato_il del PDF salvato — letti freschi dal DB (non dalla copia in memoria di
   * checklistEngine, che "Modifica dati sopralluogo" aggiorna solo su IndexedDB, non nella
   * cache del motore): corretto anche se la modifica arriva da un'altra sessione/dispositivo
   * via sync. Nessun PDF ancora generato = nulla da segnalare.
   */
  async function aggiornaBannerAnagrafica(sopralluogoId) {
    const [sopralluogo, pdfReport] = await Promise.all([
      db.leggiSopralluogo(sopralluogoId),
      db.leggiPdfReport(sopralluogoId)
    ]);
    const modificatoDopoGenerazione = Boolean(
      pdfReport && sopralluogo && sopralluogo.aggiornato_il > pdfReport.generato_il
    );
    bannerAnagrafica.hidden = !modificatoDopoGenerazione;
  }

  /** Ricalcola e mostra i conteggi e l'elenco NC del sopralluogo in compilazione. */
  function render() {
    const checklist = checklistEngine.getChecklist();
    const sopralluogo = checklistEngine.sopralluogoCorrente();
    const { totale, conteggi, nonRisposte, nonConformita } = checklistEngine.calcolaRiepilogo(checklist, sopralluogo);
    aggiornaBannerAnagrafica(sopralluogo.id);

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
      bannerAnagrafica.hidden = true;
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

  function onModificaAnagrafica() {
    anagraficaDialog.apri(checklistEngine.sopralluogoCorrente().id, { onSalvato: render });
  }

  function init() {
    btnGeneraPdf.addEventListener('click', onGeneraPdf);
    btnSalvaCondividi.addEventListener('click', onSalvaCondividi);
    btnModificaAnagrafica.addEventListener('click', onModificaAnagrafica);
  }

  return { init, render };
})();

/**
 * Schermata Storico: elenco sopralluoghi salvati, ordinati per data decrescente, con
 * possibilità di aprire o scaricare il report PDF (PROJECT.md §7.8). Usa il PDF già salvato al
 * completamento del sopralluogo quando c'è; altrimenti lo rigenera al volo dagli stessi dati
 * (stessa funzione pdf.generaReport usata a fine Compilazione) — serve sia per i sopralluoghi
 * completati prima dell'introduzione del salvataggio del PDF, sia per quelli sincronizzati da
 * un altro dispositivo (il PDF salvato, come le foto, non viaggia mai su Firestore: solo i dati
 * testuali). Le foto non disponibili in locale vengono semplicemente omesse dal PDF rigenerato
 * (vedi disegnaPaginaAllegati in pdf.js), con un avviso esplicito all'utente se ne manca almeno una.
 *
 * Filtro cliente/testo applicato in memoria sull'elenco già caricato (nessuna nuova query
 * IndexedDB per digitazione); selezione multipla con export ZIP.
 */
const storicoScreen = (() => {
  const lista = document.getElementById('storico-lista');
  const vuoto = document.getElementById('storico-vuoto');
  const nessunRisultato = document.getElementById('storico-nessun-risultato');
  const filtroClienteContainer = document.getElementById('storico-filtro-cliente');
  const filtroStatoChiusuraContainer = document.getElementById('storico-filtro-stato-chiusura');
  const inputRicerca = document.getElementById('storico-ricerca');
  const checkboxSelezionaTutti = document.getElementById('storico-seleziona-tutti');
  const bottoneScaricaSelezionati = document.getElementById('storico-scarica-selezionati');
  const bottoneVaiCestino = document.getElementById('storico-vai-cestino');

  const DEBOUNCE_RICERCA_MS = 250;

  const VALORE_CLIENTE_ALTRO = '__altro__';

  let sopralluoghiCache = [];
  let clienteAttivo = '';
  let statoChiusuraAttivo = '';
  let nomiClientiConfigurati = [];
  let testoRicerca = '';
  let timerDebounce = null;
  const selezionati = new Set();

  function formattaData(iso) {
    return new Date(iso).toLocaleDateString('it-IT');
  }

  /**
   * Popola il filtro cliente con un'opzione per ciascun cliente in checklists/clients.json, tra
   * "Tutti" e "Altro" già presenti staticamente nell'HTML. Idempotente (rimuove prima le opzioni
   * inserite da una chiamata precedente): può essere richiamata a ogni ingresso nello Storico
   * senza duplicarle. `nomiClientiConfigurati` resta aggiornato per il match di "Altro".
   */
  async function popolaFiltroCliente() {
    let clienti = [];
    try {
      const risposta = await fetch('checklists/clients.json');
      if (!risposta.ok) {
        throw new Error(`HTTP ${risposta.status}`);
      }
      clienti = (await risposta.json()).clienti || [];
    } catch (errore) {
      console.error('[app.js] Impossibile caricare checklists/clients.json per il filtro Storico:', errore);
    }
    nomiClientiConfigurati = clienti.map((c) => c.nome);

    Array.from(filtroClienteContainer.options).forEach((opzione) => {
      if (opzione.value !== '' && opzione.value !== VALORE_CLIENTE_ALTRO) {
        opzione.remove();
      }
    });
    const opzioneAltro = filtroClienteContainer.querySelector(`option[value="${VALORE_CLIENTE_ALTRO}"]`);
    clienti.forEach(({ nome }) => {
      const opzione = document.createElement('option');
      opzione.value = nome;
      opzione.textContent = nome;
      filtroClienteContainer.insertBefore(opzione, opzioneAltro);
    });
  }

  /**
   * Match sul "Punto vendita" del sopralluogo (stessa logica esatta, case-insensitive, di
   * filtraChecklistPerCliente in nuovoSopralluogoScreen — non più sul checklist_id): "Altro"
   * cattura i sopralluoghi il cui punto vendita non combacia con nessun cliente configurato
   * (incluso il caso di punto vendita vuoto, ora possibile con l'anagrafica facoltativa).
   */
  function corrispondeCliente(sopralluogo, filtro) {
    if (!filtro) {
      return true;
    }
    const puntoVendita = String(sopralluogo.punto_vendita || '').toLowerCase();
    if (filtro === VALORE_CLIENTE_ALTRO) {
      return !nomiClientiConfigurati.some((nome) => nome.toLowerCase() === puntoVendita);
    }
    return puntoVendita === filtro.toLowerCase();
  }

  function corrispondeRicerca(sopralluogo, testo) {
    if (!testo) {
      return true;
    }
    return String(sopralluogo.punto_vendita || '').toLowerCase().includes(testo);
  }

  /**
   * Filtro "Tutti"/"Da completare"/"Chiuse" sullo stato_chiusura (vedi isChiuso più sotto): si
   * applica a ogni sopralluogo indipendentemente dallo stato di compilazione (anche "in corso",
   * non solo "completato" — è un tracciamento manuale separato, vedi creaVoce).
   */
  function corrispondeStatoChiusura(sopralluogo, filtro) {
    if (!filtro) {
      return true;
    }
    return isChiuso(sopralluogo) === (filtro === 'chiuso');
  }

  function elencoFiltrato() {
    return sopralluoghiCache.filter(
      (s) =>
        corrispondeCliente(s, clienteAttivo) &&
        corrispondeStatoChiusura(s, statoChiusuraAttivo) &&
        corrispondeRicerca(s, testoRicerca)
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

  /** Conta quante foto referenziate dalle risposte (o da "Altri aspetti") di un sopralluogo non sono (più) presenti in locale. */
  async function contaFotoMancanti(sopralluogo) {
    const idFoto = (sopralluogo.risposte || [])
      .flatMap((r) => r.foto || [])
      .concat(sopralluogo.altri_aspetti_foto || []);
    if (!idFoto.length) {
      return 0;
    }
    const trovate = await Promise.all(idFoto.map((id) => db.leggiFoto(id)));
    return trovate.filter((foto) => !foto).length;
  }

  /**
   * Ritorna sempre un PDF utilizzabile per il sopralluogo indicato: quello già salvato se esiste,
   * altrimenti lo rigenera al volo dai dati del sopralluogo (stessa funzione di generazione usata
   * a fine Compilazione). `rigenerato`/`fotoMancanti` servono solo per avvisare l'utente quando è
   * stato necessario rigenerare senza tutte le foto originali.
   */
  async function ottieniOGeneraPdf(sopralluogoId) {
    const salvato = await db.leggiPdfReport(sopralluogoId);
    if (salvato) {
      return { blob: salvato.blob, filename: salvato.filename, rigenerato: false, fotoMancanti: 0 };
    }

    const sopralluogo = await db.leggiSopralluogo(sopralluogoId);
    if (!sopralluogo) {
      throw new Error('Sopralluogo non trovato.');
    }

    const [checklist, fotoMancanti] = await Promise.all([
      checklistEngine.carica(sopralluogo.checklist_id),
      contaFotoMancanti(sopralluogo)
    ]);
    const blob = await pdf.generaReport(checklist, sopralluogo);

    return { blob, filename: pdf.nomeFile(sopralluogo), rigenerato: true, fotoMancanti };
  }

  function avvisaSeFotoMancanti(rigenerato, fotoMancanti) {
    if (rigenerato && fotoMancanti > 0) {
      alert(
        `Alcune foto di questo sopralluogo non sono disponibili su questo dispositivo (${fotoMancanti}). ` +
        'Il PDF è stato rigenerato senza quelle foto.'
      );
    }
  }

  /**
   * Apre in una nuova scheda il PDF (già salvato o rigenerato al volo). La scheda viene aperta in
   * modo sincrono, prima di qualsiasi `await`, per non perdere il gesto utente del click: su
   * mobile (Safari iOS, WebView Android, PWA installate) un window.open dopo operazioni
   * asincrone viene spesso bloccato silenziosamente come popup.
   */
  async function apriPdf(sopralluogoId, bottone) {
    const finestra = window.open('', '_blank');
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Apertura…';
      try {
        const { blob, rigenerato, fotoMancanti } = await ottieniOGeneraPdf(sopralluogoId);
        const url = URL.createObjectURL(blob);
        if (finestra) {
          finestra.location.href = url;
        } else {
          window.open(url, '_blank');
        }
        avvisaSeFotoMancanti(rigenerato, fotoMancanti);
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
        const { blob, filename, rigenerato, fotoMancanti } = await ottieniOGeneraPdf(sopralluogoId);
        await pdf.salvaOCondividi(blob, filename);
        avvisaSeFotoMancanti(rigenerato, fotoMancanti);
      } catch (errore) {
        if (errore.name !== 'AbortError') {
          alert(`Impossibile scaricare il PDF: ${errore.message}`);
        }
      }
    });
  }

  /**
   * Riapre in Compilazione lo STESSO sopralluogo (stesso id, nessuna copia): risposte/note/foto
   * già date arrivano precompilate (checklistEngine.avvia le legge da sopralluogo.risposte come
   * in qualsiasi altra compilazione) e restano modificabili con la stessa navigazione avanti/
   * indietro. Nessun dialogo di conferma (a differenza di Duplica: qui non c'è nulla da decidere
   * prima di entrare). Se il sopralluogo era "completato", arrivare di nuovo a Riepilogo →
   * Genera PDF lo sovrascrive (db.salvaPdfReport fa un put sullo stesso sopralluogo_id) e
   * aggiorna aggiornato_il (db.aggiornaSopralluogo/salvaRisposta), riflettendosi sulla sync;
   * se invece si torna alla Home senza generare un nuovo PDF, le risposte nel frattempo
   * modificate restano comunque salvate (autosalvataggio già esistente in salvaRisposta) e lo
   * stato resta quello precedente.
   */
  async function apriModifica(sopralluogo) {
    const checklist = await checklistEngine.carica(sopralluogo.checklist_id);
    checklistEngine.avvia(checklist, sopralluogo);

    router.navigate('compilazione');
    compilazioneScreen.renderDomandaCorrente();
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

  /**
   * Stato di chiusura amministrativa (Da completare/Chiusa): puramente manuale, non dipende dal
   * numero di conformità/non conformità né dal campo "stato" di compilazione. I sopralluoghi
   * salvati prima dell'introduzione di questo campo non lo hanno: vanno trattati come "aperto".
   */
  function isChiuso(sopralluogo) {
    return sopralluogo.stato_chiusura === 'chiuso';
  }

  /** Sostituisce in cache il sopralluogo aggiornato (stessa identità di riferimento delle altre voci) e ridisegna subito la lista. */
  function aggiornaSopralluogoInCache(sopralluogoAggiornato) {
    const indice = sopralluoghiCache.findIndex((s) => s.id === sopralluogoAggiornato.id);
    if (indice >= 0) {
      sopralluoghiCache[indice] = sopralluogoAggiornato;
    }
    applicaFiltri();
  }

  /** Chiede conferma, poi marca il sopralluogo come "Chiusa" (con data di chiusura) e aggiorna subito l'elenco a schermo. */
  async function chiudiChecklist(sopralluogo, bottone) {
    if (!confirm('Segnare questo sopralluogo come chiuso?')) {
      return;
    }
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Chiusura…';
      try {
        const aggiornato = await db.chiudiSopralluogo(sopralluogo.id);
        aggiornaSopralluogoInCache(aggiornato);
      } catch (errore) {
        alert(`Impossibile chiudere il sopralluogo: ${errore.message}`);
      }
    });
  }

  /** Chiede conferma, poi riporta il sopralluogo a "Da completare" e aggiorna subito l'elenco a schermo. */
  async function riapriChecklist(sopralluogo, bottone) {
    if (!confirm('Riaprire questo sopralluogo?')) {
      return;
    }
    await eseguiConBottone(bottone, async () => {
      bottone.textContent = 'Riapertura…';
      try {
        const aggiornato = await db.riapriSopralluogo(sopralluogo.id);
        aggiornaSopralluogoInCache(aggiornato);
      } catch (errore) {
        alert(`Impossibile riaprire il sopralluogo: ${errore.message}`);
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

    const chiuso = isChiuso(sopralluogo);
    const statoChiusura = document.createElement('span');
    statoChiusura.className = `storico-stato${chiuso ? ' is-chiuso' : ''}`;
    const pallinoStato = document.createElement('span');
    pallinoStato.className = 'storico-stato-pallino';
    statoChiusura.appendChild(pallinoStato);
    statoChiusura.appendChild(document.createTextNode(chiuso ? 'Chiusa' : 'Da completare'));

    const dettaglio = document.createElement('span');
    dettaglio.textContent = `${sopralluogo.indirizzo_punto_vendita || ''} · ${formattaData(sopralluogo.data)} · ${sopralluogo.stato}`;

    const tecnico = document.createElement('span');
    tecnico.textContent = `Tecnico: ${sopralluogo.tecnico || '—'}`;

    info.appendChild(titolo);
    info.appendChild(statoChiusura);
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

    const bottoneModifica = document.createElement('button');
    bottoneModifica.type = 'button';
    bottoneModifica.className = 'btn-secondario';
    bottoneModifica.textContent = '✏️ Modifica';
    bottoneModifica.setAttribute('aria-label', `Modifica ${sopralluogo.punto_vendita}`);
    bottoneModifica.addEventListener('click', () => apriModifica(sopralluogo));

    const bottoneDuplica = document.createElement('button');
    bottoneDuplica.type = 'button';
    bottoneDuplica.className = 'btn-secondario';
    bottoneDuplica.textContent = '📋 Duplica';
    bottoneDuplica.setAttribute('aria-label', `Duplica ${sopralluogo.punto_vendita}`);
    bottoneDuplica.addEventListener('click', () => duplicaDialog.apri(sopralluogo));

    const bottoneChiusura = document.createElement('button');
    bottoneChiusura.type = 'button';
    bottoneChiusura.className = 'btn-secondario';
    if (chiuso) {
      bottoneChiusura.textContent = 'Riapri';
      bottoneChiusura.addEventListener('click', () => riapriChecklist(sopralluogo, bottoneChiusura));
    } else {
      bottoneChiusura.textContent = 'Segna come chiusa';
      bottoneChiusura.addEventListener('click', () => chiudiChecklist(sopralluogo, bottoneChiusura));
    }

    const bottoneElimina = document.createElement('button');
    bottoneElimina.type = 'button';
    bottoneElimina.className = 'btn-secondario btn-elimina';
    bottoneElimina.textContent = '🗑️';
    bottoneElimina.setAttribute('aria-label', `Sposta ${sopralluogo.punto_vendita} nel cestino`);
    bottoneElimina.title = 'Sposta nel cestino';
    bottoneElimina.addEventListener('click', () => spostaNelCestino(sopralluogo, bottoneElimina));

    azioni.appendChild(bottoneApri);
    azioni.appendChild(bottoneScarica);
    azioni.appendChild(bottoneModifica);
    azioni.appendChild(bottoneDuplica);
    azioni.appendChild(bottoneChiusura);
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

  function onFiltroClienteChange() {
    clienteAttivo = filtroClienteContainer.value;
    applicaFiltri();
  }

  function onFiltroStatoChiusuraChange() {
    statoChiusuraAttivo = filtroStatoChiusuraContainer.value;
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
      let rigenerati = 0;
      let conFotoMancanti = 0;

      for (const id of idSelezionati) {
        let esito;
        try {
          esito = await ottieniOGeneraPdf(id);
        } catch (errore) {
          console.error(`Impossibile ottenere il PDF del sopralluogo ${id}:`, errore);
          continue;
        }
        trovati += 1;
        if (esito.rigenerato) {
          rigenerati += 1;
          if (esito.fotoMancanti > 0) {
            conFotoMancanti += 1;
          }
        }

        let nomeFile = esito.filename;
        let contatore = 2;
        while (nomiUsati.has(nomeFile)) {
          nomeFile = esito.filename.replace(/\.pdf$/i, `_${contatore}.pdf`);
          contatore += 1;
        }
        nomiUsati.add(nomeFile);

        zip.file(nomeFile, esito.blob);
      }

      if (trovati === 0) {
        alert('Impossibile generare un PDF per i sopralluoghi selezionati.');
        return;
      }

      const blobZip = await zip.generateAsync({ type: 'blob' });
      const nomeZip = `Sopralluoghi_${new Date().toISOString().slice(0, 10)}.zip`;
      await pdf.salvaOCondividi(blobZip, nomeZip);

      const mancanti = idSelezionati.length - trovati;
      let messaggio = `Scaricati ${trovati} PDF su ${idSelezionati.length} selezionati.`;
      if (mancanti > 0) {
        messaggio += ` ${mancanti} non generabile${mancanti > 1 ? 'i' : ''}.`;
      }
      if (rigenerati > 0) {
        messaggio += ` ${rigenerati} rigenerato${rigenerati > 1 ? 'i' : ''} al volo (non salvato in precedenza)${conFotoMancanti > 0 ? `, ${conFotoMancanti} senza alcune foto non più disponibili in locale` : ''}.`;
      }
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
    const [sopralluoghi] = await Promise.all([db.elencaSopralluoghi(), popolaFiltroCliente()]);
    sopralluoghiCache = sopralluoghi;
    selezionati.clear();
    clienteAttivo = '';
    statoChiusuraAttivo = '';
    testoRicerca = '';
    inputRicerca.value = '';
    filtroClienteContainer.value = '';
    filtroStatoChiusuraContainer.value = '';
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
    filtroClienteContainer.addEventListener('change', onFiltroClienteChange);
    filtroStatoChiusuraContainer.addEventListener('change', onFiltroStatoChiusuraChange);
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
  const labelTecnicoAltro = document.getElementById('label-duplica-tecnico-altro');
  const inputTecnicoAltro = document.getElementById('duplica-tecnico-altro');
  const inputData = document.getElementById('duplica-data');
  const bottoneAnnulla = document.getElementById('btn-duplica-annulla');
  const labelPuntoVenditaTesto = document.getElementById('label-duplica-punto-vendita-testo');

  let sopralluogoOriginale = null;

  function oggiISO() {
    const oggi = new Date();
    const mese = String(oggi.getMonth() + 1).padStart(2, '0');
    const giorno = String(oggi.getDate()).padStart(2, '0');
    return `${oggi.getFullYear()}-${mese}-${giorno}`;
  }

  /** Apre il dialogo precompilato con i dati del sopralluogo da duplicare (data proposta: oggi). */
  async function apri(sopralluogo) {
    sopralluogoOriginale = sopralluogo;
    inputPuntoVendita.value = sopralluogo.punto_vendita || '';
    inputIndirizzo.value = sopralluogo.indirizzo_punto_vendita || '';
    inputData.value = oggiISO();
    applicaEtichettePersonalizzate(sopralluogo.checklist_id, { puntoVendita: labelPuntoVenditaTesto });
    await popolaSelectTecnico(inputTecnico);
    precompilaTecnico(inputTecnico, labelTecnicoAltro, inputTecnicoAltro, sopralluogo.tecnico);
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
      tecnico: leggiValoreTecnico(inputTecnico, inputTecnicoAltro),
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
    inputTecnico.addEventListener('change', () => aggiornaVisibilitaTecnicoAltro(inputTecnico, labelTecnicoAltro, inputTecnicoAltro));
    bottoneAnnulla.addEventListener('click', () => dialog.close());
  }

  return { init, apri };
})();

/**
 * Dialogo "Modifica dati sopralluogo": stessi campi anagrafici del form "Nuovo sopralluogo"
 * (nessuna Checklist: cambiarla a metà compilazione invaliderebbe le risposte già date), tutti
 * facoltativi, riusabile da Compilazione e da Riepilogo per un sopralluogo già iniziato o già
 * completato. Salva con lo stesso db.aggiornaSopralluogo già usato da "Altri aspetti" (bump di
 * aggiornato_il, propagato alla sincronizzazione) — non passa da checklistEngine, quindi non
 * rigenera né tocca in alcun modo risposte/PDF già generati: chi apre il dialogo riceve il
 * sopralluogo aggiornato in un callback opzionale, per reagire (es. il banner "rigenera il PDF"
 * di Riepilogo).
 */
const anagraficaDialog = (() => {
  const dialog = document.getElementById('dialog-anagrafica');
  const form = document.getElementById('form-anagrafica');
  const inputPuntoVendita = document.getElementById('anagrafica-punto-vendita');
  const inputIndirizzo = document.getElementById('anagrafica-indirizzo');
  const inputNumeroDipendenti = document.getElementById('anagrafica-numero-dipendenti');
  const inputTecnico = document.getElementById('anagrafica-tecnico');
  const labelTecnicoAltro = document.getElementById('label-anagrafica-tecnico-altro');
  const inputTecnicoAltro = document.getElementById('anagrafica-tecnico-altro');
  const inputData = document.getElementById('anagrafica-data');
  const inputResponsabile = document.getElementById('anagrafica-responsabile');
  const inputAreaManager = document.getElementById('anagrafica-area-manager');
  const selectPresenzaResponsabile = document.getElementById('anagrafica-presenza-responsabile');
  const selectPresenzaRls = document.getElementById('anagrafica-presenza-rls');
  const bottoneAnnulla = document.getElementById('btn-anagrafica-annulla');

  const labelPuntoVenditaTesto = document.getElementById('label-anagrafica-punto-vendita-testo');
  const labelResponsabileTesto = document.getElementById('label-anagrafica-responsabile-testo');
  const labelPresenzaResponsabileTesto = document.getElementById('label-anagrafica-presenza-responsabile-testo');

  const listaPuntiVendita = document.getElementById('anagrafica-lista-punti-vendita');
  const listaIndirizzi = document.getElementById('anagrafica-lista-indirizzi');
  const listaResponsabili = document.getElementById('anagrafica-lista-responsabili');
  const listaAreaManager = document.getElementById('anagrafica-lista-area-manager');

  let sopralluogoId = null;
  let alSalvataggio = null;

  /**
   * Apre il dialogo precompilato con i dati anagrafici correnti. `onSalvato(sopralluogoAggiornato)`
   * è opzionale. Riceve solo l'id e rilegge il sopralluogo fresco da IndexedDB (mai da
   * checklistEngine.sopralluogoCorrente(), che resta quella del momento di avvia() e non viene
   * aggiornata dai salvataggi diretti di questo stesso dialogo): un secondo giro di apertura
   * dopo una prima modifica altrimenti precompilerebbe con dati vecchi, e risalvare
   * sovrascriverebbe silenziosamente i campi nel frattempo cambiati con quei valori stantii.
   */
  async function apri(sopralluogoIdDaAprire, { onSalvato } = {}) {
    sopralluogoId = sopralluogoIdDaAprire;
    alSalvataggio = onSalvato || null;
    const sopralluogo = await db.leggiSopralluogo(sopralluogoId);

    inputPuntoVendita.value = sopralluogo.punto_vendita || '';
    inputIndirizzo.value = sopralluogo.indirizzo_punto_vendita || '';
    inputNumeroDipendenti.value = sopralluogo.numero_dipendenti || '';
    inputData.value = sopralluogo.data_sopralluogo || '';
    inputResponsabile.value = sopralluogo.responsabile_punto_vendita || '';
    inputAreaManager.value = sopralluogo.area_manager || '';
    selectPresenzaResponsabile.value = sopralluogo.presenza_responsabile || '';
    selectPresenzaRls.value = sopralluogo.presenza_rls || '';

    applicaEtichettePersonalizzate(sopralluogo.checklist_id, {
      puntoVendita: labelPuntoVenditaTesto,
      responsabile: labelResponsabileTesto,
      presenzaResponsabile: labelPresenzaResponsabileTesto
    });

    await popolaSelectTecnico(inputTecnico);
    precompilaTecnico(inputTecnico, labelTecnicoAltro, inputTecnicoAltro, sopralluogo.tecnico);

    popolaSuggerimentiAnagrafica({ listaPuntiVendita, listaIndirizzi, listaResponsabili, listaAreaManager });
    dialog.showModal();
  }

  async function onSubmit(event) {
    event.preventDefault();

    const aggiornato = await db.aggiornaSopralluogo(sopralluogoId, {
      punto_vendita: inputPuntoVendita.value.trim(),
      indirizzo_punto_vendita: inputIndirizzo.value.trim(),
      numero_dipendenti: inputNumeroDipendenti.value,
      tecnico: leggiValoreTecnico(inputTecnico, inputTecnicoAltro),
      data_sopralluogo: inputData.value,
      responsabile_punto_vendita: inputResponsabile.value.trim(),
      area_manager: inputAreaManager.value.trim() || null,
      presenza_responsabile: selectPresenzaResponsabile.value,
      presenza_rls: selectPresenzaRls.value
    });

    dialog.close();
    if (alSalvataggio) {
      alSalvataggio(aggiornato);
    }
  }

  function init() {
    form.addEventListener('submit', onSubmit);
    inputTecnico.addEventListener('change', () => aggiornaVisibilitaTecnicoAltro(inputTecnico, labelTecnicoAltro, inputTecnicoAltro));
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

document.addEventListener('DOMContentLoaded', async () => {
  router.init();
  connessioneIndicatore.init();
  nuovoSopralluogoScreen.init();
  compilazioneScreen.init();
  altriAspettiScreen.init();
  riepilogoScreen.init();
  storicoScreen.init();
  duplicaDialog.init();
  anagraficaDialog.init();
  cestinoScreen.init();
  impostazioniScreen.init();

  const sincronizzazioneIniziale = await sync.init();

  /**
   * Pulizia silenziosa del cestino (elimina definitivamente i sopralluoghi da più di 30 giorni):
   * SOLO dopo che la sincronizzazione iniziale è riuscita, mai in parallelo con essa. Prima
   * girava subito dopo sync.init() senza aspettarlo: db.pulisciCestino() legge lo stato locale
   * corrente, e se lo legge mentre il download dei dati remoti è ancora in corso rischia di
   * operare su un IndexedDB locale incompleto/non ancora aggiornato. Se offline o la
   * sincronizzazione fallisce, si salta semplicemente la pulizia in questo avvio: non è mai
   * urgente (i 30 giorni di margine assorbono un ciclo saltato) e riproverà al prossimo avvio.
   */
  if (sincronizzazioneIniziale) {
    db.pulisciCestino().catch((errore) => console.error('Pulizia automatica del cestino fallita:', errore));
  } else {
    console.warn('Pulizia automatica del cestino saltata: sincronizzazione iniziale non riuscita o offline.');
  }
});
