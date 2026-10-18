# witness-summary

Summarises loopback-witness text logs, one record per file.

```
node tools/witness-summary/summarise.mjs docs/witness/c1r1.log docs/witness/c2a_r1.log
node tools/witness-summary/summarise.mjs --json docs/witness/c1r1.log
```

Reads existing text output only. It does not touch tools/loopback-witness/ or the lock render output.

Fields the log does not carry (binary md5, lock binary sha256, tracker sha256, timestamp) are not in this summary. A field the log does not carry prints as `-` in TSV and `null` in JSON, never a guessed value.
