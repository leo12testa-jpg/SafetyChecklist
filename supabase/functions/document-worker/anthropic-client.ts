/**
 * Claude API client for the document worker (Messages API + Files API).
 *
 * Pure request builder + pure response interpreter + a thin call wrapper with an
 * injectable `fetch`, so every outcome can be unit-tested without network access.
 * The engine uses only the Claude API: there is no other provider.
 */

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';
/**
 * Files API beta header. The Files API is GA (https://platform.claude.com/docs/en/build-with-claude/files):
 * this header is optional, still accepted, and only changes list/pagination/expires_at response shapes.
 * The worker only uses upload -> `id` and delete, so removal is expected to be safe; it is kept until
 * verified against the real API. To remove it later set this constant to null (one-line change).
 */
export const FILES_API_BETA: string | null = 'files-api-2025-04-14';
export const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ThinkingMode = 'adaptive' | 'disabled' | 'between_tools';
export type AgentPhase = 'extract' | 'analyze' | 'draft' | 'validate';
export type AgentConfig = {
  phase: AgentPhase;
  role: string;
  model: string;
  effort: Effort;
  thinking: ThinkingMode;
  maxTokens: number;
};

export const SUPPORTED_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const THINKING_MODES: ThinkingMode[] = ['adaptive', 'disabled', 'between_tools'];
const MIN_MAX_TOKENS = 1024;
const MAX_MAX_TOKENS = 32000; // non-streaming requests: keep well below HTTP/edge timeouts

/**
 * Cheapest configuration compatible with acceptable quality, per agent.
 * Thinking tokens are billed as output tokens and count toward max_tokens, so phases with
 * adaptive thinking need room for reasoning + JSON. max_tokens is a ceiling (only generated
 * tokens are billed); a truncated answer blocks the draft and wastes the whole call, so the
 * ceilings are generous rather than tight.
 */
export const DEFAULT_AGENT_CONFIG: Record<AgentPhase, AgentConfig> = {
  extract: { phase: 'extract', role: 'document-reader', model: 'claude-haiku-5-5', effort: 'low', thinking: 'disabled', maxTokens: 16000 },
  analyze: { phase: 'analyze', role: 'interference-analyst', model: 'claude-sonnet-5-5', effort: 'medium', thinking: 'adaptive', maxTokens: 16000 },
  draft: { phase: 'draft', role: 'duvri-writer', model: 'claude-sonnet-5-5', effort: 'medium', thinking: 'between_tools', maxTokens: 16000 },
  validate: { phase: 'validate', role: 'quality-controller', model: 'claude-sonnet-5-5', effort: 'medium', thinking: 'between_tools', maxTokens: 8000 }
};

export type AnthropicErrorKind = 'configuration' | 'http' | 'network' | 'stop_reason' | 'invalid_output';

export class AnthropicCallError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly kind: AnthropicErrorKind;
  readonly stopReason?: string;
  readonly httpStatus?: number;
  constructor(message: string, opts: { status: number; retryable: boolean; kind: AnthropicErrorKind; stopReason?: string; httpStatus?: number }) {
    super(message);
    this.name = 'AnthropicCallError';
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.kind = opts.kind;
    this.stopReason = opts.stopReason;
    this.httpStatus = opts.httpStatus;
  }
}

function configError(message: string): AnthropicCallError {
  return new AnthropicCallError(message, { status: 503, retryable: false, kind: 'configuration' });
}

/** Throws a clear Italian configuration error for combinations the API would reject with HTTP 400. */
export function validateAgentConfig(config: AgentConfig): AgentConfig {
  const where = 'Configurazione agente ' + config.role + ' (fase ' + config.phase + '): ';
  if (!(SUPPORTED_MODELS as readonly string[]).includes(config.model)) {
    throw configError(where + 'modello "' + config.model + '" non supportato. Modelli ammessi: ' + SUPPORTED_MODELS.join(', ') + '.');
  }
  if (!EFFORTS.includes(config.effort)) throw configError(where + 'effort "' + config.effort + '" non valido (ammessi: ' + EFFORTS.join(', ') + ').');
  if (!THINKING_MODES.includes(config.thinking)) {
    throw configError(where + 'thinking "' + config.thinking + '" non valido (ammessi: ' + THINKING_MODES.join(', ') + ').');
  }
  const highEffort = config.effort === 'xhigh' || config.effort === 'max';
  if (config.model === 'claude-sonnet-5-5' && config.thinking === 'disabled') {
    throw configError(where + 'Claude Sonnet 5.5 non accetta thinking "disabled": usare "between_tools" oppure "adaptive".');
  }
  if (config.thinking === 'between_tools' && config.model !== 'claude-sonnet-5-5') {
    throw configError(where + 'thinking "between_tools" è disponibile solo su claude-sonnet-5-5.');
  }
  if (config.thinking === 'between_tools' && highEffort) {
    throw configError(where + 'thinking "between_tools" è ammesso solo con effort low, medium o high.');
  }
  if (config.model === 'claude-haiku-5-5' && config.thinking === 'disabled' && highEffort) {
    throw configError(where + 'su Claude Haiku 5.5 thinking "disabled" è ammesso solo con effort high o inferiore.');
  }
  if (!Number.isInteger(config.maxTokens) || config.maxTokens < MIN_MAX_TOKENS || config.maxTokens > MAX_MAX_TOKENS) {
    throw configError(where + 'max_tokens deve essere un intero tra ' + MIN_MAX_TOKENS + ' e ' + MAX_MAX_TOKENS + '.');
  }
  return config;
}

export type EnvGetter = (name: string) => string | undefined;

/**
 * Env overrides:
 * - DOCUMENT_AI_EXTRACT_MODEL (extract) and DOCUMENT_AI_MODEL (analyze/draft/validate);
 * - DOCUMENT_AI_<FASE>_EFFORT, DOCUMENT_AI_<FASE>_THINKING, DOCUMENT_AI_<FASE>_MAX_TOKENS
 *   with FASE in EXTRACT, ANALYZE, DRAFT, VALIDATE.
 * Every resolved combination is validated; an invalid one throws a configuration error.
 */
export function resolveAgentConfigs(env: EnvGetter): Record<AgentPhase, AgentConfig> {
  const read = (name: string) => (env(name) || '').trim();
  const result = {} as Record<AgentPhase, AgentConfig>;
  for (const phase of Object.keys(DEFAULT_AGENT_CONFIG) as AgentPhase[]) {
    const base = DEFAULT_AGENT_CONFIG[phase];
    const prefix = 'DOCUMENT_AI_' + phase.toUpperCase() + '_';
    const model = read(phase === 'extract' ? 'DOCUMENT_AI_EXTRACT_MODEL' : 'DOCUMENT_AI_MODEL') || base.model;
    const effort = (read(prefix + 'EFFORT').toLowerCase() || base.effort) as Effort;
    const thinking = (read(prefix + 'THINKING').toLowerCase() || base.thinking) as ThinkingMode;
    const rawMax = read(prefix + 'MAX_TOKENS');
    const maxTokens = rawMax ? Number(rawMax) : base.maxTokens;
    result[phase] = validateAgentConfig({ ...base, model, effort, thinking, maxTokens });
  }
  return result;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'file'; file_id: string }; title?: string }
  | { type: 'image'; source: { type: 'file'; file_id: string } };
export type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicContentBlock[] };

export function textBlock(text: string): AnthropicContentBlock {
  return { type: 'text', text: String(text) };
}
/** Native block for a Files API upload: PDF -> document, PNG/JPEG -> image. */
export function fileBlock(fileId: string, mimeType: string, filename?: string): AnthropicContentBlock {
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'file', file_id: fileId }, ...(filename ? { title: filename.slice(0, 500) } : {}) };
  }
  if (mimeType === 'image/png' || mimeType === 'image/jpeg') return { type: 'image', source: { type: 'file', file_id: fileId } };
  throw new AnthropicCallError('Tipo di allegato non inviabile a Claude come file: ' + mimeType + '.', { status: 415, retryable: false, kind: 'configuration' });
}
export function isFileUploadMime(mimeType: string) {
  return mimeType === 'application/pdf' || mimeType === 'image/png' || mimeType === 'image/jpeg';
}

function baseHeaders(apiKey: string): Record<string, string> {
  if (!apiKey) throw configError('Chiave API Claude non configurata: impostare il secret ANTHROPIC_API_KEY.');
  return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION };
}
function filesHeaders(apiKey: string): Record<string, string> {
  return { ...baseHeaders(apiKey), ...(FILES_API_BETA ? { 'anthropic-beta': FILES_API_BETA } : {}) };
}

export function thinkingField(config: AgentConfig): Record<string, unknown> {
  // Adaptive is the model default: omit the field. Never send temperature/top_p/top_k or prefill.
  if (config.thinking === 'adaptive') return {};
  return { thinking: { type: config.thinking } };
}

/** Pure: builds URL, headers and JSON body of a Messages API request. */
export function buildMessagesRequest(input: {
  apiKey: string;
  config: AgentConfig;
  system: string;
  messages: AnthropicMessage[];
}) {
  validateAgentConfig(input.config);
  const containsFiles = input.messages.some((message) =>
    message.content.some((block) => block.type === 'document' || block.type === 'image'));
  const headers: Record<string, string> = {
    ...baseHeaders(input.apiKey),
    'content-type': 'application/json',
    ...(containsFiles && FILES_API_BETA ? { 'anthropic-beta': FILES_API_BETA } : {})
  };
  const body = {
    model: input.config.model,
    max_tokens: input.config.maxTokens,
    system: input.system,
    messages: input.messages,
    output_config: { effort: input.config.effort },
    ...thinkingField(input.config)
  };
  return { url: ANTHROPIC_API_BASE + '/messages', headers, body };
}

const HTTP_MESSAGES: Record<number, string> = {
  400: 'La richiesta Claude non è compatibile con il modello, i parametri o gli allegati selezionati (HTTP 400). Nuovi tentativi automatici sospesi: verificare la configurazione.',
  401: 'Chiave API Claude non valida o revocata (HTTP 401). Nuovi tentativi automatici sospesi: verificare ANTHROPIC_API_KEY.',
  403: 'La chiave API Claude non ha i permessi richiesti (HTTP 403). Nuovi tentativi automatici sospesi.',
  404: 'Modello o risorsa Claude non trovati (HTTP 404). Nuovi tentativi automatici sospesi: verificare il nome del modello.',
  413: 'Richiesta troppo grande per Claude (HTTP 413). Ridurre o suddividere gli allegati.',
  429: 'Limite temporaneo del provider AI.',
  529: 'Claude è temporaneamente sovraccarico (HTTP 529). Il sistema riproverà automaticamente.'
};

/** Pure: 408/409/429/5xx/529 are retryable; any other 4xx (400/401/403/404/413...) is not. */
export function classifyHttpError(status: number): AnthropicCallError {
  const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  const message = HTTP_MESSAGES[status] || (retryable
    ? 'Claude non ha completato la richiesta (HTTP ' + status + '). Il sistema riproverà automaticamente.'
    : 'Claude ha respinto la richiesta (HTTP ' + status + '). Nuovi tentativi automatici sospesi.');
  return new AnthropicCallError(message, {
    status: status === 429 ? 429 : retryable ? 502 : status,
    retryable, kind: 'http', httpStatus: status
  });
}

function blocked(message: string, stopReason: string) {
  return new AnthropicCallError(message, { status: 422, retryable: false, kind: 'stop_reason', stopReason });
}
function clip(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Pure: checks stop_reason and returns the concatenated text output.
 * Every non-success stop_reason is non-retryable: retrying the same request wastes budget.
 */
export function interpretMessagesResponse(data: any, config?: Pick<AgentConfig, 'maxTokens' | 'phase'>): { text: string; stopReason: string } {
  const stopReason = typeof data?.stop_reason === 'string' ? data.stop_reason : String(data?.stop_reason ?? 'assente');
  if (stopReason === 'refusal') {
    const details = data?.stop_details && typeof data.stop_details === 'object' ? data.stop_details : null;
    const category = clip(details?.category, 80) || 'non indicata';
    const explanation = clip(details?.explanation, 300);
    throw blocked('Claude ha rifiutato la richiesta (categoria: ' + category + ').' +
      (explanation ? ' Spiegazione: ' + explanation + '.' : '') +
      ' Bozza bloccata: serve revisione umana.', stopReason);
  }
  if (stopReason === 'max_tokens') {
    throw blocked('L’output di Claude è stato troncato al limite max_tokens' +
      (config ? ' (' + config.maxTokens + ', fase ' + config.phase + ')' : '') +
      '. Bozza bloccata: nessun nuovo tentativo automatico; ridurre gli allegati o aumentare DOCUMENT_AI_' +
      (config ? config.phase.toUpperCase() : '<FASE>') + '_MAX_TOKENS dopo verifica.', stopReason);
  }
  if (stopReason === 'model_context_window_exceeded') {
    throw blocked('Il materiale inviato supera la finestra di contesto del modello. Bozza bloccata: ridurre o suddividere gli allegati.', stopReason);
  }
  if (stopReason === 'pause_turn') {
    throw blocked('Claude ha sospeso il turno (pause_turn): risposta incompleta. Bozza bloccata: serve verifica tecnica.', stopReason);
  }
  if (stopReason === 'tool_use') {
    throw blocked('Claude ha richiesto uno strumento non previsto dal motore documentale (tool_use). Bozza bloccata: serve verifica tecnica.', stopReason);
  }
  if (stopReason !== 'end_turn' && stopReason !== 'stop_sequence') {
    throw blocked('Motivo di arresto Claude non riconosciuto (' + stopReason.slice(0, 60) + '). Bozza bloccata: serve verifica tecnica.', stopReason);
  }
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text).join('\n').trim();
  if (!text) {
    throw new AnthropicCallError('Claude non ha restituito contenuto testuale. Bozza bloccata: nessun dato salvato.', {
      status: 502, retryable: false, kind: 'invalid_output', stopReason
    });
  }
  return { text, stopReason };
}

/** Pure: parses the agent's JSON object, tolerating a surrounding ```json fence. */
export function parseAgentJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch {
    throw new AnthropicCallError('L’output dell’agente non è JSON valido. Bozza bloccata: nessun dato salvato.', { status: 502, retryable: false, kind: 'invalid_output' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AnthropicCallError('L’output dell’agente non è un oggetto JSON. Bozza bloccata: nessun dato salvato.', { status: 502, retryable: false, kind: 'invalid_output' });
  }
  return parsed as Record<string, unknown>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type UsageReporter = (model: string, usage: Record<string, unknown> | null, stopReason: string | null) => Promise<void> | void;

async function send(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout = (error as any)?.name === 'TimeoutError' || (error as any)?.name === 'AbortError';
    throw new AnthropicCallError(timeout
      ? 'Timeout della richiesta a Claude. Il sistema riproverà automaticamente.'
      : 'Errore di rete verso Claude. Il sistema riproverà automaticamente.', { status: 503, retryable: true, kind: 'network' });
  }
}

/**
 * Calls the Messages API and returns the agent's JSON object.
 * Usage is reported right after a successful HTTP response, before interpreting stop_reason
 * or parsing output: tokens are billed even when the answer is then rejected.
 */
export async function callClaudeJson(input: {
  apiKey: string;
  config: AgentConfig;
  system: string;
  messages: AnthropicMessage[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  onUsage?: UsageReporter;
}): Promise<Record<string, unknown>> {
  const request = buildMessagesRequest(input);
  const response = await send(input.fetchImpl || fetch, request.url, {
    method: 'POST', headers: request.headers, body: JSON.stringify(request.body)
  }, input.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[document-worker] Anthropic API error', input.config.model, response.status, detail.slice(0, 240));
    throw classifyHttpError(response.status);
  }
  let data: any;
  try { data = await response.json(); } catch {
    throw new AnthropicCallError('Risposta Claude non leggibile. Il sistema riproverà automaticamente.', { status: 502, retryable: true, kind: 'http', httpStatus: response.status });
  }
  if (input.onUsage) {
    await input.onUsage(input.config.model, data?.usage && typeof data.usage === 'object' ? data.usage : null,
      typeof data?.stop_reason === 'string' ? data.stop_reason : null);
  }
  const { text } = interpretMessagesResponse(data, input.config);
  return parseAgentJson(text);
}

/** Files API upload: returns the file id used in document/image blocks. */
export async function uploadClaudeFile(input: {
  apiKey: string;
  bytes: ArrayBuffer;
  filename: string;
  mimeType: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<string> {
  const body = new FormData();
  body.append('file', new File([input.bytes], input.filename, { type: input.mimeType }), input.filename);
  const response = await send(input.fetchImpl || fetch, ANTHROPIC_API_BASE + '/files', {
    method: 'POST', headers: filesHeaders(input.apiKey), body
  }, input.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[document-worker] Claude file upload failed', response.status, detail.slice(0, 240));
    const error = classifyHttpError(response.status);
    throw new AnthropicCallError('Un allegato non è stato accettato da Claude. ' + error.message, {
      status: error.status, retryable: error.retryable, kind: 'http', httpStatus: response.status
    });
  }
  const data = await response.json().catch(() => null);
  if (typeof data?.id !== 'string') {
    throw new AnthropicCallError('ID allegato Claude non disponibile.', { status: 502, retryable: true, kind: 'http', httpStatus: response.status });
  }
  return data.id;
}

/** Files API delete; best effort (provider copies are temporary). */
export async function deleteClaudeFile(input: { apiKey: string; id: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
  try {
    await send(input.fetchImpl || fetch, ANTHROPIC_API_BASE + '/files/' + encodeURIComponent(input.id), {
      method: 'DELETE', headers: filesHeaders(input.apiKey)
    }, input.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  } catch { /* best effort */ }
}
