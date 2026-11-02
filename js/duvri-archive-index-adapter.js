/*
 * COLLIGO DUVRI AI — local archive index normalization (isolated v1).
 * Input rows may contain confidential internal data: NEVER log, persist or
 * commit them. Pure local operation; column names require approved mapping.
 * Does not verify technical correctness, source dates or access privileges.
 */
const duvriArchiveIndexAdapter = (() => {
  'use strict';
  const history = typeof require === 'function'
    ? require('./duvri-historical-references.js')
    : (typeof duvriHistoricalReferences !== 'undefined' ? duvriHistoricalReferences : null);

  const FIELDS = Object.freeze([
    'archive_id', 'year', 'year_status', 'document_status',
    'activity_tags', 'interference_tags'
  ]);
  const VALID_YEAR = new Set(['confirmed','unverified']);
  const VALID_DOC = new Set(['finale','revisione','bozza','sconosciuto']);
  const hasOwn = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const isRecord = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  const opaque = x => typeof x === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(x);
  const safeColumn = x => typeof x === 'string' && x.length > 0 && x.length <= 100 &&
    !/[\r\n\x00-\x1f]/.test(x);

  function blocked(reason) {
    return {
      schema_version: 'colligo-duvri-archive-index/1.0',
      state: 'blocked', catalog: [], excluded_count: 0, included_count: 0,
      errors: [reason]
    };
  }
  function tags(value, allowed) {
    if (!Array.isArray(value) || value.length > 24 ||
        !value.every(x => typeof x === 'string' && allowed.has(x)) ||
        new Set(value).size !== value.length) return null;
    return [...value];
  }
  function normalizeCatalog({ rows, columns, approvedManifest, maxRows = 10000 } = {}) {
    if (!history || !Array.isArray(rows) || rows.length > maxRows ||
        !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000 ||
        !isRecord(columns) || Object.keys(columns).length !== FIELDS.length ||
        !FIELDS.every(f => hasOwn(columns,f) && safeColumn(columns[f])) ||
        new Set(FIELDS.map(f => columns[f])).size !== FIELDS.length ||
        !isRecord(approvedManifest) ||
        approvedManifest.approved !== true ||
        approvedManifest.archive_scope !== 'duvri_2026_local_only' ||
        !opaque(approvedManifest.revision_id) ||
        approvedManifest.records_reviewed !== rows.length) {
      return blocked('Mapping esplicito, manifest approvato e perimetro locale necessari');
    }
    const activities = new Set(history.ACTIVITY_TAGS);
    const interferences = new Set(history.INTERFERENCE_TAGS);
    const output = [];
    const seen = new Set();
    let excluded = 0;
    for (const row of rows) {
      if (!isRecord(row) || !FIELDS.every(f => hasOwn(row,columns[f]))) {
        return blocked('Riga senza campi mappati; impossibile classificare in sicurezza');
      }
      const id = row[columns.archive_id];
      const year = row[columns.year];
      const status = row[columns.year_status];
      const documentStatus = row[columns.document_status];
      const activityTags = tags(row[columns.activity_tags], activities);
      const interferenceTags = tags(row[columns.interference_tags], interferences);
      if (!opaque(id) || seen.has(id) ||
          !Number.isInteger(year) || !VALID_YEAR.has(status) ||
          !VALID_DOC.has(documentStatus) ||
          activityTags === null || interferenceTags === null) {
        return blocked('Metadati storici malformati, duplicati o non riconosciuti');
      }
      seen.add(id);
      if (year !== 2026 || status !== 'confirmed') {
        excluded++;
        continue;
      }
      output.push({
        archive_id: id,
        year: 2026,
        year_status: 'confirmed',
        document_status: documentStatus,
        activity_tags: activityTags,
        interference_tags: interferenceTags
      });
    }
    return {
      schema_version: 'colligo-duvri-archive-index/1.0',
      state: 'normalized_local_only',
      catalog: output,
      included_count: output.length,
      excluded_count: excluded,
      errors: []
    };
  }
  return Object.freeze({FIELDS,normalizeCatalog});
})();
if (typeof module !== 'undefined' && module.exports) module.exports=duvriArchiveIndexAdapter;
