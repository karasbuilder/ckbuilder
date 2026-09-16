# Builder Track Weekly Report, Week 5

**Name:** Karas

**Week Ending:** 18 September 2026

**Repo:** https://github.com/karasbuilder/ckbuilder

**Focus:** Spore and digital objects, and RFC 0025 read against the xUDT from week 3

## 1. Summary

Minted a cell that holds a PNG, read the PNG back out of the chain, then melted the cell and watched all 573 CKB come home. Doing the round trip is what made the difference from a conventional NFT concrete. The file sits in the cell itself, and the 573 CKB comes back when the cell goes.

The week did not go the way the tutorial suggests. The Spore scripts OffCKB ships are the CoBuild build, so every mint, transfer and melt has to carry a second, signed statement of what the transaction claims to be doing, and the script rejects the transaction if the two disagree. There is no npm package for that in this repo, so I wrote the schemas by hand. They were wrong for about an hour in a way that produces valid bytes and an opaque error code.

Tokens were done early, in week 3, so this week also picked up the one token thing still open: RFC 0025, read against the xUDT I already issued. I went in with an assumption about where the two standards differ, tested it, and was wrong.

## 2. Goals

- [x] Complete the Create DOB exercise, the last of the five basic ones
- [x] Mint a spore holding real image content
- [x] Read the content back from chain and render it to a file
- [x] Melt a spore and measure the capacity returned
- [x] Prove the immutability rule rather than quoting it
- [x] Create a cluster and prove membership is chain enforced
- [x] Read RFC 0025 and check it against the week-3 xUDT on chain
- [ ] Sketch project ideas and send them to Neon

## 3. Courses and documentation

- [Create a DOB](https://docs.nervos.org/docs/dapp/create-dob), read as reference, then written from scratch against the protocol rather than the SDK.
- [docs.spore.pro](https://docs.spore.pro/), the protocol model, spore against cluster, the immutability rules.
- [spore-contract](https://github.com/sporeprotocol/spore-contract) source, specifically `contracts/spore/src/entry.rs` and `lib/errors/src/error.rs`. This ended up mattering more than the prose docs.
- [ckb-transaction-cobuild-poc](https://github.com/cryptape/ckb-transaction-cobuild-poc), the CoBuild schemas and `fetch_message`.
- [RFC 0025, sUDT](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0025-simple-udt/0025-simple-udt.md), read against [RFC 0052, xUDT](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0052-extensible-udt/0052-extensible-udt.md) from week 3.

## 4. Key learnings

**The content is the asset.** A spore cell's data is one molecule table and the file sits inside it:

```
table SporeData {
  contentType: Bytes,
  content:     Bytes,
  clusterId:   BytesOpt,
}
```

The PNG magic number `89504e470d0a1a0a` is in the cell data, on chain, and reading the live cell and writing `content` to disk produces a file with the same sha256 as the one I minted. There is no gateway, no pin, no host that can disappear. Overhead on top of the file is 33 bytes: 24 of molecule framing and the 9 ascii characters of `image/png`.

**One byte of content is one CKB of locked capacity.** My image is 414 bytes, so the cell is 573 CKB: 8 for the capacity field, 53 for the lock, 65 for the type, 447 for the data. 414 of those 573 bytes are the picture. Knowing that changed what I was willing to put on chain.

**Melting is what makes the price bearable.** A spore can be destroyed by whoever can unlock it, and the capacity returns. Measured on chain:

| | Balance, CKB |
| --- | --- |
| Before mint | 41980786.87895958 |
| After mint | 41980213.87894584 |
| After melt | 41980786.87893778 |
| Net cost | 0.0000218 |

The entire 573 CKB came back. What is gone is two transaction fees. The mint is closer to a **deposit** than a purchase: the holder collateralises the storage and can exit whenever they want. That gives a DOB a floor it cannot fall below, held up by the storage model instead of by a market.

**The content cannot be edited, and the script is what stops you.** Flipping the last byte of the image and transferring the spore gets error code **61**, `ModifySporePermanentField`. Relabelling `image/png` as `image/gif`, same nine characters so the capacity still balances, gets **61** as well. There is no metadata update and no reveal. If the content has to change, you mint a new spore.

**The spore id is the Type ID rule wearing a different hat.** `args` are `hash(first input outpoint, output index)`, exactly what week 4 worked through for Type ID, and a forged one is refused with **63**. The same rule that gives a script a stable identity across upgrades gives a DOB an id nobody else can claim. Minting with an id I chose myself is not possible, because an outpoint spends once.

**CoBuild, which nobody warned me about.** The deployed spore script does not just validate the transaction. It also demands a witness declaring, in a structured and signable form, *what the transaction means*:

```
WitnessLayout::SighashAll {
  seal: Bytes,
  message: Message { actions: [ Action { script_info_hash, script_hash, data } ] },
}
```

where `data` is a `SporeAction`, here `MintSpore { spore_id, to, data_hash }`. The script recomputes the spore id and the hash of the cell data and compares them against what the action claims. Lie in the action and you get **12**, `SporeActionFieldMismatch`. Omit the witness entirely and you get **8**.

The point of this is worth stating, because it is not obvious from the error codes: a wallet signing a raw CKB transaction is signing a blob of inputs and outputs no human can read. CoBuild makes the transaction carry a machine-checkable sentence, "mint spore X with content hashing to Y, to address Z", that the script itself verifies is true. It is a signing-surface fix, not a validation fix. The union tags start at `0xff000001` precisely so a CoBuild witness can never be mistaken for a legacy `WitnessArgs`, which is how both can sit in one transaction.

**Clusters are collections the chain agrees with.** A cluster is its own cell type with its own id under the same rule, and its data holds the name and description. A spore that names a cluster has to put the cluster cell in the transaction's cell deps and prove it is entitled to join, which here means the cluster's own lock appears in both the inputs and the outputs. Without the dep it is refused with **6**, `ClusterCellNotInDep`, and a cluster that was never created cannot be claimed at all, because there is no cell to put in the deps. Which means the chain is what checks "this DOB belongs to collection X", instead of a marketplace asserting it. It costs 36 bytes, not 32: `BytesOpt` pays a four-byte length prefix on the 32-byte id.

**sUDT against xUDT, and the assumption I got wrong.** Both standards write the amount as a little endian u128 in the first 16 bytes of cell data, and I checked that the sUDT cell's data is byte-identical to the week-3 xUDT cell's for the same amount. Both hold the owner lock hash in the type script args, and both give the same `-52` when a holder tries to mint one extra token.

I assumed the difference was that xUDT reads on past the amount where sUDT stops. It does not. I minted a 20-byte cell under each, four junk bytes after the amount, and both accepted it. Then I moved each cell without the owner lock, expecting xUDT to finally read its extension field, and both accepted that too.

The flags are in the **type script args**, after the owner lock hash, not in the cell data. That is why adding them changes the token's identity: the type script hash changes, so cells under plain args and cells under extended args are not fungible with each other even though the code hash is the same.

Flag 0 means no extension and mints cleanly. Flag 1 means a molecule `ScriptVec` naming extension scripts follows, and the two ways of getting that wrong fail differently, which is how I know the parsing order: a bare 32-byte script hash is refused with **47**, `ERROR_INVALID_MOL_FORMAT`, because it is not a `ScriptVec` and xUDT never gets as far as looking for a script. A well formed `ScriptVec` naming a script that is not deployed anywhere is refused with **1**, from `ckb_dlopen2` failing to find a dep cell. sUDT has nowhere to put any of this, because rule 2 defines the args as the owner lock hash and stops.

The question worth asking is whether the token will ever need an extension. xUDT costs nothing extra until it does.

## 5. Practical progress

```bash
offckb node                                    # terminal 1
node scripts/make-dob-image.js                 # regenerates the image, 414 bytes
npm test
npm run test:devnet
```

The image is generated by hand rather than taken from a photo library, because on CKB the file size is the price and a file you can regenerate is a file whose size you chose. `scripts/make-dob-image.js` writes a 64x64 PNG with no dependencies beyond Node's zlib.

New files:

| File | Tests | What it checks |
| --- | --- | --- |
| `tests/spore-helper.ts` | - | `SporeData` and `ClusterDataV2` codecs, the devnet script config, the image fixture. |
| `tests/spore-cobuild.ts` | - | The CoBuild and SporeAction schemas, written out from the contract source, and the witness builder. |
| `tests/spore-data.mock.test.ts` | 6 | The cell data layout offline: the PNG round trips byte for byte, the bytes really are in there, 33 bytes of overhead, a cluster id costs 36. |
| `tests/spore-cobuild.mock.test.ts` | 6 | The witness offline: the `0xff000001` tag, the action round trip, the 281-byte size, and the `seal` before `message` trap. |
| `tests/spore.devnet.test.ts` | 16 | Mint, verify the id rule, render the PNG back from chain, capacity accounting, the three rejections on transfer, melt, and three rejections on mint. |
| `tests/spore-cluster.devnet.test.ts` | 4 | Cluster creation, a spore joining it for real, and the two ways a membership claim fails. |
| `tests/sudt.devnet.test.ts` | 10 | sUDT issued and compared with the week-3 xUDT: same amount layout, same args rule, same `-52`, and where the extension actually lives. |

Counts, against week 4:

```
npm test             9 suites, 44 tests passed   (was 7 suites, 32 tests)
npm run test:devnet 12 suites, 68 tests passed   (was 9 suites, 38 tests)
```

Devnet transactions:

| What | Hash |
| --- | --- |
| Spore minted, 414-byte PNG | `0x869bf20efb148a8059514b0bbb759b67bfd37e04a0875dd46ed30541c93e4529` |
| Same spore melted | `0x661f9cba3dc98ce067045878b4d35f272b3eab66e394eb454777f4d4b33d74af` |
| Cluster created | `0x14affe99562fa635cc23dd064bbfb416f460bbcf6d09bca02e12934a402608a3` |
| Spore minted into that cluster | `0x73b9532f1292dbd7ccf93dc61aaa2c05cf6b2e7cd7958c85b63ee14772e11bbe` |
| sUDT issued, 1,000,000 | `0xc58cea75b8ebd0e345130bfb5b7b5ef22f141c7a9b9cb807c98569bfa479e682` |

| Item | Value |
| --- | --- |
| Spore id | `0x1ba43b64a970799405c95818c78fb579d39c925fd1acf24dbd41a2508895ca8f` |
| Cluster id | `0xe9cc90c5c9d71402b8c2ca18df6575656e0fa5546cab13f2f766d7d2ac34876f` |
| Clustered spore id | `0x3da6590e3d55a2aa0acde5afd85afd9d940b2d43eb11303265fb06477b00efa3` |
| Spore code hash, devnet | `0x7e8bf78a62232caa2f5d47e691e8db1a90d05e93dc6828ad3cb935c01ec6d208` |
| Cluster code hash, devnet | `0x7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075` |
| Image sha256 | `66b3a4456e56cb777f0209ebe0915cdc7632866b42ecd87e134642e83e892e02` |
| Content | 414 bytes, `image/png`, 64x64 |
| SporeData size | 447 bytes |
| Spore cell | 573 CKB, 609 CKB inside a cluster |
| CoBuild witness | 281 bytes |

All devnet, so nobody else can check these hashes. Every number above comes from the run in the screenshots.

Error codes collected this week, all of them the script's own rather than generic transaction errors:

| Code | Meaning | How I got it |
| --- | --- | --- |
| 6 | `ClusterCellNotInDep` | Joining a cluster without the cluster cell in the deps |
| 8 | `InvliadCoBuildWitnessLayout` (typo is in the contract source) | No CoBuild witness, or one the script cannot parse |
| 12 | `SporeActionFieldMismatch` | An action naming a different spore, or a wrong data hash |
| 47 | xUDT `ERROR_INVALID_MOL_FORMAT` | Flag 1 args that are not a molecule `ScriptVec` |
| 1 | xUDT, `ckb_dlopen2` found nothing | Flag 1 naming an extension script with no dep cell |
| 61 | `ModifySporePermanentField` | Editing the content, or relabelling the content type |
| 63 | `InvalidSporeID` | An id not derived from the first input |
| -52 | xUDT and sUDT, amount increased | A holder minting one extra token without the owner lock |

## 6. Challenges

**The CoBuild witness cost an hour and the error told me nothing.** Error code 8 means `fetch_message` found no witness it could parse, which covers "you forgot it", "it is in the wrong place" and "one field is in the wrong order" equally. I chased the wrong two first, checking whether the witness index had to stay under the input count and rebuilding the transaction with two inputs to test it. It does not.

The actual cause: `ckb-transaction-cobuild-poc/schemas/basic.mol` declares `table SighashAll { message, seal }`, and the deployed scripts want `seal` first. Both orders encode to valid molecule of the same length, and both decode cleanly on my side, so nothing local can catch it. I found it by unpacking `@ckb-ccc/spore` from npm and reading its codec definitions against mine. The lesson I am taking is narrower than "read the schema": when a schema file and a working client disagree, the client is the one that has been tested against the chain. There is a test in `spore-cobuild.mock.test.ts` that encodes both orders side by side so this stays visible.

**I tested my sUDT assumption and it was wrong, twice.** I expected xUDT to reject cell data with junk after the amount, and it did not. I then expected it to reject on transfer, when owner mode is not in play, and it did not either. Only after that did I go back to RFC 0052 properly and find the flags in the args. The tests kept both dead ends, rewritten as the accepting cases they actually are, because the useful part of the week was being wrong in a way the chain could correct.

**`--testPathIgnorePatterns` has to be repeated by hand for single devnet files.** The jest config excludes `devnet.test.ts` from the default run, so `npx jest tests/spore.devnet.test.ts` alone matches nothing, and `npm run test:devnet` runs all eleven other devnet suites too. Every single-file command in this report carries the override.

**The error-code URL the node prints is still a 404**, as in week 4. Every code above was matched by hand against `lib/errors/src/error.rs` in the contract source.

## 7. Environment

- macOS darwin arm64
- OffCKB 0.4.11, Node v25.3.0
- ckb-debugger 0.200.2, ckb-testtool 1.0.5, @ckb-ccc/core 1.12.2, jest 29 with ts-jest
- No new dependencies. The Spore and CoBuild schemas are written out in `tests/`, not installed.
- Node moved from v22.21.1 in week 4 to v25.3.0. Nothing in the suite needed changing for it.

## 8. Next week

The pivot week. CCC with a real wallet connection, move off devnet to testnet so the evidence is independently checkable, and get the project scoped and agreed with Neon and CKB DevRel before the build window opens in week 7 rather than during it.

## 9. Evidence

In `reports/week-05/images/`.

| File | Shows |
| --- | --- |
| `w5-01-offckb-node.png` | `offckb node` running in terminal 1 |
| `w5-02-spore-mock.png` | The data layout and the CoBuild witness offline, 12 tests |
| `w5-03-spore-mint-melt.png` | Mint, render, the three transfer rejections, melt, the capacity table, and the three mint rejections |
| `w5-04-dob-round-trip.png` | The rendered file and the minted file have the same sha256 |
| `w5-05-cluster.png` | Cluster created, a spore joined to it, and both ways the claim fails |
| `w5-06-sudt-vs-xudt.png` | sUDT issued and compared with the week-3 xUDT |
| `w5-07-npm-test.png` | `npm test`, 9 suites, 44 tests |
| `w5-08-test-devnet.png` | `npm run test:devnet`, 12 suites, 68 tests |
| `w5-dob.png` | The DOB itself, as read back off the chain |
