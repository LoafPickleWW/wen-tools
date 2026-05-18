import { useState } from "react";
import { IoCodeSlash, IoChevronDown, IoChevronUp, IoCopy, IoCheckmark } from "react-icons/io5";

const TEALSCRIPT_CODE = `import { Contract } from '@algorandfoundation/tealscript';

export class AgentChild extends Contract {
  name = GlobalStateKey<string>({ key: 'name' });
  description = GlobalStateKey<string>({ key: 'description' });
  endpoint_url = GlobalStateKey<string>({ key: 'endpoint_url' });
  price_algo = GlobalStateKey<uint64>({ key: 'price_algo' });
  wallet_address = GlobalStateKey<Address>({ key: 'wallet_address' });
  category = GlobalStateKey<string>({ key: 'category' });
  active = GlobalStateKey<uint64>({ key: 'active' });

  createApplication(
    name: string,
    description: string,
    endpoint_url: string,
    price_algo: uint64,
    category: string,
    wallet_address: Address
  ): void {
    assert(name.length <= 50);
    assert(description.length <= 200);
    assert(endpoint_url.length <= 100);
    assert(category.length <= 30);

    this.name.value = name;
    this.description.value = description;
    this.endpoint_url.value = endpoint_url;
    this.price_algo.value = price_algo;
    this.category.value = category;
    this.wallet_address.value = wallet_address;
    this.active.value = 1;
  }

  update_listing(
    name: string,
    description: string,
    endpoint_url: string,
    price_algo: uint64,
    category: string
  ): void {
    assert(this.txn.sender === this.app.creator);
    assert(name.length <= 50);
    assert(description.length <= 200);
    assert(endpoint_url.length <= 100);
    assert(category.length <= 30);

    this.name.value = name;
    this.description.value = description;
    this.endpoint_url.value = endpoint_url;
    this.price_algo.value = price_algo;
    this.category.value = category;
    this.active.value = 1;
  }

  deactivate_listing(): void {
    assert(this.txn.sender === this.app.creator);
    this.active.value = 0;
  }

  activate_listing(): void {
    assert(this.txn.sender === this.app.creator);
    this.active.value = 1;
  }

  deleteApplication(): void {
    assert(this.txn.sender === this.app.creator);
  }
}

export class AgentFactory extends Contract {
  total_listings = GlobalStateKey<uint64>({ key: 'total_listings' });
  listings = BoxMap<Address, AppID>({ prefix: '' });

  createApplication(): void {
    this.total_listings.value = 0;
  }

  create_listing(
    mbrPayment: PayTxn,
    name: string,
    description: string,
    endpoint_url: string,
    price_algo: uint64,
    category: string
  ): AppID {
    assert(!this.listings(this.txn.sender).exists);

    // Box MBR (18,500) + Child App MBR (407,000) = 425,500
    verifyPayTxn(mbrPayment, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: 425_500 },
    });

    sendMethodCall<typeof AgentChild.prototype.createApplication>({
      approvalProgram: AgentChild.approvalProgram(),
      clearStateProgram: AgentChild.clearProgram(),
      methodArgs: [name, description, endpoint_url, price_algo, category, this.txn.sender],
      fee: 0,
      globalNumByteSlice: 5,
      globalNumUint: 2,
    });

    const childApp = this.itxn.createdApplicationID;
    this.listings(this.txn.sender).value = childApp;
    this.total_listings.value = this.total_listings.value + 1;

    return childApp;
  }

  get_listing_app(wallet: Address): AppID {
    assert(this.listings(wallet).exists);
    return this.listings(wallet).value;
  }

  delete_listing(): void {
    assert(this.listings(this.txn.sender).exists);
    const childApp = this.listings(this.txn.sender).value;

    sendMethodCall<typeof AgentChild.prototype.deleteApplication>({
      applicationID: childApp,
      onCompletion: OnCompletion.DeleteApplication,
      fee: 1_000, 
    });

    sendPayment({
      receiver: this.txn.sender,
      amount: 425_500,
      fee: 0,
    });

    this.listings(this.txn.sender).delete();
    this.total_listings.value = this.total_listings.value - 1;
  }
  
  deleteApplication(): void {
    assert(this.txn.sender === this.app.creator);
  }

  updateApplication(): void {
    assert(this.txn.sender === this.app.creator);
  }
}`;

export function SmartContractViewer() {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(TEALSCRIPT_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-4xl mx-auto my-12 border border-neutral-800 rounded-2xl overflow-hidden bg-primary-black">
      <div 
        className="w-full px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-neutral-900 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-500">
            <IoCodeSlash />
          </div>
          <div>
            <h3 className="font-bold text-white">Open Source Smart Contract</h3>
            <p className="text-xs text-neutral-500">Written in TEALScript. Deployed mutably for the public good.</p>
          </div>
        </div>
        <div className="text-neutral-400">
          {isOpen ? <IoChevronUp /> : <IoChevronDown />}
        </div>
      </div>

      {isOpen && (
        <div className="relative border-t border-neutral-800 bg-neutral-950/50 p-4">
          <button
            onClick={handleCopy}
            className="absolute top-6 right-6 p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
          >
            {copied ? <IoCheckmark className="text-green-400 text-lg" /> : <IoCopy className="text-lg" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <pre className="text-sm font-mono text-neutral-300 overflow-x-auto p-4 custom-scrollbar">
            <code className="language-typescript">{TEALSCRIPT_CODE}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
