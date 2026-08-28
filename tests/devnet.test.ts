import { readFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/core";
import { buildClient } from "./helper";

// Excluded from `npm test` because it needs a running node.
//   offckb node
//   npm run test:devnet
//
// The node serves :8114 but OffCKB puts an RPC proxy on :28114, and the proxy
// is what tooling should target — buildClient() handles that, with :8114 as a
// fallback.
const client = buildClient("devnet");

const DEPLOYS = [
  {
    day: "11 Aug",
    txHash:
      "0x717f98ebdc961a4a5daa2cdbff938c38a5e39f2260c73ba36f738c56916ae974",
    blockNumber: 20n,
  },
  {
    day: "12 Aug",
    txHash:
      "0x8e8e3bbf5252b7741410e114446f68ffa2533cc387e28314b9e74dacc9faf140",
    blockNumber: 197n,
  },
];

jest.setTimeout(30_000);

describe("hello-world on the local devnet", () => {
  const bytecode = readFileSync("dist/hello-world.bc");

  it("the devnet is reachable through the OffCKB proxy", async () => {
    await expect(client.getTip()).resolves.toBeGreaterThan(0n);
  });

  describe.each(DEPLOYS)("$day deploy", ({ txHash, blockNumber }) => {
    it("is still committed on the persisted chain", async () => {
      // `offckb node` resumes the same chain; only `offckb clean` resets it.
      const tx = await client.getTransaction(txHash);
      expect(tx?.status).toBe("committed");
      expect(tx?.blockNumber).toBe(blockNumber);
    });

    it("left a live code cell matching the local artifact", async () => {
      const cell = await client.getCellLive({ txHash, index: 0 }, true);
      expect(cell).toBeDefined();
      expect(cell!.cellOutput.capacity).toBe(ccc.fixedPointFrom(1366));
      expect(Buffer.from(cell!.outputData.slice(2), "hex").equals(bytecode)).toBe(
        true,
      );
    });
  });

  it("deploying twice produced two code cells, not an upgrade", async () => {
    // Nothing "installs" a contract: each deploy writes the bytecode into a
    // new cell. There is no mutable address to overwrite, so both are live.
    const cells = await Promise.all(
      DEPLOYS.map(({ txHash }) =>
        client.getCellLive({ txHash, index: 0 }, true),
      ),
    );
    expect(cells.every(Boolean)).toBe(true);
    const identities = cells.map((c) => ccc.hashCkb(c!.outputData));
    expect(new Set(identities).size).toBe(1); // same script identity...
    expect(new Set(DEPLOYS.map((d) => d.txHash)).size).toBe(2); // ...two out points
  });
});
