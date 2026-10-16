# duel-inputs-1 validation

This is the assembled `{schemaVersion, events}` input accepted by the deterministic core in HolobotsMobile #103. It is not a live callable envelope, transport chunk or the older `duel-intents-1` action-string array. No endpoint, gameplay or deployment changes are included.

## Run without Unity

```sh
python3 -m venv /tmp/duel-inputs-schema-venv
/tmp/duel-inputs-schema-venv/bin/pip install jsonschema==4.26.0
/tmp/duel-inputs-schema-venv/bin/python functions/scripts/contracts/test_duel_inputs_schema.py
```

The draft-2020-12 validator checks all nine actions, required/forbidden action-specific fields, integer and collection limits, actor/target IDs, versions, and client damage/outcome injection. It validates all 24 frozen logs when that repository's vector file exists. The Unity vector-dependent test explicitly skips until the independent twin PR supplies `Assets/StreamingAssets/Samples/duel-sim/vectors.json`; all structural cases are self-contained.

JSON Schema cannot require seq equal to array index, monotonically increasing ticks, at most four commands per tick, or snapshot-specific team ownership and maxTicks. The core's `validate()` remains authoritative for these semantics and rejects negative zero; schema numeric equality does not distinguish signed zero or integer-valued numeric spellings. Global ceilings are 8192 events, seq 0–8191, tick 0–7199, move axes −127..127; they are not authorization to exceed a particular admitted snapshot. ID matching uses an absolute end assertion to reject a trailing newline (unlike JavaScript `$`).

On Mobile, after `npm --prefix functions run build`, run `npm --prefix functions run test:duel-inputs`. Four tests cover the 24 valid logs, ordering/sequence/per-tick/maxTick refusals, actor and target membership, signed zero and injected outcomes; they also participate in the normal `npm test` command.

## W63 evidence

- Mobile: 8/8 schema tests and 4/4 semantic tests passed; build and shared parity passed (three shared files).
- Unity: seven structural tests passed, one frozen-vector check skipped until the twin lands. No editor or native tests run.
- First schema attempt caught a trailing-newline regex case; absolute-end assertion fixed it. First semantic attempt selected a non-CPU fixture for the CPU-actor check; selecting the existing CPU fixture fixed it. The initial sparse build lacked three shared-source files; adding those files restored the normal build gate.
- Both copies of the schema and Python test are byte-identical. No schemas are applied to production by this change.
