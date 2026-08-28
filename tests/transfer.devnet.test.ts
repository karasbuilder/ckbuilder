import { ccc } from "@ckb-ccc/core";
import { buildClient, buildSigner } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
const client = buildClient("devnet");
const sender = buildSigner(client, "PRIVATE_KEY");
const recipient = buildSigner(client, "PRIVATE_KEY_2");

// Keep this a number. fixedPointFrom(100n) is 100n, fixedPointFrom(100) is 1e10.
const AMOUNT_CKB = 100;
const FEE_RATE = 1000n;

jest.setTimeout(120_000);

describe("transferring CKB on the local devnet", () => {
  it("consumes cells and produces a recipient cell plus change", async () => {
    const { script: toLock } = await recipient.getRecommendedAddressObj();
    const { script: fromLock } = await sender.getRecommendedAddressObj();

    const tx = ccc.Transaction.from({
      outputs: [{ lock: toLock, capacity: ccc.fixedPointFrom(AMOUNT_CKB) }],
      outputsData: ["0x"],
    });

    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(sender);
    await tx.completeFeeBy(sender, FEE_RATE);

    // The picked cells never sum to the exact amount, so there is always change.
    expect(tx.outputs.length).toBe(2);
    expect(tx.outputs[1]!.lock.hash()).toBe(fromLock.hash());
    expect(tx.outputs[0]!.capacity).toBe(ccc.fixedPointFrom(AMOUNT_CKB));

    const signed = await sender.signTransaction(tx);
    const txHash = await client.sendTransaction(signed);
    const committed = await client.waitTransaction(txHash, 0, 60_000);
    expect(committed?.status).toBe("committed");

    const inputsCapacity = await signed.getInputsCapacity(client);
    const outputsCapacity = signed.getOutputsCapacity();
    const fee = inputsCapacity - outputsCapacity;
    expect(fee).toBeGreaterThan(0n);
    expect(outputsCapacity).toBeLessThan(inputsCapacity);

    for (const input of signed.inputs) {
      await expect(
        client.getCellLive(input.previousOutput, false),
      ).resolves.toBeUndefined();
    }

    for (const index of [0, 1]) {
      await expect(
        client.getCellLive({ txHash, index }, false),
      ).resolves.toBeDefined();
    }

    console.log(
      `transfer ${txHash} in ${ccc.fixedPointToString(inputsCapacity)} CKB ` +
        `(${signed.inputs.length} cell(s)), out ` +
        `${ccc.fixedPointToString(signed.outputs[0]!.capacity)} + ` +
        `${ccc.fixedPointToString(signed.outputs[1]!.capacity)} CKB, ` +
        `fee ${ccc.fixedPointToString(fee)} CKB`,
    );
  });

  // Dry run instead of send, otherwise running the suite twice in a row builds
  // the same transaction and the node rejects it as a duplicate.
  const dryRunWithCapacity = async (ckb: number) => {
    const { script: toLock } = await recipient.getRecommendedAddressObj();

    const tx = ccc.Transaction.from({
      outputs: [{ lock: toLock, capacity: ccc.fixedPointFrom(ckb) }],
      outputsData: ["0x"],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(sender);
    await tx.completeFeeBy(sender, FEE_RATE);

    const signed = await sender.signTransaction(tx);
    return client.sendTransactionDry(signed).catch((e) => e);
  };

  // 8 (capacity) + 32 (code hash) + 20 (args) + 1 (hash type) = 61 bytes, and a
  // cell can't hold less capacity than the bytes it occupies.
  it("rejects a 60 CKB cell, below the 61 byte floor", async () => {
    const error = await dryRunWithCapacity(60);
    console.log(`60 CKB -> REJECTED ${String(error.message ?? error)}`);

    expect(String(error)).toContain("InsufficientCellCapacity(Outputs[0])");
    expect(String(error)).toContain(
      `(0x${ccc.fixedPointFrom(61).toString(16)})`,
    );
  });

  it("accepts a 61 CKB cell, exactly at the floor", async () => {
    const cycles = await dryRunWithCapacity(61);
    console.log(`61 CKB -> ACCEPTED, verified in ${cycles} cycles`);

    expect(cycles).not.toBeInstanceOf(Error);
    expect(typeof cycles).toBe("bigint");
  });
});
