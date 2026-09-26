// Week 6, run once against public testnet:
//
//   node scripts/omnilock-testnet.ts
//
// The testnet key from .env goes to two signers. The CKB signer funds the
// Omnilock address the same key has as an EVM account, the EVM signer spends
// it back, then two forged spends are sent to see what Omnilock rejects.
// tests/omnilock.testnet.test.ts checks the results after the fact.
import { ccc } from "@ckb-ccc/core";
import dotenv from "dotenv";
import { Wallet } from "ethers";
import {
  omnilockWitnessLock,
  SignerEvmPrivateKey,
} from "../tests/evm-signer.ts";

dotenv.config({ quiet: true });
const KEY = process.env.TESTNET_PRIVATE_KEY;
if (!KEY) throw new Error("TESTNET_PRIVATE_KEY is not set");

const client = new ccc.ClientPublicTestnet({
  url: process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc",
});
const ckbSigner = new ccc.SignerCkbPrivateKey(client, KEY);
const evmSigner = new SignerEvmPrivateKey(client, KEY);
const ckbLock = (await ckbSigner.getRecommendedAddressObj()).script;
const evmLock = (await evmSigner.getRecommendedAddressObj()).script;

const committed = async (hash: string) => {
  for (let i = 0; i < 60; i++) {
    const res = await client.getTransaction(hash);
    if (res?.status === "committed") return res.blockNumber!;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${hash} not committed after 5 minutes`);
};

const send = async (
  label: string,
  signer: ccc.Signer,
  to: ccc.Script,
  ckb: number,
) => {
  const tx = ccc.Transaction.from({
    outputs: [{ lock: to, capacity: ccc.fixedPointFrom(ckb) }],
  });
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);
  const hash = await signer.sendTransaction(tx);
  const block = await committed(hash);
  console.log(`${label}\n  ${hash}\n  block ${block}`);
  return hash;
};

console.log(`ckb address ${await ckbSigner.getRecommendedAddress()}`);
console.log(`evm address ${await evmSigner.getRecommendedAddress()}`);
console.log(`evm account ${await evmSigner.getEvmAccount()}\n`);

await send("fund the Omnilock address, 300 CKB", ckbSigner, evmLock, 300);
await send(
  "spend it back with the EVM signer, 100 CKB",
  evmSigner,
  ckbLock,
  100,
);

// Two forgeries against the Omnilock change cell. Each builds the same honest
// transaction, then swaps in a signature Omnilock should refuse.
const forged = async (
  label: string,
  sign: (hash: string) => Promise<string>,
) => {
  const tx = ccc.Transaction.from({
    outputs: [{ lock: ckbLock, capacity: ccc.fixedPointFrom(100) }],
  });
  await tx.completeInputsByCapacity(evmSigner);
  await tx.completeFeeBy(evmSigner, 1000);
  const { message, position } = (await tx.getSignHashInfo(evmLock, client))!;

  const witness = ccc.WitnessArgs.fromBytes(tx.witnesses[position]!);
  witness.lock = omnilockWitnessLock(await sign(message));
  tx.setWitnessArgsAt(position, witness);

  try {
    await client.sendTransaction(tx);
    console.log(`${label}\n  ACCEPTED, which it should not be`);
  } catch (err) {
    const text = String((err as Error).message ?? err);
    const code = text.match(/error code (-?\d+)/)?.[1];
    console.log(
      `${label}\n  rejected, error code ${code}\n  ${text.split("\n")[0]}`,
    );
  }
};

const same = new Wallet(KEY);
const stranger = Wallet.createRandom();
await forged(
  "forged: right key, raw hash signed without the text prefix",
  (h) => same.signMessage(ccc.bytesFrom(h)),
);
await forged("forged: right message, signed by a different EVM account", (h) =>
  stranger.signMessage(`CKB transaction: ${h}`),
);
