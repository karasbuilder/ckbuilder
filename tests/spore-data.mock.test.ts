import { ccc } from "@ckb-ccc/core";
import {
  DOB_CONTENT_TYPE,
  DOB_IMAGE,
  SporeData,
  packSpore,
  unpackSpore,
} from "./spore-helper";

// No chain needed. This file is about the cell data layout on its own, because
// the layout is the whole argument: a spore cell carries the bytes of the file,
// not a URL that points at a server which can go away.

describe("SporeData, the molecule table a DOB lives in", () => {
  it("round trips the image byte for byte", () => {
    const packed = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE);
    const back = unpackSpore(packed);

    expect(back.contentType).toBe(DOB_CONTENT_TYPE);
    expect(back.clusterId).toBeUndefined();
    expect(Buffer.from(back.content)).toEqual(Buffer.from(DOB_IMAGE));
    expect(ccc.hashCkb(back.content)).toBe(ccc.hashCkb(DOB_IMAGE));
  });

  it("the packed data really contains the PNG, it is not a reference to it", () => {
    const packed = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE);

    // PNG magic number, verbatim, inside the cell data
    expect(packed).toContain("89504e470d0a1a0a");
    expect(packed).toContain(ccc.hexFrom(DOB_IMAGE).slice(2));
    // and the MIME type as plain ascii
    expect(packed).toContain(
      ccc.hexFrom(ccc.bytesFrom(DOB_CONTENT_TYPE, "utf8")).slice(2),
    );
  });

  it("the overhead on top of the file is 33 bytes, the rest is the file", () => {
    const packed = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE);
    const size = (packed.length - 2) / 2;

    // 4 full size + 3 * 4 offsets + 4 + 4 + 0 length prefixes = 24, plus the
    // 9 ascii bytes of "image/png"
    expect(size).toBe(24 + DOB_CONTENT_TYPE.length + DOB_IMAGE.length);
    expect(DOB_IMAGE.length).toBe(414);
    expect(size).toBe(447);
  });

  it("a molecule table declares its own size, so nothing is implicit", () => {
    const packed = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE);
    const bytes = ccc.bytesFrom(packed);
    const declared = ccc.numLeFromBytes(bytes.slice(0, 4));

    expect(Number(declared)).toBe(bytes.length);
  });

  it("joining a cluster costs 36 bytes, not 32", () => {
    const id = `0x${"ab".repeat(32)}`;
    const loose = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE);
    const joined = packSpore(DOB_CONTENT_TYPE, DOB_IMAGE, id);

    expect(unpackSpore(joined).clusterId).toBe(id);
    // BytesOpt is a byte vector, so Some pays a 4-byte length prefix on top of
    // the 32-byte id, and None is genuinely nothing.
    expect((joined.length - loose.length) / 2).toBe(36);
    expect(unpackSpore(loose).clusterId).toBeUndefined();
  });

  it("refuses to decode data that is not a SporeData table", () => {
    expect(() => SporeData.decode(ccc.bytesFrom("0xdeadbeef"))).toThrow();
    expect(() => SporeData.decode(ccc.bytesFrom("0x"))).toThrow();
  });
});
