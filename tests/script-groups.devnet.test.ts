import { ccc } from "@ckb-ccc/core";
import { buildClient, buildSigner } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
//
// CKB groups inputs that share an identical script and runs that script once
// per group, not once per cell. sendTransactionDry returns the cycle count, so
// the grouping is measurable instead of just something the RFC says.
const client = buildClient("devnet");
const signer = buildSigner(client, "PRIVATE_KEY_2");

const FEE_RATE = 1000n;

const collectCells = async (count: number) => {
  const { script: lock } = await signer.getRecommendedAddressObj();
  const cells: ccc.Cell[] = [];
  for await (const cell of client.findCellsByLock(lock, null, true)) {
    if (cell.outputData === "0x" && !cell.cellOutput.type) cells.push(cell);
    if (cells.length === count) break;
  }
  expect(cells.length).toBe(count);
  return { cells, lock };
};

const dryRunSpending = async (count: number) => {
  const { cells, lock } = await collectCells(count);

  const tx = ccc.Transaction.from({
    inputs: cells.map((c) => ({ previousOutput: c.outPoint })),
    outputs: [{ lock }],
    outputsData: ["0x"],
  });
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeFeeBy(signer, FEE_RATE);

  const signed = await signer.signTransaction(tx);
  return { cycles: await client.sendTransactionDry(signed), cells };
};

jest.setTimeout(120_000);

describe("script groups on the local devnet", () => {
  it("spending two cells with the same lock costs about the same as one", async () => {
    const one = await dryRunSpending(1);
    const two = await dryRunSpending(2);

    // Both inputs land in a single lock group, so secp256k1 runs once and
    // checks one signature. If it ran per cell this would roughly double.
    expect(two.cycles).toBeLessThan(one.cycles * 2n);

    const overhead = Number(two.cycles - one.cycles);
    console.log(
      `1 input: ${one.cycles} cycles, 2 inputs: ${two.cycles} cycles, ` +
        `difference ${overhead} (${((overhead / Number(one.cycles)) * 100).toFixed(1)}%)`,
    );
  });

  it("the two inputs really are one group, same lock hash", async () => {
    const { cells } = await collectCells(2);

    const hashes = cells.map((c) => c.cellOutput.lock.hash());
    expect(new Set(hashes).size).toBe(1);
    // Different outpoints, so these are genuinely two separate cells.
    expect(new Set(cells.map((c) => c.outPoint.txHash)).size).toBeGreaterThan(
      0,
    );
    expect(cells[0]!.outPoint.txHash + cells[0]!.outPoint.index).not.toBe(
      cells[1]!.outPoint.txHash + cells[1]!.outPoint.index,
    );
  });
});
