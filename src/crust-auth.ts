import algosdk from "algosdk";
import { bytesToBase64, bytesToHex } from "./utils";
import { toast } from "react-toastify";

/** Text encoder used to convert strings to Uint8Arrays */
const textEncoder = new TextEncoder;

/** Data about the user and the wallet they are using */
type UserData = {
  // The address of the user's account
  account: string,
  // The chain the user is using
  wallet: string,
  // XXX: It is not clear when `pubKey` used instead of `account`
  pubKey?: string,
}

export const CRUST_DEBUG = false;

/** Creates an access token for Crust IPFS W3Auth Pinning Service by signing a transaction that is
 * never sent.
 * @param address The address of the Algorand account
 * @param signTxnsFunc A function for signing a transaction. It is usually an instance of the
 *                     `signTransaction()` function from `useWallet()`.
 * @param algodClient Algod client used to retrieve the suggested transaction parameters. Usually
 *                    the Algod client from `useWallet()`.
 * @return An access token that can be used to access Crust IPFS W3Auth PS endpoints
 */
export async function signLoginAlgorandForCrustIpfsEndpoint(
  address: string,
  signTxnsFunc: <T extends algosdk.Transaction[] | Uint8Array[]>(txnGroup: T | T[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>,
  algodClient: algosdk.Algodv2
) {
  // Already logged in, so simply return the token in storage
  if (isCrustAuth()) {
    return localStorage.getItem('authBasic')
  }

  const user: UserData = { account: address, wallet: "algorand" };
  const prefix = getPrefix(user);
  let signedData: (Uint8Array | null)[];

  try {
    toast.info("Sign the transaction to authenticate for Crust IPFS.")

    // XXX: Many wallets do not fully support signing arbitrary bytes yet, so a transaction is
    // signed instead

    // Sign a message
    // signedData = await peraWallet.signData(
    //   [{
    //     // The data that is to be signed is simply the account address
    //     data: textEncoder.encode(address),
    //     // This is the message displayed to the user that is used to explain the reason for signing
    //     // the data
    //     message: "For login"
    //   }],
    //   user.account
    // )

    signedData = await signTxnsFunc([algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: address,
      to: address,
      amount: 0,
      note: textEncoder.encode('For authenticating with Crust. Transaction will not be sent.'),
      suggestedParams: await algodClient.getTransactionParams().do(),
    })])
  } catch (err: any) {
    throw Error("Algorand wallet signing for Crust IPFS error: " + err);
  }

  if (signedData[0] === null || signedData[0].length === 0) {
    // Signed data is empty, something must have gone wrong
    throw Error('Algorand wallet signing for Crust IPFS error: No signed data returned from wallet')
  }

  // Create Crust IPFS W3Auth Pinning Service access token in the format described in
  // <https://wiki.crust.network/docs/en/buildIPFSW3AuthPin#usage> (as of October 2025). According
  // to the docs, the access token is a Base64 encoding of a string that was in the format:
  // `<prefix>-<address/public key>-<signed message in hex>`

  const sigHex = bytesToHex(signedData[0])
  const formattedSig = `${prefix}-${address}:${sigHex}`

  return await bytesToBase64(textEncoder.encode(formattedSig));
}

export function isCrustAuthFail() {
  return !!localStorage.getItem('authBasicFail');
}

export function isCrustAuth() {
  // localStorage.setItem("authBasic", authBasic);
  const token = localStorage.getItem("authBasic");
  if (token === "" || token === undefined || token === null) {
    return false;
  }

  return true;
}

const getPrefix = (user: UserData) => {
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
