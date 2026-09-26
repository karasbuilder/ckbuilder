import { ccc } from "@ckb-ccc/core";
import { secp256k1 } from "@noble/curves/secp256k1";
import { computeAddress, verifyMessage } from "ethers";
import { SignerEvmPrivateKey } from "./evm-signer";

// One secp256k1 key handed to two CCC signers, fully offline. The client
// points at a port with nothing on it and only lends its testnet script
// table. Omnilock's code cell is tracked by Type ID, and CCC looks it up by
// that type before every Omnilock spend. Stripping the type here pins the
// out point CCC ships with, so no lookup happens.
const KEY = "0x" + "4b".repeat(32); // throwaway, never funded

const shipped = new ccc.ClientPublicTestnet().scripts;
const scripts = Object.fromEntries(
  Object.entries(shipped).map(([name, info]) => [
    name,
    info && {
      ...info,
      cellDeps: ccc.ScriptInfo.from(info).cellDeps.map(({ cellDep }) => ({
        cellDep,
      })),
    },
  ]),
) as typeof shipped;

const client = new ccc.ClientPublicTestnet({
  url: "http://127.0.0.1:1",
  scripts,
});
const ckbSigner = new ccc.SignerCkbPrivateKey(client, KEY);
const evmSigner = new SignerEvmPrivateKey(client, KEY);

// A transaction spending one made-up cell under `lock`. The input carries its
// own cell output, so CCC never has to look it up.
const spending = (lock: ccc.Script) =>
  ccc.Transaction.from({
    inputs: [
      {
        previousOutput: { txHash: "0x" + "11".repeat(32), index: 0 },
        cellOutput: { capacity: ccc.fixedPointFrom(1000), lock },
        outputData: "0x",
      },
    ],
    outputs: [{ capacity: ccc.fixedPointFrom(999), lock }],
    outputsData: ["0x"],
  });

const lockOf = async (signer: ccc.Signer) =>
  (await signer.getRecommendedAddressObj()).script;

const witnessLock = (tx: ccc.Transaction) =>
  ccc.bytesFrom(ccc.WitnessArgs.fromBytes(tx.witnesses[0]!).lock ?? "0x");

describe("one private key, two signers", () => {
  it("gives two different addresses under two different lock scripts", async () => {
    const ckbLock = await lockOf(ckbSigner);
    const evmLock = await lockOf(evmSigner);

    expect(ckbLock.codeHash).toBe(
      (await client.getKnownScript(ccc.KnownScript.Secp256k1Blake160)).codeHash,
    );
    expect(evmLock.codeHash).toBe(
      (await client.getKnownScript(ccc.KnownScript.OmniLock)).codeHash,
    );
    expect(ckbLock.hash()).not.toBe(evmLock.hash());
    console.log(
      `ckb ${await ckbSigner.getRecommendedAddress()}\nevm ${await evmSigner.getRecommendedAddress()}`,
    );
  });

  it("puts blake160 of the compressed public key in the secp256k1 args", async () => {
    const args = (await lockOf(ckbSigner)).args;
    expect(ccc.bytesFrom(args).length).toBe(20);
    expect(args).toBe(ccc.hashCkb(ckbSigner.publicKey).slice(0, 42));
  });

  it("puts 0x12, the Ethereum address and 0x00 in the Omnilock args", async () => {
    const args = ccc.bytesFrom((await lockOf(evmSigner)).args);
    const ethAddress = computeAddress(KEY).toLowerCase();

    expect(args.length).toBe(22);
    expect(args[0]).toBe(0x12);
    expect(ccc.hexFrom(args.slice(1, 21))).toBe(ethAddress);
    expect(args[21]).toBe(0x00);
    expect(ethAddress).not.toBe(ccc.hashCkb(ckbSigner.publicKey).slice(0, 42));
  });

  it("reserves 65 witness bytes for secp256k1 and 85 for Omnilock before signing", async () => {
    const ckbTx = await ckbSigner.prepareTransaction(
      spending(await lockOf(ckbSigner)),
    );
    const evmTx = await evmSigner.prepareTransaction(
      spending(await lockOf(evmSigner)),
    );

    expect(witnessLock(ckbTx).length).toBe(65);
    expect(witnessLock(evmTx).length).toBe(85);
    expect(witnessLock(evmTx).every((b) => b === 0)).toBe(true);
  });

  it("does not change the size when it signs, so a fee sized before signing still fits", async () => {
    for (const signer of [ckbSigner, evmSigner]) {
      const prepared = await signer.prepareTransaction(
        spending(await lockOf(signer)),
      );
      const signed = await signer.signOnlyTransaction(prepared.clone());

      expect(witnessLock(signed).some((b) => b !== 0)).toBe(true);
      expect(signed.toBytes().length).toBe(prepared.toBytes().length);
      expect(signed.estimateFee(1000)).toBe(prepared.estimateFee(1000));
    }
  });

  // The sign hash covers the witness with its own lock bytes still zero, so
  // it has to be read off the prepared transaction, not the signed one.
  const signedWithHash = async (signer: ccc.Signer) => {
    const lock = await lockOf(signer);
    const prepared = await signer.prepareTransaction(spending(lock));
    const { message } = (await prepared.getSignHashInfo(lock, client))!;
    const signed = await signer.signOnlyTransaction(prepared.clone());
    return { message, signed };
  };

  it("has the secp256k1 signer sign the raw 32-byte hash", async () => {
    const { message, signed } = await signedWithHash(ckbSigner);
    const sig = witnessLock(signed);

    const recovered = secp256k1.Signature.fromCompact(sig.slice(0, 64))
      .addRecoveryBit(sig[64]!)
      .recoverPublicKey(ccc.bytesFrom(message).slice())
      .toRawBytes(true);
    expect(ccc.hexFrom(recovered)).toBe(ckbSigner.publicKey);
  });

  it("has the EVM signer sign the text 'CKB transaction: 0x...' instead", async () => {
    const { message, signed } = await signedWithHash(evmSigner);

    // The Omnilock witness lock is a molecule table: a 20-byte header, then
    // the 65-byte signature, with v stored as 0 or 1 rather than 27 or 28.
    const sig = witnessLock(signed).slice(20);
    expect(sig.length).toBe(65);
    const ethSig = ccc.hexFrom([...sig.slice(0, 64), sig[64]! + 27]);

    const ethAddress = computeAddress(KEY);
    expect(verifyMessage(`CKB transaction: ${message}`, ethSig)).toBe(
      ethAddress,
    );
    expect(verifyMessage(ccc.bytesFrom(message), ethSig)).not.toBe(ethAddress);
  });
});
