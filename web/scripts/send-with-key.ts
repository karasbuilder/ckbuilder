// Runs the app's own send path, src/transfer.ts, with a private key in place
// of the wallet, so the code can be checked on testnet without a browser:
//
//   npm run send -- <to address> <amount in CKB>
//
// Reads TESTNET_PRIVATE_KEY from the repo's .env.
import { ccc } from "@ckb-ccc/core";
import dotenv from "dotenv";
import { lockName, sendCkb } from "../src/transfer.ts";

dotenv.config({ path: new URL("../../.env", import.meta.url), quiet: true });
const key = process.env.TESTNET_PRIVATE_KEY;
if (!key) throw new Error("TESTNET_PRIVATE_KEY is not set");
const [to, amount] = process.argv.slice(2);
if (!to || !amount) throw new Error("usage: npm run send -- <to> <amount>");

const client = new ccc.ClientPublicTestnet();
const signer = new ccc.SignerCkbPrivateKey(client, key);

console.log(`from ${await signer.getRecommendedAddress()}`);
console.log(`lock ${await lockName(signer)}`);
console.log(`to   ${to}\n`);

const hash = await sendCkb(signer, to, amount);
console.log(`sent ${amount} CKB\n  ${hash}`);

for (let i = 0; i < 60; i++) {
  const res = await client.getTransaction(hash);
  if (res?.status === "committed") {
    console.log(`  committed in block ${res.blockNumber}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
throw new Error("not committed after 5 minutes");
