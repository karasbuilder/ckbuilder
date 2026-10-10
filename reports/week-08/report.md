# Builder Track Weekly Report, Week 8

**Name:** Karas

**Week Ending:** 9 October 2026

**Repo:** https://github.com/karasbuilder/ckbuilder

**Project:** Nine Cells, a merge tower defense game ([brief](https://docs.google.com/document/d/1gyfgirT0tEwG0wIreZJ-OtbDqQOxSMv8VQ4z1ZiVyMU/edit?usp=sharing), [demo](https://nine-cells.karasdev.com/))

**Focus:** Build week 2 of 4: hardening the CatCell type script on a real node

## 1. Summary

Last week the type script reached testnet, so this week went on testing it against a real node instead of the mock. I wrote a devnet suite that sends every failing case through `send_transaction` and checks the exit code the node returns. 30 bad transactions, all refused, each with the code I expected.

Three things came out of it that the mock could not show. Five of the 22 exit codes can never be reached from a node. CCC reports the wrong exit code for any code above 9. And the reveal still has a way around it: a player can mint a batch of crates, open them all, keep the line they want and release the rest for about 0.0001 CKB in fees.

## 2. Last week's objectives

| Objective | Status | Note |
| --- | --- | --- |
| Devnet test that sends every failing case to a real node and checks the exit code | Done | 33 tests, 30 rejections, see section 5 |
| Try to break the reveal by controlling which block a transaction lands in | Partly | Choosing another block is refused. Mint, open and release in bulk works, see section 4 |
| Get people other than me to play the demo | Not done | No outside players yet |

## 3. Courses and documentation

- [RFC 0022, transaction structure](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0022-transaction-structure/0022-transaction-structure.md), the part on occupied capacity, to see why three of my codes never fire.
- [CKB script error codes](https://nervosnetwork.github.io/ckb-script-error-codes/), the page every node error links to.
- The `@ckb-ccc/core` 1.12.2 source, `client/jsonRpc/client.js`, where RPC errors are turned into typed errors.
- `offckb node --daemon` and the CKB 0.208.0 devnet it runs.

## 4. Key learnings

**The node checks capacity before the type script runs.** I sent a mint, a merge and a transfer where the cat cell holds 100 CKB, below the 169 CKB it occupies. The node refused all three with `InsufficientCellCapacity`, and the script never ran. So codes 24, 36 and 41 can only be hit in ckb-testtool. I'm keeping them, because they cost nothing and the mock tests still use them, but the report from last week called them rules and on a real chain they are not.

**Two more codes can't be reached because the cell can't exist.** Code 32 needs two cats with different versions. MINT only accepts version 1 and every other branch keeps the version, so there is no version 2 cat to merge. Code 37 needs a level 255 cat, and starting from level 9 that would take 2^246 merges. Together with the three capacity codes, 17 of the 22 codes can be reached from a node, and the suite reaches all 17.

**CCC drops all but the last digit of the exit code.** The first run of the suite failed 27 of 30 cases with codes like 5 instead of 25 and 4 instead of 54. The node message was right. CCC 1.12.2 parses it with `see error code (-?[0-9])* on`, and a repeated group in a JavaScript regex keeps only its last match, so `ErrorClientVerification.errorCode` is the last digit. Codes 0 to 9 come through fine, which is probably why nobody noticed. The suite now reads the code from the message and prints both, so the bug is visible in the output.

**The reveal can be beaten by volume, not by timing.** Picking a different block is refused: a reveal with the header of block N+2 instead of N+1 fails with 50, and so does one missing either header. v3.1 also stops a crate from being sent or released before it is opened (54). But once a crate is opened it is a normal cat, and a normal cat can be released for its capacity. So a player who wants line 1 can do this:

1. Mint 16 crates in one transaction.
2. Wait one block, then open all 16 in one transaction. The lines are random and the player can't change them.
3. Keep the line 1 cat and release the other 15 to get their capacity back.

I ran this on devnet. The 16 crates came out as lines 7 12 14 2 4 11 3 11 4 11 14 13 4 5 1 12, so one was line 1. The three transactions cost 4,221 + 4,989 + 1,045 = 10,255 shannons. A batch of 16 has about a 67% chance of holding any given line, and the player gets the capacity back each time, so trying again is cheap. An earlier run of the same test had no line 1 in its 16.

So the randomness holds per crate, but the player still ends up choosing their line. Mint is open and the level is fixed at 9, so this only affects which lines a player collects. I haven't decided whether to fix it. Making release cost something would mean the type script has to control where the capacity goes, which it does not do today.

## 5. Practical progress

```bash
# contract project (ckb-js-vm)
offckb node --daemon
npm run build:contract nine-cells-cat         # same bytecode as v3.1 on testnet
npx jest nine-cells-cat.mock                  # 48 cases, offline
RUN_DEVNET=1 npx jest nine-cells-cat.reject.devnet --runInBand

# game
npm test                                      # needs NODE_ENV unset or "test"
```

| Part | File | What it is |
| --- | --- | --- |
| Devnet suite | `tests/nine-cells-cat.reject.devnet.test.ts` | 33 tests on a real node: 30 rejections, the passing reveal, merge and release, and the bulk reroll |
| Results | `tests/out/reject-devnet.json` | Each case with the expected code, the node's code, CCC's code, and the tx hash for accepted ones |
| Type script | `contracts/nine-cells-cat/src/index.ts` | Unchanged this week, still v3.1 |

Counts:

```
nine-cells-cat mock         1 suite, 48 tests passed
nine-cells-cat devnet       1 suite, 33 tests passed (30 rejections, all with the expected code)
game npm test               31 files, 430 tests passed, 8 skipped (the devnet ones)
```

The rebuilt `dist/nine-cells-cat.bc` has SHA-256 `90be5dec...ae36`, the same file that is deployed as v3.1 on testnet, so the devnet results apply to the testnet contract.

Exit codes on a real node:

| Code | Rule | Reached on devnet |
| --- | --- | --- |
| 10 | Transaction shape matches no branch | Yes |
| 11 | Cell data is not 8 bytes | Yes |
| 20, 21, 25 | Mint version, level, crate only | Yes |
| 24, 36, 41 | Output below occupied capacity | No, the node refuses first |
| 30, 31, 33, 34, 35, 38 | Merge count, level, output level, line, version, crates | Yes |
| 32 | Merge inputs with different versions | No, no such cell can exist |
| 37 | Merge output above level 255 | No, no such cell can exist |
| 40 | Transfer changes cat data | Yes |
| 50 to 53 | Reveal headers, line, role, other fields | Yes |
| 54 | Crate sent or released before it is opened | Yes |

Devnet transactions from the run in `w8-01`:

| What | Hash |
| --- | --- |
| Mint six crates | `0xbfb379ee...d172` |
| Open six crates, lines from the seed | `0x459cdc56...441a` |
| Merge two level 9 into a level 10 | `0x3159bb6f...5231` |
| Release an opened cat | `0x425f140e...2366` |
| Bulk reroll, mint 16 crates | `0xd4325308...a15a` |
| Bulk reroll, open 16 | `0xba5d4b76...c4eb` |
| Bulk reroll, release 15 and keep line 1 | `0xe54731ca...f64f` |

These are on a local devnet, so there is no explorer link. The full hashes are in the results file.

## 6. Project

No change to the chain side of the game this week. On 3 October I shipped a new splash screen and the crate opening animation: the game mints the crate, waits for the next block, and only shows the cat once the reveal is confirmed, so the animation never decides anything.

The weakness from the brief is unchanged. Battles are computed in the browser, so a mint does not prove the player won anything. Section 4 adds a second weakness: the player can choose which line to keep by minting in bulk.

## 7. Challenges

**27 of 30 cases failed on the first run.** Every one of them was the CCC parsing bug from section 4, not the script. I only found it because the node's own message, printed next to the CCC field, had the right number.

**Getting real inputs for the rejection cases.** A bad transaction needs real cells to spend, and some cases need cats in a specific state: an unopened crate, two cats with different lines, a level 10 cat. The suite builds them in order: it mints six crates, runs the crate cases, opens all six, runs the cat cases, then merges two to get the level 10 for code 31. Refused transactions don't spend anything, so the same cells are reused across cases.

## 8. Environment

- No new dependencies.
- CKB devnet 0.208.0 through OffCKB 0.4.11.
- The suite ran on Node v25.3.0. The screenshots were taken in my own terminal, which has Node v22.21.1. Both pass.

## 9. Next week

Build week 3 of 4.

1. Decide what to do about the bulk reroll: accept it and say so in the brief, or change release so a freshly opened cat can't be released straight away.
2. Report the CCC exit code bug upstream with the one-line fix (`(-?[0-9]+)`).
3. Get at least three other people to play the demo and write down where they get stuck.

## 10. Evidence

In `reports/week-08/images/`.

| File | Shows |
| --- | --- |
| `w8-01-reject-devnet.png` | The devnet suite: every case with the expected code, the node's code and CCC's code, the three capacity cases refused by the node, and the bulk reroll with its fees |
| `w8-02-mock-tests.png` | The 48-case mock suite still passing |
| `w8-03-ccc-errorcode.png` | The regex in CCC 1.12.2 that keeps one digit, and the same match with `+` giving 54 |
