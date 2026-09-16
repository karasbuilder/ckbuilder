import { ccc } from "@ckb-ccc/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import systemScripts from "../deployment/system-scripts.json";

// Spore, per the protocol docs at docs.spore.pro. The cell data is a molecule
// table and the content sits inside it, so a DOB is not a pointer to a file,
// it is the file.
//
//   table SporeData {
//     contentType: Bytes,
//     content:     Bytes,
//     clusterId:   BytesOpt,
//   }
export const SporeData = ccc.mol.table({
  contentType: ccc.mol.Bytes,
  content: ccc.mol.Bytes,
  clusterId: ccc.mol.BytesOpt,
});

// ClusterDataV2. mutantId is the v2 addition and stays None here.
export const ClusterData = ccc.mol.table({
  name: ccc.mol.Bytes,
  description: ccc.mol.Bytes,
  mutantId: ccc.mol.BytesOpt,
});

export const SPORE = systemScripts.devnet.spore!.script;
export const CLUSTER = systemScripts.devnet.spore_cluster!.script;

export const SPORE_DEP = SPORE.cellDeps[0]!.cellDep;
export const CLUSTER_DEP = CLUSTER.cellDeps[0]!.cellDep;

// Spore and Cluster both take a 32-byte id in args and both mint it with the
// Type ID rule: hash(first input outpoint, output index). Week 4 wrote that
// rule out by hand; here it is again under a different script.
export const sporeType = (id: ccc.HexLike) =>
  ccc.Script.from({
    codeHash: SPORE.codeHash,
    hashType: SPORE.hashType as ccc.HashType,
    args: ccc.hexFrom(id),
  });

export const clusterType = (id: ccc.HexLike) =>
  ccc.Script.from({
    codeHash: CLUSTER.codeHash,
    hashType: CLUSTER.hashType as ccc.HashType,
    args: ccc.hexFrom(id),
  });

export const packSpore = (
  contentType: string,
  content: Uint8Array,
  clusterId?: ccc.HexLike,
) =>
  ccc.hexFrom(
    SporeData.encode({
      contentType: ccc.bytesFrom(contentType, "utf8"),
      content,
      clusterId: clusterId === undefined ? undefined : ccc.hexFrom(clusterId),
    }),
  );

export const unpackSpore = (data: ccc.HexLike) => {
  const d = SporeData.decode(ccc.bytesFrom(data));
  return {
    contentType: ccc.bytesTo(d.contentType, "utf8"),
    content: ccc.bytesFrom(d.content),
    clusterId: d.clusterId === undefined ? undefined : ccc.hexFrom(d.clusterId),
  };
};

export const packCluster = (name: string, description: string) =>
  ccc.hexFrom(
    ClusterData.encode({
      name: ccc.bytesFrom(name, "utf8"),
      description: ccc.bytesFrom(description, "utf8"),
      mutantId: undefined,
    }),
  );

// The image minted in week 5. Regenerate with: node scripts/make-dob-image.js
export const DOB_IMAGE_PATH = resolve(process.cwd(), "tests/fixtures/dob.png");
export const DOB_IMAGE = new Uint8Array(readFileSync(DOB_IMAGE_PATH));
export const DOB_CONTENT_TYPE = "image/png";
