const { getConnection, getMultipleAccounts, sumTokens2 } = require("../helper/solana");
const { PublicKey } = require("@solana/web3.js");

const RLP_PROGRAM = new PublicKey("JrXLmS6aYJNJDVxdAfjNJE5wikT8ubf3TA9iL2JA9Av");
const PROXY_PROGRAM = new PublicKey("pRoxYU64BSjv8HbhENna8a7LVCrkzzNrnvbYuTwas8C");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const RLP_ASSET_DISC = Buffer.from([234, 180, 241, 252, 139, 224, 160, 8]);
const RLP_POOL_DISC = Buffer.from([66, 38, 17, 64, 188, 80, 68, 129]);
const PROXY_STATE_SIZE = 156;

const ataFor = (mint, owner) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];

async function tvl(api) {
  const connection = getConnection();
  const rlpAccounts = await connection.getProgramAccounts(RLP_PROGRAM);

  const assetMintByIndex = {};
  const rawPools = [];

  for (const { pubkey, account: { data } } of rlpAccounts) {
    if (data.slice(0, 8).equals(RLP_ASSET_DISC)) {
      assetMintByIndex[data[9]] = new PublicKey(data.slice(10, 42));
    } else if (data.slice(0, 8).equals(RLP_POOL_DISC)) {
      rawPools.push({ pubkey, data });
    }
  }

  const pools = rawPools
    .map(({ pubkey, data }) => {
      let offset = 58;
      if (data[offset++] === 1) offset += 8;

      const assetCount = data[offset++];
      const assetIdxs = [...data.slice(offset, offset + 4)];
      offset += 4;

      const protectedVault =
        data[offset++] === 1 ? new PublicKey(data.slice(offset, offset + 32)) : null;

      return { pubkey, assetCount, assetIdxs, protectedVault };
    })
    .filter((pool) => pool.protectedVault);

  const proxies = await getMultipleAccounts(pools.map((pool) => pool.protectedVault));

  const tokenAccounts = [];

  pools.forEach((pool, index) => {
    const proxy = proxies[index];
    if (!proxy || !proxy.owner.equals(PROXY_PROGRAM) || proxy.data.length !== PROXY_STATE_SIZE) return;

    for (let i = 0; i < pool.assetCount; i++) {
      const mint = assetMintByIndex[pool.assetIdxs[i]];
      if (mint) tokenAccounts.push(ataFor(mint, pool.pubkey).toString());
    }

    const stablecoinMint = new PublicKey(proxy.data.slice(32, 64));
    tokenAccounts.push(ataFor(stablecoinMint, pool.protectedVault).toString());
  });

  return sumTokens2({ api, tokenAccounts, allowError: true });
}

module.exports = {
  timetravel: false,
  methodology:
    "Reflect Tranches TVL is the underlying tokens held by the live tranche pools on the RLP program. A pool is live when its protected_vault resolves to a real Reflect Proxy Program ProxyState, which excludes placeholder pools. Junior = the underlying assets held in each RLP pool's per-asset token accounts. Senior = the underlying held by the backstopped proxy vault.",
  solana: { tvl },
};
