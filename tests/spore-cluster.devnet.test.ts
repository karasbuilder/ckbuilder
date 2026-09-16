import { ccc } from "@ckb-ccc/core";
import { buildClient, buildSigner } from "./helper";
import { addressOf, cobuildWitness } from "./spore-cobuild";
import {
  CLUSTER,
  CLUSTER_DEP,
  ClusterData,
  DOB_CONTENT_TYPE,
  DOB_IMAGE,
  SPORE_DEP,
  clusterType,
  packCluster,
  packSpore,
  sporeType,
  unpackSpore,
} from "./spore-helper";

// Needs a running node:
//   offckb node
//   npm run test:devnet
//
// A cluster is the collection a spore belongs to. The point of this file is
// that membership is a fact the chain enforces, not a label a marketplace
// attaches: a spore that claims a cluster it cannot prove is not mintable.
const client = buildClient("devnet");
const signer = buildSigner(client, "PRIVATE_KEY");

const FEE_RATE = 1000;
const NAME = "CKBuilder week 5";
const DESCRIPTION = "DOBs minted while working through the Spore protocol.";

const clusterData = packCluster(NAME, DESCRIPTION);
const CLUSTER_OCCUPIED = 8 + 53 + 65 + (clusterData.length - 2) / 2;

const errorCode = (e: unknown) => {
  const m = /error code (-?\d+)/.exec(String(e));
  return m ? Number(m[1]) : undefined;
};

// The node prints the whole error-code URL and that URL is a 404 (week 4 note),
// so the log keeps the two parts that matter: which script said no, and why.
const why = (e: unknown) => {
  const s = String((e as Error)?.message ?? e);
  const source = /source: ([^,]+)/.exec(s)?.[1];
  return source
    ? `${source} rejected it, error code ${errorCode(e)}`
    : s.replace(/ on page \S+/, "");
};

jest.setTimeout(300_000);

describe("clusters on devnet", () => {
  let myLock: ccc.Script;
  let clusterId: string;
  let clusterTx: string;

  beforeAll(async () => {
    myLock = (await signer.getRecommendedAddressObj()).script;

    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: myLock,
          type: clusterType(`0x${"00".repeat(32)}`),
          capacity: ccc.fixedPointFrom(CLUSTER_OCCUPIED),
        },
      ],
      outputsData: [clusterData],
      cellDeps: [CLUSTER_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(signer);

    clusterId = ccc.hashTypeId(tx.inputs[0]!, 0);
    tx.outputs[0]!.type = clusterType(clusterId);
    while (tx.witnesses.length < tx.inputs.length) tx.witnesses.push("0x");
    tx.witnesses.push(
      cobuildWitness(tx.outputs[0]!.type!.hash(), {
        type: "MintCluster",
        value: {
          clusterId,
          to: addressOf(myLock),
          dataHash: ccc.hashCkb(clusterData),
        },
      }),
    );
    await tx.completeFeeBy(signer, FEE_RATE);

    clusterTx = await client.sendTransaction(await signer.signTransaction(tx));
    expect((await client.waitTransaction(clusterTx, 0, 180_000))?.status).toBe(
      "committed",
    );
    console.log(`cluster "${NAME}" ${clusterId}\n  tx ${clusterTx}`);
  });

  const clusterOutPoint = () =>
    ccc.OutPoint.from({ txHash: clusterTx, index: 0 });

  it("the cluster cell holds its own name and description on chain", async () => {
    const cell = await client.getCellLive(clusterOutPoint(), true);
    const data = ClusterData.decode(ccc.bytesFrom(cell!.outputData));

    expect(cell!.cellOutput.type!.codeHash).toBe(CLUSTER.codeHash);
    expect(cell!.cellOutput.type!.args).toBe(clusterId);
    expect(ccc.bytesTo(data.name, "utf8")).toBe(NAME);
    expect(ccc.bytesTo(data.description, "utf8")).toBe(DESCRIPTION);
    expect(data.mutantId).toBeUndefined();
  });

  // A spore joining a cluster has to prove it is allowed to. Here that proof is
  // lock proxy mode: the cluster's own lock appears in both the inputs and the
  // outputs of the minting transaction, which only its owner can arrange.
  const buildJoin = async (withClusterDep: boolean) => {
    const data = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE, clusterId);
    const occupied = 8 + 53 + 65 + (data.length - 2) / 2;

    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: myLock,
          type: sporeType(`0x${"00".repeat(32)}`),
          capacity: ccc.fixedPointFrom(occupied),
        },
      ],
      outputsData: [data],
      cellDeps: withClusterDep
        ? [SPORE_DEP, { outPoint: clusterOutPoint(), depType: "code" }]
        : [SPORE_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(signer);

    const id = ccc.hashTypeId(tx.inputs[0]!, 0);
    tx.outputs[0]!.type = sporeType(id);
    while (tx.witnesses.length < tx.inputs.length) tx.witnesses.push("0x");
    tx.witnesses.push(
      cobuildWitness(tx.outputs[0]!.type!.hash(), {
        type: "MintSpore",
        value: {
          sporeId: id,
          to: addressOf(myLock),
          dataHash: ccc.hashCkb(data),
        },
      }),
    );
    await tx.completeFeeBy(signer, FEE_RATE);
    return { tx: await signer.signTransaction(tx), id, occupied };
  };

  it("a spore may join the cluster when the cluster cell is in the deps", async () => {
    const { tx, id, occupied } = await buildJoin(true);
    const joinTx = await client.sendTransaction(tx);
    expect((await client.waitTransaction(joinTx, 0, 180_000))?.status).toBe(
      "committed",
    );
    console.log(`spore ${id} joined the cluster\n  tx ${joinTx}`);

    const cell = await client.getCellLive({ txHash: joinTx, index: 0 }, true);
    const data = unpackSpore(cell!.outputData);

    expect(data.clusterId).toBe(clusterId);
    // 36 bytes more than the same spore outside a cluster
    expect(occupied).toBe(573 + 36);
    expect(cell!.cellOutput.capacity).toBe(ccc.fixedPointFrom(occupied));
  });

  it("refuses the same spore when the cluster is not in the deps, with 6", async () => {
    const { tx } = await buildJoin(false);
    const error = await client.sendTransactionDry(tx).catch((e) => e);
    console.log(`no cluster dep -> ${why(error)}`);

    expect(errorCode(error)).toBe(6); // ClusterCellNotInDep
  });

  it("refuses a spore claiming a cluster that was never created", async () => {
    const data = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE, `0x${"cd".repeat(32)}`);
    const occupied = 8 + 53 + 65 + (data.length - 2) / 2;

    const tx = ccc.Transaction.from({
      outputs: [
        {
          lock: myLock,
          type: sporeType(`0x${"00".repeat(32)}`),
          capacity: ccc.fixedPointFrom(occupied),
        },
      ],
      outputsData: [data],
      cellDeps: [SPORE_DEP],
    });
    await tx.addCellDepsOfKnownScripts(
      client,
      ccc.KnownScript.Secp256k1Blake160,
    );
    await tx.completeInputsByCapacity(signer);
    const id = ccc.hashTypeId(tx.inputs[0]!, 0);
    tx.outputs[0]!.type = sporeType(id);
    while (tx.witnesses.length < tx.inputs.length) tx.witnesses.push("0x");
    tx.witnesses.push(
      cobuildWitness(tx.outputs[0]!.type!.hash(), {
        type: "MintSpore",
        value: {
          sporeId: id,
          to: addressOf(myLock),
          dataHash: ccc.hashCkb(data),
        },
      }),
    );
    await tx.completeFeeBy(signer, FEE_RATE);

    const error = await client
      .sendTransactionDry(await signer.signTransaction(tx))
      .catch((e) => e);
    console.log(`invented cluster -> ${why(error)}`);

    // there is no cell to put in the deps, so the claim cannot be made at all
    expect(errorCode(error)).toBe(6);
  });
});
