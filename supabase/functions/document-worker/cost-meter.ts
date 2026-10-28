export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  } | null;
};

export type UsageCost = {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number | null;
  pricingKnown: boolean;
};

type Rates = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  threshold?: number;
  inputOverThreshold?: number;
  outputOverThreshold?: number;
  cacheWrite5mOverThreshold?: number;
  cacheWrite1hOverThreshold?: number;
  cacheReadOverThreshold?: number;
};

// Prices are USD per 1,000,000 tokens, based on published first-party Claude API pricing.
// Update this table whenever the provider changes its public rates.
const ANTHROPIC_RATES: Record<string, Rates> = {
  'claude-sonnet-5-5': {
    input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1
  },
  'claude-sonnet-5': {
    input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2
  },
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01,
    threshold: 100000,
    inputOverThreshold: 0.5, outputOverThreshold: 2.5,
    cacheWrite5mOverThreshold: 0.625, cacheWrite1hOverThreshold: 1,
    cacheReadOverThreshold: 0.05
  }
};

const perMillion = (tokens: number, rate: number) => Math.max(0, tokens || 0) * rate / 1_000_000;

export function calculateAnthropicCost(model: string, usage: AnthropicUsage): UsageCost {
  const inputTokens = Math.max(0, Number(usage.input_tokens) || 0);
  const outputTokens = Math.max(0, Number(usage.output_tokens) || 0);
  const cacheWrite5mTokens = Math.max(0, Number(usage.cache_creation?.ephemeral_5m_input_tokens) || 0);
  const cacheWrite1hTokens = Math.max(0, Number(usage.cache_creation?.ephemeral_1h_input_tokens) || 0);
  const cacheReadTokens = Math.max(0, Number(usage.cache_read_input_tokens) || 0);
  const rates = ANTHROPIC_RATES[model];
  if (!rates) {
    return {
      model, provider: 'anthropic', inputTokens, outputTokens, cacheWrite5mTokens,
      cacheWrite1hTokens, cacheReadTokens, estimatedCostUsd: null, pricingKnown: false
    };
  }
  const promptTokens = inputTokens + cacheWrite5mTokens + cacheWrite1hTokens + cacheReadTokens;
  const over = !!rates.threshold && promptTokens > rates.threshold;
  const inputRate = over ? rates.inputOverThreshold! : rates.input;
  const outputRate = over ? rates.outputOverThreshold! : rates.output;
  const write5mRate = over ? rates.cacheWrite5mOverThreshold! : rates.cacheWrite5m;
  const write1hRate = over ? rates.cacheWrite1hOverThreshold! : rates.cacheWrite1h;
  const readRate = over ? rates.cacheReadOverThreshold! : rates.cacheRead;
  const cost =
    perMillion(inputTokens, inputRate) +
    perMillion(outputTokens, outputRate) +
    perMillion(cacheWrite5mTokens, write5mRate) +
    perMillion(cacheWrite1hTokens, write1hRate) +
    perMillion(cacheReadTokens, readRate);
  return {
    model, provider: 'anthropic', inputTokens, outputTokens, cacheWrite5mTokens,
    cacheWrite1hTokens, cacheReadTokens, estimatedCostUsd: cost, pricingKnown: true
  };
}

export function estimateJobsRemaining(monthlyCreditUsd: number, averageCostUsd: number) {
  if (!Number.isFinite(monthlyCreditUsd) || monthlyCreditUsd < 0 ||
      !Number.isFinite(averageCostUsd) || averageCostUsd <= 0) return null;
  return Math.floor(monthlyCreditUsd / averageCostUsd);
}
