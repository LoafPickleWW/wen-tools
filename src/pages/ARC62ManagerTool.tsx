import { useEffect, useState } from "react";
import { ASSET_PREVIEW, IPFS_ENDPOINT, TOOLS } from "../constants";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  getIndexerURL,
  formatNumber,
  formatAddress,
  stringToBase64,
  base64ToUint8Array,
  getAssetHolding,
  base64ToString,
  stringToHex,
  getARC19AssetMetadataData,
  Arc69,
} from "../utils";
import algosdk from "algosdk";
import * as algokit from "@algorandfoundation/algokit-utils";
import {
  CirculatingSupplyFactory,
  APP_SPEC,
} from "../clients/CirculatingSupplyClient";
import axios from "axios";
import { atomWithStorage } from "jotai/utils";
import { useAtom } from "jotai";
import { IconButton } from "@mui/material";
import { FaCopy } from "react-icons/fa";
import { NumberFormatter } from "../components/NumberFormatter";
import { ALGORAND_ZERO_ADDRESS } from "../constants";

interface LabelData {
  key: string;
  value: string;
  amountHeld: number;
}
interface Arc62Data {
  label1: LabelData;
  label2: LabelData;
  label3: LabelData;
  circulatingSupply: number;
}

interface AssetData {
  assetId: number;
  creator: string;
  manager: string;
  name: string;
  unitName: string;
  totalSupply: number;
  decimals: number;
  freeze: string;
  reserveHoldings: number;
  clawback: string;
  reserve: string;
  isArc62: boolean;
  arc62AppId: number;
  arc62Data: Arc62Data | null;
}

interface LabelForm {
  key1: string;
  value1: string;
  key2: string;
  value2: string;
  key3: string;
  value3: string;
}

function findFormat(url: string) {
  if (!url) {
    return "Token";
  }
  if (url.includes("template-ipfs")) {
    return "ARC19";
  } else if (url.includes("#arc3")) {
    return "ARC3";
  } else if (url.includes("ipfs://") || url.includes("ipfs/")) {
    return "ARC69";
  } else {
    return "Token";
  }
}

const tmAssetIdAtom = atomWithStorage("tmAssetId", 0);

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success("Copied to clipboard");
};

export const ARC62ManagerTool = () => {
  const [assetId, setAssetId] = useAtom(tmAssetIdAtom);
  const [inputAssetId, setInputAssetId] = useState(assetId || "");
  const [assetDetailsLoading, setAssetDetailsLoading] =
    useState<boolean>(false);
  const [assetData, setAssetData] = useState<AssetData | null>(null);

  const { activeNetwork, algodClient, activeAddress, transactionSigner } =
    useWallet();

  const algorand = algokit.AlgorandClient.fromClients({
    algod: algodClient,
    indexer: new algosdk.Indexer(
      "a".repeat(64),
      getIndexerURL(activeNetwork),
      443
    ),
  });

  const fetchAssetDetails = async (idToFetch: number) => {
    if (!idToFetch) {
      toast.error("Please enter asset ID");
      resetAssetId();
      return;
    }

    if (!activeAddress) {
      toast.error("Please connect your wallet");
      resetAssetId();
      return;
    }

    setAssetDetailsLoading(true);
    try {
      let IsArc62 = false;
      let arc62AppId = 0;

      const indexerURL = getIndexerURL(activeNetwork);
      const res = (await axios.get(`${indexerURL}/v2/assets/${assetId}`)).data;
      if (res.asset) {
        const assetFormat = findFormat(res.asset.params.url);
        let assetMetadata;
        try {
          if (assetFormat === "ARC19") {
            const data = await getARC19AssetMetadataData(
              res.asset.params.url,
              res.asset.params.reserve
            );
            if (typeof data === "string") {
              assetMetadata = JSON.parse(data);
            } else {
              assetMetadata = data;
            }
          } else if (assetFormat === "ARC69" || assetFormat === "ARC3") {
            if (res.asset.params.url.startsWith("ipfs://")) {
              const data = await axios
                .get(
                  IPFS_ENDPOINT + res.asset.params.url.replace("ipfs://", "")
                )
                .then((res) => res.data);
              if (typeof data === "string") {
                assetMetadata = JSON.parse(data);
              } else {
                assetMetadata = data;
              }
            } else if (res.asset.params.url.includes("ipfs/")) {
              const data = await axios
                .get(IPFS_ENDPOINT + res.asset.params.url.split("ipfs/")[1])
                .then((res) => res.data);
              if (typeof data === "string") {
                assetMetadata = JSON.parse(data);
              } else {
                assetMetadata = data;
              }
            } else {
              const data = await axios
                .get(res.asset.params.url)
                .then((res) => res.data);
              if (typeof data === "string") {
                assetMetadata = JSON.parse(data);
              } else {
                assetMetadata = data;
              }
            }
          }
        } catch (e) {
          const arc69 = new Arc69();
          assetMetadata = await arc69.fetch(Number(assetId), activeNetwork);
          console.error(e);
        }

        if (assetMetadata && assetMetadata.properties) {
          if (
            assetMetadata.properties["arc-62"] &&
            assetMetadata.properties["arc-62"]["application-id"]
          ) {
            IsArc62 = true;
            arc62AppId = Number(
              assetMetadata.properties["arc-62"]["application-id"]
            );
          }
        }
        const manager = res.asset.params.manager || ALGORAND_ZERO_ADDRESS;
        const reserve = res.asset.params.reserve || ALGORAND_ZERO_ADDRESS;
        const freeze = res.asset.params.freeze || ALGORAND_ZERO_ADDRESS;
        const clawback = res.asset.params.clawback || ALGORAND_ZERO_ADDRESS;
        const creator = res.asset.params.creator || ALGORAND_ZERO_ADDRESS;
        const decimals = Number(res.asset.params.decimals) || 0;
        const name = res.asset.params.name || "Asset Name";
        const unitName = res.asset.params["unit-name"] || "UNIT";
        const totalSupply =
          Number(res.asset.params.total) / 10 ** decimals || 0;

        if (!IsArc62) {
          const reconfigs = [];
          let configtxns = (
            await axios.get(
              `${indexerURL}/v2/assets/${assetId}/transactions?tx-type=${"acfg"}&note-prefix=${stringToBase64(
                "arc62:"
              )}`
            )
          ).data;
          for (let i = 0; i < configtxns.transactions.length; i++) {
            reconfigs.push(configtxns.transactions[i]);
          }
          while (configtxns["next-token"]) {
            configtxns = (
              await axios.get(
                `${indexerURL}/v2/assets/${assetId}/transactions?tx-type=${"acfg"}&note-prefix=${stringToBase64(
                  "arc62:"
                )}&next=${configtxns["next-token"]}`
              )
            ).data;
            for (let i = 0; i < configtxns.transactions.length; i++) {
              reconfigs.push(configtxns.transactions[i]);
            }
          }
          const latest = reconfigs[reconfigs.length - 1];
          if (latest) {
            const note = latest.note;
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            const noteStr = base64ToUint8Array(note);
            const noteStrDecoded = decoder.decode(noteStr);
            const arc62 = noteStrDecoded.split("arc62:");
            if (arc62.length > 1 && arc62[1][0] === "j") {
              const json = JSON.parse(arc62[1].slice(1));
              if (json["application-id"]) {
                IsArc62 = true;
                arc62AppId = Number(json["application-id"]);
              }
            } else if (arc62.length > 1 && arc62[1][0] === "m") {
              const msgpack = encoder.encode(arc62[1].slice(1));
              const decoded = algosdk.decodeObj(msgpack) as any;
              if (decoded["application-id"]) {
                IsArc62 = true;
                arc62AppId = Number(decoded["application-id"]);
              }
            }
          }
        }

        let arc62Data: Arc62Data | null = null;
        try {
          if (IsArc62) {
            const algorand = algokit.AlgorandClient.fromClients({
              algod: algodClient,
            });
            const sender = activeAddress;
            const signer = algosdk.makeEmptyTransactionSigner();
            const caller = new CirculatingSupplyFactory({
              algorand,
              defaultSigner: signer,
              defaultSender: sender,
            }).getAppClientById({ appId: BigInt(arc62AppId) });
            const globalState = await caller.appClient.getGlobalState();
            const otherKeys = Object.keys(globalState).filter((key) => {
              return key !== "asset_id";
            });
            if (
              globalState.asset_id &&
              globalState.asset_id.value === BigInt(assetId) &&
              otherKeys.length === 3
            ) {
              const circulatingSupply = (
                await caller
                  .newGroup()
                  .arc62GetCirculatingSupply({
                    args: { assetId: assetId },
                    sender: sender,
                    signer: signer,
                  })
                  .simulate({
                    allowEmptySignatures: true,
                    allowUnnamedResources: true,
                    fixSigners: true,
                  })
              ).returns[0];
              const value1 = algosdk.encodeAddress(
                (globalState[otherKeys[0]] as any).valueRaw as Uint8Array
              );
              const value1Held = await getAssetHolding(
                value1,
                algorand,
                assetId
              );
              const value2 = algosdk.encodeAddress(
                (globalState[otherKeys[1]] as any).valueRaw as Uint8Array
              );
              const value2Held = await getAssetHolding(
                value2,
                algorand,
                assetId
              );
              const value3 = algosdk.encodeAddress(
                (globalState[otherKeys[2]] as any).valueRaw as Uint8Array
              );
              const value3Held = await getAssetHolding(
                value3,
                algorand,
                assetId
              );
              arc62Data = {
                label1: {
                  key: otherKeys[0],
                  value: value1,
                  amountHeld:
                    value1Held == -1 ? 0 : value1Held / 10 ** decimals,
                },
                label2: {
                  key: otherKeys[1],
                  value: value2,
                  amountHeld:
                    value2Held == -1 ? 0 : value2Held / 10 ** decimals,
                },
                label3: {
                  key: otherKeys[2],
                  value: value3,
                  amountHeld:
                    value3Held == -1 ? 0 : value3Held / 10 ** decimals,
                },
                circulatingSupply: Number(circulatingSupply) / 10 ** decimals,
              };
            } else {
              throw new Error("Invalid App ID mentioned For the Asset");
            }
          }
        } catch (e) {
          toast.error("Unable to resolve circulating supply from the app");
          console.error(e);
          IsArc62 = false;
          arc62AppId = 0;
        }

        const reserveHeld = await getAssetHolding(reserve, algorand, assetId);

        const assetData: AssetData = {
          assetId,
          manager,
          name,
          unitName,
          totalSupply,
          decimals,
          freeze,
          reserveHoldings: reserveHeld == -1 ? 0 : reserveHeld / 10 ** decimals,
          clawback,
          creator,
          reserve,
          isArc62: IsArc62,
          arc62AppId,
          arc62Data,
        };
        setLabel1(assetData.arc62Data?.label1.value || "");
        setLabel2(assetData.arc62Data?.label2.value || "");
        setLabel3(assetData.arc62Data?.label3.value || "");
        setAssetData(assetData);
        setAssetId(assetId);
        toast.success("Asset details fetched successfully");
      } else {
        toast.error("Asset not found");
        resetAssetId();
      }
    } catch (e) {
      setAssetId(0); // Reset to initial state instead of using RESET
      toast.error("Error fetching asset details from blockchain: " + e);
      console.error(e);
    } finally {
      setAssetDetailsLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch if assetId is valid and not the initial state
    if (assetId > 0) {
      fetchAssetDetails(assetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, activeAddress, activeNetwork]); // Added proper dependencies

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAssetId = Number(inputAssetId);
    if (numericAssetId > 0) {
      setAssetId(numericAssetId);
    } else {
      toast.error("Please enter a valid asset ID");
    }
  };

  const resetAssetId = () => {
    setAssetId(0);
    setInputAssetId("");
    setAssetData(null);
  };

  const [label1, setLabel1] = useState("");
  const [label2, setLabel2] = useState("");
  const [label3, setLabel3] = useState("");
  const [labelUpdateLoading, setLabelUpdateLoading] = useState(false);

  const onSubmitLabels = async () => {
    if (!activeAddress) {
      toast.error("Please connect your wallet");
      return;
    }

    if (!assetData) {
      toast.error("Asset data not found");
      return;
    }

    if (
      !assetData.arc62Data ||
      assetData.arc62AppId === 0 ||
      !assetData.isArc62
    ) {
      toast.error("ARC62 data not found");
      return;
    }

    if (!label1 || !label2 || !label3) {
      toast.error("Please enter all label addresses");
      return;
    }

    if (
      !algosdk.isValidAddress(label1) ||
      !algosdk.isValidAddress(label2) ||
      !algosdk.isValidAddress(label3)
    ) {
      toast.error("Invalid Address");
      return;
    }

    const held1 = await getAssetHolding(label1, algorand, assetData.assetId);
    const held2 = await getAssetHolding(label2, algorand, assetData.assetId);
    const held3 = await getAssetHolding(label3, algorand, assetData.assetId);

    if (held1 == -1 || held2 == -1 || held3 == -1) {
      toast.error("All Addresses should hold the asset");
      return;
    }

    try {
      setLabelUpdateLoading(true);
      const caller = new CirculatingSupplyFactory({
        algorand,
        defaultSigner: transactionSigner,
        defaultSender: activeAddress,
      }).getAppClientById({ appId: BigInt(assetData.arc62AppId) });

      await caller
        .newGroup()
        .setNotCirculatingAddress({
          args: { address: label1, label: assetData.arc62Data.label1.key },
          assetReferences: [BigInt(assetData.assetId)],
          accountReferences: [label1],
          note: new TextEncoder().encode(
            "via wen.tools - free tools for creators and collectors | " +
              Math.random().toString(36).substring(2)
          ),
        })
        .setNotCirculatingAddress({
          args: { address: label2, label: assetData.arc62Data.label2.key },
          assetReferences: [BigInt(assetData.assetId)],
          accountReferences: [label2],
          note: new TextEncoder().encode(
            "via wen.tools - free tools for creators and collectors | " +
              Math.random().toString(36).substring(2)
          ),
        })
        .setNotCirculatingAddress({
          args: { address: label3, label: assetData.arc62Data.label3.key },
          assetReferences: [BigInt(assetData.assetId)],
          accountReferences: [label3],
          note: new TextEncoder().encode(
            "via wen.tools - free tools for creators and collectors | " +
              Math.random().toString(36).substring(2)
          ),
        })
        .send({});

      toast.success("Label addresses updated successfully");
      window.location.reload();
    } catch (e) {
      toast.error("Error updating label addresses");
      console.error(e);
    } finally {
      setLabelUpdateLoading(false);
    }
  };

  const [newLabelForm, setNewLabelForm] = useState<LabelForm>({
    key1: "",
    value1: "",
    key2: "",
    value2: "",
    key3: "",
    value3: "",
  });
  const [newLabelUpdateLoading, setNewLabelUpdateLoading] = useState(false);

  const onSubmitNewLabels = async () => {
    if (!activeAddress) {
      toast.error("Please connect your wallet");
      return;
    }

    if (!assetData) {
      toast.error("Asset data not found");
      return;
    }

    if (!newLabelForm.key1 || !newLabelForm.key2 || !newLabelForm.key3) {
      toast.error("Please enter all keys");
      return;
    }

    if (
      newLabelForm.key1.length > 64 ||
      newLabelForm.key2.length > 64 ||
      newLabelForm.key3.length > 64
    ) {
      toast.error("Keys should be less than 64 characters");
      return;
    }

    if (
      !algosdk.isValidAddress(
        newLabelForm.value1 == "" ? ALGORAND_ZERO_ADDRESS : newLabelForm.value1
      ) ||
      !algosdk.isValidAddress(
        newLabelForm.value2 == "" ? ALGORAND_ZERO_ADDRESS : newLabelForm.value2
      ) ||
      !algosdk.isValidAddress(
        newLabelForm.value3 == "" ? ALGORAND_ZERO_ADDRESS : newLabelForm.value3
      )
    ) {
      toast.error("Invalid Address");
      return;
    }

    if (
      newLabelForm.key1 === newLabelForm.key2 ||
      newLabelForm.key1 === newLabelForm.key3 ||
      newLabelForm.key2 === newLabelForm.key3
    ) {
      toast.error("Keys should be unique");
      return;
    }

    if (!APP_SPEC.source?.approval) {
      toast.error("Approval Program not found");
      return;
    }

    if (!APP_SPEC.source?.clear) {
      toast.error("Clear Program not found");
      return;
    }

    const held1 = await getAssetHolding(
      newLabelForm.value1,
      algorand,
      assetData.assetId
    );

    const held2 = await getAssetHolding(
      newLabelForm.value2,
      algorand,
      assetData.assetId
    );

    const held3 = await getAssetHolding(
      newLabelForm.value3,
      algorand,
      assetData.assetId
    );

    if (held1 == -1 || held2 == -1 || held3 == -1) {
      toast.error("All Addresses should hold the asset");
      return;
    }

    try {
      setNewLabelUpdateLoading(true);
      let approval = base64ToString(APP_SPEC.source.approval);
      const clear = base64ToString(APP_SPEC.source.clear);

      approval = approval.replace(
        /bytecblock 0x 0x67656e65726963 0x6275726e6564 0x6c6f636b6564 0x61737365745f6964/g,
        `bytecblock 0x ${stringToHex(newLabelForm.key3)} ${stringToHex(
          newLabelForm.key1
        )} ${stringToHex(newLabelForm.key2)} 0x61737365745f6964 ${stringToHex(
          `${Date.now()}`
        )}`
      );

      const method = algosdk.ABIMethod.fromSignature("createApplication()void");
      console.log(method);
      const appCreateResult = await algorand.send.appCreateMethodCall({
        approvalProgram: approval,
        clearStateProgram: clear,
        schema: {
          globalByteSlices: APP_SPEC.state.schema.global.bytes,
          globalInts: APP_SPEC.state.schema.global.ints,
          localByteSlices: APP_SPEC.state.schema.local.bytes,
          localInts: APP_SPEC.state.schema.local.ints,
        },
        sender: activeAddress,
        signer: transactionSigner,
        method: method,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
      })
      toast.info(
        "ARC62 app created successfully with app id: " + appCreateResult.appId
      );
      const caller = new CirculatingSupplyFactory({
        algorand,
        defaultSigner: transactionSigner,
        defaultSender: activeAddress,
      }).getAppClientById({ appId: BigInt(appCreateResult.appId) });

      const encoder = new TextEncoder();
      toast.info("Updating label addresses in ARC62 app, please sign the Txn");
      const composer = caller
        .newGroup()
        .setAsset({
          args: { assetId: BigInt(assetId) },
          assetReferences: [BigInt(assetId)],
          note: new TextEncoder().encode(
            "via wen.tools - free tools for creators and collectors | " +
              Math.random().toString(36).substring(2)
          ),
        })
        .addTransaction(
          algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({
            from: activeAddress,
            assetIndex: assetId,
            manager: assetData.manager,
            reserve: assetData.freeze,
            freeze: assetData.reserve,
            clawback: assetData.clawback,
            strictEmptyAddressChecking: true,
            suggestedParams: await algodClient.getTransactionParams().do(),
            note: encoder.encode(
              `arc62:j{"application-id":${appCreateResult.appId.toString()}}`
            ),
          }),
          transactionSigner
        );

      if (newLabelForm.value1 !== "") {
        composer.setNotCirculatingAddress({
          args: { address: newLabelForm.value1, label: newLabelForm.key1 },
          assetReferences: [BigInt(assetId)],
          accountReferences: [newLabelForm.value1],
          note: new TextEncoder().encode(
            "via wen.tools - free tools for creators and collectors | " +
              Math.random().toString(36).substring(2)
          ),
        });
      }
      if (newLabelForm.value2 !== "") {
        composer.setNotCirculatingAddress({
          args: { address: newLabelForm.value2, label: newLabelForm.key2 },
          assetReferences: [BigInt(assetId)],
          accountReferences: [newLabelForm.value2],
          note: new TextEncoder().encode(
            "via wen.tools - free tools for creators and collectors | " +
              Math.random().toString(36).substring(2)
          ),
        });
      }
      if (newLabelForm.value3 !== "") {
        composer.setNotCirculatingAddress({
          args: { address: newLabelForm.value3, label: newLabelForm.key3 },
          assetReferences: [BigInt(assetId)],
          accountReferences: [newLabelForm.value3],
          note: new TextEncoder().encode(
            "via wen.tools - free tools for creators and collectors | " +
              Math.random().toString(36).substring(2)
          ),
        });
      }

      await composer.send({});

      toast.success("Label addresses updated successfully");
      window.location.reload();
    } catch (e) {
      toast.error("Error creating arc62 app : " + e);
      console.error(e);
    } finally {
      setNewLabelUpdateLoading(false);
    }
  };

  return (
    <div className="mx-auto text-white mb-4 mt-4 text-center flex flex-col items-center max-w-full gap-y-2 min-h-screen">
      <h1 className="text-2xl font-bold mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </h1>
      <p className="text-md text-gray-200">
        Set and manage your token's circulation supply using the ARC62 Standard
      </p>

      {!assetId && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col justify-center items-center w-[20rem] mt-4"
        >
          <input
            type="number"
            value={inputAssetId}
            onChange={(e) => setInputAssetId(e.target.value.trim())}
            placeholder="Enter asset id"
            className="w-48 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/50 px-3 py-2 border rounded border-gray-200"
          />
          <button
            type="submit"
            className={`rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black/90 font-semibold px-4 py-1 mt-4 ${
              assetDetailsLoading ? "opacity-50 cursor-not-allowed" : ""
            }`}
            disabled={assetDetailsLoading}
          >
            Next
          </button>
        </form>
      )}

      {assetData && activeAddress && (
        <>
          <div className="flex flex-col md:flex-row justify-between">
            <button
              className="rounded bg-secondary-orange hover:bg-secondary-orange/80 text-black px-4 py-1 mt-2"
              onClick={() => {
                resetAssetId();
                window.location.reload();
              }}
            >
              Back
            </button>
            <div className="focus:outline-nonetext-sm font-light leading-tight text-slate-200 mt-4 md:ml-2">
              Asset:{" "}
              <a
                className="font-medium text-slate-300 underline hover:text-slate-400 transition"
                href={ASSET_PREVIEW + assetData.assetId}
                target="_blank"
                rel="noreferrer"
              >
                {assetData.assetId}
              </a>
            </div>
          </div>

          {/* Name and Unit Name */}
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Name
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={assetData.name}
                disabled
              />
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Unit name
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={assetData.unitName}
                disabled
              />
            </div>
          </div>

          {/* Total Supply and Decimals */}
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Total Supply
              </label>
              <NumberFormatter
                value={assetData.totalSupply}
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-[11px] border rounded border-gray-400 disabled:cursor-not-allowed"
              />
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Decimals
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={assetData.decimals}
                disabled
              />
            </div>
          </div>

          {/* Creator and Manager */}
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Creator
              </label>
              <span className="w-64 flex flex-row justify-center items-center bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-2 py-1 border rounded border-gray-400 disabled:cursor-not-allowed">
                {formatAddress(assetData.creator)}{" "}
                <IconButton onClick={(_) => copyToClipboard(assetData.creator)}>
                  <FaCopy className="w-3 h-3 text-white" />
                </IconButton>
              </span>
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Manager
              </label>
              <span className="w-64 flex flex-row justify-center items-center bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-2 py-1 border rounded border-gray-400 disabled:cursor-not-allowed">
                {formatAddress(assetData.manager)}{" "}
                <IconButton onClick={(_) => copyToClipboard(assetData.manager)}>
                  <FaCopy className="w-3 h-3 text-white" />
                </IconButton>
              </span>
            </div>
          </div>

          {/* Clawback and Freeze */}
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Clawback
              </label>
              <span className="w-64 flex flex-row justify-center items-center bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-2 py-1 border rounded border-gray-400 disabled:cursor-not-allowed">
                {formatAddress(assetData.clawback)}{" "}
                <IconButton
                  onClick={(_) => copyToClipboard(assetData.clawback)}
                >
                  <FaCopy className="w-3 h-3 text-white" />
                </IconButton>
              </span>
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Freeze
              </label>
              <span className="w-64 flex flex-row justify-center items-center bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-2 py-1 border rounded border-gray-400 disabled:cursor-not-allowed">
                {formatAddress(assetData.freeze)}{" "}
                <IconButton onClick={(_) => copyToClipboard(assetData.freeze)}>
                  <FaCopy className="w-3 h-3 text-white" />
                </IconButton>
              </span>
            </div>
          </div>

          {/* Reserve and Holdings */}
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Reserve
              </label>
              <span className="w-64 flex flex-row justify-center items-center bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-2 py-1 border rounded border-gray-400 disabled:cursor-not-allowed">
                {formatAddress(assetData.reserve)}{" "}
                <IconButton onClick={(_) => copyToClipboard(assetData.reserve)}>
                  <FaCopy className="w-3 h-3 text-white" />
                </IconButton>
              </span>
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Reserve Holdings
              </label>
              <NumberFormatter
                value={assetData.reserveHoldings}
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-[11px] border rounded border-gray-400 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* ARC62 Status */}
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                ARC62 Status
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={assetData.isArc62 ? "Enabled" : "Not Enabled"}
                disabled
              />
            </div>
            {assetData.isArc62 && (
              <div className="flex flex-col md:mt-0 mt-4">
                <label className="mb-2 text-sm leading-none text-gray-200">
                  ARC62 App ID
                </label>
                <input
                  className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                  value={assetData.arc62AppId}
                  disabled
                />
              </div>
            )}
          </div>

          {/* ARC62 Labels */}
          {assetData.isArc62 && (
            <div className="border-t border-gray mt-4">
              <p className="focus:outline-nonetext-sm font-semibold text-lg leading-tight text-gray-200 mt-4">
                ARC62 Labels
              </p>
              {assetData.arc62Data && (
                <>
                  <div className="mt-4 md:flex items-center text-start gap-x-4">
                    {[
                      {
                        key: assetData.arc62Data.label1.key,
                        value: label1,
                        amount: assetData.arc62Data.label1.amountHeld,
                        setLabel: setLabel1,
                      },
                      {
                        key: assetData.arc62Data.label2.key,
                        value: label2,
                        amount: assetData.arc62Data.label2.amountHeld,
                        setLabel: setLabel2,
                      },
                      {
                        key: assetData.arc62Data.label3.key,
                        value: label3,
                        amount: assetData.arc62Data.label3.amountHeld,
                        setLabel: setLabel3,
                      },
                    ].map((label, index) => (
                      <div key={index} className="flex flex-col mb-4">
                        <label className="mb-2 text-sm leading-none text-gray-200">
                          {label.key}
                        </label>
                        <input
                          className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                          disabled={assetData.manager !== activeAddress}
                          value={label.value}
                          onChange={async (e) => {
                            label.setLabel(e.target.value.trim());
                            const isValidAddress = algosdk.isValidAddress(
                              e.target.value.trim()
                            );
                            const held = await getAssetHolding(
                              e.target.value.trim(),
                              algorand,
                              assetId
                            );
                            const res = isValidAddress
                              ? held == -1
                                ? "Didn't OptedIn"
                                : held / 10 ** assetData.decimals
                              : "Invalid Address";
                            document.getElementById(
                              `holding_${index}`
                            )!.innerText = res.toString();
                          }}
                        />
                        <label className="mt-1 text-xs leading-none text-gray-400">
                          Holdings:{" "}
                          <span id={`holding_${index}`}>
                            {formatNumber(label.amount)}
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                  {assetData.manager === activeAddress && (
                    <button
                      className={`rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black font-semibold px-4 py-1 mt-2 ${
                        labelUpdateLoading
                          ? "opacity-50 cursor-not-allowed"
                          : ""
                      }`}
                      onClick={() => onSubmitLabels()}
                      disabled={labelUpdateLoading}
                    >
                      Update Label Addresses
                    </button>
                  )}
                  {labelUpdateLoading && (
                    <div className="mx-auto flex flex-col">
                      <div
                        className="spinner-border animate-spin inline-block mx-auto mt-4 mb-2 w-8 h-8 border-4 rounded-full"
                        role="status"
                      />
                      <span>Updating Label Addresses to blockchain...</span>
                    </div>
                  )}
                  <p className="text-xl text-gray-200 mt-2 animate-pulse">
                    Circulating Supply:{" "}
                    <span className="font-bold">
                      <NumberFormatter
                        value={assetData.arc62Data.circulatingSupply}
                        className="inline"
                      />
                    </span>
                  </p>
                </>
              )}
            </div>
          )}

          {/* New ARC62 Form */}
          {assetData.manager === activeAddress && (
            <div className="border-t border-gray mt-4">
              <p
                className={`focus:outline-nonetext-sm font-semibold text-lg leading-tight text-gray-200 mt-4 ${
                  assetData.isArc62 ? "mt-8" : ""
                }`}
              >
                Set Up {assetData.isArc62 ? "New" : ""} ARC62 App
              </p>
              <p className="text-sm text-gray-200 mt-2">
                This will create a new ARC62 application with the given labels, will replace existing app if already created.
              </p>
              <div className="mt-4 md:flex items-center text-start gap-x-4">
                {[1, 2, 3].map((num) => (
                  <div key={num} className="flex flex-col mb-4">
                    <label className="mb-2 text-sm leading-none text-gray-200">
                      Label {num}
                    </label>
                    <input
                      className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
                      placeholder="Key"
                      value={newLabelForm[`key${num}` as keyof LabelForm]}
                      onChange={(e) => {
                        if (e.target.value.trim().length > 64) {
                          document.getElementById(
                            `key_label_${num}`
                          )!.innerText = "Key too long";
                        } else {
                          document.getElementById(
                            `key_label_${num}`
                          )!.innerText = "";
                        }
                        setNewLabelForm({
                          ...newLabelForm,
                          [`key${num}`]: e.target.value.trim(),
                        });
                      }}
                    />
                    <label className="mt-1 text-xs leading-none text-red-400 h-[12px]">
                      <span id={`key_label_${num}`}></span>
                    </label>
                    <input
                      className="w-64 mt-2 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
                      placeholder="Wallet Address"
                      value={newLabelForm[`value${num}` as keyof LabelForm]}
                      onChange={async (e) => {
                        setNewLabelForm({
                          ...newLabelForm,
                          [`value${num}`]: e.target.value.trim(),
                        });

                        const isValidAddress = algosdk.isValidAddress(
                          e.target.value.trim()
                        );
                        const held = await getAssetHolding(
                          e.target.value.trim(),
                          algorand,
                          assetId
                        );
                        const res = isValidAddress
                          ? held == -1
                            ? "Didn't OptedIn"
                            : `Holding: ${formatNumber(
                                held / 10 ** assetData.decimals
                              )}`
                          : "Invalid Address";
                        document.getElementById(
                          `value_label_${num}`
                        )!.innerText = res.toString();
                      }}
                    />
                    <label className="mt-1 text-xs leading-none text-gray-400 h-[12px]">
                      <span id={`value_label_${num}`}></span>
                    </label>
                  </div>
                ))}
              </div>
              <button
                className={`rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black font-semibold px-4 py-1 mt-2 ${
                  newLabelUpdateLoading ? "opacity-50 cursor-not-allowed" : ""
                }`}
                onClick={() => onSubmitNewLabels()}
                disabled={newLabelUpdateLoading}
              >
                Submit
              </button>
              {newLabelUpdateLoading && (
                <div className="mx-auto flex flex-col">
                  <div
                    className="spinner-border animate-spin inline-block mx-auto mt-4 mb-2 w-8 h-8 border-4 rounded-full"
                    role="status"
                  />
                  <span>Creating ARC62 Application...</span>
                </div>
              )}
            </div>
          )}
          {!assetData.isArc62 && assetData.manager !== activeAddress && (
            <>
              <div className="text-center text-orange-200 mt-4">
                <p>ARC62 is not enabled for this asset.</p>
                <p>Connect with the manager account to enable ARC62.</p>
              </div>
            </>
          )}
        </>
      )}

      {assetDetailsLoading && (
        <div className="mx-auto flex flex-col">
          <div
            className="spinner-border animate-spin inline-block mx-auto mt-4 mb-2 w-8 h-8 border-4 rounded-full"
            role="status"
          />
          <span>Fetching asset details from blockchain...</span>
        </div>
      )}

      {assetId > 0 && (
        <p className="text-center text-xs text-slate-400 py-2">
          ⚠️If you reload or close this page, you will lose your progress⚠️
          <br />
          You can reload the page if you want to stop/restart the process!
        </p>
      )}

      <p className="text-center text-md text-gray-400 py-2 mt-4">
        Crafted with 💻 and ❤️ for Dev Track (Algorand India Summit 2024) by{" "}
        <a
          className="underline"
          target="_blank"
          href="https://satishccy.algo.xyz"
        >
          SatishCCY
        </a>
        🚀
      </p>
    </div>
  );
};
