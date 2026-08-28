import { readFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/core";

// https://testnet.explorer.nervos.org
const DEPLOY_TX =
  "0x2e22607da17179db3071a74614a6aed82ef34715b046c30c7601e857f410a856";
const EXEC_TX =
  "0x46231d44f16b86c8db4ba2396ed358f7c79023a7639a1b82e164e4b7284adb77";
const ADDR =
  "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfwcrwfzsp54v5z9pwgtjnrl553as8ke0cu93dj9";

const client = new ccc.ClientPublicTestnet({
  url: process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc",
});

jest.setTimeout(60_000);

describe("hello-world on public testnet", () => {
  const bytecode = readFileSync("dist/hello-world.bc");

  it("deploy transaction is committed", async () => {
    const tx = await client.getTransaction(DEPLOY_TX);
    expect(tx?.status).toBe("committed");
    expect(tx?.blockNumber).toBe(22145099n);
  });

  it("code cell is still live and holds the local artifact byte for byte", async () => {
    const cell = await client.getCellLive(
      { txHash: DEPLOY_TX, index: 0 },
      true,
    );
    expect(cell).toBeDefined();
    expect(cell!.cellOutput.capacity).toBe(ccc.fixedPointFrom(1366));

    const onChain = Buffer.from(cell!.outputData.slice(2), "hex");
    expect(onChain.length).toBe(bytecode.length);
    expect(onChain.equals(bytecode)).toBe(true);
  });

  it("execution transaction is committed and runs the contract", async () => {
    const tx = await client.getTransaction(EXEC_TX);
    expect(tx?.status).toBe("committed");
    expect(tx?.blockNumber).toBe(22145113n);

    const deps = tx!.transaction.cellDeps.map((d) =>
      d.outPoint.txHash.toLowerCase(),
    );
    expect(deps).toContain(DEPLOY_TX);

    const typed = tx!.transaction.outputs.find((o) => o.type);
    expect(typed).toBeDefined();
    expect(typed!.type!.args.toLowerCase()).toContain(
      ccc.hashCkb(bytecode).slice(2).toLowerCase(),
    );
  });

  it("shows up in a CCC live-cell query on the deploying address", async () => {
    const { script: lock } = await ccc.Address.fromString(ADDR, client);
    const cells = [];
    for await (const cell of client.findCellsByLock(lock, null, true)) {
      cells.push(cell);
    }

    const codeCell = cells.find(
      (c) => c.outPoint.txHash.toLowerCase() === DEPLOY_TX,
    );
    expect(codeCell).toBeDefined();
    expect(Buffer.from(codeCell!.outputData.slice(2), "hex").length).toBe(
      bytecode.length,
    );

    const executed = cells.find(
      (c) => c.outPoint.txHash.toLowerCase() === EXEC_TX && c.cellOutput.type,
    );
    expect(executed).toBeDefined();
  });

  it("the same artifact is one script identity on both chains", async () => {
    // hash_type data2 means code_hash == blake2b-256(bytecode
    // the same bytes to devnet and testnet yields two out points but one
    const cell = await client.getCellLive(
      { txHash: DEPLOY_TX, index: 0 },
      true,
    );
    const onChainHash = ccc.hashCkb(cell!.outputData);
    expect(onChainHash.toLowerCase()).toBe(ccc.hashCkb(bytecode).toLowerCase());
  });
});
