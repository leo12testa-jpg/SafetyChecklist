import {
  AnthropicCallError, DEFAULT_AGENT_CONFIG, FILES_API_BETA, buildMessagesRequest, callClaudeJson, classifyHttpError,
  deleteClaudeFile, fileBlock, interpretMessagesResponse, parseAgentJson, resolveAgentConfigs, textBlock, uploadClaudeFile,
  validateAgentConfig, type AgentConfig, type AgentPhase
} from './anthropic-client.ts';

// No network: every test injects a mocked fetch. The key below is a fake placeholder.
const KEY = 'test-key-not-real';

function ok(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + ': atteso ' + JSON.stringify(expected) + ', ricevuto ' + JSON.stringify(actual));
  }
}
function catchError(fn: () => unknown): AnthropicCallError {
  try { fn(); } catch (error) {
    if (error instanceof AnthropicCallError) return error;
    throw error;
  }
  throw new Error('Era atteso un errore.');
}
async function catchAsync(fn: () => Promise<unknown>): Promise<AnthropicCallError> {
  try { await fn(); } catch (error) {
    if (error instanceof AnthropicCallError) return error;
    throw error;
  }
  throw new Error('Era atteso un errore.');
}
function cfg(phase: AgentPhase, patch: Partial<AgentConfig> = {}): AgentConfig {
  return { ...DEFAULT_AGENT_CONFIG[phase], ...patch };
}
function body(phase: AgentPhase, files = false) {
  return buildMessagesRequest({
    apiKey: KEY,
    config: cfg(phase),
    system: 'sistema',
    messages: [{ role: 'user', content: files ? [textBlock('a'), fileBlock('file_1', 'application/pdf', 'doc.pdf')] : [textBlock('a')] }]
  });
}
type Call = { url: string; init: RequestInit };
function mockFetch(responses: Array<{ status?: number; json?: unknown; text?: string }>, calls: Call[] = []) {
  let index = 0;
  return async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(index++, responses.length - 1)];
    const payload = next.text !== undefined ? next.text : JSON.stringify(next.json ?? {});
    return new Response(payload, { status: next.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
}
function message(stopReason: unknown, text = '{"ok":true}', extra: Record<string, unknown> = {}) {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: stopReason,
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...extra
  };
}

// --- request builder ---------------------------------------------------------------------

Deno.test('document-reader: Haiku 5.5, effort low, thinking disabled', () => {
  const request = body('extract');
  equal(request.body.model, 'claude-haiku-5-5', 'modello');
  equal(request.body.output_config, { effort: 'low' }, 'effort');
  equal((request.body as any).thinking, { type: 'disabled' }, 'thinking');
  equal(request.body.max_tokens, 16000, 'max_tokens');
  equal(request.url, 'https://api.anthropic.com/v1/messages', 'url');
});

Deno.test('interference-analyst: Sonnet 5.5, effort medium, thinking adattivo (campo omesso)', () => {
  const request = body('analyze');
  equal(request.body.model, 'claude-sonnet-5-5', 'modello');
  equal(request.body.output_config, { effort: 'medium' }, 'effort');
  ok(!('thinking' in request.body), 'thinking deve essere omesso per il default adattivo');
});

Deno.test('duvri-writer e quality-controller: Sonnet 5.5, effort medium, between_tools senza altri campi', () => {
  for (const phase of ['draft', 'validate'] as AgentPhase[]) {
    const request = body(phase);
    equal(request.body.model, 'claude-sonnet-5-5', phase + ' modello');
    equal(request.body.output_config, { effort: 'medium' }, phase + ' effort');
    equal((request.body as any).thinking, { type: 'between_tools' }, phase + ' thinking');
  }
  equal(body('draft').body.max_tokens, 16000, 'max_tokens draft');
  equal(body('validate').body.max_tokens, 8000, 'max_tokens validate');
});

Deno.test('nessun parametro di campionamento né prefill nella richiesta', () => {
  for (const phase of ['extract', 'analyze', 'draft', 'validate'] as AgentPhase[]) {
    const request = body(phase, true);
    for (const forbidden of ['temperature', 'top_p', 'top_k']) ok(!(forbidden in request.body), phase + ': ' + forbidden + ' non ammesso');
    ok(request.body.messages.every((m) => m.role === 'user'), phase + ': nessun messaggio assistant (prefill)');
    equal(request.headers['x-api-key'], KEY, 'x-api-key');
    equal(request.headers['anthropic-version'], '2023-06-01', 'anthropic-version');
  }
});

Deno.test('blocchi nativi: PDF -> document, PNG/JPEG -> image, testo -> text', () => {
  equal(fileBlock('f1', 'application/pdf', 'a.pdf'), { type: 'document', source: { type: 'file', file_id: 'f1' }, title: 'a.pdf' }, 'pdf');
  equal(fileBlock('f2', 'image/png'), { type: 'image', source: { type: 'file', file_id: 'f2' } }, 'png');
  equal(fileBlock('f3', 'image/jpeg', 'x.jpg'), { type: 'image', source: { type: 'file', file_id: 'f3' } }, 'jpeg');
  equal(textBlock('ciao'), { type: 'text', text: 'ciao' }, 'testo');
  const error = catchError(() => fileBlock('f4', 'application/msword'));
  ok(!error.retryable, 'tipo non supportato non ritentabile');
});

Deno.test('header beta Files API solo quando ci sono blocchi file', () => {
  ok(!('anthropic-beta' in body('extract').headers), 'nessun beta header senza file');
  equal(body('extract', true).headers['anthropic-beta'], FILES_API_BETA, 'beta header con file');
});

Deno.test('chiave API mancante: errore di configurazione chiaro, nessuna chiamata', async () => {
  const calls: Call[] = [];
  const error = await catchAsync(() => callClaudeJson({
    apiKey: '', config: cfg('analyze'), system: 's', messages: [{ role: 'user', content: [textBlock('x')] }],
    fetchImpl: mockFetch([{ json: message('end_turn') }], calls)
  }));
  equal(error.kind, 'configuration', 'tipo errore');
  ok(!error.retryable, 'non ritentabile');
  ok(error.message.includes('ANTHROPIC_API_KEY'), 'il messaggio cita il secret');
  equal(calls.length, 0, 'nessuna chiamata di rete');
});

// --- configuration validation ------------------------------------------------------------

Deno.test('combinazioni non valide rifiutate con errore italiano', () => {
  const cases: Array<[Partial<AgentConfig>, AgentPhase, string]> = [
    [{ thinking: 'between_tools', effort: 'xhigh' }, 'draft', 'between_tools'],
    [{ thinking: 'between_tools', effort: 'max' }, 'validate', 'between_tools'],
    [{ thinking: 'disabled' }, 'analyze', 'Sonnet 5.5'],
    [{ thinking: 'disabled', effort: 'xhigh' }, 'extract', 'Haiku 5.5'],
    [{ thinking: 'disabled', effort: 'max' }, 'extract', 'Haiku 5.5'],
    [{ thinking: 'between_tools' }, 'extract', 'between_tools'],
    [{ model: 'claude-sonnet-5' }, 'analyze', 'non supportato'],
    [{ model: 'gpt-5' }, 'analyze', 'non supportato'],
    [{ effort: 'extreme' as any }, 'analyze', 'effort'],
    [{ maxTokens: 100 }, 'analyze', 'max_tokens'],
    [{ maxTokens: Number.NaN }, 'analyze', 'max_tokens']
  ];
  for (const [patch, phase, fragment] of cases) {
    const error = catchError(() => validateAgentConfig(cfg(phase, patch)));
    equal(error.kind, 'configuration', JSON.stringify(patch));
    ok(error.message.includes(fragment), 'messaggio per ' + JSON.stringify(patch) + ': ' + error.message);
  }
  // Valid edge cases.
  validateAgentConfig(cfg('extract', { thinking: 'disabled', effort: 'high' }));
  validateAgentConfig(cfg('draft', { thinking: 'between_tools', effort: 'high' }));
  validateAgentConfig(cfg('analyze', { thinking: 'adaptive', effort: 'max' }));
});

Deno.test('override da env: modelli, effort, thinking e max_tokens per fase', () => {
  const env: Record<string, string> = {
    DOCUMENT_AI_MODEL: 'claude-sonnet-5-5',
    DOCUMENT_AI_EXTRACT_MODEL: 'claude-haiku-5-5',
    DOCUMENT_AI_EXTRACT_EFFORT: 'MEDIUM',
    DOCUMENT_AI_ANALYZE_EFFORT: 'high',
    DOCUMENT_AI_DRAFT_THINKING: 'adaptive',
    DOCUMENT_AI_VALIDATE_MAX_TOKENS: '12000'
  };
  const configs = resolveAgentConfigs((name) => env[name]);
  equal(configs.extract.effort, 'medium', 'extract effort');
  equal(configs.analyze.effort, 'high', 'analyze effort');
  equal(configs.draft.thinking, 'adaptive', 'draft thinking');
  equal(configs.validate.maxTokens, 12000, 'validate max_tokens');
  const defaults = resolveAgentConfigs(() => undefined);
  equal(defaults, DEFAULT_AGENT_CONFIG, 'senza env valgono i default');
  const error = catchError(() => resolveAgentConfigs((name) => ({ DOCUMENT_AI_DRAFT_EFFORT: 'xhigh' } as Record<string, string>)[name]));
  ok(error.message.includes('between_tools'), 'combinazione env non valida rifiutata all’avvio');
  const legacy = catchError(() => resolveAgentConfigs((name) => ({ DOCUMENT_AI_MODEL: 'gpt-4o' } as Record<string, string>)[name]));
  ok(legacy.message.includes('non supportato'), 'modello non Claude rifiutato');
});

// --- stop_reason -------------------------------------------------------------------------

Deno.test('end_turn e stop_sequence: testo restituito', () => {
  equal(interpretMessagesResponse(message('end_turn', '{"a":1}')).text, '{"a":1}', 'end_turn');
  equal(interpretMessagesResponse(message('stop_sequence', '{"a":2}')).text, '{"a":2}', 'stop_sequence');
});

Deno.test('refusal con stop_details: messaggio con categoria e spiegazione, non ritentabile', () => {
  const error = catchError(() => interpretMessagesResponse(message('refusal', '', {
    stop_details: { type: 'refusal', category: 'cyber', explanation: 'contenuto non consentito' }
  })));
  ok(!error.retryable, 'refusal non ritentabile');
  equal(error.stopReason, 'refusal', 'stop reason');
  ok(error.message.includes('Claude ha rifiutato la richiesta (categoria: cyber)'), error.message);
  ok(error.message.includes('contenuto non consentito'), 'spiegazione inclusa');
  ok(error.message.includes('Bozza bloccata: serve revisione umana.'), 'bozza bloccata');
});

Deno.test('refusal senza stop_details o con campi null: nessun crash', () => {
  for (const extra of [{}, { stop_details: null }, { stop_details: { type: 'refusal', category: null, explanation: null } }]) {
    const error = catchError(() => interpretMessagesResponse(message('refusal', '', extra)));
    ok(error.message.includes('categoria: non indicata'), error.message);
    ok(!error.retryable, 'non ritentabile');
  }
});

Deno.test('max_tokens: output troncato, bloccato e non ritentabile anche con JSON parziale', () => {
  const error = catchError(() => interpretMessagesResponse(message('max_tokens', '{"parziale":'), cfg('draft')));
  ok(!error.retryable, 'non ritentabile');
  ok(error.message.includes('troncato'), error.message);
  ok(error.message.includes('DOCUMENT_AI_DRAFT_MAX_TOKENS'), 'indica la variabile da verificare');
});

Deno.test('model_context_window_exceeded, pause_turn, tool_use, valori sconosciuti o assenti: bloccati', () => {
  for (const reason of ['model_context_window_exceeded', 'pause_turn', 'tool_use', 'nuovo_motivo', null, undefined]) {
    const error = catchError(() => interpretMessagesResponse(message(reason)));
    ok(!error.retryable, String(reason) + ' non ritentabile');
    equal(error.kind, 'stop_reason', String(reason));
    ok(error.message.includes('Bozza bloccata'), String(reason) + ': ' + error.message);
  }
});

Deno.test('testo vuoto o non JSON: errore chiaro', () => {
  const empty = catchError(() => interpretMessagesResponse(message('end_turn', '')));
  equal(empty.kind, 'invalid_output', 'vuoto');
  ok(empty.message.includes('non ha restituito contenuto'), empty.message);
  const invalid = catchError(() => parseAgentJson('Ecco il risultato: niente JSON'));
  ok(invalid.message.includes('non è JSON valido'), invalid.message);
  const array = catchError(() => parseAgentJson('[1,2]'));
  ok(array.message.includes('non è un oggetto JSON'), array.message);
  equal(parseAgentJson('```json\n{"a":1}\n```'), { a: 1 }, 'fence markdown tollerato');
});

// --- call wrapper ------------------------------------------------------------------------

Deno.test('chiamata riuscita: JSON restituito e consumo registrato una volta', async () => {
  const calls: Call[] = [];
  const usage: unknown[] = [];
  const result = await callClaudeJson({
    apiKey: KEY, config: cfg('analyze'), system: 's', messages: [{ role: 'user', content: [textBlock('x')] }],
    fetchImpl: mockFetch([{ json: message('end_turn', '{"interferenceScenarios":[]}') }], calls),
    onUsage: (model, u, stop) => { usage.push({ model, u, stop }); }
  });
  equal(result, { interferenceScenarios: [] }, 'risultato');
  equal(calls.length, 1, 'una chiamata');
  const sent = JSON.parse(String(calls[0].init.body));
  ok(!('thinking' in sent) && sent.output_config.effort === 'medium', 'corpo inviato');
  equal(usage.length, 1, 'usage registrato');
  equal((usage[0] as any).stop, 'end_turn', 'stop reason nel log');
});

Deno.test('usage registrato anche quando lo stop_reason blocca la bozza', async () => {
  for (const reason of ['refusal', 'max_tokens', 'tool_use', 'sconosciuto']) {
    const usage: any[] = [];
    const error = await catchAsync(() => callClaudeJson({
      apiKey: KEY, config: cfg('draft'), system: 's', messages: [{ role: 'user', content: [textBlock('x')] }],
      fetchImpl: mockFetch([{ json: message(reason, '{"x":1}') }]),
      onUsage: (model, u, stop) => { usage.push({ model, u, stop }); }
    }));
    ok(!error.retryable, reason + ' non ritentabile');
    equal(usage.length, 1, reason + ': usage registrato');
    equal(usage[0].u.output_tokens, 300, reason + ': token output');
    equal(usage[0].stop, reason, reason + ': stop reason');
  }
  // JSON non valido: token fatturati e registrati prima dell'errore.
  const usage: unknown[] = [];
  const error = await catchAsync(() => callClaudeJson({
    apiKey: KEY, config: cfg('analyze'), system: 's', messages: [{ role: 'user', content: [textBlock('x')] }],
    fetchImpl: mockFetch([{ json: message('end_turn', 'non json') }]),
    onUsage: (_m, u) => { usage.push(u); }
  }));
  equal(error.kind, 'invalid_output', 'tipo errore');
  equal(usage.length, 1, 'usage registrato prima del parsing');
});

Deno.test('classificazione HTTP: 400/401/403/404/413 non ritentabili, 408/429/500/503/529 ritentabili', async () => {
  for (const status of [400, 401, 403, 404, 413, 422]) {
    const usage: unknown[] = [];
    const error = await catchAsync(() => callClaudeJson({
      apiKey: KEY, config: cfg('analyze'), system: 's', messages: [{ role: 'user', content: [textBlock('x')] }],
      fetchImpl: mockFetch([{ status, json: { type: 'error', error: { type: 'invalid_request_error', message: 'x' } } }]),
      onUsage: (_m, u) => { usage.push(u); }
    }));
    ok(!error.retryable, status + ' non ritentabile');
    equal(error.httpStatus, status, 'status HTTP');
    equal(usage.length, 0, status + ': nessun usage su errore HTTP');
  }
  for (const status of [408, 429, 500, 503, 529]) {
    ok(classifyHttpError(status).retryable, status + ' ritentabile');
  }
  equal(classifyHttpError(429).status, 429, '429 mantiene lo status');
});

Deno.test('timeout ed errori di rete: ritentabili', async () => {
  const timeout = await catchAsync(() => callClaudeJson({
    apiKey: KEY, config: cfg('analyze'), system: 's', messages: [{ role: 'user', content: [textBlock('x')] }],
    fetchImpl: () => Promise.reject(new DOMException('timeout', 'TimeoutError'))
  }));
  ok(timeout.retryable && timeout.kind === 'network', 'timeout ritentabile');
  ok(timeout.message.includes('Timeout'), timeout.message);
  const network = await catchAsync(() => callClaudeJson({
    apiKey: KEY, config: cfg('analyze'), system: 's', messages: [{ role: 'user', content: [textBlock('x')] }],
    fetchImpl: () => Promise.reject(new TypeError('connessione rifiutata'))
  }));
  ok(network.retryable, 'errore di rete ritentabile');
});

Deno.test('Files API: upload restituisce id, delete best effort, beta header centralizzato', async () => {
  const calls: Call[] = [];
  const id = await uploadClaudeFile({
    apiKey: KEY, bytes: new Uint8Array([37, 80, 68, 70]).buffer, filename: 'a.pdf', mimeType: 'application/pdf',
    fetchImpl: mockFetch([{ json: { id: 'file_abc', type: 'file' } }], calls)
  });
  equal(id, 'file_abc', 'id');
  equal(calls[0].url, 'https://api.anthropic.com/v1/files', 'url upload');
  equal((calls[0].init.headers as Record<string, string>)['anthropic-beta'], FILES_API_BETA, 'beta header upload');
  await deleteClaudeFile({ apiKey: KEY, id: 'file_abc', fetchImpl: mockFetch([{ status: 200, json: {} }], calls) });
  equal(calls[1].url, 'https://api.anthropic.com/v1/files/file_abc', 'url delete');
  equal(calls[1].init.method, 'DELETE', 'metodo delete');
  await deleteClaudeFile({ apiKey: KEY, id: 'x', fetchImpl: () => Promise.reject(new TypeError('rete')) });
  const rejected = await catchAsync(() => uploadClaudeFile({
    apiKey: KEY, bytes: new ArrayBuffer(1), filename: 'a.pdf', mimeType: 'application/pdf',
    fetchImpl: mockFetch([{ status: 400, json: {} }])
  }));
  ok(!rejected.retryable && rejected.message.includes('allegato'), rejected.message);
});
