import { ccc } from "@ckb-ccc/core";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

// What CCC's two complete* calls do to a transaction, watched one stage at a
// time against the live testnet account. Every transaction here is built and
// then dropped. Nothing is sent, so it is safe inside `npm test`.
const client = new ccc.ClientPublicTestnet({
  url: process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc",
});

// Cells the account has held since weeks 1 and 3. All three are live and
// none of them should ever be picked to pay for anything.
const OCCUPIED = [
  // week 1: the hello-world code cell, 1305 bytes of data
  "0x2e22607da17179db3071a74614a6aed82ef34715b046c30c7601e857f410a856",
  // week 1: the cell the ckb-js-vm type script runs on
  "0x46231d44f16b86c8db4ba2396ed358f7c79023a7639a1b82e164e4b7284adb77",
  // week 3: the 44-byte store-data cell
  "0xa98bd3a106151bfa7288af61745a7dc91c13cea8b5a64cdd0c8d0d8f7c652507",
];

const signer = () => {
  const key = process.env.TESTNET_PRIVATE_KEY;
  if (!key) throw new Error("TESTNET_PRIVATE_KEY is not set");
  return new ccc.SignerCkbPrivateKey(client, key);
};

const isPlain = (cell: ccc.Cell) =>
  !cell.cellOutput.type && ccc.bytesFrom(cell.outputData).length === 0;

jest.setTimeout(60_000);

const describeWithKey = process.env.TESTNET_PRIVATE_KEY
  ? describe
  : describe.skip;

describeWithKey("completing a transaction on testnet, never sending it", () => {
  it("reports as balance only the cells with no type and no data", async () => {
    const s = signer();
    const { script } = await s.getRecommendedAddressObj();

    const all: ccc.Cell[] = [];
    for await (const cell of client.findCellsByLock(script, undefined, true)) {
      all.push(cell);
    }
    const sum = (cells: ccc.Cell[]) =>
      cells.reduce((acc, c) => acc + c.cellOutput.capacity, 0n);
    const occupied = all.filter((c) => !isPlain(c));

    expect(occupied.map((c) => c.outPoint.txHash).sort()).toEqual(
      [...OCCUPIED].sort(),
    );
    expect(await s.getBalance()).toBe(sum(all.filter(isPlain)));
    expect(sum(occupied)).toBe(ccc.fixedPointFrom(1366 + 161 + 105));
  });

  it("completeInputsByCapacity adds plain cells until the outputs are covered, and nothing else", async () => {
    const s = signer();
    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: (await s.getRecommendedAddressObj()).script,
          capacity: ccc.fixedPointFrom(100),
        },
      ],
    });
    expect(tx.inputs.length).toBe(0);
    const added = await tx.completeInputsByCapacity(s);

    expect(added).toBeGreaterThan(0);
    expect(tx.inputs.length).toBe(added);
    expect(tx.outputs.length).toBe(1);
    for (const input of tx.inputs) {
      expect(OCCUPIED).not.toContain(input.previousOutput.txHash);
      expect(input.cellOutput?.type).toBeUndefined();
      expect(input.outputData).toBe("0x");
    }
    expect(await tx.getInputsCapacity(client)).toBeGreaterThanOrEqual(
      tx.getOutputsCapacity(),
    );
  });

  it("completeFeeBy adds one change output to my own lock and a 65-byte placeholder to sign into", async () => {
    const s = signer();
    const { script } = await s.getRecommendedAddressObj();
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script, capacity: ccc.fixedPointFrom(100) }],
    });
    await tx.completeInputsByCapacity(s);
    await tx.completeFeeBy(s, 1000);

    expect(tx.outputs.length).toBe(2);
    expect(tx.outputs[1]!.lock.eq(script)).toBe(true);

    const lock = ccc.bytesFrom(
      ccc.WitnessArgs.fromBytes(tx.witnesses[0]!).lock!,
    );
    expect(lock.length).toBe(65);
    expect(lock.every((b) => b === 0)).toBe(true);
  });

  it("leaves inputs minus outputs equal to the size in bytes, at 1000 shannons per KB", async () => {
    const s = signer();
    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: (await s.getRecommendedAddressObj()).script,
          capacity: ccc.fixedPointFrom(100),
        },
      ],
    });
    await tx.completeInputsByCapacity(s);
    await tx.completeFeeBy(s, 1000);

    const fee = (await tx.getInputsCapacity(client)) - tx.getOutputsCapacity();
    const size = tx.toBytes().length + 4;
    expect(fee).toBe(BigInt(size));
    expect(await tx.getFeeRate(client)).toBe(1000n);
    console.log(
      `completed ${tx.inputs.length} in / ${tx.outputs.length} out, ${size} bytes, fee ${fee} shannons`,
    );
  });
});
