/**
 * Motore di abbinamento per l'importazione da PDF (vedi js/pdf-import.js per l'estrazione del
 * testo dal file). Riceve righe GIA' estratte (posizione, testo, stato, nota così come letti dal
 * PDF, mai modificati qui) e le abbina alle domande della checklist target, in ordine di priorità:
 *
 * 1. id stabile letto dal PDF (solo formato "nostro": la colonna "n." è l'id vero della domanda).
 * 2. sezione + numero locale (solo formato "storico": l'unico dato posizionale disponibile è il
 *    numero "N)" che riparte da 1 a ogni macro-sezione) — SEMPRE confermato da una verifica di
 *    similarità testuale indipendente, mai accettato alla cieca.
 * 3. testo normalizzato: automatico solo sopra una soglia alta.
 * 4. fuzzy (stessa similarità testuale, soglia più bassa): non è mai un metodo automatico, la riga
 *    finisce SEMPRE "da verificare".
 *
 * Principio guida esplicito: meglio una domanda non riconosciuta che una risposta assegnata alla
 * domanda sbagliata. Nessuna riga viene mai assegnata "in silenzio": ogni abbinamento porta il
 * proprio metodo/confidenza, e due righe che convergono sulla stessa domanda diventano entrambe
 * un conflitto da rivedere, mai una scelta automatica fra le due.
 */
const importMatching = (() => {
  /** Similarità testuale (Dice su insiemi di token) sopra la quale un abbinamento per testo è automatico. */
  const SOGLIA_ALTA = 0.90;
  /** Sotto questa similarità una domanda è considerata non riconosciuta (nessun candidato). */
  const SOGLIA_MINIMA = 0.55;
  /**
   * Soglia di sanità minima per fidarsi anche solo parzialmente di un id o di una posizione
   * "sezione+numero": sotto questa soglia il testo è così diverso da quello atteso che l'id/la
   * posizione vengono ignorati del tutto (probabile domanda rimossa/sostituita), non solo
   * declassati a "da verificare".
   */
  const SOGLIA_SANITA = 0.30;
  /** Differenza minima fra il punteggio migliore e il secondo candidato per non considerarli "troppo simili fra loro" (ambigui). */
  const MARGINE_AMBIGUITA = 0.05;
  const CONFIDENZA_ID = 1;
  const CONFIDENZA_SEZIONE_NUMERO = 0.85;
  /** Soglie usate solo per il rilevamento di QUALE checklist il PDF appartenga (vedi rilevaChecklist): più permissive di quelle per-domanda, perché operano su una media aggregata di tante righe, non su un singolo confronto. */
  const SOGLIA_RILEVAMENTO_CHECKLIST_TESTO = 0.5;
  const SOGLIA_RILEVAMENTO_CHECKLIST_ID = 0.6;
  const MARGINE_AMBIGUITA_CHECKLIST = 0.1;

  function appiattisciDomande(checklist) {
    const risultato = [];
    (checklist.sezioni || []).forEach((sezione) => {
      (sezione.domande || []).forEach((domanda) => {
        risultato.push({ sezione: sezione.titolo, domanda });
      });
    });
    return risultato;
  }

  /** Normalizza per il confronto: minuscolo, accenti ridotti alla forma base, solo lettere/numeri/spazi. */
  function normalizzaTesto(testo) {
    return String(testo || '')
      .toLowerCase()
      .replace(/[àáâä]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenizza(testo) {
    const normalizzato = normalizzaTesto(testo);
    return normalizzato ? normalizzato.split(' ') : [];
  }

  /**
   * Similarità fra due testi come coefficiente di Dice sugli insiemi di token (parole) normalizzati:
   * 2×|intersezione| / (|A|+|B|). Robusta a riordino delle parole e piccole differenze di formulazione,
   * sensibile a domande davvero diverse (poco vocabolario in comune). Deliberatamente semplice: nessuna
   * libreria esterna (coerente con l'app "vanilla", nessuna dipendenza aggiunta), nessun tentativo di
   * essere "intelligente" oltre il necessario — la conservatività viene dalle soglie, non dall'algoritmo.
   */
  function similarita(testoA, testoB) {
    const setA = new Set(tokenizza(testoA));
    const setB = new Set(tokenizza(testoB));
    if (!setA.size && !setB.size) {
      return 1;
    }
    if (!setA.size || !setB.size) {
      return 0;
    }
    let intersezione = 0;
    setA.forEach((token) => { if (setB.has(token)) intersezione += 1; });
    return (2 * intersezione) / (setA.size + setB.size);
  }

  /** Candidati ordinati per similarità testuale decrescente, uno per ciascuna domanda della checklist. */
  function candidatiTesto(testo, domande) {
    return domande
      .map((voce) => ({ voce, punteggio: similarita(testo, voce.domanda.testo) }))
      .sort((a, b) => b.punteggio - a.punteggio);
  }

  /** Abbinamento per solo testo (metodi 3 e 4): automatico sopra SOGLIA_ALTA e non ambiguo, "fuzzy" (mai automatico) sopra SOGLIA_MINIMA, altrimenti nessun candidato. */
  function abbinaPerTesto(testoOriginale, domande) {
    const candidati = candidatiTesto(testoOriginale, domande);
    const migliore = candidati[0];
    if (!migliore || migliore.punteggio < SOGLIA_MINIMA) {
      return null;
    }
    const secondo = candidati[1];
    const ambiguo = Boolean(secondo) && (migliore.punteggio - secondo.punteggio) < MARGINE_AMBIGUITA && secondo.punteggio >= SOGLIA_MINIMA;
    const automatico = migliore.punteggio >= SOGLIA_ALTA && !ambiguo;
    return {
      domandaId: migliore.voce.domanda.id,
      metodo: automatico ? 'testo' : 'fuzzy',
      confidenza: migliore.punteggio,
      automatico,
      avviso: ambiguo
        ? `due domande hanno un punteggio di somiglianza molto vicino (differenza < ${Math.round(MARGINE_AMBIGUITA * 100)}%): verificare quale sia quella giusta`
        : null
    };
  }

  /**
   * Costruisce il risolutore "sezione + numero locale" per il formato storico: la checklist target
   * viene divisa negli stessi due macro-gruppi usati in generazione (stesso punto di divisione di
   * js/pdf.js#calcolaPuntoDivisioneGruppi, passato dal chiamante per non introdurre qui una
   * dipendenza diretta da js/pdf.js), e il numero locale letto dal PDF viene interpretato come
   * indice 1-based nel gruppo corrispondente al banner di macro-sezione letto dal PDF.
   */
  function creaRisolutoreGruppoStorico(domande, puntoDivisioneGruppi) {
    const gruppo1 = domande.slice(0, puntoDivisioneGruppi);
    const gruppo2 = domande.slice(puntoDivisioneGruppi);
    const ETICHETTE_GRUPPO_1 = ['AUDIT DOCUMENTALE', 'ANALISI DOCUMENTALE'];
    const ETICHETTE_GRUPPO_2 = ['SOPRALLUOGO AMBIENTI DI LAVORO'];
    return function risolvi(sezioneOriginale, numeroLocale) {
      if (!Number.isInteger(numeroLocale) || numeroLocale < 1) {
        return null;
      }
      const testo = String(sezioneOriginale || '').toUpperCase();
      let elenco = null;
      if (ETICHETTE_GRUPPO_1.some((etichetta) => testo.includes(etichetta))) {
        elenco = gruppo1;
      } else if (ETICHETTE_GRUPPO_2.some((etichetta) => testo.includes(etichetta))) {
        elenco = gruppo2;
      }
      if (!elenco) {
        return null;
      }
      const voce = elenco[numeroLocale - 1];
      return voce ? { domandaId: voce.domanda.id } : null;
    };
  }

  /**
   * Abbina UNA riga grezza a una domanda della checklist target, provando i metodi in ordine di
   * priorità. Non applica MAI il vincolo uno-a-uno (quello è responsabilità di abbinaRighe, che
   * vede tutte le righe insieme): questa funzione ragiona su una riga alla volta.
   */
  function abbinaRiga(riga, domande, idValidi, risolutoreStorico) {
    // 1. id stabile (solo formato "nostro")
    if (riga.id_originale != null && idValidi.has(riga.id_originale)) {
      const domandaTarget = domande.find((voce) => voce.domanda.id === riga.id_originale);
      const sim = similarita(riga.testo_originale, domandaTarget.domanda.testo);
      if (sim < SOGLIA_SANITA) {
        return {
          domandaId: riga.id_originale,
          metodo: 'id',
          confidenza: sim,
          automatico: false,
          avviso: `id ${riga.id_originale} trovato nel PDF, ma il testo della domanda corrispondente in questa checklist è molto diverso da quello letto (somiglianza ${Math.round(sim * 100)}%): probabile domanda cambiata, verificare.`
        };
      }
      return { domandaId: riga.id_originale, metodo: 'id', confidenza: CONFIDENZA_ID, automatico: true, avviso: null };
    }

    // 2. sezione + numero locale (solo formato storico), sempre confermato dal testo
    if (riga.formato === 'storico' && risolutoreStorico) {
      const perPosizione = risolutoreStorico(riga.sezione_originale, riga.numero_originale);
      if (perPosizione) {
        const domandaTarget = domande.find((voce) => voce.domanda.id === perPosizione.domandaId);
        const sim = similarita(riga.testo_originale, domandaTarget.domanda.testo);
        const candidatiGlobali = candidatiTesto(riga.testo_originale, domande);
        const miglioreGlobale = candidatiGlobali[0];
        const confermataDalTesto = Boolean(miglioreGlobale) && miglioreGlobale.voce.domanda.id === perPosizione.domandaId;
        if (sim >= SOGLIA_ALTA && confermataDalTesto && abbinaPerTesto(riga.testo_originale, domande).automatico) {
          return { domandaId: perPosizione.domandaId, metodo: 'sezione_numero', confidenza: CONFIDENZA_SEZIONE_NUMERO, automatico: true, avviso: null };
        }
        // La posizione non è confermata dal testo della domanda che indica: se esiste altrove un
        // candidato testuale nettamente migliore (probabile domanda spostata), ci si fida di
        // quello — mai far vincere una posizione debole su un'evidenza testuale forte ma
        // discordante, altrimenti si rischia di segnalare "da verificare" la domanda SBAGLIATA
        // mentre quella giusta, individuabile dal testo, resta ignorata.
        if (miglioreGlobale && miglioreGlobale.punteggio >= SOGLIA_ALTA && miglioreGlobale.voce.domanda.id !== perPosizione.domandaId) {
          return abbinaPerTesto(riga.testo_originale, domande);
        }
        if (sim >= SOGLIA_SANITA) {
          return {
            domandaId: perPosizione.domandaId,
            metodo: 'sezione_numero',
            confidenza: sim,
            automatico: false,
            avviso: 'posizione (sezione + numero) coerente, ma il testo non la conferma in modo univoco: verificare.'
          };
        }
        // Sanità fallita del tutto: la posizione viene ignorata, si prova solo il testo qui sotto.
      }
    }

    // 3/4. testo normalizzato / fuzzy
    return abbinaPerTesto(riga.testo_originale, domande);
  }

  /**
   * Abbina l'intero elenco di righe grezze estratte da un PDF alla checklist target. Ogni riga
   * mantiene intatti i propri dati originali (vedi `originale`): il matching AGGIUNGE un
   * collegamento proposto, non sostituisce mai quanto letto dal PDF.
   *
   * `opzioni.puntoDivisioneGruppi`, se fornito, abilita il metodo 2 per le righe in formato
   * "storico" (vedi creaRisolutoreGruppoStorico); tipicamente calcolato dal chiamante con
   * pdf.calcolaPuntoDivisioneGruppi(checklist) — questo modulo non dipende da js/pdf.js.
   *
   * Vincolo uno-a-uno: se più righe propongono la stessa domanda_id, NESSUNA delle due viene
   * assegnata automaticamente — diventano tutte "conflitto", da risolvere manualmente in anteprima.
   */
  function abbinaRighe(righeGrezze, checklist, opzioni = {}) {
    const domande = appiattisciDomande(checklist);
    const idValidi = new Set(domande.map((voce) => voce.domanda.id));
    const risolutoreStorico = Number.isInteger(opzioni.puntoDivisioneGruppi)
      ? creaRisolutoreGruppoStorico(domande, opzioni.puntoDivisioneGruppi)
      : null;

    const righe = righeGrezze.map((rigaGrezza, indice) => {
      const esito = abbinaRiga(rigaGrezza, domande, idValidi, risolutoreStorico);
      return {
        indice,
        originale: {
          numero_originale: rigaGrezza.numero_originale ?? null,
          sezione_originale: rigaGrezza.sezione_originale ?? null,
          testo_originale: rigaGrezza.testo_originale ?? null,
          stato_originale: rigaGrezza.stato_originale ?? null,
          nota_originale: rigaGrezza.nota_originale ?? null,
          id_originale: rigaGrezza.id_originale ?? null
        },
        domanda_id: esito ? esito.domandaId : null,
        metodo: esito ? esito.metodo : null,
        confidenza: esito ? esito.confidenza : null,
        automatico: esito ? Boolean(esito.automatico) && !rigaGrezza.da_verificare : false,
        avviso: rigaGrezza.avviso || (esito && esito.avviso ? esito.avviso : null),
        // Valori proposti per il sopralluogo, modificabili liberamente in anteprima: partono
        // sempre dal dato originale così com'è, mai alterati dal matching.
        risposta: rigaGrezza.stato_originale ?? null,
        note: rigaGrezza.nota_originale ?? null,
        stato_riga: null // impostato sotto, dopo il controllo uno-a-uno
      };
    });

    applicaVincoloUnoAUno(righe);

    return { righe, riepilogo: calcolaRiepilogo(righe), totaleDomandeChecklist: domande.length };
  }

  /**
   * Applica il vincolo uno-a-uno e ricalcola `stato_riga` per l'intero elenco (in place, muta e
   * ritorna lo stesso array): se più righe puntano alla stessa domanda_id, TUTTE diventano
   * "conflitto", indipendentemente dal metodo/confidenza con cui ciascuna era stata proposta —
   * mai una scelta automatica fra le due. Esposta pubblicamente (non solo usata internamente da
   * abbinaRighe) perché la UI di anteprima deve poterla richiamare dopo ogni correzione manuale
   * dell'utente (cambio di domanda associata a una riga): un'assegnazione manuale può creare o
   * risolvere un conflitto con un'altra riga già presente, e va sempre ricontrollato, mai lasciato
   * "come risultava al primo giro".
   */
  function applicaVincoloUnoAUno(righe) {
    const perDomanda = new Map();
    righe.forEach((riga) => {
      if (riga.domanda_id == null) {
        return;
      }
      if (!perDomanda.has(riga.domanda_id)) {
        perDomanda.set(riga.domanda_id, []);
      }
      perDomanda.get(riga.domanda_id).push(riga);
    });

    righe.forEach((riga) => {
      if (riga.domanda_id == null) {
        riga.stato_riga = 'non_riconosciuta';
        return;
      }
      const concorrenti = perDomanda.get(riga.domanda_id);
      if (concorrenti.length > 1) {
        riga.stato_riga = 'conflitto';
        const numeri = concorrenti.map((c) => c.originale.numero_originale ?? c.originale.id_originale ?? '?').join(', ');
        riga.avviso = `${concorrenti.length} righe del PDF (n. ${numeri}) si associano alla stessa domanda: nessuna viene assegnata automaticamente.`;
        return;
      }
      riga.stato_riga = riga.automatico ? 'sicuro' : 'da_verificare';
    });

    return righe;
  }

  function calcolaRiepilogo(righe) {
    return {
      totaleRighe: righe.length,
      sicure: righe.filter((r) => r.stato_riga === 'sicuro').length,
      daVerificare: righe.filter((r) => r.stato_riga === 'da_verificare').length,
      nonRiconosciute: righe.filter((r) => r.stato_riga === 'non_riconosciuta').length,
      conflitti: righe.filter((r) => r.stato_riga === 'conflitto').length,
      confidenzaComplessiva: righe.length
        ? righe.reduce((somma, r) => somma + (r.confidenza || 0), 0) / righe.length
        : 0
    };
  }

  /**
   * Rileva a quale checklist (fra quelle disponibili) il PDF appartiene più probabilmente, PRIMA
   * di fare qualunque matching domanda-per-domanda: se la maggior parte delle righe porta un id
   * leggibile (formato "nostro"), usa la similarità testuale MEDIA fra il testo di ogni riga e la
   * domanda che porta lo stesso id in ciascuna checklist candidata (segnale forte, ma MAI la sola
   * percentuale di id "validi": più checklist tendono a numerare le proprie domande 1..N in modo
   * indipendente, quindi quasi ogni id letto risulterebbe "valido" per QUALUNQUE checklist anche
   * quando è quella sbagliata — l'id da solo non basta a discriminare, va sempre confermato dal
   * testo della domanda a cui quell'id corrisponde IN QUELLA checklist); altrimenti (formato
   * "storico", nessun id) usa la stessa similarità testuale ma cercando il candidato migliore in
   * tutta la checklist, non a un id fisso. Ritorna sempre una classifica completa, mai solo il
   * vincitore: il chiamante decide se la confidenza/il margine sul secondo classificato sono
   * sufficienti per procedere senza chiedere conferma.
   */
  function rilevaChecklist(righeGrezze, elencoChecklist) {
    const righeConId = righeGrezze.filter((r) => r.id_originale != null);
    const usaId = righeConId.length >= Math.max(3, righeGrezze.length * 0.3);
    const campioneTesto = righeGrezze.filter((r) => r.testo_originale).slice(0, 40);

    const classifica = elencoChecklist.map(({ id, titolo, checklist }) => {
      const domande = appiattisciDomande(checklist);
      let confidenza;
      let metodo;
      if (usaId) {
        const domandaPerId = new Map(domande.map((voce) => [voce.domanda.id, voce.domanda]));
        const punteggi = righeConId.map((r) => {
          const domandaTarget = domandaPerId.get(r.id_originale);
          return domandaTarget ? similarita(r.testo_originale, domandaTarget.testo) : 0;
        });
        confidenza = punteggi.length ? punteggi.reduce((somma, p) => somma + p, 0) / punteggi.length : 0;
        metodo = 'id';
      } else {
        const punteggi = campioneTesto.map((r) => candidatiTesto(r.testo_originale, domande)[0]?.punteggio || 0);
        confidenza = punteggi.length ? punteggi.reduce((somma, p) => somma + p, 0) / punteggi.length : 0;
        metodo = 'testo';
      }
      return { checklistId: id, titolo, confidenza, metodo };
    }).sort((a, b) => b.confidenza - a.confidenza);

    const migliore = classifica[0] || null;
    const secondo = classifica[1] || null;
    const sogliaAutomatico = migliore && migliore.metodo === 'id' ? SOGLIA_RILEVAMENTO_CHECKLIST_ID : SOGLIA_RILEVAMENTO_CHECKLIST_TESTO;
    const ambiguo = Boolean(migliore) && Boolean(secondo) && (migliore.confidenza - secondo.confidenza) < MARGINE_AMBIGUITA_CHECKLIST;
    const automatico = Boolean(migliore) && migliore.confidenza >= sogliaAutomatico && !ambiguo;

    return {
      checklistId: migliore ? migliore.checklistId : null,
      titolo: migliore ? migliore.titolo : null,
      confidenza: migliore ? migliore.confidenza : 0,
      metodo: migliore ? migliore.metodo : null,
      automatico,
      ambiguo,
      classifica
    };
  }


  /**
   * Collega in modo conservativo le immagini estratte dal PDF alle domande della checklist.
   * I PDF generati dall'app usano didascalie del tipo "Foto 2 — Domanda 17: testo...": in quel
   * caso l'id letto dalla didascalia viene prima ricondotto alla riga PDF già abbinata e solo in
   * seconda battuta all'id corrente della checklist. Nei PDF storici il numero può ripartire da
   * 1 in più macro-sezioni: se lo stesso numero compare su più righe NON viene indovinato nulla.
   * Come fallback usa il testo della domanda presente dopo i due punti, ma solo con similarità alta
   * e senza ambiguità. Il risultato resta modificabile dall'utente nell'anteprima immagini.
   */
  function collegaImmaginiAlleDomande(immagini, righeAbbinate, checklist) {
    const domande = appiattisciDomande(checklist);
    const domandaPerId = new Map(domande.map((voce) => [Number(voce.domanda.id), voce]));
    const righeValide = (righeAbbinate || []).filter((riga) => riga.domanda_id != null && riga.stato_riga !== 'conflitto');

    // Nei PDF generati dall'app ogni domanda con foto riporta in tabella "Vedi Foto N". È il
    // collegamento più affidabile possibile: permette di ricostruire la relazione foto -> domanda
    // anche quando il testo della didascalia sotto l'immagine viene estratto male o su più righe.
    const riferimentiFoto = new Map();
    const sorgentiFoto = new Map();
    (righeAbbinate || []).forEach(riga => {
      const nota = String(riga.originale && riga.originale.nota_originale || '');
      for (const match of nota.matchAll(/\bFoto\s+(\d+)/gi)) {
        const numero = Number(match[1]);
        if (!sorgentiFoto.has(numero)) sorgentiFoto.set(numero, new Set());
        sorgentiFoto.get(numero).add(riga);
      }
    });
    righeValide.forEach((riga) => {
      const nota = String((riga.originale && riga.originale.nota_originale) || '');
      const gruppo = nota.match(/\bVedi\s+((?:Foto\s+\d+\s*(?:,\s*)?)+)/i);
      if (!gruppo) return;
      const regexFoto = /Foto\s+(\d+)/gi;
      let match;
      while ((match = regexFoto.exec(gruppo[1])) !== null) {
        const numeroFoto = Number(match[1]);
        if (!riferimentiFoto.has(numeroFoto)) riferimentiFoto.set(numeroFoto, []);
        riferimentiFoto.get(numeroFoto).push(Number(riga.domanda_id));
      }
    });

    function domandaDaRiferimentoFoto(numeroFoto) {
      const candidati = riferimentiFoto.get(Number(numeroFoto)) || [];
      const unici = Array.from(new Set(candidati));
      return unici.length === 1 ? unici[0] : null;
    }

    const numerazioneCompleta = (immagini || []).length > 0 &&
      Array.from({ length: (immagini || []).length }, (_, indice) => indice + 1).every((numero) => domandaDaRiferimentoFoto(numero) != null);

    function numeroFotoDaDidascalia(didascalia) {
      const match = String(didascalia || '').match(/\bFoto\s+(\d+)\b/i);
      return match ? Number(match[1]) : null;
    }

    function numeroDaDidascalia(didascalia) {
      const match = String(didascalia || '').match(/\bDomanda\s+(?:n[.°]?\s*)?(\d+)\b/i);
      return match ? Number(match[1]) : null;
    }

    function testoDaDidascalia(didascalia) {
      const testo = String(didascalia || '');
      const match = testo.match(/\bDomanda\s+(?:n[.°]?\s*)?\d+\s*[:\-–—]\s*(.+)$/i);
      return match ? match[1].trim() : '';
    }

    function voceDaDomandaId(domandaId) {
      return domandaPerId.get(Number(domandaId)) || null;
    }

    return (immagini || []).map((foto, indiceFoto) => {
      let domandaId = foto.domanda_id_collegata != null ? Number(foto.domanda_id_collegata) : null;
      let metodo = foto.associazione_domanda_metodo || null;
      const numeroFotoLetto = numeroFotoDaDidascalia(foto.didascalia);
      const numeroFoto = numeroFotoLetto != null ? numeroFotoLetto : (numerazioneCompleta ? indiceFoto + 1 : null);
      const numero = numeroDaDidascalia(foto.didascalia);

      // Preserve source ownership even when no destination can yet be trusted.
      const proprietarie = sorgentiFoto.get(numeroFoto);
      if (metodo !== 'manuale' && proprietarie && proprietarie.size === 1) {
        const sorgente = Array.from(proprietarie)[0];
        const destinazione = rigaImportabile(sorgente) ? sorgente.domanda_id : null;
        const voce = voceDaDomandaId(destinazione);
        return { ...foto, riga_sorgente_indice: sorgente.indice,
          domanda_id_collegata: destinazione,
          domanda_testo_collegata: voce ? voce.domanda.testo : null,
          associazione_domanda_metodo: destinazione != null ? (numeroFotoLetto != null ? 'riferimento_tabella' : 'riferimento_tabella_ordine') : null };
      }
      if (metodo !== 'manuale' && proprietarie && proprietarie.size > 1) {
        return { ...foto, riga_sorgente_indice: null, domanda_id_collegata: null,
          domanda_testo_collegata: null, associazione_domanda_metodo: null };
      }

      if (domandaId == null && numeroFoto != null) {
        const daTabella = domandaDaRiferimentoFoto(numeroFoto);
        if (daTabella != null && voceDaDomandaId(daTabella)) {
          domandaId = daTabella;
          metodo = numeroFotoLetto != null ? 'riferimento_tabella' : 'riferimento_tabella_ordine';
        }
      }

      if (domandaId == null && numero != null) {
        const perIdOriginale = righeValide.filter((riga) => Number(riga.originale && riga.originale.id_originale) === numero);
        if (perIdOriginale.length === 1) {
          domandaId = Number(perIdOriginale[0].domanda_id);
          metodo = 'didascalia_id';
        } else {
          const perNumeroLocale = righeValide.filter((riga) => Number(riga.originale && riga.originale.numero_originale) === numero);
          if (perNumeroLocale.length === 1) {
            domandaId = Number(perNumeroLocale[0].domanda_id);
            metodo = 'didascalia_numero';
          } else if (perNumeroLocale.length === 0 && voceDaDomandaId(numero)) {
            // PDF dell'app con id stabile ma riga non estratta (caso raro): l'id della didascalia
            // resta comunque un segnale esplicito e verificabile nell'anteprima.
            domandaId = numero;
            metodo = 'didascalia_id';
          }
        }
      }

      if (domandaId == null) {
        const testoDomanda = testoDaDidascalia(foto.didascalia);
        if (testoDomanda) {
          const candidati = domande
            .map((voce) => ({ voce, punteggio: similarita(testoDomanda, voce.domanda.testo) }))
            .sort((a, b) => b.punteggio - a.punteggio);
          const migliore = candidati[0];
          const secondo = candidati[1];
          const nonAmbiguo = !secondo || (migliore.punteggio - secondo.punteggio) >= MARGINE_AMBIGUITA;
          if (migliore && migliore.punteggio >= SOGLIA_ALTA && nonAmbiguo) {
            domandaId = Number(migliore.voce.domanda.id);
            metodo = 'didascalia_testo';
          }
        }
      }

      const voce = domandaId != null ? voceDaDomandaId(domandaId) : null;
      if (!voce) {
        domandaId = null;
        metodo = null;
      }
      const sorgenti = righeValide.filter(r => Number(r.domanda_id) === domandaId);
      const sorgente = sorgenti.length === 1 ? sorgenti[0] : null;
      return {
        ...foto,
        riga_sorgente_indice: sorgente ? sorgente.indice : null,
        domanda_id_collegata: domandaId,
        domanda_testo_collegata: voce ? voce.domanda.testo : null,
        associazione_domanda_metodo: metodo
      };
    });
  }

  function rigaImportabile(riga) {
    return riga.domanda_id != null && riga.stato_riga !== 'conflitto' &&
      (riga.automatico || riga.metodo === 'manuale');
  }

  /** Cambia soltanto la destinazione del pacchetto sorgente; stato e nota non si rimatchano. */
  function cambiaDomandaRiga(riga, domandaId, immagini = []) {
    riga.domanda_id = domandaId;
    riga.metodo = domandaId != null ? 'manuale' : null;
    riga.automatico = false;
    immagini.forEach(foto => {
      if (foto.riga_sorgente_indice != null && foto.riga_sorgente_indice === riga.indice) {
        foto.domanda_id_collegata = domandaId;
        foto.domanda_testo_collegata = null;
      }
    });
    return riga;
  }

  return {
    rigaImportabile,
    cambiaDomandaRiga,
    normalizzaTesto,
    similarita,
    appiattisciDomande,
    abbinaRighe,
    rilevaChecklist,
    creaRisolutoreGruppoStorico,
    applicaVincoloUnoAUno,
    calcolaRiepilogo,
    collegaImmaginiAlleDomande,
    SOGLIE: { ALTA: SOGLIA_ALTA, MINIMA: SOGLIA_MINIMA, SANITA: SOGLIA_SANITA, AMBIGUITA: MARGINE_AMBIGUITA }
  };
})();
