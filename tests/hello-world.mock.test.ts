import { readFileSync } from "node:fs";
import { hashTypeToBytes, hexFrom, Transaction } from "@ckb-ccc/core";
import {
  DEFAULT_SCRIPT_ALWAYS_SUCCESS,
  DEFAULT_SCRIPT_CKB_JS_VM,
  Resource,
  ScriptVerificationResult,
  Verifier,
} from "ckb-testtool";

// Needs ckb-debugger on PATH: cargo install ckb-debugger

const ARTIFACT = "dist/hello-world.bc";

type Options = {
  dropBytecodeDep?: boolean;
  codeHashOverride?: string;
};

const buildTx = ({ dropBytecodeDep, codeHashOverride }: Options = {}) => {
  const resource = Resource.default();
  const tx = Transaction.default();

  const lock = resource.deployCell(
    hexFrom(readFileSync(DEFAULT_SCRIPT_ALWAYS_SUCCESS)),
    tx,
    false,
  );
  const jsVm = resource.deployCell(
    hexFrom(readFileSync(DEFAULT_SCRIPT_CKB_JS_VM)),
    tx,
    false,
  );

  const depsBefore = tx.cellDeps.length;
  const bytecode = resource.deployCell(
    hexFrom(readFileSync(ARTIFACT)),
    tx,
    false,
  );
  if (dropBytecodeDep) {
    tx.cellDeps.splice(depsBefore, tx.cellDeps.length - depsBefore);
  }

  // ckb_js_vm args: 0x0000 | code_hash (32 bytes) | hash_type (1 byte).
  // The leading two bytes are flags, 0x0000 means load from a cell dep.
  jsVm.args = hexFrom(
    "0x0000" +
      (codeHashOverride ?? bytecode.codeHash).slice(2) +
      hexFrom(hashTypeToBytes(bytecode.hashType)).slice(2),
  );

  // Type script so it runs on the output too. A lock would only run on inputs.
  const input = resource.mockCell(lock, jsVm, "0x");
  tx.inputs.push(Resource.createCellInput(input));
  tx.outputs.push(Resource.createCellOutput(lock, jsVm));
  tx.outputsData.push(hexFrom("0x"));

  return { resource, tx, bytecodeCodeHash: bytecode.codeHash };
};

const typeGroup = (results: ScriptVerificationResult[]) => {
  const group = results.find((r) => r.groupType === "type");
  expect(group).toBeDefined();
  return group!;
};

jest.setTimeout(120_000);

describe("hello-world in a mock context", () => {
  it("runs under ckb_js_vm and exits 0", async () => {
    const { resource, tx } = buildTx();
    const group = typeGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(0);
    expect(group.stdout).toContain("hello-world script loaded");
    expect(group.stdoutCycles).toBeGreaterThan(1_000_000);
  });

  // Note: verifySuccess() only checks the debugger's process status, not the
  // script's return code, so these have to look at scriptErrorCode.
  it("fails when the bytecode cell dep is missing", async () => {
    const { resource, tx } = buildTx({ dropBytecodeDep: true });
    const group = typeGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(1);
    expect(group.stdout).not.toContain("hello-world script loaded");
  });

  it("fails when ckb_js_vm points at an unknown code hash", async () => {
    const { resource, tx } = buildTx({
      codeHashOverride: `0x${"ab".repeat(32)}`,
    });
    const group = typeGroup(await Verifier.from(resource, tx).verify());

    expect(group.scriptErrorCode).toBe(1);
    expect(group.stdout).not.toContain("hello-world script loaded");
  });

  it("the mock code hash matches the deployed code hash on both chains", () => {
    const { bytecodeCodeHash } = buildTx();
    const scripts = JSON.parse(
      readFileSync("deployment/scripts.json", "utf8"),
    ) as Record<string, Record<string, { codeHash: string }>>;

    expect(bytecodeCodeHash.toLowerCase()).toBe(
      scripts.devnet["hello-world.bc"].codeHash.toLowerCase(),
    );
    expect(bytecodeCodeHash.toLowerCase()).toBe(
      scripts.testnet["hello-world.bc"].codeHash.toLowerCase(),
    );
  });
});
