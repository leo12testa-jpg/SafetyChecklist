import { validateDuvriDraft, validateDuvriQa } from './duvri-agent.ts';
import type { TemplateRiskRow } from './docx-generator.ts';

// Pure validation tests: incomplete agent output must never become a DOCX silently.

const ROWS: TemplateRiskRow[] = [
  { tableIndex: 3, rowIndex: 1, factor: 'Rumore', continuationOf: '', description: '', measures: '', templateIndex: '' },
  { tableIndex: 3, rowIndex: 2, factor: '', continuationOf: 'Rumore', description: '', measures: '', templateIndex: '' }
];

function validDraft(): Record<string, any> {
  return {
    title: 'DUVRI - Bozza',
    documentDate: '2026-10-28',
    clientName: 'Committente Srl',
    siteDescription: '', siteCharacteristics: '', accessDescription: '', emergencyDescription: '',
    clientActivities: { summary: '', items: [] },
    contractorSummary: '',
    contractors: [{ legalName: 'Impresa Spa', role: 'Appaltatore', activityDescription: 'Manutenzione impianti', equipment: [], ppe: [] }],
    equipmentSummary: '', ppeItems: [], interferenceSummary: '', interferenceMeasures: '',
    riskRows: [
      { tableIndex: 3, rowIndex: 1, description: 'Rumore da lavorazioni', measures: 'Sfasamento orario', irIndex: 2, rationale: 'Fonte: verbale' },
      { tableIndex: 3, rowIndex: 2, description: '', measures: 'Continuazione misure', irIndex: null, rationale: '' }
    ],
    missingInformation: ['Orari di lavoro'], conflicts: [], normativeReferencesToCheck: [], humanReviewItems: ['Verificare IR']
  };
}
function expectError(fn: () => unknown, fragment: string) {
  try { fn(); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(fragment)) throw new Error('Messaggio inatteso: ' + message + ' (atteso: ' + fragment + ')');
    return;
  }
  throw new Error('Era atteso un errore contenente: ' + fragment);
}

Deno.test('bozza completa con campi descrittivi vuoti: accettata, lacune preservate', () => {
  const draft = validateDuvriDraft(validDraft(), ROWS);
  if (draft.riskRows.length !== 2 || draft.riskRows[1].irIndex !== null) throw new Error('Righe rischio non corrette.');
  if (draft.missingInformation[0] !== 'Orari di lavoro') throw new Error('Lacune non preservate.');
});

Deno.test('imprese mancanti o vuote: errore chiaro di integrazione dati', () => {
  for (const contractors of [undefined, []]) {
    expectError(() => validateDuvriDraft({ ...validDraft(), contractors }, ROWS), 'imprese non risultano sufficientemente identificate');
  }
});

Deno.test('campi obbligatori mancanti: errore che nomina il campo', () => {
  expectError(() => validateDuvriDraft({ ...validDraft(), clientName: '' }, ROWS), 'Campo obbligatorio mancante: clientName');
  expectError(() => validateDuvriDraft({ ...validDraft(), title: undefined }, ROWS), 'Campo testuale non valido: title');
  const draft = validDraft();
  draft.contractors[0].legalName = '  ';
  expectError(() => validateDuvriDraft(draft, ROWS), 'Campo obbligatorio mancante: contractors.legalName');
});

Deno.test('elenchi lacune/revisione assenti: la bozza è respinta, non completata in silenzio', () => {
  for (const key of ['missingInformation', 'humanReviewItems', 'conflicts', 'normativeReferencesToCheck', 'ppeItems']) {
    const draft = validDraft();
    delete draft[key];
    expectError(() => validateDuvriDraft(draft, ROWS), 'Elenco non valido: ' + key);
  }
  const draft = validDraft();
  delete draft.siteDescription;
  expectError(() => validateDuvriDraft(draft, ROWS), 'Campo testuale non valido: siteDescription');
});

Deno.test('matrice rischio incompleta o fuori scala: DOCX non generato', () => {
  expectError(() => validateDuvriDraft({ ...validDraft(), riskRows: [validDraft().riskRows[0]] }, ROWS), 'una riga per ciascuna riga rischio');
  const outOfScale = validDraft();
  outOfScale.riskRows[0].irIndex = 4;
  expectError(() => validateDuvriDraft(outOfScale, ROWS), 'scala approvata 1–3');
  const continuation = validDraft();
  continuation.riskRows[1].irIndex = 2;
  expectError(() => validateDuvriDraft(continuation, ROWS), 'continuazione');
  const noMeasures = validDraft();
  noMeasures.riskRows[0].measures = '';
  expectError(() => validateDuvriDraft(noMeasures, ROWS), 'riskRows.measures');
  const badDate = validDraft();
  badDate.documentDate = '28/10/2026';
  expectError(() => validateDuvriDraft(badDate, ROWS), 'data di redazione');
});

Deno.test('output non oggetto: errore chiaro', () => {
  expectError(() => validateDuvriDraft(null, ROWS), 'non ha restituito un oggetto DUVRI');
  expectError(() => validateDuvriDraft([], ROWS), 'non ha restituito un oggetto DUVRI');
  expectError(() => validateDuvriQa('ok'), 'report valido');
});

Deno.test('QA incompleto: respinto; QA valido richiede sempre revisione umana', () => {
  expectError(() => validateDuvriQa({ conflicts: [], missingInformation: [], mandatoryHumanChecks: [] }), 'qa.unsupportedClaims');
  const qa = validateDuvriQa({ unsupportedClaims: [], conflicts: [], missingInformation: [], mandatoryHumanChecks: [], contentReviewPassed: 'true' });
  if (qa.contentReviewPassed !== false) throw new Error('contentReviewPassed deve essere true solo se booleano.');
  if (qa.humanReviewRequired !== true) throw new Error('La revisione umana deve essere sempre richiesta.');
});
