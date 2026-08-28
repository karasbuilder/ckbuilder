import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ccc } from "@ckb-ccc/core";
import scripts from "../deployment/scripts.json";

const ARTIFACT = "dist/hello-world.bc";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("contract artifact", () => {
  const bytecode = readFileSync(ARTIFACT);

  it("is non-empty ckb-js-vm bytecode", () => {
    expect(bytecode.length).toBeGreaterThan(0);
  });

  it("rebuilds byte-identically", () => {
    const before = sha256(bytecode);
    execFileSync("npm", ["run", "build"], { stdio: "ignore" });
    expect(sha256(readFileSync(ARTIFACT))).toBe(before);
  });

  it.each(["devnet", "testnet"] as const)(
    "%s codeHash equals blake2b-256 of the artifact",
    (network) => {
      const entry = scripts[network]["hello-world.bc"];
      expect(entry.codeHash.toLowerCase()).toBe(
        ccc.hashCkb(bytecode).toLowerCase(),
      );
      expect(entry.hashType).toBe("data2");
    },
  );
});
