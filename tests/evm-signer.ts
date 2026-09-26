import { ccc } from "@ckb-ccc/core";
import { Wallet } from "ethers";

// CCC ships SignerEvm as an abstract class and leaves the signing to the
// browser wallet. This fills it in with an ethers Wallet, which signs the way
// MetaMask does: personal_sign over a message string. Everything CKB-specific
// (the Omnilock address, the message format, the witness layout) is still
// CCC's own code in SignerEvm.
export class SignerEvmPrivateKey extends ccc.SignerEvm {
  private readonly wallet: Wallet;

  constructor(client: ccc.Client, privateKey: ccc.HexLike) {
    super(client);
    this.wallet = new Wallet(ccc.hexFrom(privateKey));
  }

  async connect(): Promise<void> {}

  async isConnected(): Promise<boolean> {
    return true;
  }

  async getEvmAccount(): Promise<ccc.Hex> {
    return ccc.hexFrom(this.wallet.address.toLowerCase());
  }

  async signMessageRaw(message: string | ccc.BytesLike): Promise<ccc.Hex> {
    const payload =
      typeof message === "string" ? message : ccc.bytesFrom(message);
    return ccc.hexFrom(await this.wallet.signMessage(payload));
  }
}

// The Omnilock witness lock around a 65-byte signature, laid out the way
// SignerEvm writes it: a molecule table of total size, three field offsets
// and the signature's length, then the signature with v as 0 or 1.
export const omnilockWitnessLock = (ethSignature: ccc.BytesLike) => {
  const sig = ccc.bytesFrom(ethSignature).slice();
  if (sig[64]! >= 27) sig[64]! -= 27;
  return ccc.hexFrom(
    ccc.bytesConcat(
      ccc.numToBytes(85, 4),
      ccc.numToBytes(16, 4),
      ccc.numToBytes(85, 4),
      ccc.numToBytes(85, 4),
      ccc.numToBytes(65, 4),
      sig,
    ),
  );
};
