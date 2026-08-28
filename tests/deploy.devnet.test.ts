import { ccc } from "@ckb-ccc/core";
import scripts from "../deployment/scripts.json";
import systemScripts from "../deployment/system-scripts.json";
import { buildClient, buildSigner } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
//
// Uses PRIVATE_KEY_2 so it doesn't fight devnet.test.ts over the same cells.
const client = buildClient("devnet");
const signer = buildSigner(client, "PRIVATE_KEY_2");

const HELLO_WORLD = scripts.devnet["hello-world.bc"];
const CKB_JS_VM = systemScripts.devnet.ckb_js_vm!.script;

const UNKNOWN_CODE_HASH = `0x${"ab".repeat(32)}`;

// 0x0000 | code_hash (32 bytes) | hash_type (1 byte)
const jsVmArgs = (codeHash: string) =>
  ccc.hexFrom(
    "0x0000" +
      codeHash.slice(2) +
      ccc
        .hexFrom(ccc.hashTypeToBytes(HELLO_WORLD.hashType as ccc.HashType))
        .slice(2),
  );

type Options = {
  dropBytecodeDep?: boolean;
  codeHashOverride?: string;
};

const buildExecutionTx = async ({
  dropBytecodeDep,
  codeHashOverride,
}: Options = {}) => {
  const { script: lock } = await signer.getRecommendedAddressObj();

  const tx = ccc.Transaction.from({
    outputs: [
      {
        lock,
        type: {
          codeHash: CKB_JS_VM.codeHash,
          hashType: CKB_JS_VM.hashType,
          args: jsVmArgs(codeHashOverride ?? HELLO_WORLD.codeHash),
        },
      },
    ],
    outputsData: ["0x"],
    cellDeps: [
      CKB_JS_VM.cellDeps[0]!.cellDep,
      ...(dropBytecodeDep ? [] : [HELLO_WORLD.cellDeps[0]!.cellDep]),
    ],
  });

  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  return signer.signTransaction(tx);
};

jest.setTimeout(120_000);

describe("invoking hello-world on the local devnet", () => {
  it("the devnet is reachable through the OffCKB proxy", async () => {
    await expect(client.getTip()).resolves.toBeGreaterThan(0n);
  });

  it("accepts a transaction whose type script runs the deployed bytecode", async () => {
    const tx = await buildExecutionTx();
    const txHash = await signer.client.sendTransaction(tx);

    const committed = await client.waitTransaction(txHash, 0, 60_000);
    expect(committed?.status).toBe("committed");

    const cell = await client.getCellLive({ txHash, index: 0 }, true);
    expect(cell?.cellOutput.type?.args.toLowerCase()).toContain(
      HELLO_WORLD.codeHash.slice(2).toLowerCase(),
    );

    console.log(
      `execution ${txHash} @ block ${committed?.blockNumber} ` +
        `type ckb_js_vm(${HELLO_WORLD.codeHash.slice(0, 10)}...), ` +
        `${tx.cellDeps.length} cell deps`,
    );
  });

  it.each([
    ["the bytecode cell dep is missing", { dropBytecodeDep: true }],
    [
      "ckb_js_vm points at an unknown code hash",
      { codeHashOverride: UNKNOWN_CODE_HASH },
    ],
  ] as const)("rejects it when %s", async (_label, options) => {
    const tx = await buildExecutionTx(options);
    const error = await client.sendTransaction(tx).catch((e) => e);

    expect(String(error)).toContain("TransactionFailedToVerify");
    // Outputs, not Inputs: type scripts run on both sides.
    expect(String(error)).toContain("Outputs[0].Type");
    expect(String(error)).toContain(CKB_JS_VM.codeHash.slice(2));
    expect(String(error)).toMatch(/error code 1\b/);
  });
});
