import { ccc } from "@ckb-ccc/core";

// The spore scripts offckb ships are the CoBuild build. Every mint, transfer
// and melt has to be declared twice: once as the transaction itself, and once
// as a signed, human-readable statement of intent carried in a witness. The
// script rejects the transaction if the two disagree.
//
// There is no npm package for this in the repo, so the schemas are written out
// here from spore-contract/lib/types/schemas/action.mol and
// ckb-transaction-cobuild-poc/schemas/{basic,top_level}.mol.

// union Address { Script }
export const Address = ccc.mol.union({ Script: ccc.Script });

// table MintSpore  { spore_id: Byte32, to: Address, data_hash: Byte32 }
export const MintSpore = ccc.mol.table({
  sporeId: ccc.mol.Byte32,
  to: Address,
  dataHash: ccc.mol.Byte32,
});

// table TransferSpore { spore_id: Byte32, from: Address, to: Address }
export const TransferSpore = ccc.mol.table({
  sporeId: ccc.mol.Byte32,
  from: Address,
  to: Address,
});

// table BurnSpore { spore_id: Byte32, from: Address }
export const BurnSpore = ccc.mol.table({
  sporeId: ccc.mol.Byte32,
  from: Address,
});

// table MintCluster { cluster_id: Byte32, to: Address, data_hash: Byte32 }
export const MintCluster = ccc.mol.table({
  clusterId: ccc.mol.Byte32,
  to: Address,
  dataHash: ccc.mol.Byte32,
});

// table TransferCluster { cluster_id: Byte32, from: Address, to: Address }
export const TransferCluster = ccc.mol.table({
  clusterId: ccc.mol.Byte32,
  from: Address,
  to: Address,
});

// union SporeAction. Only the five actions above are used here, but the tag
// numbers are positional, so the rest of the union has to be declared for the
// tags to come out right.
export const SporeAction = ccc.mol.union(
  {
    MintSpore,
    TransferSpore,
    BurnSpore,
    MintCluster,
    TransferCluster,
    MintProxy: ccc.mol.Bytes,
    TransferProxy: ccc.mol.Bytes,
    BurnProxy: ccc.mol.Bytes,
    MintAgent: ccc.mol.Bytes,
    TransferAgent: ccc.mol.Bytes,
    BurnAgent: ccc.mol.Bytes,
  },
  {
    MintSpore: 0,
    TransferSpore: 1,
    BurnSpore: 2,
    MintCluster: 3,
    TransferCluster: 4,
    MintProxy: 5,
    TransferProxy: 6,
    BurnProxy: 7,
    MintAgent: 8,
    TransferAgent: 9,
    BurnAgent: 10,
  },
);

// table Action { script_info_hash: Byte32, script_hash: Byte32, data: Bytes }
export const Action = ccc.mol.table({
  scriptInfoHash: ccc.mol.Byte32,
  scriptHash: ccc.mol.Byte32,
  data: ccc.mol.Bytes,
});

export const ActionVec = ccc.mol.vector(Action);
export const Message = ccc.mol.table({ actions: ActionVec });

// Field order matters and the schema file in ckb-transaction-cobuild-poc has it
// the other way round: `table SighashAll { message, seal }`. The deployed
// scripts want `seal` first, which is what the CoBuild RFC and @ckb-ccc/spore
// both use. Following the .mol file costs an hour and gives error code 8.
export const SighashAll = ccc.mol.table({
  seal: ccc.mol.Bytes,
  message: Message,
});
export const SighashAllOnly = ccc.mol.table({ seal: ccc.mol.Bytes });

// union WitnessLayout, with the reserved tag numbers from the CoBuild spec.
// They start at 0xff000001 so that a WitnessLayout can never be mistaken for a
// legacy WitnessArgs, which is what lets the two live in the same transaction.
export const WitnessLayout = ccc.mol.union(
  {
    SighashAll,
    SighashAllOnly,
    Otx: ccc.mol.Bytes,
    OtxStart: ccc.mol.Bytes,
  },
  {
    SighashAll: 4278190081,
    SighashAllOnly: 4278190082,
    Otx: 4278190083,
    OtxStart: 4278190084,
  },
);

// One action, addressed to one script, wrapped in a SighashAll witness.
// script_info_hash identifies the dapp that produced the action; the spore
// script does not read it, so it stays zero rather than pretending otherwise.
export const cobuildWitness = (
  scriptHash: ccc.Hex,
  action: Parameters<typeof SporeAction.encode>[0],
) =>
  ccc.hexFrom(
    WitnessLayout.encode({
      type: "SighashAll",
      value: {
        seal: "0x",
        message: {
          actions: [
            {
              scriptInfoHash: `0x${"00".repeat(32)}`,
              scriptHash,
              data: SporeAction.encode(action),
            },
          ],
        },
      },
    }),
  );

export const addressOf = (lock: ccc.Script) => ({
  type: "Script" as const,
  value: lock,
});
