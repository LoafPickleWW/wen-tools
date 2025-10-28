import { bytesToBase64 } from "./utils";
import { toast } from "react-toastify";

/** Text encoder used to convert strings to Uint8Arrays */
const textEncoder = new TextEncoder;

/** Data about the user and the wallet they are using */
type UserData = {
  // The address of the user's account
  account: string,
  // The chain the user is using
  wallet: string
}

export const CRUST_DEBUG = false;

/** Creates an access token for Crust IPFS W3Auth Pinning Service by signing a transaction that is
 * never sent.
 * @param address The address of the Algorand account
 * @return An access token that can be used to access Crust IPFS W3Auth PS endpoints
 */
export async function signLoginAlgorandForCrustIpfsEndpoint(address: string) {
  // XXX: Fake the Crust authentication so that we can skip the authentication when connecting the
  // wallet while still being able to use the tools that rely on Crust. This is an actual token for
  // the account: BCAPWJALWA3N3EIZRFCO55PQ3YBYCSGPZXNDHOOA6R7CGHTISV2GCSYC6Y
  return 'YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0='

  // XXX: Because signing arbitrary bytes is broken in Pera the following code was disabled and a
  // mock was used instead. When signing arbitrary bytes works in Pera, remove the mock code above
  // and uncomment the code below.

  // // Already logged in, so simply return the token in storage
  // if (isCrustAuth()) {
  //   return localStorage.getItem('authBasic')
  // }

  // const user: UserData = { account: address, wallet: "algorand" };
  // const prefix = getPrefix(user);
  // let signedData: (Uint8Array | null)[];

  // try {
  //   toast.info("Sign the transaction to authenticate for Crust IPFS.")

  //   peraWallet.reconnectSession();
  //   // Sign a message
  //   signedData = await peraWallet.signData(
  //     [{
  //       // The data that is to be signed is simply the account address
  //       data: textEncoder.encode(address),
  //       // This is the message displayed to the user that is used to explain the reason for signing
  //       // the data
  //       message: "For login"
  //     }],
  //     user.account
  //   )
  // } catch (err: any) {
  //   throw Error("Algorand wallet signing for Crust IPFS error: " + err);
  // }

  // if (signedData[0] === null || signedData[0].length === 0) {
  //   // Signed data is empty, something must have gone wrong
  //   throw Error('Algorand wallet signing for Crust IPFS error: No signed data returned from wallet')
  // }

  // // Create Crust IPFS W3Auth Pinning Service access token in the format described in
  // // <https://wiki.crust.network/docs/en/algorandBuild101> and
  // // <https://wiki.crust.network/docs/en/buildIPFSW3AuthPin#usage> (as of October 2025). According
  // // to the docs, the access token is a Base64 encoding of a string that was in the format:
  // // `<prefix>-<address/public key>-<signed message in base64>`

  // const sigB64 = await bytesToBase64(signedData[0])
  // const formattedSig = `${prefix}-${address}:${sigB64}`

  // return await bytesToBase64(textEncoder.encode(formattedSig));
}

/** Returns if the user has rejected Crust authentication. This is used to stop prompting the user
 * to authenticate for Crust
 */
export function isCrustAuthFail() {
  return !!localStorage.getItem('authBasicFail');
}

export function isCrustAuth() {
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
