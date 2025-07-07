const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');

exports.handler = async (event) => {
  const { mnemonic, receiver, datetime } = JSON.parse(event.body || '{}');
  if (!mnemonic || !receiver || !datetime) {
    return { statusCode: 400, body: '❌ Data tidak lengkap' };
  }

  async function getKeypairFromMnemonic(mnemonic) {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const { key } = ed25519.derivePath("m/44'/314159'/0'", seed.toString('hex'));
    const keypair = StellarSdk.Keypair.fromRawEd25519Seed(key);
    return { keypair, publicKey: keypair.publicKey(), secretKey: keypair.secret() };
  }

  async function startFastBot() {
    const { keypair, publicKey } = await getKeypairFromMnemonic(mnemonic);
    const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

    try {
      const account = await server.loadAccount(publicKey);
      const claimables = await server.claimableBalances().claimant(publicKey).call();

      if (claimables.records.length > 0) {
        for (let cb of claimables.records) {
          const tx = new StellarSdk.TransactionBuilder(account, {
            fee: (await server.fetchBaseFee()).toString(),
            networkPassphrase: 'Pi Network'
          })
            .addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceId: cb.id }))
            .setTimeout(30)
            .build();

          tx.sign(keypair);
          await server.submitTransaction(tx);
        }
      }

      const accInfo = await axios.get(`https://api.mainnet.minepi.com/accounts/${publicKey}`);
      const balance = parseFloat(
        accInfo.data.balances.find(b => b.asset_type === 'native')?.balance || "0"
      );

      if (balance > 0.01) {
        const amount = balance - 0.01;
        const reload = await server.loadAccount(publicKey);
        const tx = new StellarSdk.TransactionBuilder(reload, {
          fee: (await server.fetchBaseFee()).toString(),
          networkPassphrase: 'Pi Network'
        })
          .addOperation(StellarSdk.Operation.payment({
            destination: receiver,
            asset: StellarSdk.Asset.native(),
            amount: amount.toFixed(7)
          }))
          .setTimeout(30)
          .build();

        tx.sign(keypair);
        await server.submitTransaction(tx);
        return { statusCode: 200, body: `✅ Sukses transfer ${amount.toFixed(7)} Pi` };
      } else {
        return { statusCode: 200, body: "⏳ Saldo belum cukup" };
      }
    } catch (err) {
      return {
        statusCode: 500,
        body: "❌ Gagal: " + (err.response?.data?.extras?.result_codes || err.message)
      };
    }
  }

  const targetTime = new Date(datetime).getTime();
  const now = Date.now();
  const delay = targetTime - now;

  if (delay <= 0) {
    return await startFastBot();
  } else {
    setTimeout(() => startFastBot(), delay);
    return {
      statusCode: 200,
      body: `⏳ Bot akan mulai pada ${new Date(targetTime).toLocaleString('id-ID')} WIB`
    };
  }
};