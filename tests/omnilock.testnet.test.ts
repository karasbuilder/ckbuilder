import { ccc } from "@ckb-ccc/core";
import dotenv from "dotenv";
import { verifyMessage, Wallet } from "ethers";
import { omnilockWitnessLock, SignerEvmPrivateKey } from "./evm-signer";
dotenv.config({ quiet: true });

// scripts/omnilock-testnet.ts, checked after the fact against public testnet.
// Nothing is signed or sent here, so it is safe inside `npm test`.
// https://testnet.explorer.nervos.org/transaction/0x8080d03e...
const FUND_TX =
  "0x8ecca8a06fbd06617175be239281c0e90b83b30ad853fb6bfa58b7460cd6f444";
const FUND_BLOCK = 22513725n;
const SPEND_TX =
  "0x8080d03ede43c2cc14d9a5503ea76c9da16e10f7dc3ce495b66c5b299ec0a5e6";
const SPEND_BLOCK = 22513728n;

// The testnet key's Ethereum address. Omnilock holds this, not a CKB pubkey hash.
const EVM_ACCOUNT = "0xf2f26f93a35adbc88b454807493b28b27c75075b";
const CKB_ADDRESS =
  "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfwcrwfzsp54v5z9pwgtjnrl553as8ke0cu93dj9";

const client = new ccc.ClientPublicTestnet({
  url: process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc",
});

jest.setTimeout(60_000);

const omnilock = async () =>
  ccc.Script.fromKnownScript(
    client,
    ccc.KnownScript.OmniLock,
    ccc.hexFrom([0x12, ...ccc.bytesFrom(EVM_ACCOUNT), 0x00]),
  );

describe("an EVM account spending CKB through Omnilock on testnet", () => {
  it("funded the Omnilock address with 300 CKB from a secp256k1 account", async () => {
    const res = (await client.getTransaction(FUND_TX))!;
    expect(res.status).toBe("committed");
    expect(res.blockNumber).toBe(FUND_BLOCK);

    const lock = await omnilock();
    const funded = res.transaction.outputs.find((o) => o.lock.eq(lock));
    expect(funded?.capacity).toBe(ccc.fixedPointFrom(300));
  });

  it("spent that cell with the EVM signer, 100 CKB back and the change to Omnilock", async () => {
    const res = (await client.getTransaction(SPEND_TX))!;
    expect(res.status).toBe("committed");
    expect(res.blockNumber).toBe(SPEND_BLOCK);

    const { transaction: tx } = res;
    const lock = await omnilock();
    const back = (await ccc.Address.fromString(CKB_ADDRESS, client)).script;

    expect(tx.inputs.length).toBe(1);
    expect(tx.inputs[0]!.previousOutput.txHash).toBe(FUND_TX);
    expect(tx.outputs[0]!.lock.eq(back)).toBe(true);
    expect(tx.outputs[0]!.capacity).toBe(ccc.fixedPointFrom(100));
    expect(tx.outputs[1]!.lock.eq(lock)).toBe(true);
  });

  it("carries an 85-byte witness lock: a 20-byte molecule header, then 65 bytes of signature", async () => {
    const { transaction: tx } = (await client.getTransaction(SPEND_TX))!;
    const lockBytes = ccc.bytesFrom(
      ccc.WitnessArgs.fromBytes(tx.witnesses[0]!).lock!,
    );

    expect(lockBytes.length).toBe(85);
    const header = [0, 4, 8, 12, 16].map((at) =>
      Number(ccc.numLeFromBytes(lockBytes.slice(at, at + 4))),
    );
    // total size, then offsets of signature / omni_identity / preimage, then
    // the signature's own length. The last two fields are empty.
    expect(header).toEqual([85, 16, 85, 85, 65]);
  });

  it("was signed over the text 'CKB transaction: 0x...', recovered from the chain", async () => {
    const { transaction: tx } = (await client.getTransaction(SPEND_TX))!;
    const witness = ccc.WitnessArgs.fromBytes(tx.witnesses[0]!);
    const sig = ccc.bytesFrom(witness.lock!).slice(20);

    // Put the lock back the way it was when it was signed: same length, all zero.
    const unsigned = tx.clone();
    unsigned.setWitnessArgsAt(
      0,
      ccc.WitnessArgs.from({
        ...witness,
        lock: ccc.hexFrom(new Uint8Array(85)),
      }),
    );
    const { message } = (await unsigned.getSignHashInfo(
      await omnilock(),
      client,
    ))!;
    const ethSig = ccc.hexFrom([...sig.slice(0, 64), sig[64]! + 27]);

    expect(
      verifyMessage(`CKB transaction: ${message}`, ethSig).toLowerCase(),
    ).toBe(EVM_ACCOUNT);
  });

  it("paid exactly the fee its size called for at 1000 shannons per KB", async () => {
    const { transaction: tx } = (await client.getTransaction(SPEND_TX))!;
    const fee = (await tx.getInputsCapacity(client)) - tx.getOutputsCapacity();

    expect(fee).toBe(BigInt(tx.toBytes().length + 4));
    expect(fee).toBe(tx.estimateFee(1000));
    console.log(`spend fee ${fee} shannons for ${tx.toBytes().length} bytes`);
  });
});

// The change cell the spend left under Omnilock, output 1 of SPEND_TX, while it
// stays live. Each case signs a spend of it and asks the node to run the
// scripts with estimate_cycles. Nothing is sent.
const KEY = process.env.TESTNET_PRIVATE_KEY;
const describeWithKey = KEY ? describe : describe.skip;

describeWithKey("what Omnilock refuses, run by the node and never sent", () => {
  const unsignedSpend = async (signer: SignerEvmPrivateKey) => {
    const back = (await ccc.Address.fromString(CKB_ADDRESS, client)).script;
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: SPEND_TX, index: 1 } }],
      outputs: [{ lock: back, capacity: ccc.fixedPointFrom(100) }],
    });
    await tx.completeFeeBy(signer, 1000);
    expect(tx.inputs.length).toBe(1);
    const { message } = (await tx.getSignHashInfo(await omnilock(), client))!;
    return { tx, message };
  };

  const withSignature = (tx: ccc.Transaction, ethSignature: string) => {
    const signed = tx.clone();
    const witness = ccc.WitnessArgs.fromBytes(signed.witnesses[0]!);
    witness.lock = omnilockWitnessLock(ethSignature);
    signed.setWitnessArgsAt(0, witness);
    return signed;
  };

  const errorCode = async (tx: ccc.Transaction) => {
    try {
      await client.estimateCycles(tx);
      return undefined;
    } catch (err) {
      const code = String(err).match(/error code (-?\d+)/)?.[1];
      return code === undefined ? String(err) : Number(code);
    }
  };

  it("accepts the honest signature over 'CKB transaction: 0x...'", async () => {
    const signer = new SignerEvmPrivateKey(client, KEY!);
    const { tx, message } = await unsignedSpend(signer);
    const sig = await new Wallet(KEY!).signMessage(
      `CKB transaction: ${message}`,
    );

    const cycles = await client.estimateCycles(withSignature(tx, sig));
    expect(cycles).toBeGreaterThan(0n);
    console.log(`honest spend runs in ${cycles} cycles`);
  });

  it("refuses the same key signing the raw hash, with -31", async () => {
    const signer = new SignerEvmPrivateKey(client, KEY!);
    const { tx, message } = await unsignedSpend(signer);
    const sig = await new Wallet(KEY!).signMessage(ccc.bytesFrom(message));

    expect(await errorCode(withSignature(tx, sig))).toBe(-31);
  });

  it("refuses a different account signing the right text, with the same -31", async () => {
    const signer = new SignerEvmPrivateKey(client, KEY!);
    const { tx, message } = await unsignedSpend(signer);
    const sig = await Wallet.createRandom().signMessage(
      `CKB transaction: ${message}`,
    );

    expect(await errorCode(withSignature(tx, sig))).toBe(-31);
  });
});
