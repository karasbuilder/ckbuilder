import { ccc } from "@ckb-ccc/core";

// The Transfer CKB tutorial run on public testnet, checked after the fact.
// No keys and nothing sent, so this is safe to run in `npm test`.
// https://testnet.explorer.nervos.org/transaction/0xcd39b8fe...
const TRANSFER_TX =
  "0xcd39b8fec8474e6f518cf316307b37c5cdd1d59e7badd2194e1fdb6be61de580";
const BLOCK = 22229375n;

const FROM =
  "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfwcrwfzsp54v5z9pwgtjnrl553as8ke0cu93dj9";
const TO =
  "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt435c3epyrupszm7khk6weq5lrlyt52lg48ucew";

const AMOUNT = ccc.fixedPointFrom(100);
const FEE = 464n; // shannons, at a 1000 fee rate

const client = new ccc.ClientPublicTestnet({
  url: process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc",
});

jest.setTimeout(60_000);

describe("transferring CKB on public testnet", () => {
  it("is committed in the block it claims", async () => {
    const tx = await client.getTransaction(TRANSFER_TX);
    expect(tx?.status).toBe("committed");
    expect(tx?.blockNumber).toBe(BLOCK);
  });

  it("spent one cell and produced two: the recipient's and the sender's change", async () => {
    const { transaction } = (await client.getTransaction(TRANSFER_TX))!;
    const fromLock = (await ccc.Address.fromString(FROM, client)).script;
    const toLock = (await ccc.Address.fromString(TO, client)).script;

    expect(transaction.inputs.length).toBe(1);
    expect(transaction.outputs.length).toBe(2);

    expect(transaction.outputs[0]!.capacity).toBe(AMOUNT);
    expect(transaction.outputs[0]!.lock.hash()).toBe(toLock.hash());
    expect(transaction.outputs[1]!.lock.hash()).toBe(fromLock.hash());
    expect(transaction.outputs[1]!.capacity).toBeGreaterThan(AMOUNT);
  });

  it("paid a fee equal to input capacity minus output capacity", async () => {
    const { transaction } = (await client.getTransaction(TRANSFER_TX))!;

    const inputsCapacity = await transaction.getInputsCapacity(client);
    const outputsCapacity = transaction.getOutputsCapacity();

    expect(inputsCapacity - outputsCapacity).toBe(FEE);
  });

  it("consumed its input, the cell is dead not updated", async () => {
    const { transaction } = (await client.getTransaction(TRANSFER_TX))!;
    const outPoint = transaction.inputs[0]!.previousOutput;

    await expect(client.getCell(outPoint)).resolves.toBeDefined();
    await expect(client.getCellLive(outPoint, false)).resolves.toBeUndefined();
  });

  it("left the recipient's cell live at exactly 100 CKB", async () => {
    const cell = await client.getCellLive(
      { txHash: TRANSFER_TX, index: 0 },
      true,
    );

    expect(cell).toBeDefined();
    expect(cell!.cellOutput.capacity).toBe(AMOUNT);
    expect(cell!.outputData).toBe("0x");
  });
});
