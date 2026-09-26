import { ccc } from "@ckb-ccc/connector-react";
import { useEffect, useState } from "react";
import { lockName, sendCkb } from "./transfer.ts";

const EXPLORER = "https://testnet.explorer.nervos.org";

type Account = { address: string; lock: string; balance: bigint };

export function App() {
  const { open, disconnect, wallet } = ccc.useCcc();
  const signer = ccc.useSigner();

  const [account, setAccount] = useState<Account>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");

  useEffect(() => {
    setAccount(undefined);
    if (!signer) return;
    let live = true;
    (async () => {
      const next = {
        address: await signer.getRecommendedAddress(),
        lock: await lockName(signer),
        balance: await signer.getBalance(),
      };
      if (live) setAccount(next);
    })();
    return () => {
      live = false;
    };
  }, [signer, txHash]);

  const send = async () => {
    if (!signer) return;
    setStatus("Waiting for the wallet to sign");
    setTxHash("");
    try {
      const hash = await sendCkb(signer, to.trim(), amount);
      setTxHash(hash);
      setStatus("Sent. The explorer shows it once it lands in a block.");
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main>
      <header>
        <h1>CKBuilder week 6</h1>
        <span className="net">testnet</span>
      </header>

      {!wallet ? (
        <section>
          <p>Connect a wallet to read its balance and send testnet CKB.</p>
          <button onClick={open}>Connect wallet</button>
        </section>
      ) : (
        <>
          <section>
            <div className="wallet">
              <img src={wallet.icon} alt="" />
              <strong>{wallet.name}</strong>
              <button className="quiet" onClick={disconnect}>
                Disconnect
              </button>
            </div>
            <dl>
              <dt>Address</dt>
              <dd className="mono">{account?.address ?? "..."}</dd>
              <dt>Lock</dt>
              <dd>{account?.lock ?? "..."}</dd>
              <dt>Balance</dt>
              <dd>
                {account
                  ? `${ccc.fixedPointToString(account.balance)} CKB`
                  : "..."}
              </dd>
            </dl>
          </section>

          <section>
            <h2>Send</h2>
            <label>
              To
              <input
                className="mono"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="ckt1..."
              />
            </label>
            <label>
              Amount, CKB
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <button onClick={send} disabled={!to.trim() || !amount}>
              Send
            </button>
            {status && <p className="status">{status}</p>}
            {txHash && (
              <p className="mono">
                <a href={`${EXPLORER}/transaction/${txHash}`} target="_blank">
                  {txHash}
                </a>
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
