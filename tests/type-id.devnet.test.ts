import { ccc } from "@ckb-ccc/core";
import scripts from "../deployment/scripts.json";
import systemScripts from "../deployment/system-scripts.json";
import v1 from "../deployment/devnet/hash-lock.bc/migrations/2026-09-09-194133.json";
import v2 from "../deployment/devnet/hash-lock.bc/migrations/2026-09-09-194500.json";
import { buildClient } from "./helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
const client = buildClient("devnet");

const HASH_LOCK = scripts.devnet["hash-lock.bc"];
const TYPE_ID = systemScripts.devnet.type_id!.script;

// CREATION = tx that minted the Type ID, LIVE = cell holding it now.
// hello-world (week 1, no type id) is the control.
const CREATION = v1.cell_recipes[0]!.tx_hash;
const LIVE = v2.cell_recipes[0]!.tx_hash;
const HELLO_WORLD_DEPLOYS = [
  "0x717f98ebdc961a4a5daa2cdbff938c38a5e39f2260c73ba36f738c56916ae974",
  "0x8e8e3bbf5252b7741410e114446f68ffa2533cc387e28314b9e74dacc9faf140",
];

const liveCodeCell = () => client.getCellLive({ txHash: LIVE, index: 0 }, true);

jest.setTimeout(60_000);

describe("Type ID on devnet", () => {
  it("the hash-lock code cell carries the Type ID type script", async () => {
    const cell = await liveCodeCell();

    expect(cell).toBeDefined();
    expect(cell!.cellOutput.type).toBeDefined();
    expect(cell!.cellOutput.type!.codeHash).toBe(TYPE_ID.codeHash);
    expect(cell!.cellOutput.type!.hashType).toBe("type");
  });

  it("the script identity is the Type ID, not the hash of the bytecode", async () => {
    const cell = await liveCodeCell();

    // "code hash" here is the type script hash, not the bytecode hash
    expect(HASH_LOCK.hashType).toBe("type");
    expect(cell!.cellOutput.type!.hash()).toBe(HASH_LOCK.codeHash);
    expect(ccc.hashCkb(cell!.outputData)).not.toBe(HASH_LOCK.codeHash);
  });

  it("the args come from the first input of the transaction that created it", async () => {
    const creation = await client.getTransaction(CREATION);
    expect(creation?.status).toBe("committed");

    const cell = await liveCodeCell();

    // rule 3: args = hash(first input, output index). outpoint spends once
    expect(cell!.cellOutput.type!.args).toBe(
      ccc.hashTypeId(creation!.transaction.inputs[0]!, 0),
    );
  });

  it("the upgrade inherited those args instead of recomputing them", async () => {
    const update = await client.getTransaction(LIVE);
    const cell = await liveCodeCell();

    // rule 2: input already has the type script, so rule 3 never runs
    expect(ccc.hashTypeId(update!.transaction.inputs[0]!, 0)).not.toBe(
      cell!.cellOutput.type!.args,
    );
    expect(CREATION).not.toBe(LIVE);
  });

  it("exactly one live cell carries that Type ID", async () => {
    const cell = await liveCodeCell();
    const typeScript = ccc.Script.from({
      codeHash: TYPE_ID.codeHash,
      hashType: TYPE_ID.hashType,
      args: cell!.cellOutput.type!.args,
    });

    const found: string[] = [];
    for await (const c of client.findCells({
      script: typeScript,
      scriptType: "type",
      scriptSearchMode: "exact",
    })) {
      found.push(`${c.outPoint.txHash}:${c.outPoint.index}`);
    }

    // rule 1: one at a time, chain enforced
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(`${LIVE}:0`);
  });

  it("hello-world has no Type ID, which is why week 1 could not upgrade", async () => {
    const cells = await Promise.all(
      HELLO_WORLD_DEPLOYS.map((txHash) =>
        client.getCellLive({ txHash, index: 0 }, true),
      ),
    );

    expect(cells.every(Boolean)).toBe(true);
    // no type script, so the week-1 redeploy just made a second code cell
    expect(cells.map((c) => c!.cellOutput.type)).toEqual([undefined, undefined]);
    expect(scripts.devnet["hello-world.bc"].hashType).toBe("data2");
    expect(new Set(cells.map((c) => ccc.hashCkb(c!.outputData))).size).toBe(1);
  });
});
