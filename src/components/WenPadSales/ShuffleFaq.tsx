import type { ReactNode } from "react";
import { MdExpandMore } from "react-icons/md";

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "What is Shuffle?",
    a: (
      <>
        Shuffle sells an NFT collection as a random mint. Buyers pay a fixed price and receive a random NFT from the
        collection. Each Shuffle is its own smart contract on Algorand that hands out the NFTs; wen.tools runs the
        page but never holds any keys or funds.
      </>
    ),
  },
  {
    q: "How is my NFT chosen? Can anyone rig it?",
    a: (
      <>
        When you mint, you commit to the next block. Once that block exists, its random seed (mixed with your address
        and mint number) picks your NFT. Nobody knows the seed when you commit, so neither you nor the creator can
        choose the result, and the draw is fixed once the block exists. In theory, the validator who proposes that
        one block could withhold it to force a re-draw. They would lose the block reward and still couldn't pick a
        specific NFT, which is acceptable for NFT mints.
      </>
    ),
  },
  {
    q: "What do I pay as a buyer?",
    a: (
      <>
        Four line items, shown before you sign: the mint price (to the creator), a small delivery fee (pays whoever
        draws your NFT on-chain), and two refundable deposits. If you are already opted in to the NFT you draw, the
        deposits come straight back. Otherwise the NFT goes to your ARC-59 inbox: part of the deposit pays for the
        inbox (up to about 0.33 ALGO, one time, less if you already have one) and the rest travels with the NFT, so
        you get it back when you claim.
      </>
    ),
  },
  {
    q: "What is the ARC-59 inbox and how do I claim?",
    a: (
      <>
        ARC-59 is the Algorand standard for sending an asset to someone who hasn't opted in yet. It waits in an inbox
        tied to your address. Pera and other wallets show inbox items to claim, or you can use the wen.tools claim
        tool.
      </>
    ),
  },
  {
    q: "How long does a mint take, and what if it gets stuck?",
    a: (
      <>
        You sign once; your NFT is drawn about two blocks later (a few seconds), automatically. If the automatic
        delivery doesn't happen, the page asks you to confirm once more, and you receive the delivery fee back. Anyone can
        reveal any pending mint, so they don't stay stuck. In the rare case nobody reveals a mint for about 45
        minutes, it can be cancelled for a full refund.
      </>
    ),
  },
  {
    q: "Creators: does wen.tools hold my keys?",
    a: (
      <>
        No. When your Shuffle goes live, your collection wallet is <em>rekeyed</em> to the Shuffle's smart contract.
        That is an Algorand feature that hands signing authority to the contract. The contract can only send listed
        NFTs to buyers, one at a time, and rekey the wallet back to itself. It can't send ALGO, close the wallet,
        or do anything else.
      </>
    ),
  },
  {
    q: "Creators: how do I get my wallet back?",
    a: (
      <>
        Three ways, all built into the contract: the manager can release it at any time (pause first so pending
        mints finish), it is released automatically when the collection sells out, and anyone can release it once
        the end date has passed. That last one means the wallet can't get stuck even if the manager wallet is lost.
      </>
    ),
  },
  {
    q: "Creators: what is the manager, and how do split payouts work?",
    a: (
      <>
        While your Shuffle is live, the collection wallet can't sign, so a second wallet you control manages it:
        pausing, changing the price or end date, and releasing. By default that is the first payout address. Proceeds
        can be split between up to 5 addresses by percentage. Splits are locked when the Shuffle is created, so
        collaborators can trust them. Anyone can trigger the payout.
      </>
    ),
  },
  {
    q: "Creators: what does it cost?",
    a: (
      <>
        There is no platform fee. You put down deposits (about 1 ALGO for the contract and registry, plus about 0.42
        ALGO per 128 NFTs for storage), plus small network fees. All deposits come back to your collection wallet
        when you close the Shuffle. Delivering NFTs costs your wallet nothing: whoever reveals a mint pays those fees.
      </>
    ),
  },
  {
    q: "Can other sites and marketplaces list Shuffles?",
    a: (
      <>
        Yes. Every Shuffle is created by one on-chain factory contract, which keeps a public index of all of them
        (price, dates, sold count, status and a collection metadata link) and emits events for every Shuffle and
        purchase. Any site can read it straight from the chain.
      </>
    ),
  },
  {
    q: "Is it safe? Has it been audited?",
    a: (
      <>
        Shuffle is <strong>experimental</strong>. The contracts went through an internal security review and a full
        test suite on testnet, but they have not had an independent audit. Rekeying always carries risk: a bug could
        leave the wallet or its assets unrecoverable. Use a dedicated wallet that only holds the collection you are
        selling, never a wallet with high-value assets.
      </>
    ),
  },
];

export function ShuffleFaq() {
  return (
    <section className="w-full max-w-3xl mx-auto mt-16 text-left">
      <h2 className="text-2xl font-black text-white mb-4">Frequently asked questions</h2>
      <div className="divide-y divide-white/[0.08] border border-white/[0.12] rounded-3xl bg-banner-grey/30 overflow-hidden">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-5 py-4">
            <summary className="flex items-center justify-between gap-3 cursor-pointer list-none font-bold text-white text-sm">
              {item.q}
              <MdExpandMore className="shrink-0 text-gray-400 transition-transform group-open:rotate-180" size={20} />
            </summary>
            <p className="mt-3 text-sm text-gray-400 leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
