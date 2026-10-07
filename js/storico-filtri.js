/**
 * Funzioni pure per il filtro Cliente dello Storico.
 * Il cliente si ricava dalla checklist usata dal sopralluogo, NON dal testo libero "Punto vendita":
 * una sede Interparking può chiamarsi "Rho" e una sede Carrefour può chiamarsi "Milano ...".
 */
const storicoFiltri = (() => {
  const VALORE_ALTRO = '__altro__';

  function normalizza(valore) {
    return String(valore || '').trim().toLocaleLowerCase('it-IT');
  }

  function idsCliente(cliente) {
    return Array.isArray(cliente?.checklist_ids) ? cliente.checklist_ids.map(String) : [];
  }

  function trovaClientePerChecklist(checklistId, clienti = []) {
    if (checklistId === null || checklistId === undefined || checklistId === '') return null;
    const id = String(checklistId);
    return clienti.find((cliente) => idsCliente(cliente).includes(id)) || null;
  }

  function trovaClientePerNome(nome, clienti = []) {
    const cercato = normalizza(nome);
    return clienti.find((cliente) => normalizza(cliente?.nome) === cercato) || null;
  }

  function corrispondeCliente(sopralluogo, filtro, clienti = []) {
    if (!filtro) return true;

    const checklistId = sopralluogo?.checklist_id;
    const clienteChecklist = trovaClientePerChecklist(checklistId, clienti);

    if (filtro === VALORE_ALTRO) {
      if (checklistId !== null && checklistId !== undefined && checklistId !== '') {
        return clienteChecklist === null;
      }
      // Fallback esclusivamente per record molto vecchi privi di checklist_id.
      const pv = normalizza(sopralluogo?.punto_vendita);
      return !clienti.some((cliente) => {
        const nome = normalizza(cliente?.nome);
        return nome && (pv === nome || pv.includes(nome));
      });
    }

    const clienteFiltro = trovaClientePerNome(filtro, clienti);
    if (!clienteFiltro) return false;

    // Percorso normale e autorevole.
    if (checklistId !== null && checklistId !== undefined && checklistId !== '') {
      return idsCliente(clienteFiltro).includes(String(checklistId));
    }

    // Compatibilità con eventuali record legacy senza checklist_id.
    const pv = normalizza(sopralluogo?.punto_vendita);
    const nome = normalizza(clienteFiltro.nome);
    return Boolean(nome && (pv === nome || pv.includes(nome)));
  }

  return {
    VALORE_ALTRO,
    corrispondeCliente,
    trovaClientePerChecklist
  };
})();
