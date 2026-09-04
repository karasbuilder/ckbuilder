import { ccc } from "@ckb-ccc/core";

// Store Data on Cell, run on public testnet and then checked after the fact.
// Nothing is sent here, so this is safe inside `npm test`.
// https://testnet.explorer.nervos.org/transaction/0xa98bd3a1...
const STORE_TX =
  "0xa98bd3a106151bfa7288af61745a7dc91c13cea8b5a64cdd0c8d0d8f7c652507";
const BLOCK = 22307186n;

const MESSAGE = "ckbuilder week 3, the data lives in the cell";
const DATA = ccc.hexFrom(new TextEncoder().encode(MESSAGE));
const DATA_BYTES = (DATA.length - 2) / 2;
const CAPACITY = ccc.fixedPointFrom(61 + DATA_BYTES);

const RPC = process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc";
const client = new ccc.ClientPublicTestnet({ url: RPC });

const getLiveCell = async (txHash: string, index = 0) => {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "get_live_cell",
      params: [{ tx_hash: txHash, index: `0x${index.toString(16)}` }, true],
    }),
  });
  return (await res.json()).result;
};

jest.setTimeout(60_000);

describe("storing data on a cell, public testnet", () => {
  it("is committed in the block it claims", async () => {
    const tx = await client.getTransaction(STORE_TX);
    expect(tx?.status).toBe("committed");
    expect(tx?.blockNumber).toBe(BLOCK);
  });

  it("put the message in outputs_data, not in the cell struct", async () => {
    const { transaction } = (await client.getTransaction(STORE_TX))!;

    expect(transaction.outputsData[0]).toBe(DATA);
    // The struct itself stays 61 bytes. Data is a separate parallel array.
    expect(transaction.outputs[0]!.occupiedSize).toBe(61);
    expect(transaction.outputs[0]!.capacity).toBe(CAPACITY);
  });

  it("reads back as the same string over raw JSON-RPC", async () => {
    const result = await getLiveCell(STORE_TX);

    expect(result.status).toBe("live");
    const decoded = new TextDecoder().decode(
      Buffer.from(result.cell.data.content.slice(2), "hex"),
    );
    expect(decoded).toBe(MESSAGE);
  });

  it("locked 61 CKB for the cell plus one CKB per data byte", async () => {
    const cell = await client.getCellLive({ txHash: STORE_TX, index: 0 }, true);

    expect(cell?.cellOutput.capacity).toBe(CAPACITY);
    expect(Number(cell!.cellOutput.capacity / 100_000_000n)).toBe(
      61 + DATA_BYTES,
    );
  });
});
