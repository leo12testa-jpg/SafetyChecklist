// Contratto residuo sul backend documentale.
//
// Il comportamento è coperto dai test Deno eseguiti nel workflow "Storage and Deno security":
// - supabase/functions/document-worker/anthropic-client.test.ts: corpo richiesta per agente,
//   modelli/effort/thinking, stop_reason, classificazione HTTP, header beta Files API,
//   upload e cancellazione dei file sul provider;
// - supabase/functions/document-worker/cost-meter.test.ts: costo token e durata del credito;
// - supabase/functions/document-worker/duvri-agent.test.ts: validazione bozza/QA e revisione umana;
// - supabase/functions/document-jobs/index.test.ts e validation.test.ts: autenticazione,
//   chiave Firebase fail-closed, consenso, proprietà del job, transizioni, upload.
//
// Qui restano solo le verifiche senza equivalente comportamentale:
// - schema.draft.sql (RLS, bucket privato, claim atomico) non viene applicato in CI;
// - document-worker/index.ts chiama Deno.serve all'import e non esporta le fasi, quindi il
//   collegamento tra fasi, gate e client Claude è verificabile solo sul sorgente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const gateway = read('supabase/functions/document-jobs/index.ts');
const worker = read('supabase/functions/document-worker/index.ts');
const anthropicClient = read('supabase/functions/document-worker/anthropic-client.ts');
const schema = read('supabase/document-generation/schema.draft.sql');

// Estrae il corpo di una funzione top-level dal sorgente (fino alla prossima dichiarazione).
function functionBody(source, name) {
  const start = source.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  assert.ok(start >= 0, 'funzione ' + name + ' assente');
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:async\s+)?function\s+\w+\s*\(|\nDeno\.serve\(/);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('i Deno test comportamentali referenziati esistono e coprono i contratti rimossi da qui', () => {
  const required = {
    'supabase/functions/document-worker/anthropic-client.test.ts': [/Files API: upload restituisce id, delete best effort/, /header beta Files API solo quando ci sono blocchi file/, /document-reader: Haiku 5\.5, effort low, thinking disabled/],
    'supabase/functions/document-worker/cost-meter.test.ts': [/stima quanti documenti rimangono/],
    'supabase/functions/document-worker/duvri-agent.test.ts': [/revisione umana/],
    'supabase/functions/document-jobs/index.test.ts': [/missing SAFETYCHECKLIST_FIREBASE_API_KEY fails closed/, /consent required/],
    'supabase/functions/document-jobs/validation.test.ts': [/extension allow-list/]
  };
  for (const [file, patterns] of Object.entries(required)) {
    const source = read(file);
    for (const pattern of patterns) assert.match(source, pattern, file);
  }
  const workflow = read('.github/workflows/safetychecklist-storage-security.yml');
  assert.match(workflow, /deno test[^\n]*supabase\/functions\/document-worker\//);
  assert.match(workflow, /deno test[^\n]*supabase\/functions\/document-jobs\//);
});

test('il gateway accetta solo profili Firebase attivi con ruolo aziendale e conserva i file nel bucket privato', () => {
  // Il caso profilo inattivo / ruolo sconosciuto non ha ancora un Deno test dedicato.
  assert.match(gateway, /profile\.attivo !== true/);
  assert.match(gateway, /\['admin','tecnico'\]\.includes\(profile\.ruolo\)/);
  assert.match(gateway, /const BUCKET = 'documenti-generati'/);
});

test('schema: tabelle backend-only con RLS, bucket privato e claim atomico con lease', () => {
  // schema.draft.sql non viene applicato in CI: verificabile solo come testo finché non sarà
  // caricato nel Supabase locale del workflow Storage/Deno.
  assert.match(schema, /public = false/);
  assert.match(schema, /document_generation_backend_only/);
  assert.match(schema, /revoke all on public\.document_jobs from anon, authenticated/i);
  assert.match(schema, /alter table public\.document_jobs enable row level security/i);
  assert.match(schema, /claim_document_job\(\)/);
  assert.match(schema, /for update skip locked/i);
  assert.match(schema, /lease_until/);
  assert.match(schema, /worker_token|claim_token/);
});

test('il motore usa solo Claude API: nessun riferimento a OpenAI, provider diverso bloccato', () => {
  for (const [name, source] of [['worker', worker], ['anthropic-client', anthropicClient], ['gateway', gateway]]) {
    assert.doesNotMatch(source, /openai/i, name + ' non deve riferirsi a OpenAI');
  }
  // DOCUMENT_AI_PROVIDER sopravvive solo come guardia: qualunque valore diverso da anthropic
  // rende il provider non configurato.
  assert.match(worker, /return AI_PROVIDER === 'anthropic' && !!ANTHROPIC_API_KEY/);
  assert.match(functionBody(worker, 'configurationMessage'), /AI_PROVIDER !== 'anthropic'/);
  // Le chiamate al provider passano tutte dal client testato.
  assert.doesNotMatch(worker, /api\.anthropic\.com/, 'URL del provider solo in anthropic-client.ts');
  assert.match(worker, /from '\.\/anthropic-client\.ts'/);
});

test('il worker resta fermo senza attivazione, configurazione e consenso esplicito', () => {
  assert.match(worker, /const PIPELINE_ENABLED = Deno\.env\.get\('DOCUMENT_PIPELINE_ENABLED'\) === 'true'/);
  const processOne = functionBody(worker, 'processOne');
  const gate = processOne.indexOf('if (!PIPELINE_ENABLED || !providerConfigured())');
  const consent = processOne.indexOf('fields.aiDataProcessingConsent !== true');
  const firstPhase = processOne.indexOf("job.phase === 'extract'");
  assert.ok(gate >= 0 && consent > gate && firstPhase > consent, 'attivazione e consenso vanno verificati prima di qualunque fase');
  assert.match(worker, /x-document-worker-secret/);
  assert.match(worker, /rpc\/claim_document_job/);
});

test('i file caricati sul provider vengono cancellati anche se l\'estrazione fallisce', () => {
  // deleteClaudeFile/uploadClaudeFile sono testati in anthropic-client.test.ts; qui si verifica
  // il collegamento nel worker (extractDocuments non è esportata).
  const extract = functionBody(worker, 'extractDocuments');
  assert.match(extract, /remoteFiles\.push\(fileId\)/);
  assert.match(extract, /\}\s*finally\s*\{[\s\S]*remoteFiles\.map\(deleteAIFile\)/);
  assert.match(functionBody(worker, 'deleteAIFile'), /deleteClaudeFile\(/);
  assert.match(functionBody(worker, 'uploadAIFile'), /uploadClaudeFile\(/);
});

test('fasi persistenti, gate DOCX/regola di rischio e revisione umana obbligatoria', () => {
  for (const phase of ['extract', 'analyze', 'draft', 'validate']) assert.match(worker, new RegExp("job\\.phase === '" + phase + "'"));
  assert.match(worker, /DUVRI_DOCX_ENGINE_ENABLED/);
  assert.match(worker, /DUVRI_RISK_RULE_APPROVED/);
  assert.match(worker, /DUVRI_RISK_RULE_DESCRIPTION/);
  assert.match(worker, /DUVRI_RISK_RULE_APPROVAL_ID/);
  assert.match(worker, /DUVRI_RISK_RULE_VERSION/);
  assert.match(worker, /configuredTemplateVersion = String\(Deno\.env\.get\('DUVRI_TEMPLATE_VERSION'\)/);
  assert.match(worker, /savedMeta\.riskRuleApprovalId !== configuredRiskRuleApprovalId/);
  assert.match(worker, /savedMeta\.riskRuleVersion !== configuredRiskRuleVersion/);
  assert.match(worker, /payloadTemplateVersion && payloadTemplateVersion !== templateVersion/);
  assert.match(worker, /delete resumableOutputs\.draft/);
  assert.match(worker, /phase: 'draft', agentOutputs: resumableOutputs/);
  assert.match(worker, /populateDuvriTemplate\(templateBytes, draft\)/);
  assert.match(worker, /status: 'needs_review'/);
  assert.match(gateway, /awaiting_configuration/);
});

test('ogni agente registra il consumo API con il proprio nome', () => {
  assert.match(worker, /usageKind: 'ai_usage'/);
  assert.match(functionBody(worker, 'logModelUsage'), /calculateAnthropicCost\(/);
  for (const [phase, agent] of [['extract', 'document-reader'], ['analyze', 'duvri-analyst'], ['draft', 'docx-writer'], ['validate', 'quality-check']]) {
    assert.match(worker, new RegExp("phase: '" + phase + "', agent: '" + agent + "'"));
  }
  assert.match(gateway, /select=agent,phase,event_type,message,details,created_at/);
});
