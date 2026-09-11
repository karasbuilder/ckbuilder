# Builder Track Weekly Report, Week 4

**Name:** Karas

**Week Ending:** 11 September 2026

**Repo:** https://github.com/karasbuilder/ckbuilder

**Focus:** The script validation model, a lock that can say no, and Type ID

## 1. Summary

The first three weeks treated scripts as things that exist. This week I wrote one that has to decide something: a hash lock that opens when the witness carries a preimage hashing to the value in the script args. It's a bad lock on purpose, and working out why it's bad taught me more than a safe one would have.

Type ID landed the same week and explained week 1 in hindsight. My `hello-world` redeploy made a second code cell instead of upgrading the first, because the deployment had `enable_type_id = false`. This week I deployed `hash-lock` with it on, changed the code, redeployed, and unlocked a cell that had been locked before the upgrade.

## 2. Goals

- [x] Read Intro to Script and the script course classes on validation, args and Type ID
- [x] Write a lock of my own rather than following the tutorial's copy
- [x] Deploy `hash-lock` to devnet and unlock a real cell with it
- [x] Prove the lock rejects a wrong preimage, with its own exit code
- [x] Understand Type ID and `hash_type: type` against `data`
- [x] Upgrade a deployed script in place and prove the old locks still work

## 3. Courses and documentation

- [Intro to Script](https://docs.nervos.org/docs/script/intro-to-script), script structure and the lock/type split.
- Script course [class 1](https://docs.nervos.org/docs/script-course/intro-to-script-1) and [class 2](https://docs.nervos.org/docs/script-course/intro-to-script-2), validation model and script basics.
- Script course [class 5](https://docs.nervos.org/docs/script-course/intro-to-script-5) debugging, [class 6](https://docs.nervos.org/docs/script-course/intro-to-script-6) Type ID.
- [Build a Simple Lock](https://docs.nervos.org/docs/dapp/simple-lock), read as reference, then written from scratch as `contracts/hash-lock`.
- [Detailed JS scripting](https://docs.nervos.org/docs/script/js/js-quick-start), for the ckb-js-vm args convention.

## 4. Key learnings

**A script is a predicate, not a program.** It takes a transaction and returns an integer. Zero means proceed, anything else rejects. No state to mutate, nothing to emit. The docs say this in the first paragraph and it didn't land until I wrote one: you don't write "transfer the token", you write "reject any transaction where the amounts don't balance".

**`code_hash` says which code, `hash_type` says how to find it, `args` are per-instance.** That last one is the deployment economics: secp256k1 is deployed once and every CKB address uses it, differing only in `args`. My hash-lock is the same shape, one binary, one expected hash per "account".

ckb-js-vm puts its own metadata in front of my args:

```
0x0000            2 bytes, flags
code_hash        32 bytes, the JS bytecode to load
hash_type         1 byte
expected_hash    32 bytes, mine   <- offset 35
```

So `loadScript().args.slice(35)`. The tutorial never says where 35 comes from. A cell locked by this needs 8 + 32 + 1 + 67 = **108 CKB** occupied.

**The lock, and the four ways it fails.**

```typescript
const expected = args.slice(ARGS_OFFSET);
const witness = HighLevel.loadWitnessArgs(0, bindings.SOURCE_GROUP_INPUT);
const preimage = witness.lock;
if (!preimage || preimage.byteLength === 0) return ERR_NO_PREIMAGE;          // 12
if (!bytesEq(hashCkb(preimage), expected.buffer)) return ERR_WRONG_PREIMAGE; // 11
return 0;
```

The negative tests taught me more than the positive one. Wrong preimage gives **11**, my own code, back from the node as `Inputs[0].Lock, ValidationFailure: see error code 11`. A witness that decodes but has no lock field gives **12**. An empty witness gives **-7**, not 12, because `loadWitnessArgs` can't decode `0x` as molecule and the vm quits before my code runs. I'd assumed my check ran first. It doesn't. The 67-byte args check I wrote off as noise fires with **10** on 66-byte args, and it earns its place, otherwise the lock compares against a truncated hash.

**Why the lock leaks.** The preimage sits in the witness and the witness is public the moment you broadcast. A miner reads it out of the mempool and spends the same cells. Being quick doesn't help. Spend part of your balance and everything else under that hash is open too. The unlock I ran has no signature at all, just `witnesses: [WitnessArgs { lock: preimage }]`, which is the clearest way to see it. A signature lock proves you know the key without sending it. This one sends the secret. Devnet only.

**Type ID fixes the upgrade problem content addressing creates.** With `hash_type: data` a script is the hash of its bytecode, so one changed byte is a different script and old references keep running old code. That's week 1: two deploys, two live cells, one hash, no way to upgrade.

`hash_type: type` matches the dep cell's *type script* hash instead. If that type script is a Type ID it's unique across live cells, because the rules enforce:

1. At most one output may carry it.
2. If an input already carries it, the transaction is an update and rule 3 doesn't apply.
3. Otherwise `args` must be the hash of the first input's OutPoint and the output index. An OutPoint spends once, so it can't be forged.

I wrote the args check against the wrong transaction first. Recomputing `hashTypeId(firstInput, 0)` from the *upgrade* gives something different from what's on the cell, and the test failed. The failure is rule 2: the upgrade inherited its args instead of recomputing them. Both assertions are in the suite now.

**The upgrade.** v1 with `enable_type_id = true`, then one changed log line, rebuild, redeploy. offckb printed `Upgrade keeps the same type-id by consuming the old code Cell and creating a new one`, and the chain agrees: v1 cell dead, one live cell with the Type ID, data hash changed, type id didn't.

The cell I'd deposited *before* the upgrade is the one worth looking at. Its lock args hold the Type ID with `hash_type: type`, so they resolve to the new code, and it unlocked with the v2 cell as its only hash-lock dep. Nothing about the locked cell had to move.

The catch: upgradeability is centralisation. Whoever can unlock the code cell rewrites the rules under everyone using the script. `data` is immutable and trustless, `type` needs someone you trust holding the upgrade key. Decide before deploying, not after.

## 5. Practical progress

```bash
offckb node        # terminal 1
npm test
npm run test:devnet
```

New contract `contracts/hash-lock/src/index.ts` and four test files:

| File | Tests | What it checks |
| --- | --- | --- |
| `tests/hash-lock.mock.test.ts` | 6 | The lock under ckb-debugger: right preimage 0, wrong preimage 11, no lock field 12, empty witness -7, 66-byte args 10. |
| `tests/hash-lock.devnet.test.ts` | 5 | Deposits 200 CKB, checks the 67-byte args and 108 occupied, dry-runs the two rejections against the node, then unlocks for real with no signature. |
| `tests/type-id.devnet.test.ts` | 6 | Type ID type script on the code cell, identity is the type hash not the data hash, args match `hashTypeId(first input, 0)` of the creating transaction, the upgrade inherited them, one live cell only, hello-world has none. |
| `tests/type-id-upgrade.devnet.test.ts` | 5 | Old code cell consumed, data hash changed while the type id didn't, live cell matches the local artifact, and a cell locked before the upgrade unlocked after it with only the new code cell. |

Counts, against week 3:

```
npm test            7 suites, 32 tests passed   (was 6 suites, 26 tests)
npm run test:devnet 9 suites, 38 tests passed   (was 6 suites, 22 tests)
```

Devnet transactions:

| What | Hash |
| --- | --- |
| `hash-lock` v1 deploy, type id on | `0x43889efae6cdef759b5195ae285362c894b15ec5bb559ee7eca7bbc46f480fe8` |
| Deposit under v1, 200 CKB | `0x4d3ca8c33cbdbf9c6910f07177fddc41ca6135be83aeae3ef2892735a5127c0a` |
| `hash-lock` v2 deploy, upgrade in place | `0x0f79ed0a45747154d92472c4ecd2fc232197bdf94c7f6678b566ad5532f034a5` |
| Pre-upgrade cell unlocked with v2 code | `0xd5dda05c8e08d6892beb487e0ed928f094f3cfe151535f9b0a590fbddfffadf4` |
| Deposit and unlock from the screenshotted run | `0x6cf3de48817aeb90f3ac1c9cf7efe023107de0df1bb065290596b6e896fff543`, `0xf258fd129334c09b42c74b36c19d39737635601099ed37cd7f126dbc54f90788` |

| Item | Value |
| --- | --- |
| Type ID, both versions | `0x6ee184d1f6f96a569ba366c6bd01bdc3382e258ed18c0a0b3a28313331b39ce8` |
| v1 data hash | `0x15c004edcc37d9399b56f6ffc214a7e2b8660ac9fcb546b968b6a5d4cdeca2d4` |
| v2 data hash | `0x1b0106870708d36083bd6e281cb6a7b67f2131c25ec2d58a33d071193dfa1cf6` |
| Expected preimage hash in the args | `0xd347d354bfcb73b49418c31875260d06bd23ab94fe23321d400a93f063e39d56` |
| Hash-lock script hash | `0x0125fc881fb748e1c425dad53adcb49eedc78c501e0672fbd37da7738a2b10a9` |
| Preimage | `ckbuilder week 4, the preimage is the whole secret` |

All devnet, so nobody else can check these hashes. The preimage is printed on purpose, it's public as soon as the unlock is broadcast.

## 6. Challenges

**The Type ID args test went against the wrong transaction.** It used the transaction the cell lives in now, which is the upgrade, not the creation, and failed with two hashes that looked unrelated. Rule 2 is the answer.

**`offckb deploy --target <dir>` rewrote `deployment/scripts.json` with only that one contract.** The devnet `hello-world` entry vanished, which quietly breaks the week-1 tests that read their code hash from it. Backed it up and merged the entry back by hand, twice.

**The error-code URL the node prints is a 404.** Exit codes have to be matched against my own script by hand.

## 7. Environment

- macOS darwin arm64
- OffCKB 0.4.11, Node v22.21.1 via nvm
- ckb-debugger 0.200.2, ckb-testtool 1.0.5, @ckb-ccc/core 1.12.2, jest 29 + ts-jest
- Otherwise unchanged from week 3

## 8. Next week

Spore and DOBs. Create DOB is the last of the five basic exercises I haven't done - tokens went early, in week 3, so the only token thing still open is reading RFC 0025 against the xUDT I already issued. Also sketching project ideas, because running ahead moved the build forward: the idea gets agreed with Neon in week 6 and the build starts week 7.

## 9. Evidence

In `reports/week-04/images/`.

| File | Shows |
| --- | --- |
| `w4-01-offckb-node.png` | `offckb node` running in terminal 1 |
| `w4-02-hash-lock-mock.png` | The lock under ckb-debugger: 0, 11, 12, -7, 10 |
| `w4-03-hash-lock-devnet.png` | Deposit, wrong preimage rejected with 11, empty witness with -7, then the real unlock |
| `w4-04-type-id.png` | The Type ID rules checked against the chain |
| `w4-05-type-id-upgrade.png` | Old cell consumed, identity unchanged, pre-upgrade cell unlocked with new code |
| `w4-06-deploy-artifacts.png` | `deployment.toml` with `enable_type_id = true`, both migrations, same type id different data hash |
| `w4-07-npm-test.png` | `npm test`, 7 suites, 32 tests |
| `w4-08-test-devnet.png` | `npm run test:devnet`, 9 suites, 38 tests |
