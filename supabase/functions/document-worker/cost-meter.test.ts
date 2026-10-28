import { calculateAnthropicCost, estimateJobsRemaining } from './cost-meter.ts';

function assertNear(actual: number | null, expected: number, tolerance = 0.0000001) {
  if (actual === null || Math.abs(actual - expected) > tolerance) {
    throw new Error('Costo atteso ' + expected + ', ricevuto ' + actual);
  }
}

Deno.test('costo Sonnet 5.5 usa token input/output ai prezzi pubblici', () => {
  const result = calculateAnthropicCost('claude-sonnet-5-5', {
    input_tokens: 10000,
    output_tokens: 1000
  });
  assertNear(result.estimatedCostUsd, 0.03);
  if (!result.pricingKnown) throw new Error('Prezzo Sonnet deve essere riconosciuto.');
});

Deno.test('Haiku 5.5 usa il tier economico per prompt sotto 100.000 token', () => {
  const result = calculateAnthropicCost('claude-haiku-5-5', {
    input_tokens: 10000,
    output_tokens: 1000
  });
  assertNear(result.estimatedCostUsd, 0.0015);
});

Deno.test('Haiku 5.5 usa il tier superiore sopra 100.000 token', () => {
  const result = calculateAnthropicCost('claude-haiku-5-5', {
    input_tokens: 120000,
    output_tokens: 1000
  });
  assertNear(result.estimatedCostUsd, 0.0625);
});

Deno.test('stima quanti documenti rimangono con il credito disponibile', () => {
  const result = estimateJobsRemaining(40, 0.5);
  if (result !== 80) throw new Error('Attesi 80 documenti teorici, ricevuti ' + result);
  if (estimateJobsRemaining(40, 0) !== null) throw new Error('Costo medio zero deve essere non stimabile.');
});

Deno.test('modello non riconosciuto non inventa una stima di costo', () => {
  const result = calculateAnthropicCost('custom-model', { input_tokens: 1000, output_tokens: 100 });
  if (result.estimatedCostUsd !== null || result.pricingKnown) {
    throw new Error('Prezzo non noto deve rimanere nullo.');
  }
});

Deno.test('Haiku 5.5: cache read e write contano per la soglia dei 100.000 token', () => {
  const result = calculateAnthropicCost('claude-haiku-5-5', {
    input_tokens: 20000,
    output_tokens: 1000,
    cache_read_input_tokens: 70000,
    cache_creation: { ephemeral_5m_input_tokens: 20000, ephemeral_1h_input_tokens: 0 }
  });
  // 110.000 token di prompt: tier superiore (0,50 / 2,50 / 0,625 / 0,05 USD per milione).
  assertNear(result.estimatedCostUsd, 0.01 + 0.0025 + 0.0125 + 0.0035);
});

Deno.test('Sonnet 5.5: cache write 5m/1h e cache read ai prezzi pubblici', () => {
  const result = calculateAnthropicCost('claude-sonnet-5-5', {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 1000000,
    cache_creation: { ephemeral_5m_input_tokens: 1000000, ephemeral_1h_input_tokens: 1000000 }
  });
  assertNear(result.estimatedCostUsd, 0.1 + 2.5 + 4);
});
