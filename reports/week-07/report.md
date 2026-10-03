# Builder Track Weekly Report, Week 7

**Name:** Karas

**Week Ending:** 2 October 2026

**Repo:** https://github.com/karasbuilder/ckbuilder

**Project:** Nine Cells, a merge tower defense game ([brief](https://docs.google.com/document/d/1gyfgirT0tEwG0wIreZJ-OtbDqQOxSMv8VQ4z1ZiVyMU/edit?usp=sharing), [demo](https://nine-cells.karasdev.com/))

**Focus:** Build week 1 of 4: the CatCell type script, from rejection list to testnet

## 1. Summary

The plan for this week was the spec, the list of everything the script must reject, and an empty skeleton on devnet. I got further than that. The type script is on public testnet with Type ID, I upgraded it in place three times, and the game's Vault mints, merges, sends and releases real cats with it.

The script checks one rule from the game. Two cats of the same level go in, one cat a level higher comes out, and it keeps the line of the cat it was dropped onto. Most of the other checks are there to refuse transactions that break it.

Late in the week I added random cats. The first version could be rerolled for free. Section 4 has the hole and the fix.

## 2. Goals

- [x] A rejection list with one exit code per rule
- [x] Turn every rule into a passing and a failing test, offline with ckb-testtool
- [x] Deploy to devnet, then to testnet with Type ID
- [x] Wire the game's Vault to the deployed script
- [x] Sign a transaction with my own JoyID wallet (left open in week 6)
- [x] Make the cat a player gets from a mint random, decided by the chain and not by the player
- [ ] Prove a mint was earned in a real battle. Still out of scope, see section 6

## 3. Courses and documentation

- [ckb-js-vm](https://docs.nervos.org/docs/script/js/js-quick-start) and the `@ckb-js-std/core` source, mainly `HighLevel.loadHeader` and how `SOURCE_GROUP_*` sources end.
- [RFC 0022, transaction structure](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md), the `header_deps` part, which I had skipped in week 3.
- [RFC 0009, VM syscalls](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0009-vm-syscalls/0009-vm-syscalls.md), for `load_header` and which sources it accepts.
- `offckb deploy --type-id` and the files it writes under `deployment/`.
- My own week 4 notes on Type ID. This week was the first time I upgraded a script that other cells depend on.

## 4. Key learnings

**The transaction shape picks the branch.** The script counts the cells in its own group on each side and dispatches on the pair:

| Inputs | Outputs | Branch |
| --- | --- | --- |
| 0 | 1 or more | MINT |
| n | n | TRANSFER, or REVEAL for a crate |
| 1 or more | 0 | RELEASE |
| 2^k, k ≥ 1 | 1 | MERGE |
| anything else | | reject, exit 10 |

There is no mode flag in the witness, so a transaction cannot say it is a transfer while doing a merge. There is also no syscall that counts a group. The script calls `loadCellData` with a rising index until it fails with `INDEX_OUT_OF_BOUND`, and that index is the count. Week 3's lesson applies to every rule: the script runs once per group, so each check loops over the whole group instead of looking at index 0.

**`throw` does not give an exit code in ckb-js-vm.** Throwing a number from the script does not end it with that number. It comes back as **-7**, because the QuickJS wrapper catches the exception and reports its own code. To make each rule fail with its own number, the script calls `bindings.exit(code)` directly. There are 22 codes now, grouped by branch: 10s for shape and data length, 20s for MINT, 30s for MERGE, 40s for TRANSFER, 50s for crates. Codes 22 and 23 are no longer used, and I did not give them to new rules.

**The input order carries game meaning.** In the game, the merged cat keeps the line of the cat you drop onto. On chain, the script treats the last input as the drop target and checks the output's skin and role against it. The first merge on testnet shows it: a skin 5 cat and a skin 7 cat went in, and a level 10 skin 7 came out. A batch of four level 9 cats became one level 11 in a single transaction, because the level goes up by log2 of the input count.

**Type ID kept every cat valid through three upgrades.** A cat's type script points at ckb-js-vm, and its args carry the contract's code hash. That hash is the Type ID, not the hash of the bytecode, so redeploying the contract changes nothing on any cat. I deployed four versions on testnet and the Type ID stayed `0xbc7cc190...126d` each time. The code cell grew from 31,216 to 32,246 bytes, and its capacity went from 31,342 to 32,372 CKB, which is one CKB per byte plus 126 bytes for the cell itself. The args are 67 bytes (2 flag bytes, the 32-byte code hash, 1 hash type byte, the 32-byte collection id), so a cat with a secp256k1 lock needs 169 CKB.

`offckb deploy` writes the code hash to `scripts.json`, but not the Type ID script itself. CCC needs that script to find the live code cell after an upgrade, so the game's sync tool reads it from the deploy transaction over RPC.

**Randomness from the next block, and the hole in my first version.** From v3 on, MINT only creates a crate (skin 0). A crate is opened by a REVEAL, where the cat's line must be:

```
seed = blake2b(nonce of block N+1 ‖ transactions_root of block N+1 ‖ out point of the crate)
skin = 1 + (first 4 bytes of seed, little-endian) mod 15
```

N is the block that holds the crate. Block N+1 does not exist yet when the crate is created, so whoever mints cannot know the result. The reveal must carry both headers in `header_deps`. The script finds N through `load_header` on the crate input, then looks for exactly N+1 among the header deps. A test checks that a header for N+2 is refused, otherwise a player could choose the block they like best.

Once block N+1 exists, though, anyone can compute the result before opening the crate. In v3 a crate could still be transferred, so a player who saw a bad result could send the crate to themselves. That gives a new out point and a new block, so a new seed. So the player could reroll for free until they got a cat they liked. Releasing the crate and minting again worked the same way. v3.1 closes both: a crate that has not been opened can only be opened, and transferring or releasing it fails with code 54.

One limit remains. The miner of block N+1 could in principle grind the nonce for a result. I'm leaving that for now, since a level 9 cat on testnet is worth much less than a block reward.

To check this on testnet, `scripts/nine-cells-testnet.ts` recomputes all four reveals on testnet from the block headers. All four match what is on chain.

**ckb-js-vm uses a lot of cycles.** A pair merge in ckb-testtool runs in 13,515,741 cycles. On testnet the batch merge took 15,200,972 cycles and the reveal 17,971,738. The Omnilock spend in week 6 took 1,449,684. The gap is the JavaScript VM: ckb-js-vm interprets the script with QuickJS instead of running compiled RISC-V. It is still far below the block limit. The fee is still the size plus 4 at 1,000 shannons/kB: 794 bytes and 798 shannons for the batch merge, 770 and 774 for the reveal.

**JoyID transactions are bigger.** The mint I signed with JoyID is 1,096 bytes, and 367 of them are the JoyID witness, against 65 for secp256k1. The fee came out at 1,753 shannons, a rate of 1,593 shannons/kB instead of the usual 1,000.

## 5. Practical progress

```bash
# contract project (ckb-js-vm)
npm run build:contract nine-cells-cat
npx jest nine-cells-cat.mock                    # 48 cases, offline
offckb deploy --network testnet --target dist/nine-cells-cat.bc --output deployment --type-id

# game
npm test                                        # needs NODE_ENV unset or "test"
npm run chain:sync -- testnet

# this repo, read-only
node scripts/nine-cells-testnet.ts
```

| Part | File | What it is |
| --- | --- | --- |
| Type script | `contracts/nine-cells-cat/src/index.ts` | 312 lines, four branches plus REVEAL, 22 exit codes |
| Script tests | `tests/nine-cells-cat.mock.test.ts` | 48 cases, a passing and a failing case for each rule |
| Game, chain layer | `src/chain/vault.ts`, `src/chain/ccc/vaultOps.ts` | The same rules on the client, and mint, merge, transfer, release and reveal over CCC |
| Game, quick mode | `src/chain/session.ts`, `src/chain/ccc/sessionOps.ts` | A session key funded once from the main wallet, so a run of actions needs no popups |
| Testnet check | `scripts/nine-cells-testnet.ts` (this repo) | Lists every CatCell transaction by shape and recomputes the reveals |

Counts:

```
nine-cells-cat mock   1 suite,  48 tests passed
game npm test         31 files, 430 tests passed, 8 skipped (the devnet ones)
```

Contract versions on testnet, all under Type ID `0xbc7cc190ac166a31de875e6fc4b0571903d62c665c25a84ec4f971277dd4126d`:

| Version | What changed | Deploy tx | Block |
| --- | --- | --- | --- |
| v1 | Four branches, one cat per transaction | [`0x55457b1a...c7b3`](https://testnet.explorer.nervos.org/transaction/0x55457b1a4eb44a4ac3f34545615b6489ca23443b92a05c77e42df05e08eec7b3) | 22,587,856 |
| v2 | Batches for MINT, TRANSFER and RELEASE | [`0x9ed22b7e...fad9`](https://testnet.explorer.nervos.org/transaction/0x9ed22b7e26d6dcce80210d0b06af155d2de6abab07f300b5e38016f07c4efad9) | 22,588,276 |
| v3 | Crates and REVEAL | [`0x65696c84...badb`](https://testnet.explorer.nervos.org/transaction/0x65696c84dabf66070ed044cca2ab4a2713c81d8ccd34be5cd6c7d7a58510badb) | 22,589,003 |
| v3.1 | Crates can only be opened | [`0x47c3f0ed...1d2e`](https://testnet.explorer.nervos.org/transaction/0x47c3f0edb11e41b0fb331405c9fb675b84b27b1ee3c82e01836798d5d5aa1d2e) | 22,589,716 |

By the end of 2 October there were 31 CatCell transactions on testnet: 18 mints, 4 merges, 4 transfers, 2 releases and 3 reveals. A selection:

| What | Hash | Block |
| --- | --- | --- |
| Pair merge, skin 5 onto skin 7, level 10 skin 7 out | [`0xf6c9b3be...ce5b`](https://testnet.explorer.nervos.org/transaction/0xf6c9b3becda276815994ed51ce83e6c3795604b09414ba1a13b22b76bfe9ce5b) | 22,587,876 |
| Batch merge, four level 9 into one level 11 | [`0x355c4dbe...1e0b`](https://testnet.explorer.nervos.org/transaction/0x355c4dbe2696b81e605728fa8add7b45f50e09a7714eb7a8b414d662f3221e0b) | 22,587,897 |
| Transfer to another address | [`0xc1bd6557...15da`](https://testnet.explorer.nervos.org/transaction/0xc1bd6557d9e7045b5f0b85cc66516f5b69de55f3c3153f172a104c7c409115da) | 22,587,905 |
| Release, the cat's 169 CKB back less the fee | [`0x7906ca15...072a`](https://testnet.explorer.nervos.org/transaction/0x7906ca157c2063d5ec46f85962e29469a22e3e8ef06feef7900c2cc5a615072a) | 22,587,913 |
| Mint signed with my JoyID wallet | [`0x7837c23b...3476`](https://testnet.explorer.nervos.org/transaction/0x7837c23b01660ed6ceec313ac37ff45806c51b04a10036e3fba06f7381a23476) | 22,588,117 |
| Batch mint, three cats in one transaction | [`0x5537fee0...0bc9`](https://testnet.explorer.nervos.org/transaction/0x5537fee003b7ffc06b19df23c750812dc34613dde606c1bcd136d0f1a6ac0bc9) | 22,588,280 |
| Quick mode sweep, two cats from the session key to the main wallet | [`0x33f8a534...85db`](https://testnet.explorer.nervos.org/transaction/0x33f8a5349d468d1d038e466b4b0c29287a1050c033d2727b4d05221e8c1185db) | 22,588,289 |
| Crate opened, skin 7 from the seed | [`0xdfa81fef...b963`](https://testnet.explorer.nervos.org/transaction/0xdfa81fefc4bde23ba9739b6df9420c2772223165d5a5259539e28469bd21b963) | 22,589,020 |

| Item | Value |
| --- | --- |
| ckb-js-vm code hash, testnet | `0x3e9b6bead927bef62fcb56f0c79f4fbd1b739f32dd222beac10d346f2918bed7` |
| Collection id | `"NineCells"` in ASCII, padded to 32 bytes |
| Cat cell data | 8 bytes: version, level, skin, role, `minted_at` as u32 |
| Cat capacity, secp256k1 lock | 169 CKB |
| Contract code cell | 32,246 bytes, 32,372 CKB |

## 6. Project

Nine Cells is a merge tower defense game. A battle runs entirely in the browser and nothing is signed during it. A cat goes on chain only when the player chooses to keep it after a win, and from there the Vault can merge it, send it, or release it for the capacity. Neon's earlier advice was that the most important thing for a game is to be fun, so I built the game first, and the chain only comes in after a battle.

The known weakness from the brief is still there. Battles are computed on the client, so a mint does not prove the player earned the cat. Fixing the mint level at 9 limits the damage, and since v3 the player can't choose the line either. The real fix is to verify the battle replay on chain, which is too big for this build.

## 7. Challenges

**The free reroll.** Covered in section 4. Every test passed while the hole was there, because each rule was correct by itself. I only found it by thinking about what a player would do if they could see the result before opening the crate.

**Every UI test failed at once.** 62 tests failed with `React.act is not a function`. My shell had `NODE_ENV=production`, which loads the production build of React, and that build has no `act`. With `NODE_ENV=test` all 430 pass.

**`throw` reported -7 for every rule.** See section 4. With one code for every failure, a failing test can't say which rule broke, so the script calls `bindings.exit` instead.

**`scripts.json` does not record the Type ID script.** Without it, the game had to pin the code cell's out point, and that out point is spent on every upgrade. The sync tool now reads the Type ID from the deploy transaction, and CCC looks up the live cell by it.

## 8. Environment

- macOS darwin arm64, Node v25.3.0, OffCKB 0.4.11
- Contract project: ckb-js-vm with `@ckb-js-std/core` 1.0, ckb-testtool 1.0.5, `@ckb-ccc/core` 1.12.2, jest 29
- Game: React 19, Phaser 3.90, Vite 7, `@ckb-ccc/ccc` 1.3, vitest 3
- Network: public testnet through `https://testnet.ckb.dev/rpc`

## 9. Next week

Build week 2 of 4. The plan put the core script here, and it is already on testnet, so week 8 goes on hardening. I'll run a devnet test that sends every failing case to a real node and checks the exit code, and I'll try to break the reveal by controlling which block a transaction lands in. After that I want other people to play the demo.

## 10. Evidence

In `reports/week-07/images/`.

| File | Shows |
| --- | --- |
| `w7-01-contract-tests.png` | The type script's 48-case matrix in ckb-testtool, all passing |
| `w7-02-testnet-check.png` | The four Type ID deploys, the 31 CatCell transactions up to 2 October by shape, and the four reveals recomputed from block headers |
| `w7-03-game-tests.png` | The game suite, 430 passing, including the Vault and wallet tests |
| `w7-04-explorer-batch-merge.png` | Four level 9 cats merged into one level 11 on the testnet explorer |
| `w7-05-explorer-reveal.png` | A crate opened on testnet, two header deps, 17,971,738 cycles |
| `w7-06-explorer-joyid-mint.png` | The mint signed with my JoyID wallet |
| `w7-07-demo.png` | The live demo at nine-cells.karasdev.com |
