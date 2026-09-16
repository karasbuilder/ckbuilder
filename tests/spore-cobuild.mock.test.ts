import { ccc } from "@ckb-ccc/core";
import {
  Action,
  Message,
  SighashAll,
  SporeAction,
  WitnessLayout,
  addressOf,
  cobuildWitness,
} from "./spore-cobuild";

// No chain needed. The CoBuild witness is the part of week 5 that cost the most
// time, so it gets its own tests: the layout is exact, and a wrong field order
// produces bytes that decode fine locally and are invisible to the script.

const lock = ccc.Script.from({
  codeHash: `0x${"11".repeat(32)}`,
  hashType: "type",
  args: `0x${"22".repeat(20)}`,
});
const sporeId = `0x${"33".repeat(32)}`;
const dataHash = `0x${"44".repeat(32)}`;
const scriptHash: ccc.Hex = `0x${"55".repeat(32)}`;

const action = {
  type: "MintSpore" as const,
  value: { sporeId, to: addressOf(lock), dataHash },
};

describe("the CoBuild witness a spore transaction has to carry", () => {
  it("is tagged 0xff000001, which is what keeps it out of WitnessArgs' way", () => {
    const w = cobuildWitness(scriptHash, action);

    // molecule unions are little endian, so 0xff000001 reads back reversed
    expect(w.slice(0, 10)).toBe("0x010000ff");
    // a WitnessArgs starts with its own byte length, which can never reach
    // 0xff000001, so a script can tell the two apart by the first four bytes
    expect(ccc.numLeFromBytes(ccc.bytesFrom(w).slice(0, 4))).toBe(4278190081n);
  });

  it("round trips back to the action it was built from", () => {
    const decoded = WitnessLayout.decode(
      ccc.bytesFrom(cobuildWitness(scriptHash, action)),
    );

    expect(decoded.type).toBe("SighashAll");
    const actions = (decoded.value as any).message.actions;
    expect(actions).toHaveLength(1);
    expect(ccc.hexFrom(actions[0]!.scriptHash)).toBe(scriptHash);

    const mint = SporeAction.decode(actions[0]!.data);
    expect(mint.type).toBe("MintSpore");
    expect(ccc.hexFrom((mint.value as any).sporeId)).toBe(sporeId);
    expect(ccc.hexFrom((mint.value as any).dataHash)).toBe(dataHash);
  });

  it("names the script it is addressed to, so one witness can carry many", () => {
    const a = ccc.bytesFrom(cobuildWitness(scriptHash, action));
    const b = ccc.bytesFrom(
      cobuildWitness(`0x${"66".repeat(32)}` as ccc.Hex, action),
    );

    // same action, different addressee: the script filters on script_hash
    expect(a.length).toBe(b.length);
    expect(ccc.hexFrom(a)).not.toBe(ccc.hexFrom(b));
  });

  it("puts seal before message, which the .mol file in the POC repo does not", () => {
    const right = SighashAll.encode({
      seal: "0x",
      message: { actions: [] },
    });
    const wrong = ccc.mol
      .table({ message: Message, seal: ccc.mol.Bytes })
      .encode({ message: { actions: [] }, seal: "0x" });

    // both are valid molecule and the same length. only one is the one the
    // deployed script reads, and the other fails with error code 8.
    expect(right.length).toBe(wrong.length);
    expect(ccc.hexFrom(right)).not.toBe(ccc.hexFrom(wrong));
  });

  it("an Action is a fixed 80-byte head plus the action data", () => {
    const encoded = Action.encode({
      scriptInfoHash: `0x${"00".repeat(32)}`,
      scriptHash,
      data: SporeAction.encode(action),
    });
    const payload = SporeAction.encode(action);

    // 4 size + 3 offsets + 32 + 32 + 4 length prefix = 84
    expect(encoded.length).toBe(84 + payload.length);
  });

  it("the whole witness for one mint is 281 bytes", () => {
    expect((cobuildWitness(scriptHash, action).length - 2) / 2).toBe(281);
  });
});
