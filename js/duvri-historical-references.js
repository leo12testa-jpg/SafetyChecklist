/*
 * COLLIGO DUVRI AI — metadata-only historical reference retrieval (isolated v1).
 * Input MUST be a normalized, approved local catalog: no file paths, client names,
 * excerpts, personal data, attachments or remote calls are accepted here.
 *
 * Matching selects EXAMPLES for review. It does NOT establish facts about the
 * current job, assess risks or authorize any measure. No risk score is computed.
 */
const duvriHistoricalReferences = (() => {
  'use strict';
  const ACTIVITY_TAGS = Object.freeze([
    'manutenzione_impianti', 'manutenzione_meccanica', 'manutenzione_frigoriferi',
    'manutenzione_elettrica', 'installazione_macchinari', 'lavori_in_quota',
    'cantieri_edili', 'attivita_esterne', 'pulizie', 'logistica_magazzino',
    'carico_scarico', 'lavori_a_caldo', 'ambienti_confinati', 'opere_edili',
    'sostanze_chimiche', 'impianti_antincendio', 'attivita_commerciali',
    'manutenzione_coperture', 'scavi', 'servizi_in_appalto'
  ]);
  const INTERFERENCE_TAGS = Object.freeze([
    'compresenza_imprese', 'caduta_materiali', 'caduta_dall_alto',
    'viabilita_condivisa', 'mezzi_pedoni', 'rischio_incendio', 'impianti_elettrici',
    'sostanze_chimiche', 'polveri', 'rumore', 'ostruzione_esodo',
    'atmosfere_pericolose', 'movimentazione_carichi', 'fermo_impianti',
    'calore', 'spazi_confinati', 'accessi_condivisi', 'lavori_a_caldo',
    'vibrazioni', 'interferenze_impiantistiche', 'scavi_sottoservizi'
  ]);
  const ACTIVITY = new Set(ACTIVITY_TAGS);
  const INTERFERENCE = new Set(INTERFERENCE_TAGS);
  const STATUSES = new Set(['finale', 'revisione', 'bozza', 'sconosciuto']);
  const STATUS_PRIORITY = { finale: 0, revisione: 1, sconosciuto: 2, bozza: 3 };
  const hasOwn = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
  const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const opaque = x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(x);
  const exactKeys = (obj, allowed) => Object.keys(obj).every(k => allowed.includes(k));

  function safeTags(value, allowed) {
    return Array.isArray(value) && value.length <= 24 &&
      value.every(v => typeof v === 'string' && allowed.has(v)) &&
      new Set(value).size === value.length;
  }

  function resultFail(reason) {
    return { ok: false, status: 'blocked', references: [], excluded_count: 0,
      message: reason };
  }

  /**
   * Retrieve metadata-only candidates from an approved normalized index.
   * Since source files stay local, only opaque archive IDs and controlled
   * taxonomy tags can appear in output. All relevance is to be reviewed.
   */
  function findHistoricalReferences(request, catalog) {
    if (!record(request) ||
        !exactKeys(request, ['job_id', 'activity_tags', 'interference_tags', 'limit']) ||
        !opaque(request.job_id) ||
        !safeTags(request.activity_tags, ACTIVITY) ||
        !safeTags(request.interference_tags, INTERFERENCE) ||
        (!request.activity_tags.length && !request.interference_tags.length) ||
        (hasOwn(request, 'limit') &&
          (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20))) {
      return resultFail('Ricerca non valida: job e categorie controllate obbligatori');
    }
    if (!Array.isArray(catalog) || catalog.length > 10000) {
      return resultFail('Catalogo locale non valido o troppo grande');
    }
    const seen = new Set();
    for (const item of catalog) {
      if (!record(item) ||
          !exactKeys(item, ['archive_id', 'year', 'year_status', 'document_status',
            'activity_tags', 'interference_tags']) ||
          !opaque(item.archive_id) || seen.has(item.archive_id) ||
          !Number.isInteger(item.year) ||
          !['confirmed', 'unverified'].includes(item.year_status) ||
          !STATUSES.has(item.document_status) ||
          !safeTags(item.activity_tags, ACTIVITY) ||
          !safeTags(item.interference_tags, INTERFERENCE)) {
        return resultFail('Catalogo non normalizzato: dati non verificati o metadati riservati');
      }
      seen.add(item.archive_id);
    }
    const wantedActivities = new Set(request.activity_tags);
    const wantedInterferences = new Set(request.interference_tags);
    const matches = [];
    let excludedCount = 0;
    for (const item of catalog) {
      // Confirmed *year*, not necessarily approved *content*.
      if (item.year !== 2026 || item.year_status !== 'confirmed') {
        excludedCount++;
        continue;
      }
      const activities = item.activity_tags.filter(x => wantedActivities.has(x));
      const interferences = item.interference_tags.filter(x => wantedInterferences.has(x));
      if (!interferences.length &&
          !(wantedInterferences.size === 0 && activities.length) &&
          activities.length < 2) {
        excludedCount++;
        continue;
      }
      matches.push({
        source_type: 'historical_2026_reference',
        archive_id: item.archive_id,
        verification_status: 'historical_example_only',
        document_status: item.document_status,
        activity_matches: activities,
        interference_matches: interferences,
        current_job_evidence: false,
        measures_automatically_applicable: false,
        requires_human_review: true
      });
    }
    matches.sort((a, b) =>
      b.interference_matches.length - a.interference_matches.length ||
      b.activity_matches.length - a.activity_matches.length ||
      STATUS_PRIORITY[a.document_status] - STATUS_PRIORITY[b.document_status] ||
      a.archive_id.localeCompare(b.archive_id, 'en')
    );
    return {
      ok: true, status: 'examples_for_review',
      job_id: request.job_id, references: matches.slice(0, request.limit || 8),
      excluded_count: excludedCount,
      message: 'Precedenti 2026 come esempi, non prove del nuovo intervento'
    };
  }
  return Object.freeze({ ACTIVITY_TAGS, INTERFERENCE_TAGS, findHistoricalReferences });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = duvriHistoricalReferences;
