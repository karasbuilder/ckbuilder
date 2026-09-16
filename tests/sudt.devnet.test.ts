import { ccc } from "@ckb-ccc/core";
import systemScripts from "../deployment/system-scripts.json";
import { buildClient, buildSigner } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
//
// Week 3 issued an xUDT without reading RFC 0025 first. This file is that
// reading, done against the chain instead of against the prose: issue the same
// token under sUDT, then find the one place the two standards actually part
// company.
const client = buildClient("devnet");
const owner = buildSigner(client, "PRIVATE_KEY");
const holder = buildSigner(client, "PRIVATE_KEY_2");

const SUDT = systemScripts.devnet.sudt!.script;
const XUDT = systemScripts.devnet.xudt!.script;
const SUDT_DEP = SUDT.cellDeps[0]!.cellDep;
const XUDT_DEP = XUDT.cellDeps[0]!.cellDep;

const ISSUED = 1_000_000n;
// 8 capacity + lock 53 + type 65 + 16 bytes of amount, the same as week 3
const TOKEN_CELL_CKB = 142;

const amountData = (n: bigint) => ccc.hexFrom(ccc.numLeToBytes(n, 16));
const amountOf = (data: string) =>
  ccc.numLeFromBytes(ccc.bytesFrom(data).slice(0, 16));

const udtType = (script: typeof SUDT, ownerLockHash: string) =>
  ccc.Script.from({
    codeHash: script.codeHash,
    hashType: script.hashType as ccc.HashType,
    args: ownerLockHash,
  });

const errorCode = (e: unknown) => {
  const m = /error code (-?\d+)/.exec(String(e));
  return m ? Number(m[1]) : undefined;
};

jest.setTimeout(240_000);

describe("sUDT on devnet, read against the xUDT from week 3", () => {
  let ownerLock: ccc.Script;
  let holderLock: ccc.Script;
  let type: ccc.Script;
  let issueTx: string;

  // Owner mode, the rule both standards share: the owner lock is in the
  // inputs, so supply may appear out of nothing. Nothing else can create it.
  const issue = async (data: string, script = SUDT, dep = SUDT_DEP) => {
    const capacity = 8 + 53 + 65 + (data.length - 2) / 2;
    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: holderLock,
          type: udtType(script, ownerLock.hash()),
          capacity: ccc.fixedPointFrom(capacity),
        },
      ],
      outputsData: [data],
      cellDeps: [dep],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(owner);
    await tx.completeFeeBy(owner, 1000);
    return owner.signTransaction(tx);
  };

  beforeAll(async () => {
    ownerLock = (await owner.getRecommendedAddressObj()).script;
    holderLock = (await holder.getRecommendedAddressObj()).script;
    type = udtType(SUDT, ownerLock.hash());

    issueTx = await client.sendTransaction(await issue(amountData(ISSUED)));
    expect((await client.waitTransaction(issueTx, 0, 120_000))?.status).toBe(
      "committed",
    );
    console.log(`issued ${ISSUED} sUDT in ${issueTx}`);
  });

  it("writes the amount exactly the way xUDT does, byte for byte", async () => {
    const cell = await client.getCellLive({ txHash: issueTx, index: 0 }, true);

    expect(amountOf(cell!.outputData)).toBe(ISSUED);
    // RFC 0025 rule 1: a little endian u128 in the first 16 bytes. RFC 0052
    // keeps that layout unchanged, which is why the week-3 xUDT read back the
    // same way as this sUDT does.
    expect(cell!.outputData).toBe(amountData(ISSUED));
    expect((cell!.outputData.length - 2) / 2).toBe(16);
    expect(cell!.cellOutput.capacity).toBe(ccc.fixedPointFrom(TOKEN_CELL_CKB));
  });

  it("holds the owner lock hash in its args, the same rule 2", async () => {
    const cell = await client.getCellLive({ txHash: issueTx, index: 0 }, true);

    expect(cell!.cellOutput.type!.codeHash).toBe(SUDT.codeHash);
    expect(cell!.cellOutput.type!.args).toBe(ownerLock.hash());
    expect((cell!.cellOutput.type!.args.length - 2) / 2).toBe(32);
    // and, again, the tokens sit under a different lock than the one that
    // governs them
    expect(cell!.cellOutput.lock.hash()).toBe(holderLock.hash());
  });

  it("refuses to let the holder mint one extra token", async () => {
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: issueTx, index: 0 } }],
      outputs: [
        {
          lock: holderLock,
          type,
          capacity: ccc.fixedPointFrom(TOKEN_CELL_CKB),
        },
      ],
      outputsData: [amountData(ISSUED + 1n)],
      cellDeps: [SUDT_DEP],
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
      `sUDT, 1,000,000 in / 1,000,001 out -> error code ${errorCode(error)}`,
    );

    expect(String(error)).toContain("Inputs[0].Type");
    expect(errorCode(error)).toBe(-52); // same code xUDT gave in week 3
  });

  // Where the two standards part company. For sUDT everything past byte 16 is
  // spare room. For xUDT the next four bytes are flags, and flag 1 means "an
  // extension script list follows". Here nothing follows, so the structure is
  // a lie, and the question is who notices.
  const FLAG_EXTENSION = "0x01000000";
  const withFlags = amountData(ISSUED) + FLAG_EXTENSION.slice(2);
  let sudtFlagged: string;
  let xudtFlagged: string;

  const transferBy = async (
    txHash: string,
    data: string,
    script: typeof SUDT,
    dep: typeof SUDT_DEP,
  ) => {
    const capacity = 8 + 53 + 65 + (data.length - 2) / 2;
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash, index: 0 } }],
      outputs: [
        {
          lock: holderLock,
          type: udtType(script, ownerLock.hash()),
          capacity: ccc.fixedPointFrom(capacity),
        },
      ],
      outputsData: [data],
      cellDeps: [dep],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(holder);
    await tx.completeFeeBy(holder, 1000);
    return holder.signTransaction(tx);
  };

  it("both standards mint a cell whose extension field is nonsense", async () => {
    sudtFlagged = await client.sendTransaction(await issue(withFlags));
    xudtFlagged = await client.sendTransaction(
      await issue(withFlags, XUDT, XUDT_DEP),
    );
    await client.waitTransaction(sudtFlagged, 0, 120_000);
    expect(
      (await client.waitTransaction(xudtFlagged, 0, 120_000))?.status,
    ).toBe("committed");

    console.log(`minted 20-byte cells: sUDT ok, xUDT ok (owner mode both)`);
    expect((withFlags.length - 2) / 2).toBe(20);
  });

  it("the sUDT cell still moves without the owner, the trailer is ignored", async () => {
    const cycles = await client.sendTransactionDry(
      await transferBy(sudtFlagged, withFlags, SUDT, SUDT_DEP),
    );

    console.log(`sUDT transfer with trailing bytes accepted, ${cycles} cycles`);
    expect(cycles).toBeGreaterThan(0n);
  });

  it("so does the xUDT cell, because the flags are not in the data at all", async () => {
    const cycles = await client.sendTransactionDry(
      await transferBy(xudtFlagged, withFlags, XUDT, XUDT_DEP),
    );

    console.log(`xUDT transfer with the same bytes accepted, ${cycles} cycles`);
    expect(cycles).toBeGreaterThan(0n);
    // I expected this to fail. It does not, and that is the correction: RFC
    // 0052 puts the flags in the type script *args*, after the owner lock
    // hash, not in the cell data after the amount. The data past byte 16 is
    // free space under both standards.
  });

  // The extension really does live in the args, and the proof is that adding
  // it produces a different token: the type script hash changes, so cells
  // under the plain args and cells under the extended args are not fungible
  // with each other even though the code hash is the same.
  const xudtWithArgs = (suffix: string) =>
    ccc.Script.from({
      codeHash: XUDT.codeHash,
      hashType: XUDT.hashType as ccc.HashType,
      args: ownerLock.hash() + suffix,
    });

  it("flags in the args change the token identity, not the amount layout", async () => {
    const plain = xudtWithArgs("");
    const noExtension = xudtWithArgs("00000000");

    expect((plain.args.length - 2) / 2).toBe(32);
    expect((noExtension.args.length - 2) / 2).toBe(36);
    expect(noExtension.hash()).not.toBe(plain.hash());
    // sUDT has nowhere to put this: rule 2 defines the args as the owner lock
    // hash and stops. That is the whole of the difference.
    expect(udtType(SUDT, ownerLock.hash()).args).toBe(ownerLock.hash());
  });

  it("names an extension script that is not in the deps, and is refused", async () => {
    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: holderLock,
          // flags 1: an extension script hash list follows in the args
          type: xudtWithArgs("01000000" + "ab".repeat(32)),
          capacity: ccc.fixedPointFrom(8 + 53 + 32 + 1 + 68 + 16),
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

    const error = await client
      .sendTransactionDry(await owner.signTransaction(tx))
      .catch((e) => e);

    console.log(`xUDT naming a missing extension -> code ${errorCode(error)}`);
    expect(String(error)).toContain("Outputs[0].Type");
    expect(errorCode(error)).toBe(47); // xUDT's own code for a missing extension
  });
});
