import * as bindings from "@ckb-js-std/bindings";
import { HighLevel, bytesEq, hashCkb, log } from "@ckb-js-std/core";

// hash lock. preimage in the witness must hash to the value in args.
// insecure, preimage is public once broadcast. devnet only.
//
// args: 0x0000 | code_hash 32 | hash_type 1 | expected_hash 32
const ARGS_OFFSET = 35; // mine starts here
const HASH_BYTES = 32;

const ERR_ARGS_LENGTH = 10;
const ERR_WRONG_PREIMAGE = 11;
const ERR_NO_PREIMAGE = 12;

function main(): number {
  log.setLevel(log.LogLevel.Debug);

  const args = new Uint8Array(HighLevel.loadScript().args);
  if (args.length !== ARGS_OFFSET + HASH_BYTES) {
    log.debug(`hash-lock: args are ${args.length} bytes, expected 67`);
    return ERR_ARGS_LENGTH;
  }
  const expected = args.slice(ARGS_OFFSET);

  // index is within the group, not the tx
  const witness = HighLevel.loadWitnessArgs(0, bindings.SOURCE_GROUP_INPUT);
  const preimage = witness.lock;
  if (!preimage || preimage.byteLength === 0) {
    log.debug("hash-lock: no preimage in the witness lock field");
    return ERR_NO_PREIMAGE;
  }

  const hash = hashCkb(preimage);
  if (!bytesEq(hash, expected.buffer)) {
    log.debug("hash-lock: preimage does not hash to the expected value");
    return ERR_WRONG_PREIMAGE;
  }

  // v2, log line only
  log.debug("hash-lock v2: preimage accepted");
  return 0;
}

bindings.exit(main());
