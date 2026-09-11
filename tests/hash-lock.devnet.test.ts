import { ccc } from "@ckb-ccc/core";
import scripts from "../deployment/scripts.json";
import systemScripts from "../deployment/system-scripts.json";
import { buildClient, buildSigner } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
const client = buildClient("devnet");
const signer = buildSigner(client, "PRIVATE_KEY");

const HASH_LOCK = scripts.devnet["hash-lock.bc"];
const CKB_JS_VM = systemScripts.devnet.ckb_js_vm!.script;

const SECRET = "ckbuilder week 4, the preimage is the whole secret";
const PREIMAGE = ccc.hexFrom(new TextEncoder().encode(SECRET));
const EXPECTED = ccc.hashCkb(PREIMAGE);

// 0x0000 | code_hash 32 | hash_type 1 | expected hash 32 = 67 bytes
const lockArgs = ccc.hexFrom(
  "0x0000" +
    HASH_LOCK.codeHash.slice(2) +
    ccc
      .hexFrom(ccc.hashTypeToBytes(HASH_LOCK.hashType as ccc.HashType))
      .slice(2) +
    EXPECTED.slice(2),
);

const hashLock = ccc.Script.from({
  codeHash: CKB_JS_VM.codeHash,
  hashType: CKB_JS_VM.hashType,
  args: lockArgs,
});

const DEPOSIT = 200;
const FEE = ccc.fixedPointFrom(0.01); // flat, over the real rate

const deposit = async () => {
  const tx = ccc.Transaction.from({
    outputs: [{ lock: hashLock, capacity: ccc.fixedPointFrom(DEPOSIT) }],
    outputsData: ["0x"],
  });
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);
  return signer.signTransaction(tx);
};

// only input is the hash-lock cell, nothing to sign. witness 0 = preimage
const unlock = async (depositTx: string, preimage?: string) => {
  const { script: myLock } = await signer.getRecommendedAddressObj();

  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: { txHash: depositTx, index: 0 } }],
    outputs: [
      { lock: myLock, capacity: ccc.fixedPointFrom(DEPOSIT) - FEE },
    ],
    outputsData: ["0x"],
    cellDeps: [CKB_JS_VM.cellDeps[0]!.cellDep, HASH_LOCK.cellDeps[0]!.cellDep],
    witnesses: [
      preimage === undefined
        ? "0x"
        : ccc.hexFrom(ccc.WitnessArgs.from({ lock: preimage }).toBytes()),
    ],
  });
  return tx;
};

jest.setTimeout(180_000);

describe("hash-lock on devnet", () => {
  let depositTx: string;

  beforeAll(async () => {
    depositTx = await client.sendTransaction(await deposit());
    const committed = await client.waitTransaction(depositTx, 0, 120_000);
    expect(committed?.status).toBe("committed");
    console.log(
      `deposit ${depositTx}, ${DEPOSIT} CKB locked by hash-lock ${hashLock.hash()}`,
    );
  });

  it("the deposited cell is locked by ckb_js_vm carrying my expected hash", async () => {
    const cell = await client.getCellLive({ txHash: depositTx, index: 0 }, true);

    expect(cell).toBeDefined();
    expect(cell!.cellOutput.lock.codeHash).toBe(CKB_JS_VM.codeHash);
    expect(cell!.cellOutput.lock.args).toBe(lockArgs);
    expect((lockArgs.length - 2) / 2).toBe(67);
    // 8 capacity + 32 code hash + 1 hash type + 67 args
    expect(cell!.cellOutput.occupiedSize).toBe(108);
  });

  it("rejects a wrong preimage with the script's own exit code 11", async () => {
    const wrong = ccc.hexFrom(new TextEncoder().encode(`${SECRET}!`));
    const error = await client
      .sendTransactionDry(await unlock(depositTx, wrong))
      .catch((e) => e);
    console.log(`wrong preimage -> ${String(error.message ?? error)}`);

    expect(String(error)).toContain("Inputs[0].Lock");
    expect(String(error)).toContain("error code 11");
  });

  it("rejects an empty witness before the script's own checks run", async () => {
    const error = await client
      .sendTransactionDry(await unlock(depositTx))
      .catch((e) => e);
    console.log(`empty witness -> ${String(error.message ?? error)}`);

    expect(String(error)).toContain("Inputs[0].Lock");
    expect(String(error)).not.toContain("error code 11");
  });

  it("unlocks with the correct preimage, no signature anywhere", async () => {
    const tx = await unlock(depositTx, PREIMAGE);
    const unlockTx = await client.sendTransaction(tx);
    const committed = await client.waitTransaction(unlockTx, 0, 120_000);
    console.log(`unlock ${unlockTx}, preimage "${SECRET}"`);

    expect(committed?.status).toBe("committed");
    await expect(
      client.getCellLive({ txHash: depositTx, index: 0 }, true),
    ).resolves.toBeUndefined();

    const spent = await client.getCellLive({ txHash: unlockTx, index: 0 }, true);
    expect(spent!.cellOutput.capacity).toBe(
      ccc.fixedPointFrom(DEPOSIT) - FEE,
    );
  });

  it("the preimage is now public, which is the flaw", async () => {
    // preimage is in the witness now, anyone can reuse it. safe once.
    const tx = await client.getTransaction(depositTx);
    expect(tx?.status).toBe("committed");
    expect(ccc.hashCkb(PREIMAGE)).toBe(EXPECTED);
  });
});
