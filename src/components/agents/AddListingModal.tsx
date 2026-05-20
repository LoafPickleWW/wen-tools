import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { IoClose, IoRocket } from "react-icons/io5";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import type { AgentListing, CreateListingParams } from "../../types/agent";
import {
  buildCreateListingTxns,
  buildUpdateListingTxns,
  SUGGESTED_CATEGORIES,
} from "../../utils/agentContract";
import { NetworkId } from "@txnlab/use-wallet-react";

interface AddListingModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** If provided, modal is in edit mode */
  existingListing?: AgentListing | null;
  network: NetworkId;
}

interface FormData {
  name: string;
  description: string;
  endpointUrl: string;
  priceAlgo: string;
  category: string;
  infoUrl: string;
}

export function AddListingModal({ open, onClose, onSuccess, existingListing, network }: AddListingModalProps) {
  const { activeAddress, signTransactions, algodClient } = useWallet();
  const [submitting, setSubmitting] = useState(false);

  const isEdit = !!existingListing;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: "",
      description: "",
      endpointUrl: "",
      priceAlgo: "0",
      category: "ai-agent",
      infoUrl: "",
    },
  });

  // Pre-fill on edit
  useEffect(() => {
    if (existingListing) {
      reset({
        name: existingListing.name,
        description: existingListing.description,
        endpointUrl: existingListing.endpointUrl,
        priceAlgo: existingListing.pricePerCallAlgo.toString(),
        category: existingListing.category,
        infoUrl: existingListing.infoUrl || "",
      });
    } else {
      reset({
        name: "",
        description: "",
        endpointUrl: "",
        priceAlgo: "0",
        category: "ai-agent",
        infoUrl: "",
      });
    }
  }, [existingListing, reset]);

  const onSubmit = async (data: FormData) => {
    if (!activeAddress) {
      toast.error("Please connect your wallet first");
      return;
    }

    setSubmitting(true);

    try {
      const params: CreateListingParams = {
        name: data.name.trim(),
        description: data.description.trim(),
        endpointUrl: data.endpointUrl.trim(),
        priceAlgo: parseFloat(data.priceAlgo) || 0,
        category: data.category.trim(),
        infoUrl: data.infoUrl.trim() || "",
      };

      let txns: Uint8Array[];

      if (isEdit && existingListing) {
        txns = await buildUpdateListingTxns(
          existingListing.appId,
          params,
          activeAddress,
          network
        );
      } else {
        txns = await buildCreateListingTxns(params, activeAddress, network);
      }

      const signed = await signTransactions(txns);
      const validTxns = signed.filter((s): s is Uint8Array => s !== null);
      if (validTxns.length > 0) {
        await algodClient.sendRawTransaction(validTxns).do();
      }

      toast.success(isEdit ? "Listing updated!" : "Agent registered on-chain!");
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("Listing submission error:", err);
      toast.error(err.message || "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-banner-grey border border-secondary-gray rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-secondary-gray/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-xl">
              <IoRocket className="text-orange-400 text-lg" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">
                {isEdit ? "Edit Listing" : "Register API / Agent"}
              </h2>
              <p className="text-xs text-neutral-500">
                {isEdit ? "Update your on-chain listing" : "Deploy a child contract with your API metadata"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-all"
          >
            <IoClose className="text-xl" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
              Name *
            </label>
            <input
              {...register("name", {
                required: "Name is required",
                maxLength: { value: 64, message: "Max 64 characters" },
              })}
              placeholder="My AI Agent / API Service"
              className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500/50 outline-none transition-all"
            />
            {errors.name && (
              <span className="text-red-400 text-[10px] mt-1">{errors.name.message}</span>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
              Description *
            </label>
            <textarea
              {...register("description", {
                required: "Description is required",
                maxLength: { value: 256, message: "Max 256 characters" },
              })}
              rows={3}
              placeholder="Describe what your tool or agent does..."
              className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500/50 outline-none transition-all resize-none"
            />
            {errors.description && (
              <span className="text-red-400 text-[10px] mt-1">{errors.description.message}</span>
            )}
          </div>

          {/* Endpoint URL */}
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
              Endpoint URL *
            </label>
            <input
              {...register("endpointUrl", {
                required: "Endpoint URL is required",
                pattern: {
                  value: /^https?:\/\/.+/,
                  message: "Must be a valid URL starting with http(s)://",
                },
              })}
              placeholder="https://api.example.com/agent"
              className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white text-sm font-mono focus:border-orange-500/50 outline-none transition-all"
            />
            {errors.endpointUrl && (
              <span className="text-red-400 text-[10px] mt-1">{errors.endpointUrl.message}</span>
            )}
          </div>

          {/* Info URL */}
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
              Info URL (Optional)
            </label>
            <input
              {...register("infoUrl", {
                maxLength: { value: 100, message: "Max 100 characters" },
                pattern: {
                  value: /^(https?:\/\/.+)?$/,
                  message: "Must be a valid URL starting with http(s)://",
                },
              })}
              placeholder="https://example.com/docs"
              className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white text-sm font-mono focus:border-orange-500/50 outline-none transition-all"
            />
            {errors.infoUrl && (
              <span className="text-red-400 text-[10px] mt-1">{errors.infoUrl.message}</span>
            )}
          </div>

          {/* Price + Category row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
                Price per call (USDC)
              </label>
              <input
                {...register("priceAlgo", {
                  min: { value: 0, message: "Must be >= 0" },
                })}
                type="number"
                step="0.001"
                min="0"
                placeholder="0"
                className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500/50 outline-none transition-all"
              />
              {errors.priceAlgo && (
                <span className="text-red-400 text-[10px] mt-1">{errors.priceAlgo.message}</span>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
                Category
              </label>
              <select
                {...register("category")}
                className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500/50 outline-none transition-all"
              >
                {SUGGESTED_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Wallet (read-only) */}
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
              Owner Wallet
            </label>
            <input
              value={activeAddress || "Connect wallet first"}
              readOnly
              className="w-full bg-primary-black/50 border border-secondary-gray/50 rounded-xl px-4 py-3 text-neutral-500 text-xs font-mono cursor-not-allowed"
            />
          </div>

          {/* MBR notice */}
          {!isEdit && (
            <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3">
              <p className="text-[10px] text-orange-400/80 leading-relaxed">
                <strong className="text-orange-400">Note:</strong> Creating a listing deploys a child smart contract on Algorand. This requires a small minimum balance (~0.48 ALGO) to cover the on-chain storage. This is refunded if you delete the listing.
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !activeAddress}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 disabled:from-neutral-700 disabled:to-neutral-700 disabled:text-neutral-500 text-black font-black rounded-xl transition-all shadow-lg shadow-orange-500/20 text-sm uppercase tracking-wider"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                {isEdit ? "Updating..." : "Deploying..."}
              </>
            ) : (
              <>
                <IoRocket />
                {isEdit ? "Update Listing" : "Register On-Chain"}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
