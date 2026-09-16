import { ccc } from "@ckb-ccc/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClient, buildSigner } from "./helper";
import { addressOf, cobuildWitness } from "./spore-cobuild";
import {
  DOB_CONTENT_TYPE,
  DOB_IMAGE,
  SPORE,
  SPORE_DEP,
  packSpore,
  sporeType,
  unpackSpore,
} from "./spore-helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
//
// The round trip that is the whole point of Spore: mint a cell that holds an
// image, read the image back out of the chain, then melt the cell and watch the
// capacity come home. Minting is a deposit, not a payment.
const client = buildClient("devnet");
const signer = buildSigner(client, "PRIVATE_KEY");

const FEE_RATE = 1000;
const RENDERED = resolve(process.cwd(), "dist/dob-from-chain.png");

const sporeData = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE);
// 8 capacity + lock 53 + type 65 + the SporeData table itself
const OCCUPIED = 8 + 53 + 65 + (sporeData.length - 2) / 2;

const errorCode = (e: unknown) => {
  const m = /error code (-?\d+)/.exec(String(e));
  return m ? Number(m[1]) : undefined;
};

// The node prints the whole error-code URL and that URL is a 404 (week 4 note),
// so the log keeps the two parts that matter: which script said no, and why.
const why = (e: unknown) => {
  const s = String((e as Error)?.message ?? e);
  const source = /source: ([^,]+)/.exec(s)?.[1];
  return source
    ? `${source} rejected it, error code ${errorCode(e)}`
    : s.replace(/ on page \S+/, "");
};

jest.setTimeout(300_000);

describe("minting, reading and melting a DOB on devnet", () => {
  let myLock: ccc.Script;
  let sporeId: string;
  let mintTx: string;
  let meltTx: string;
  let before: bigint;
  let afterMint: bigint;
  let afterMelt: bigint;

  // Building a mint is three steps that depend on each other: the id comes from
  // the first input, the CoBuild action quotes the id and the data hash, and the
  // fee has to cover the witness that carries the action. Every rejection case
  // below is this same builder with one field bent.
  const buildMint = async (bend?: {
    sporeId?: (real: string) => string;
    dataHash?: (real: string) => string;
    noCobuild?: boolean;
  }) => {
    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: myLock,
          // placeholder args: the id needs the inputs, but its length does not,
          // so the capacity is already known
          type: sporeType(`0x${"00".repeat(32)}`),
          capacity: ccc.fixedPointFrom(OCCUPIED),
        },
      ],
      outputsData: [sporeData],
      cellDeps: [SPORE_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(signer);

    // Same rule as Type ID in week 4, under a different script.
    const realId = ccc.hashTypeId(tx.inputs[0]!, 0);
    const id = bend?.sporeId ? bend.sporeId(realId) : realId;
    tx.outputs[0]!.type = sporeType(id);

    if (!bend?.noCobuild) {
      const realHash = ccc.hashCkb(sporeData);
      // park the witness past the inputs so nothing overwrites it
      while (tx.witnesses.length < tx.inputs.length) tx.witnesses.push("0x");
      tx.witnesses.push(
        cobuildWitness(tx.outputs[0]!.type!.hash(), {
          type: "MintSpore",
          value: {
            sporeId: id,
            to: addressOf(myLock),
            dataHash: bend?.dataHash ? bend.dataHash(realHash) : realHash,
          },
        }),
      );
    }

    await tx.completeFeeBy(signer, FEE_RATE);
    expect(ccc.hashTypeId(tx.inputs[0]!, 0)).toBe(realId);
    return { tx: await signer.signTransaction(tx), id: id as string };
  };

  beforeAll(async () => {
    myLock = (await signer.getRecommendedAddressObj()).script;
    before = await signer.getBalance();

    const { tx, id } = await buildMint();
    sporeId = id;
    mintTx = await client.sendTransaction(tx);
    expect((await client.waitTransaction(mintTx, 0, 180_000))?.status).toBe(
      "committed",
    );

    afterMint = await signer.getBalance();
    console.log(
      `minted spore ${sporeId}\n  tx      ${mintTx}\n  content ${DOB_IMAGE.length} bytes of ${DOB_CONTENT_TYPE}\n  cell    ${OCCUPIED} CKB occupied`,
    );
  });

  const liveSpore = () =>
    client.getCellLive({ txHash: mintTx, index: 0 }, true);

  it("the spore id follows the Type ID rule, computed off the first input", async () => {
    const minted = await client.getTransaction(mintTx);
    const cell = await liveSpore();

    expect(cell).toBeDefined();
    expect(cell!.cellOutput.type!.codeHash).toBe(SPORE.codeHash);
    expect(cell!.cellOutput.type!.args).toBe(sporeId);
    expect(cell!.cellOutput.type!.args).toBe(
      ccc.hashTypeId(minted!.transaction.inputs[0]!, 0),
    );
    expect((sporeId.length - 2) / 2).toBe(32);
  });

  it("exactly one live cell carries that spore id", async () => {
    const found: string[] = [];
    for await (const c of client.findCells({
      script: sporeType(sporeId),
      scriptType: "type",
      scriptSearchMode: "exact",
    })) {
      found.push(`${c.outPoint.txHash}:${c.outPoint.index}`);
    }

    expect(found).toEqual([`${mintTx}:0`]);
  });

  it("the image is in the cell, not behind a link to it", async () => {
    const cell = await liveSpore();
    const data = unpackSpore(cell!.outputData);

    expect(data.contentType).toBe(DOB_CONTENT_TYPE);
    expect(data.clusterId).toBeUndefined();
    expect(Buffer.from(data.content)).toEqual(Buffer.from(DOB_IMAGE));
    // no url, no hash of something elsewhere: the PNG magic number is on chain
    expect(cell!.outputData).toContain("89504e470d0a1a0a");
  });

  it("renders back to a real PNG file straight from chain data", async () => {
    const cell = await liveSpore();
    const { content, contentType } = unpackSpore(cell!.outputData);

    mkdirSync(resolve(process.cwd(), "dist"), { recursive: true });
    writeFileSync(RENDERED, content);
    console.log(`rendered ${contentType} to ${RENDERED}`);

    expect(ccc.hashCkb(content)).toBe(ccc.hashCkb(DOB_IMAGE));
    expect(content.length).toBe(DOB_IMAGE.length);
  });

  it("every CKB the cell holds is paying for bytes, none of it is slack", async () => {
    const cell = await liveSpore();
    const dataBytes = (cell!.outputData.length - 2) / 2;

    expect(cell!.cellOutput.occupiedSize + dataBytes).toBe(OCCUPIED);
    expect(cell!.cellOutput.capacity).toBe(ccc.fixedPointFrom(OCCUPIED));
    // 414 of the 573 bytes are the image itself. the file size is the price.
    expect(DOB_IMAGE.length / OCCUPIED).toBeGreaterThan(0.7);
  });

  it("the mint moved the cell capacity plus a fee out of my balance", () => {
    const spent = before - afterMint;
    const fee = spent - ccc.fixedPointFrom(OCCUPIED);

    console.log(
      `balance ${ccc.fixedPointToString(before)} -> ${ccc.fixedPointToString(afterMint)} CKB, fee ${ccc.fixedPointToString(fee)}`,
    );
    expect(spent).toBeGreaterThan(ccc.fixedPointFrom(OCCUPIED));
    expect(fee).toBeLessThan(ccc.fixedPointFrom(1));
  });

  // Same shape as the mint, one field at a time bent, so the only variable is
  // what the script objects to.
  const buildTransfer = async (
    data: string,
    bendActionId?: (real: string) => string,
  ) => {
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: mintTx, index: 0 } }],
      outputs: [
        {
          lock: myLock,
          type: sporeType(sporeId),
          capacity: ccc.fixedPointFrom(OCCUPIED),
        },
      ],
      outputsData: [data],
      cellDeps: [SPORE_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(signer);
    while (tx.witnesses.length < tx.inputs.length) tx.witnesses.push("0x");
    tx.witnesses.push(
      cobuildWitness(sporeType(sporeId).hash(), {
        type: "TransferSpore",
        value: {
          sporeId: bendActionId ? bendActionId(sporeId) : sporeId,
          from: addressOf(myLock),
          to: addressOf(myLock),
        },
      }),
    );
    await tx.completeFeeBy(signer, FEE_RATE);
    return signer.signTransaction(tx);
  };

  it("transferring the spore untouched is allowed", async () => {
    const cycles = await client.sendTransactionDry(
      await buildTransfer(sporeData),
    );

    expect(cycles).toBeGreaterThan(0n);
  });

  it("rejects an edit to the content with 61, which is what immutable means", async () => {
    const tampered = new Uint8Array(DOB_IMAGE);
    tampered[tampered.length - 1] ^= 0xff; // one byte, at the very end

    const error = await client
      .sendTransactionDry(
        await buildTransfer(packSpore(DOB_CONTENT_TYPE, tampered)),
      )
      .catch((e) => e);
    console.log(`edited content -> ${why(error)}`);

    expect(errorCode(error)).toBe(61); // ModifySporePermanentField
  });

  it("rejects relabelling the content type without touching the bytes", async () => {
    // image/gif, not image/jpeg: the same nine characters, so the cell data
    // stays 447 bytes and the capacity still balances. Otherwise the node
    // rejects it for capacity before the spore script ever runs, which is a
    // different failure wearing the same clothes.
    const error = await client
      .sendTransactionDry(
        await buildTransfer(packSpore("image/gif", DOB_IMAGE)),
      )
      .catch((e) => e);
    console.log(`relabelled type -> ${why(error)}`);

    expect(errorCode(error)).toBe(61);
  });

  it("rejects a valid transfer whose CoBuild action names another spore", async () => {
    const error = await client
      .sendTransactionDry(
        await buildTransfer(sporeData, (id) => `0x${"ff".repeat(32)}`),
      )
      .catch((e) => e);
    console.log(`lying action -> ${why(error)}`);

    expect(errorCode(error)).toBe(12); // SporeActionFieldMismatch
  });

  it("melts the spore and gives the locked capacity back", async () => {
    const tx = ccc.Transaction.from({
      // the spore cell is an input and no output carries its id, which is the
      // definition of a melt. no owner registry, the lock is the owner.
      inputs: [{ previousOutput: { txHash: mintTx, index: 0 } }],
      outputs: [{ lock: myLock, capacity: ccc.fixedPointFrom(OCCUPIED) }],
      outputsData: ["0x"],
      cellDeps: [SPORE_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    while (tx.witnesses.length < tx.inputs.length) tx.witnesses.push("0x");
    tx.witnesses.push(
      cobuildWitness(sporeType(sporeId).hash(), {
        type: "BurnSpore",
        value: { sporeId, from: addressOf(myLock) },
      }),
    );
    await tx.completeFeeBy(signer, FEE_RATE);

    meltTx = await client.sendTransaction(await signer.signTransaction(tx));
    expect((await client.waitTransaction(meltTx, 0, 180_000))?.status).toBe(
      "committed",
    );

    afterMelt = await signer.getBalance();
    await expect(liveSpore()).resolves.toBeUndefined();
    console.log(`melted in ${meltTx}`);
  });

  it("nothing carries the spore id any more", async () => {
    const found: string[] = [];
    for await (const c of client.findCells({
      script: sporeType(sporeId),
      scriptType: "type",
      scriptSearchMode: "exact",
    })) {
      found.push(`${c.outPoint.txHash}:${c.outPoint.index}`);
    }

    expect(found).toEqual([]);
  });

  it("the round trip cost fees only, so the mint was a deposit", () => {
    const net = before - afterMelt;

    console.table({
      "before mint": ccc.fixedPointToString(before),
      "after mint": ccc.fixedPointToString(afterMint),
      "after melt": ccc.fixedPointToString(afterMelt),
      "net cost": ccc.fixedPointToString(net),
    });

    expect(afterMelt).toBeGreaterThan(afterMint);
    // the whole 573 CKB came back. what is gone is two transaction fees.
    expect(net).toBeLessThan(ccc.fixedPointFrom(1));
    expect(net).toBeGreaterThan(0n);
  });

  describe("what a mint has to get right", () => {
    it("refuses to mint without a CoBuild action at all, with 8", async () => {
      const { tx } = await buildMint({ noCobuild: true });
      const error = await client.sendTransactionDry(tx).catch((e) => e);
      console.log(`no cobuild witness -> ${why(error)}`);

      expect(errorCode(error)).toBe(8); // InvliadCoBuildWitnessLayout
    });

    it("refuses a spore id that was not derived from the first input, with 63", async () => {
      const { tx } = await buildMint({ sporeId: () => `0x${"ab".repeat(32)}` });
      const error = await client.sendTransactionDry(tx).catch((e) => e);
      console.log(`forged spore id -> ${why(error)}`);

      expect(errorCode(error)).toBe(63); // InvalidSporeID
    });

    it("refuses an action whose data hash does not match the cell, with 12", async () => {
      const { tx } = await buildMint({
        dataHash: () => ccc.hashCkb("0xdeadbeef"),
      });
      const error = await client.sendTransactionDry(tx).catch((e) => e);
      console.log(`wrong data hash -> ${why(error)}`);

      expect(errorCode(error)).toBe(12); // SporeActionFieldMismatch
    });
  });
});
