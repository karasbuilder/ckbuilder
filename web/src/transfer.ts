import { ccc } from "@ckb-ccc/core";

// The app's whole send path, in the three stages the week-6 tests watch:
// declare the output, let CCC pick inputs, let CCC size the fee and add the
// change. The signer is whatever the connector hands over, a JoyID wallet or
// a MetaMask account, or a private key in scripts/send-with-key.ts. This code
// does not know which.
export async function sendCkb(
  signer: ccc.Signer,
  to: string,
  amount: string,
): Promise<ccc.Hex> {
  const { script: lock } = await ccc.Address.fromString(to, signer.client);
  const tx = ccc.Transaction.from({
    outputs: [{ lock, capacity: ccc.fixedPointFrom(amount) }],
  });
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);
  return signer.sendTransaction(tx);
}

// Which lock a signer's address actually uses. The same "connect wallet"
// button gives a different lock script per wallet.
export async function lockName(signer: ccc.Signer): Promise<string> {
  const { codeHash } = (await signer.getRecommendedAddressObj()).script;
  for (const [name, known] of [
    ["secp256k1-blake160", ccc.KnownScript.Secp256k1Blake160],
    ["Omnilock", ccc.KnownScript.OmniLock],
    ["JoyID", ccc.KnownScript.JoyId],
  ] as const) {
    if ((await signer.client.getKnownScript(known)).codeHash === codeHash) {
      return name;
    }
  }
  return `unknown, ${codeHash.slice(0, 10)}`;
}
