import { readFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/core";
import scripts from "../deployment/scripts.json";
import v1 from "../deployment/devnet/hash-lock.bc/migrations/2026-09-09-194133.json";
import v2 from "../deployment/devnet/hash-lock.bc/migrations/2026-09-09-194500.json";
import { buildClient } from "./helper";

// Needs a running node:
//offckb node
//npm run test:devnet
//
// recorded history like devnet.test.ts. the chain persists unless offckb clean.
const client = buildClient("devnet");

const HASH_LOCK = scripts.devnet["hash-lock.bc"];
const V1 = v1.cell_recipes[0]!;
const V2 = v2.cell_recipes[0]!;

// deposited under v1, unlocked after the upgrade. lock args never touched.
const PRE_UPGRADE_DEPOSIT =
  "0x4d3ca8c33cbdbf9c6910f07177fddc41ca6135be83aeae3ef2892735a5127c0a";
const POST_UPGRADE_UNLOCK =
  "0xd5dda05c8e08d6892beb487e0ed928f094f3cfe151535f9b0a590fbddfffadf4";

jest.setTimeout(60_000);

describe("upgrading hash-lock through its Type ID", () => {
  it("the upgrade consumed the old code cell and left one live", async () => {
    const [old_, current] = await Promise.all([
      client.getCellLive({ txHash: V1.tx_hash, index: 0 }, true),
      client.getCellLive({ txHash: V2.tx_hash, index: 0 }, true),
    ]);

    // update spends the old cell, unlike the hello-world redeploy
    expect(old_).toBeUndefined();
    expect(current).toBeDefined();
    expect(V1.tx_hash).not.toBe(V2.tx_hash);
  });

  it("the code changed and the identity did not", async () => {
    const current = await client.getCellLive(
      { txHash: V2.tx_hash, index: 0 },
      true,
    );

    expect(V1.data_hash).not.toBe(V2.data_hash);
    expect(V1.type_id).toBe(V2.type_id);
    expect(HASH_LOCK.codeHash).toBe(V2.type_id);
    expect(current!.cellOutput.type!.hash()).toBe(V2.type_id);
    expect(ccc.hashCkb(current!.outputData)).toBe(V2.data_hash);
  });

  it("the live code cell holds the v2 artifact built from source", async () => {
    const current = await client.getCellLive(
      { txHash: V2.tx_hash, index: 0 },
      true,
    );
    const bytecode = readFileSync("dist/hash-lock.bc");

    expect(
      Buffer.from(current!.outputData.slice(2), "hex").equals(bytecode),
    ).toBe(true);
  });

  it("a cell locked before the upgrade unlocked with the new code", async () => {
    const [unlock, deposit] = await Promise.all([
      client.getTransaction(POST_UPGRADE_UNLOCK),
      client.getTransaction(PRE_UPGRADE_DEPOSIT),
    ]);

    expect(deposit?.status).toBe("committed");
    expect(unlock?.status).toBe("committed");
    expect(deposit!.blockNumber).toBeLessThan(unlock!.blockNumber!);

    // deposit before v2, unlock after
    const upgrade = await client.getTransaction(V2.tx_hash);
    expect(deposit!.blockNumber).toBeLessThanOrEqual(upgrade!.blockNumber!);
    expect(unlock!.blockNumber).toBeGreaterThan(upgrade!.blockNumber!);

    const spent = unlock!.transaction.inputs.map((i) =>
      ccc.hexFrom(i.previousOutput.txHash),
    );
    expect(spent).toContain(PRE_UPGRADE_DEPOSIT);

    const deps = unlock!.transaction.cellDeps.map((d) =>
      ccc.hexFrom(d.outPoint.txHash),
    );
    expect(deps).toContain(V2.tx_hash);
    expect(deps).not.toContain(V1.tx_hash);
  });

  it("the lock args point at the Type ID, which is why nothing had to move", async () => {
    const deposit = await client.getTransaction(PRE_UPGRADE_DEPOSIT);
    const lockArgs = ccc.hexFrom(deposit!.transaction.outputs[0]!.lock.args);

    // code hash in the args is the Type ID, hash_type 01 = type
    expect(lockArgs.slice(6, 6 + 64)).toBe(HASH_LOCK.codeHash.slice(2));
    expect(
      ccc.hexFrom(ccc.hashTypeToBytes(HASH_LOCK.hashType as ccc.HashType)),
    ).toBe("0x01");
    expect(lockArgs.slice(70, 72)).toBe("01");
  });
});
