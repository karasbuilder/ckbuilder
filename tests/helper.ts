import { ccc, CellDepInfoLike, KnownScript, Script } from "@ckb-ccc/core";
import systemScripts from "../deployment/system-scripts.json";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

export const buildSigner = (client: ccc.Client, envVar = "PRIVATE_KEY") => {
  const privateKey = process.env[envVar];
  if (!privateKey) {
    throw new Error(
      `${envVar} is not set in environment variables or .env file`,
    );
  }
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  return signer;
};

export const buildClient = (network: "devnet" | "testnet" | "mainnet") => {
  switch (network) {
    case "devnet":
      return new ccc.ClientPublicTestnet({
        url: "http://127.0.0.1:28114",
        scripts: DEVNET_SCRIPTS,
        fallbacks: ["http://127.0.0.1:8114"],
      });
    case "testnet":
      return new ccc.ClientPublicTestnet({
        url: "http://127.0.0.1:38114",
        fallbacks: ["https://testnet.ckb.dev"],
      });
    case "mainnet":
      return new ccc.ClientPublicMainnet({
        url: "http://127.0.0.1:48114",
        fallbacks: ["https://mainnet.ckb.dev"],
      });

    default:
      throw new Error(`Unsupported network: ${network}`);
  }
};

export type KnownScriptType = Pick<Script, "codeHash" | "hashType"> & {
  cellDeps: CellDepInfoLike[];
};

export const DEVNET_SCRIPTS: Record<string, KnownScriptType> = {
  [KnownScript.Secp256k1Blake160]: systemScripts.devnet
    .secp256k1_blake160_sighash_all!.script as KnownScriptType,
  [KnownScript.Secp256k1Multisig]: systemScripts.devnet
    .secp256k1_blake160_multisig_all!.script as KnownScriptType,
  [KnownScript.NervosDao]: systemScripts.devnet.dao!.script as KnownScriptType,
  [KnownScript.AnyoneCanPay]: systemScripts.devnet.anyone_can_pay!
    .script as KnownScriptType,
  [KnownScript.OmniLock]: systemScripts.devnet.omnilock!
    .script as KnownScriptType,
  [KnownScript.XUdt]: systemScripts.devnet.xudt!.script as KnownScriptType,
};
