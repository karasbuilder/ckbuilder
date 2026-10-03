# Builder Track Weekly Report, Week 6

**Name:** Karas

**Week Ending:** 25 September 2026

**Repo:** https://github.com/karasbuilder/ckbuilder

**Focus:** CCC, wallets, and moving the evidence to public testnet

## 1. Summary

Everything new this week ran on public testnet, so every hash below can be opened on the explorer by anyone. I built a small CCC frontend whose connect button offers JoyID, MetaMask, OKX, UniSat and UTXO Global, and ran its send path on testnet.

The part that taught me the most was giving the testnet key to two different CCC signers. The same 32 bytes produced two addresses under two different lock scripts. I funded the second one, an Omnilock address holding an Ethereum address, and spent it back with the kind of signature MetaMask makes. No CKB key was involved in that spend, and the lock script was the only thing deciding whether it was allowed.

## 2. Goals

- [x] Read the CCC docs and the wallet integration pages
- [x] Build a frontend that connects a wallet through the CCC connector
- [x] Run the frontend's send code on testnet
- [ ] Sign a testnet transfer in the app with my own JoyID wallet
- [x] Spend CKB from an EVM account through Omnilock, on testnet
- [x] Move this week's evidence off devnet

No faucet run this week. The testnet account from week 1 still held 298,125 CKB.

## 3. Courses and documentation

- [CCC introduction](https://docs.ckbccc.com/en/docs/getting-started/introduction), the [playground](https://live.ckbccc.com) and the [API reference](https://api.ckbccc.com).
- [Intro to wallets](https://docs.nervos.org/docs/integrate-wallets/intro-to-wallets) and the [CCC wallet connector](https://docs.nervos.org/docs/integrate-wallets/ccc-wallet).
- [How to sign a transaction](https://docs.nervos.org/docs/how-tos/how-to-sign-a-tx).
- [RFC 0042, Omnilock](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0042-omnilock/0042-omnilock.md), and the [Omnilock source](https://github.com/cryptape/omnilock), mainly `c/ckb_identity.h`.
- CCC's own source for `SignerEvm` and `Transaction.completeFee`. As with Spore last week, the source answered questions the docs don't cover.

## 4. Key learnings

**One key, two addresses.** I gave the same private key to `SignerCkbPrivateKey` and to an EVM signer. They produced two different addresses:

| Signer | Lock | Args |
| --- | --- | --- |
| CKB | secp256k1-blake160 | 20 bytes, blake160 of the compressed public key |
| EVM | Omnilock | 22 bytes: `0x12`, the Ethereum address, `0x00` |

A CKB address is a lock script written out as text, so a different lock means a different address and a different set of cells. The key doesn't decide who owns a cell. The lock does. This is the week-4 point about locks being predicates, seen from the wallet side. Supporting MetaMask means using a lock that knows how to check an Ethereum signature, and the chain itself doesn't change at all.

CCC ships `SignerEvm` as an abstract class and leaves the signing to the browser wallet. To test it without a browser, I filled it in with an ethers `Wallet` (`tests/evm-signer.ts`). ethers signs with the same `personal_sign` MetaMask uses, and everything CKB-specific is still CCC's code.

**What the EVM wallet is actually asked to sign.** The secp256k1 signer signs the raw 32-byte sign hash. The EVM signer signs the text `CKB transaction: 0x` followed by that hash in hex, so a MetaMask popup shows something a person can read. Omnilock rebuilds the same thing on chain: `"\x19Ethereum Signed Message:\n83"`, then the text. The 83 is 19 characters of prefix plus 64 of hex. I checked this from chain data. The test takes the committed spend, zeroes the witness lock, recomputes the sign hash, and recovers the signer from the signature. It comes out as `0xf2f26f93...075b`, the address in the Omnilock args.

**What Omnilock refuses, and why both refusals look the same.** I tried two forged spends of the Omnilock cell. In the first, the right key signs the raw hash with no text prefix. In the second, a different Ethereum account signs the right text. Both fail with **-31**, `ERROR_IDENTITY_PUBKEY_BLAKE160_HASH`. Omnilock never "checks a signature" as such. It recovers an address from whatever was signed and compares it with the args, so a wrong message and a wrong signer both come out as a mismatch. The name is inherited from the secp256k1 lock even though an Ethereum address is a keccak hash. These cases run as tests through the node's `estimate_cycles`, which executes the scripts without sending anything. The honest signature runs in 1,449,684 cycles.

**The witness is sized before it is signed.** `prepareTransaction` puts in a placeholder of zeros: 65 bytes for secp256k1, 85 for Omnilock (a 20-byte molecule header, then the 65-byte signature). The sign hash covers that witness with its lock still zero, which is why the placeholder has to be the exact final size. It also lets `completeFeeBy` compute the fee before any wallet is asked to sign. My first version of the signing test read the sign hash off the signed transaction and failed twice for that reason.

**The fee is the size.** At 1,000 shannons per KB, the fee in shannons is the serialized size plus 4:

| Transaction | Size | Fee |
| --- | --- | --- |
| secp256k1, 1 input, 2 outputs | 460 + 4 | 464 shannons |
| same, 2 inputs | 504 + 4 | 508 shannons |
| Omnilock spend, 1 input | 519 + 4 | 523 shannons |

464 is exactly the fee in my week-2 transfer test, which I had written down without knowing where it came from. Each extra input adds 44 bytes, 8 for `since` and 36 for the out point. The explorer shows the Omnilock spend at 0.00000523 CKB and 1,000 shannons/kB.

**Balance is a filter.** `getBalance()` counts only cells with no type script and no data. My account also holds three cells from weeks 1 and 3 (the hello-world code cell, the cell ckb-js-vm runs on, and the 44-byte store-data cell), 1,632 CKB in total, and none of it shows up as balance. `completeInputsByCapacity` uses the same filter, so a transfer can never spend my deployed code as fee. The balance a wallet shows is CCC's answer to "what can be spent without thinking", not everything the lock owns.

## 5. Practical progress

```bash
npm test                              # includes the testnet checks, read-only
node scripts/omnilock-testnet.ts      # sent once, the Omnilock fund and spend
cd web && npm install && npm run dev  # the frontend, http://localhost:5176
cd web && npm run send -- <to> <ckb>  # the frontend's send code with a key
```

New files:

| File | Tests | What it checks |
| --- | --- | --- |
| `tests/evm-signer.ts` | - | `SignerEvm` filled in with an ethers wallet, and the Omnilock witness layout. |
| `tests/signer.mock.test.ts` | 7 | Offline: one key gives two addresses, the args of each, placeholder sizes, signing keeps the size, and what each signer signs. |
| `tests/omnilock.testnet.test.ts` | 8 | The fund and spend checked on testnet, the signature recovered from chain data, the fee, and the two forgeries refused with -31. |
| `tests/completion.testnet.test.ts` | 4 | Builds transfers from the live account and never sends them: the balance filter, what each `complete*` call adds, fee equals size. |
| `scripts/omnilock-testnet.ts` | - | The script that sent the fund and spend. |
| `web/` | - | The CCC frontend. `src/transfer.ts` is its whole send path, and `scripts/send-with-key.ts` runs that same file with a key instead of a wallet. |

The frontend has its own `package.json`. The connector needs `@ckb-ccc/core` 1.22, and the root stays on 1.12.2 so the 68 devnet tests don't move.

Counts, against week 5:

```
npm test            12 suites, 63 tests passed   (was 9 suites, 44 tests)
npm run test:devnet 12 suites, 68 tests passed   (unchanged)
```

Testnet transactions:

| What | Hash | Block |
| --- | --- | --- |
| 300 CKB to the Omnilock address, from secp256k1 | [`0x8ecca8a06fbd06617175be239281c0e90b83b30ad853fb6bfa58b7460cd6f444`](https://testnet.explorer.nervos.org/transaction/0x8ecca8a06fbd06617175be239281c0e90b83b30ad853fb6bfa58b7460cd6f444) | 22,513,725 |
| 100 CKB back, signed by the EVM signer | [`0x8080d03ede43c2cc14d9a5503ea76c9da16e10f7dc3ce495b66c5b299ec0a5e6`](https://testnet.explorer.nervos.org/transaction/0x8080d03ede43c2cc14d9a5503ea76c9da16e10f7dc3ce495b66c5b299ec0a5e6) | 22,513,728 |
| The frontend's send code, 100 CKB | [`0x349bb560ae5e08ee27a918ad2a849297d9007a96e62cbc08a4fb05d42f894758`](https://testnet.explorer.nervos.org/transaction/0x349bb560ae5e08ee27a918ad2a849297d9007a96e62cbc08a4fb05d42f894758) | 22,513,821 |

| Item | Value |
| --- | --- |
| EVM account | `0xf2f26f93a35adbc88b454807493b28b27c75075b` |
| Omnilock address | `ckt1qrejnmlar3r452tcg57gvq8patctcgy8acync0hxfnyka35ywafvkqgj7texlyarttdu3z69fqr5jwegkf782p6mqq26zzvq` |
| Omnilock code hash, testnet | `0xf329effd1c475a2978453c8600e1eaf0bc2087ee093c3ee64cc96ec6847752cb` |
| Omnilock witness lock | 85 bytes |
| Omnilock spend | 519 bytes, 523 shannons, 1,460,430 cycles |

## 6. Project

Not agreed yet. That comes first in week 7, before any build code.

## 7. Challenges

**The test suite hung after passing.** With the testnet client pointed at a dead port, jest finished and then never exited. In `@ckb-ccc/core` 1.12.2, `TransportHttp` starts a 30-second abort timer and clears it only after `fetch` succeeds, so a refused connection leaves the timer running. I only hit a dead port because CCC looks up Omnilock's code cell by its Type ID whenever it prepares an Omnilock spend. The offline test now pins the out point CCC ships with, so it makes no request at all.

**I read the sign hash off the wrong transaction.** Two signing tests failed because I computed the hash after signing. The sign hash covers the witness with its lock zeroed, so it has to come from the prepared transaction. Section 4 explains why that matters for fees.

**Vite warns that `buffer` is externalized.** It comes from `bn.js`, which requires `buffer` inside a `try` and falls back without it, so nothing breaks. The bundle is 1.23 MB, 386 KB gzipped, because the connector ships every wallet it supports.

**The error-code URL the node prints is still a 404**, as in weeks 4 and 5. -31 was matched by hand in `c/ckb_identity.h`.

## 8. Environment

- macOS darwin arm64, Node v25.3.0, OffCKB 0.4.11
- Root: @ckb-ccc/core 1.12.2, ethers 6.17.0 now declared (it was already installed through CCC), jest 29 with ts-jest
- `web/`: @ckb-ccc/connector-react 2.2.0 with @ckb-ccc/core 1.22.0, React 19.3, Vite 8.3, TypeScript 5.8
- Network: public testnet through `https://testnet.ckb.dev/rpc`

## 9. Next week

Build week 1 of 4. Agree the project with Neon first, then write the spec and the list of everything the script must reject, all before writing any implementation.

## 10. Evidence

In `reports/week-06/images/`.

| File | Shows |
| --- | --- |
| `w6-01-signer-mock.png` | One key, two signers, offline: addresses, args, placeholder sizes, what each signs |
| `w6-02-omnilock-testnet.png` | The Omnilock fund and spend checked on testnet, and both forgeries refused with -31 |
| `w6-03-completion-testnet.png` | Completing a transfer from the live account without sending it |
| `w6-04-web-send.png` | The frontend's send code run with a key, committed on testnet |
| `w6-05-web-connect.png` | The frontend before a wallet is connected |
| `w6-06-web-wallets.png` | The CCC connector's wallet list |
| `w6-07-explorer-omnilock.png` | The Omnilock spend on the testnet explorer |
| `w6-08-npm-test.png` | `npm test`, 12 suites, 63 tests |
| `w6-09-test-devnet.png` | `npm run test:devnet`, 12 suites, 68 tests |
