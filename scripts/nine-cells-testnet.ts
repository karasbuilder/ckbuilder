// Week 7, read-only check of the Nine Cells type script on public testnet:

import { ccc } from "@ckb-ccc/core";

const RPC = process.env.CKB_TESTNET_RPC ?? "https://testnet.ckb.dev/rpc";

const CKB_JS_VM =
  "0x3e9b6bead927bef62fcb56f0c79f4fbd1b739f32dd222beac10d346f2918bed7";
const CONTRACT_TYPE_ID =
  "bc7cc190ac166a31de875e6fc4b0571903d62c665c25a84ec4f971277dd4126d";
// "NineCells" in ASCII, padded to 32 bytes
const COLLECTION_ID = "4e696e6543656c6c73" + "00".repeat(23);
// ckb-js-vm args: 2 flag bytes, contract code hash, hash_type 0x01 (type), collection id
const CAT_ARGS = `0x0000${CONTRACT_TYPE_ID}01${COLLECTION_ID}`;

const DEPLOYS = [
  ["v1", "0x55457b1a4eb44a4ac3f34545615b6489ca23443b92a05c77e42df05e08eec7b3"],
  ["v2", "0x9ed22b7e26d6dcce80210d0b06af155d2de6abab07f300b5e38016f07c4efad9"],
  ["v3", "0x65696c84dabf66070ed044cca2ab4a2713c81d8ccd34be5cd6c7d7a58510badb"],
  [
    "v3.1",
    "0x47c3f0edb11e41b0fb331405c9fb675b84b27b1ee3c82e01836798d5d5aa1d2e",
  ],
];

let id = 0;
async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: ++id, jsonrpc: "2.0", method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const txCache = new Map<string, any>();
async function getTx(hash: string) {
  if (!txCache.has(hash))
    txCache.set(hash, await rpc("get_transaction", [hash]));
  return txCache.get(hash);
}

const isCat = (o: any) =>
  o.type?.code_hash === CKB_JS_VM && o.type.args === CAT_ARGS;

function decode(data: string) {
  const b = ccc.bytesFrom(data);
  const skin = b[2];
  return { version: b[0], level: b[1], skin, role: b[3], crate: skin === 0 };
}
const show = (data: string) => {
  const c = decode(data);
  return c.crate
    ? `crate L${c.level}`
    : `L${c.level} skin ${c.skin} role ${c.role}`;
};
const short = (h: string) => `${h.slice(0, 10)}...${h.slice(-4)}`;

// --- the contract code cell, upgraded in place four times ---
console.log(
  "Contract code cell, Type ID 0x" + CONTRACT_TYPE_ID.slice(0, 8) + "...",
);
for (const [version, hash] of DEPLOYS) {
  const tx = await getTx(hash);
  const out = tx.transaction.outputs[0];
  const data = tx.transaction.outputs_data[0];
  console.log(
    `  ${version.padEnd(5)} ${short(hash)}  block ${parseInt(tx.tx_status.block_number, 16)}` +
      `  ${(data.length - 2) / 2} bytes  ${Number(BigInt(out.capacity) / 100_000_000n)} CKB` +
      `  type args ${out.type.args.slice(0, 10)}...`,
  );
}

// --- every transaction that touched a CatCell ---
const search = {
  script: { code_hash: CKB_JS_VM, hash_type: "type", args: CAT_ARGS },
  script_type: "type",
  script_search_mode: "exact",
};
const found = await rpc("get_transactions", [search, "asc", "0x400"]);
const hashes = [...new Set<string>(found.objects.map((o: any) => o.tx_hash))];

const counts: Record<string, number> = {};
const reveals: { hash: string; input: any; outData: string }[] = [];
console.log(`\nCatCell transactions: ${hashes.length}`);
for (const hash of hashes) {
  const tx = await getTx(hash);
  const t = tx.transaction;
  const ins: { input: any; data: string }[] = [];
  for (const input of t.inputs) {
    const prev = (await getTx(input.previous_output.tx_hash)).transaction;
    const i = parseInt(input.previous_output.index, 16);
    if (isCat(prev.outputs[i])) ins.push({ input, data: prev.outputs_data[i] });
  }
  const outs = t.outputs
    .map((o: any, i: number) => (isCat(o) ? t.outputs_data[i] : null))
    .filter(Boolean) as string[];

  let shape: string;
  if (ins.length === 0) shape = "MINT";
  else if (outs.length === 0) shape = "RELEASE";
  else if (ins.length === outs.length) {
    const opened = ins.filter(
      (x, i) => decode(x.data).crate && !decode(outs[i]).crate,
    );
    opened.forEach((x) =>
      reveals.push({ hash, input: x.input, outData: outs[ins.indexOf(x)] }),
    );
    shape = opened.length ? "REVEAL" : "TRANSFER";
  } else shape = "MERGE";
  counts[shape] = (counts[shape] ?? 0) + 1;

  const owner = t.outputs.find(isCat)?.lock ?? null;
  const lock =
    owner?.code_hash ===
    "0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac"
      ? " (JoyID)"
      : "";
  console.log(
    `  ${shape.padEnd(8)} ${short(hash)}  ${ins.length} in ${outs.length} out  ` +
      (outs.length
        ? outs.map(show).join(", ")
        : ins.map((x) => show(x.data)).join(", ") + " burnt") +
      lock,
  );
}
console.log(
  "  " +
    Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(", "),
);

// --- recompute every reveal: seed = blake2b(nonce ‖ transactions_root ‖ crate out point)
// of the block right after the crate's block, cat line = 1 + u32le(seed) % 15 ---
console.log("\nReveals recomputed from block headers:");
for (const { hash, input, outData } of reveals) {
  const prev = await getTx(input.previous_output.tx_hash);
  const crateBlock = parseInt(prev.tx_status.block_number, 16);
  const header = await rpc("get_header_by_number", [
    "0x" + (crateBlock + 1).toString(16),
  ]);
  const nonce = new Uint8Array(16);
  let n = BigInt(header.nonce);
  for (let i = 0; i < 16; i++, n >>= 8n) nonce[i] = Number(n & 0xffn);
  const outPoint = ccc.OutPoint.from({
    txHash: input.previous_output.tx_hash,
    index: input.previous_output.index,
  }).toBytes();
  const seed = ccc.bytesFrom(
    ccc.hashCkb(
      ccc.bytesConcat(nonce, ccc.bytesFrom(header.transactions_root), outPoint),
    ),
  );
  const skin =
    1 + (new DataView(seed.buffer, seed.byteOffset).getUint32(0, true) % 15);
  const got = decode(outData);
  const ok = got.skin === skin && got.role === (skin - 1) % 4;
  console.log(
    `  ${short(hash)}  crate in block ${crateBlock}, seed from ${crateBlock + 1}` +
      `  -> skin ${skin} role ${(skin - 1) % 4}  on chain: skin ${got.skin} role ${got.role}  ${ok ? "match" : "MISMATCH"}`,
  );
}
