import { ccc } from "@ckb-ccc/core";
import systemScripts from "../deployment/system-scripts.json";

// An xUDT issued on public testnet, checked after the fact. Nothing is sent
// here, so it is safe inside `npm test`.
// https://testnet.explorer.nervos.org/transaction/0xa888fea5...
const ISSUE_TX =
  "0xa888fea50b05b3cbb66721c7b1f4c97df133bf2ec3004afdb8330aec04d48560";
const BLOCK = 22307628n;

const OWNER_LOCK_HASH =
  "0xa80efd2b393ec77611926f9279adc7a377f52f0a49a38a4908fa78b0165fff8e";
const HOLDER_LOCK_HASH =
  "0xfefd847ee86aa34c9fe65452e233e8d389258ddf5ac7d9dbfd1b6f86007c35f0";

const ISSUED = 1_000_000n;
const CAPACITY = ccc.fixedPointFrom(142);

const XUDT = systemScripts.testnet.xudt!.script;

const client = new ccc.ClientPublicTestnet({
  url: process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc",
});

const amountOf = (data: string) =>
  ccc.numLeFromBytes(ccc.bytesFrom(data).slice(0, 16));

jest.setTimeout(60_000);

describe("an xUDT issued on public testnet", () => {
  it("is committed in the block it claims", async () => {
    const tx = await client.getTransaction(ISSUE_TX);
    expect(tx?.status).toBe("committed");
    expect(tx?.blockNumber).toBe(BLOCK);
  });

  it("holds 1,000,000 as a little endian u128", async () => {
    const { transaction } = (await client.getTransaction(ISSUE_TX))!;

    expect(amountOf(transaction.outputsData[0]!)).toBe(ISSUED);
    expect(transaction.outputs[0]!.capacity).toBe(CAPACITY);
  });

  it("names the owner in the type args and someone else in the lock", async () => {
    const cell = await client.getCellLive({ txHash: ISSUE_TX, index: 0 }, true);

    expect(cell?.cellOutput.type?.codeHash).toBe(XUDT.codeHash);
    expect(cell?.cellOutput.type?.args).toBe(OWNER_LOCK_HASH);
    // Whoever can unlock the cell is not who controls the supply.
    expect(cell?.cellOutput.lock.hash()).toBe(HOLDER_LOCK_HASH);
    expect(OWNER_LOCK_HASH).not.toBe(HOLDER_LOCK_HASH);
  });

  it("is still live and still holds the full supply", async () => {
    const cell = await client.getCellLive({ txHash: ISSUE_TX, index: 0 }, true);

    expect(cell).toBeDefined();
    expect(amountOf(cell!.outputData)).toBe(ISSUED);
  });
});
