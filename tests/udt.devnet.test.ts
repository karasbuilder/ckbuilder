import { ccc } from "@ckb-ccc/core";
import systemScripts from "../deployment/system-scripts.json";
import { buildClient, buildSigner } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
//
// xUDT, per RFC 0052. The type script args hold the owner's lock hash. If that
// lock is in the inputs the transaction is in owner mode and can mint or burn
// freely. Otherwise the script only lets tokens move, never appear.
const client = buildClient("devnet");
const owner = buildSigner(client, "PRIVATE_KEY");
const holder = buildSigner(client, "PRIVATE_KEY_2");

const XUDT = systemScripts.devnet.xudt!.script;
const XUDT_DEP = XUDT.cellDeps[0]!.cellDep;

const ISSUED = 1_000_000n;
// 8 capacity + lock 53 + type 65 + 16 bytes of amount
const TOKEN_CELL_CKB = 142;

const amountData = (n: bigint) => ccc.hexFrom(ccc.numLeToBytes(n, 16));
const amountOf = (data: string) =>
  ccc.numLeFromBytes(ccc.bytesFrom(data).slice(0, 16));

const udtType = (ownerLockHash: string) =>
  ccc.Script.from({
    codeHash: XUDT.codeHash,
    hashType: XUDT.hashType as ccc.HashType,
    args: ownerLockHash,
  });

jest.setTimeout(180_000);

describe("issuing an xUDT token on the local devnet", () => {
  let ownerLock: ccc.Script;
  let holderLock: ccc.Script;
  let type: ccc.Script;
  let issueTx: string;
  let splitTx: string;

  beforeAll(async () => {
    ownerLock = (await owner.getRecommendedAddressObj()).script;
    holderLock = (await holder.getRecommendedAddressObj()).script;
    type = udtType(ownerLock.hash());

    // Owner mode: the owner lock is in the inputs, so the tokens may be created
    // out of nothing. This is the only way new supply ever appears.
    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: holderLock,
          type,
          capacity: ccc.fixedPointFrom(TOKEN_CELL_CKB),
        },
      ],
      outputsData: [amountData(ISSUED)],
      cellDeps: [XUDT_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(owner);
    await tx.completeFeeBy(owner, 1000);

    issueTx = await client.sendTransaction(await owner.signTransaction(tx));
    const committed = await client.waitTransaction(issueTx, 0, 120_000);
    expect(committed?.status).toBe("committed");
    console.log(`issued ${ISSUED} tokens in ${issueTx}`);
  });

  it("writes the amount as a little endian u128 in the cell data", async () => {
    const cell = await client.getCellLive({ txHash: issueTx, index: 0 }, true);

    expect(cell).toBeDefined();
    expect(amountOf(cell!.outputData)).toBe(ISSUED);
    expect(cell!.outputData).toBe(amountData(ISSUED));
    expect(cell!.cellOutput.capacity).toBe(ccc.fixedPointFrom(TOKEN_CELL_CKB));
  });

  it("carries the owner's lock hash in the type script args", async () => {
    const cell = await client.getCellLive({ txHash: issueTx, index: 0 }, true);

    expect(cell!.cellOutput.type?.codeHash).toBe(XUDT.codeHash);
    expect(cell!.cellOutput.type?.args).toBe(ownerLock.hash());
    // The tokens sit under someone else's lock. Ownership of the cell and
    // authority over the supply are two different things.
    expect(cell!.cellOutput.lock.hash()).toBe(holderLock.hash());
  });

  it("lets the holder move tokens without the owner", async () => {
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: issueTx, index: 0 } }],
      outputs: [
        { lock: ownerLock, type, capacity: ccc.fixedPointFrom(TOKEN_CELL_CKB) },
        {
          lock: holderLock,
          type,
          capacity: ccc.fixedPointFrom(TOKEN_CELL_CKB),
        },
      ],
      outputsData: [amountData(250_000n), amountData(750_000n)],
      cellDeps: [XUDT_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(holder);
    await tx.completeFeeBy(holder, 1000);

    splitTx = await client.sendTransaction(await holder.signTransaction(tx));
    const committed = await client.waitTransaction(splitTx, 0, 120_000);
    expect(committed?.status).toBe("committed");

    const a = await client.getCellLive({ txHash: splitTx, index: 0 }, true);
    const b = await client.getCellLive({ txHash: splitTx, index: 1 }, true);
    expect(amountOf(a!.outputData) + amountOf(b!.outputData)).toBe(ISSUED);
    console.log(
      `split ${ISSUED} into ${amountOf(a!.outputData)} + ${amountOf(b!.outputData)} in ${splitTx}`,
    );
  });

  it("refuses to let the holder mint one extra token", async () => {
    // Same cell as above, 750,000 in, 750,001 out, and no owner lock anywhere
    // in the inputs. This is the whole point of the standard.
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: splitTx, index: 1 } }],
      outputs: [
        {
          lock: holderLock,
          type,
          capacity: ccc.fixedPointFrom(TOKEN_CELL_CKB),
        },
      ],
      outputsData: [amountData(750_001n)],
      cellDeps: [XUDT_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(holder);
    await tx.completeFeeBy(holder, 1000);

    const error = await client
      .sendTransactionDry(await holder.signTransaction(tx))
      .catch((e) => e);
    console.log(
      `750,000 in / 750,001 out -> ${String(error.message ?? error)}`,
    );

    expect(String(error)).toContain("TransactionFailedToVerify");
    // Inputs, not Outputs. The type script is in both groups and the input
    // side is evaluated first, so that is where xUDT stops it.
    expect(String(error)).toContain("Inputs[0].Type");
    expect(String(error)).toContain(XUDT.codeHash.slice(2));
    // -52 is xUDT's own code, not a generic transaction error.
    expect(String(error)).toMatch(/error code -52\b/);
  });
});
