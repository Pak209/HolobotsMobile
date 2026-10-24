import test from 'node:test';
import assert from 'node:assert/strict';
import {botMaxBytes, DEFAULT_BOT_MAX_BYTES, HARE_STRICT_MAX_BYTES} from './hare-budget.mjs';

test('Pak-approved strict HARE pack is the sole byte-budget exception', () => {
  assert.equal(HARE_STRICT_MAX_BYTES, 2_210_316);
  assert.equal(botMaxBytes('hare'), 2_210_316);
  for (const id of ['ace','wolf','kuma','ken','tsuin','shadow','wake','tora','gama','kurai','era']) {
    assert.equal(botMaxBytes(id), DEFAULT_BOT_MAX_BYTES);
  }
  assert.equal(DEFAULT_BOT_MAX_BYTES, 2_000_000);
});
