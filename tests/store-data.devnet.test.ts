import { ccc } from "@ckb-ccc/core";
import { buildClient, buildSigner } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
const RPC = "http://127.0.0.1:28114";
const client = buildClient("devnet");
const signer = buildSigner(client, "PRIVATE_KEY");

const MESSAGE = "ckbuilder week 3, the data lives in the cell";
const DATA = ccc.hexFrom(new TextEncoder().encode(MESSAGE));
const DATA_BYTES = (DATA.length - 2) / 2;

// occupied = capacity(8) + lock code_hash(32) + hash_type(1) + args(20) + data
const MIN_CKB = 61 + DATA_BYTES;

const storeData = async (ckb: number) => {
  const { script: lock } = await signer.getRecommendedAddressObj();
  const tx = ccc.Transaction.from({
    outputs: [{ lock, capacity: ccc.fixedPointFrom(ckb) }],
    outputsData: [DATA],
  });
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);
  return signer.signTransaction(tx);
};

// raw JSON-RPC, not the SDK. The point of the exercise is to see the cell the
// way the node reports it.
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

jest.setTimeout(120_000);

describe("storing data on a cell, devnet", () => {
  let txHash: string;

  beforeAll(async () => {
    txHash = await client.sendTransaction(await storeData(MIN_CKB));
    const committed = await client.waitTransaction(txHash, 0, 60_000);
    expect(committed?.status).toBe("committed");
    console.log(
      `store-data ${txHash}, ${DATA_BYTES} bytes of data, ${MIN_CKB} CKB locked`,
    );
  });

  it("locks exactly 61 + data bytes worth of CKB", async () => {
    const cell = await client.getCellLive({ txHash, index: 0 }, true);

    expect(cell).toBeDefined();
    expect(cell!.cellOutput.capacity).toBe(ccc.fixedPointFrom(MIN_CKB));

    // occupiedSize covers the CellOutput struct only, so it stays 61 no matter
    // how much data you store. outputs_data is a separate parallel array and
    // its bytes have to be added by hand.
    expect(cell!.cellOutput.occupiedSize).toBe(61);
    expect(cell!.cellOutput.occupiedSize + DATA_BYTES).toBe(MIN_CKB);
  });

  it("gives the same bytes back over raw JSON-RPC", async () => {
    const result = await getLiveCell(txHash);

    expect(result.status).toBe("live");
    expect(result.cell.data.content).toBe(DATA);

    const decoded = new TextDecoder().decode(
      Buffer.from(result.cell.data.content.slice(2), "hex"),
    );
    expect(decoded).toBe(MESSAGE);
    console.log(`get_live_cell returned: "${decoded}"`);
  });

  it("rejects the same cell one CKB short", async () => {
    const error = await client
      .sendTransactionDry(await storeData(MIN_CKB - 1))
      .catch((e) => e);
    console.log(`${MIN_CKB - 1} CKB -> ${String(error.message ?? error)}`);

    expect(String(error)).toContain("InsufficientCellCapacity(Outputs[0])");
    expect(String(error)).toContain(
      `(0x${ccc.fixedPointFrom(MIN_CKB).toString(16)})`,
    );
  });
});
