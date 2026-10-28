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
