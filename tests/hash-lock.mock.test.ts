import { readFileSync } from "node:fs";
import {
  WitnessArgs,
  hashCkb,
  hashTypeToBytes,
  hexFrom,
  Transaction,
} from "@ckb-ccc/core";
import {
  DEFAULT_SCRIPT_ALWAYS_SUCCESS,
  DEFAULT_SCRIPT_CKB_JS_VM,
  Resource,
  ScriptVerificationResult,
  Verifier,
} from "ckb-testtool";

// Needs ckb-debugger on ptptahh cargo install ckb-debugger

const ARTIFACT = "dist/hash-lock.bc";

const SECRET = "ckbuilder week 4, the preimage is the whole secret";
const PREIMAGE = hexFrom(new TextEncoder().encode(SECRET));
const EXPECTED = hashCkb(PREIMAGE);

type Options = {
  preimage?: string;
  expectedHash?: string;
  omitWitness?: boolean;
  emptyLockField?: boolean;
};

const buildTx = ({
  preimage,
  expectedHash,
  omitWitness,
  emptyLockField,
}: Options = {}) => {
  const resource = Resource.default();
  const tx = Transaction.default();

  const alwaysSuccess = resource.deployCell(
    hexFrom(readFileSync(DEFAULT_SCRIPT_ALWAYS_SUCCESS)),
    tx,
    false,
  );
  const jsVm = resource.deployCell(
    hexFrom(readFileSync(DEFAULT_SCRIPT_CKB_JS_VM)),
    tx,
    false,
  );
  const bytecode = resource.deployCell(
    hexFrom(readFileSync(ARTIFACT)),
    tx,
    false,
  );

  // 0x0000 | code_hash 32 | hash_type 1 | expected hash 32
  jsVm.args = hexFrom(
    "0x0000" +
      bytecode.codeHash.slice(2) +
      hexFrom(hashTypeToBytes(bytecode.hashType)).slice(2) +
      (expectedHash ?? EXPECTED).slice(2),
  );

  // lock, so input side only
  const input = resource.mockCell(jsVm, undefined, "0x");
  tx.inputs.push(Resource.createCellInput(input));
  tx.outputs.push(Resource.createCellOutput(alwaysSuccess));
  tx.outputsData.push(hexFrom("0x"));
  tx.witnesses.push(
    omitWitness
      ? hexFrom("0x")
      : hexFrom(
          WitnessArgs.from(
            emptyLockField ? {} : { lock: preimage ?? PREIMAGE },
          ).toBytes(),
        ),
  );

  return { resource, tx, bytecodeCodeHash: bytecode.codeHash };
};

const lockGroup = (results: ScriptVerificationResult[]) => {
  const group = results.find((r) => r.groupType === "lock");
  expect(group).toBeDefined();
  return group!;
};

jest.setTimeout(120_000);

describe("hash-lock in a mock context", () => {
  it("unlocks when the witness holds the right preimage", async () => {
    const { resource, tx } = buildTx();
    const group = lockGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(0);
    expect(group.stdout).toContain("hash-lock v2: preimage accepted");
  });

  it("rejects a wrong preimage with exit code 11", async () => {
    const { resource, tx } = buildTx({
      preimage: hexFrom(new TextEncoder().encode(`${SECRET}!`)),
    });
    const group = lockGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(11);
    expect(group.stdout).toContain("does not hash to the expected value");
  });

  it("rejects a witness with no lock field with exit code 12", async () => {
    const { resource, tx } = buildTx({ emptyLockField: true });
    const group = lockGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(12);
    expect(group.stdout).toContain("no preimage in the witness lock field");
  });

  it("never reaches the script when the witness is not WitnessArgs at all", async () => {
    // molecule decode fails first, so -7 not my 12
    const { resource, tx } = buildTx({ omitWitness: true });
    const group = lockGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(-7);
    expect(group.stdout).not.toContain("preimage accepted");
  });

  it("rejects args that are not 35 + 32 bytes with exit code 10", async () => {
    const { resource, tx } = buildTx({ expectedHash: `0x${"cd".repeat(31)}` });
    const group = lockGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(10);
    expect(group.stdout).toContain("args are 66 bytes, expected 67");
  });

  it("hashes the preimage the same way the chain does", () => {
    expect(hashCkb(PREIMAGE)).toBe(EXPECTED);
    expect(EXPECTED.length).toBe(66);
  });
});
