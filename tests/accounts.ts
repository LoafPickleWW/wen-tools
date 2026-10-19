import * as algosdk from "algosdk";

// Fixed throwaway keys (seeds 0x01.., 0x02.., 0x03..) so signatures are deterministic.
export const MNEMONICS = {
  alice:
    "cage advice letter avoid acoustic doctor amount absurd cage advice letter avoid acoustic doctor amount absurd cage advice letter avoid acoustic doctor amount abandon pause",
  bob: "doctor amount absurd cage advice letter avoid acoustic doctor amount absurd cage advice letter avoid acoustic doctor amount absurd cage advice letter avoid abandon cigar",
  carol:
    "gather army light coral alcohol school blossom adapt gather army light coral alcohol school blossom adapt gather army light coral alcohol school blossom abandon wash",
};

export const ALICE = "RKEOHXLUBHYZL7KS3MWTZOS5OLFGOCN7DWKBEG7TOSEADNAPN5OOTUNSLE";
export const BOB = "QE4XODVIPULV6VVDKRTMGTD6ZTFY3CURWTXDPIS56YHVXD6JWOKORTLPBU";
export const CAROL = "5VESRRRI2HBMN2XJAM4JAWMVMEUVSJZ2LRR7SNRWYFDBJLEHG7I2572N4M";

export const sk = (name: keyof typeof MNEMONICS) => algosdk.mnemonicToSecretKey(MNEMONICS[name]).sk;

/** A TransactionSigner backed by a fixed key (stands in for a wallet). */
export const signerFor = (name: keyof typeof MNEMONICS): algosdk.TransactionSigner => {
  const key = sk(name);
  return async (group, indexes) => indexes.map((i) => algosdk.signTransaction(group[i], key).blob);
};

export const ALGOD_URL = "https://mainnet-api.4160.nodely.dev";
export const algod = () => new algosdk.Algodv2("", ALGOD_URL, "");
