import { peraWallet } from "./utils";

export const CRUST_DEBUG = false;

// Algorand wallet
export async function signLoginAlgorandForCrustIpfsEndpoint(address: string) {
  const u: any = {
    account: address,
    wallet: "algorand",
  };
  const msg =
    u.wallet === "near" ||
    u.wallet === "aptos-martian" ||
    u.wallet === "aptos-petra" ||
    u.wallet === "web3auth"
      ? u.pubKey || ""
      : u.account;
  const prefix = getPerfix(u);
  // use remark as singmsg
  await peraWallet.reconnectSession();
  return peraWallet
    .signData([{ data: Buffer.from(msg), message: "For login" }], u.account)
    .then((signedData) => {
      //@ts-expect-error didn't write this, not touching it
      return window.btoa(String.fromCharCode.apply(null, signedData[0]));
    })
    .then((signature) => {
      if (signature.length) {
        const perSignData =
          u.wallet === "elrond" ? signature : `${prefix}-${msg}:${signature}`;
        const base64Signature = window.btoa(perSignData);
        const authBasic = `${base64Signature}`;
        return authBasic;
      }
      return "";
    })
    .catch((err: any) => {
      throw Error("Algorand wallet signMessage error: " + err.message);
    });
}

export function isCrustAuth() {
  // localStorage.setItem("authBasic", authBasic);
  const token = localStorage.getItem("authBasic");
  if (token === "" || token === undefined || token === null) {
    return false;
  }

  return true;
}

const getPerfix = (user: any) => {
  if (
    user.wallet.startsWith("metamask") ||
    user.wallet === "metax" ||
    user.wallet === "wallet-connect" ||
    user.wallet === "web3auth"
  ) {
    return "eth";
  }

  if (user.wallet === "near") {
    return "near";
  }

  if (user.wallet === "flow") {
    return "flow";
  }

  if (user.wallet === "solana") {
    return "sol";
  }

  if (user.wallet === "elrond") {
    return "elrond";
  }

  if (user.wallet === "algorand") {
    return "algo";
  }

  if (user.wallet === "aptos-martian") {
    return "aptos";
  }

  if (user.wallet === "aptos-petra") {
    return "aptos";
  }
  if (user.wallet === "ton-connect") {
    return "ton";
  }
  return "substrate";
};
