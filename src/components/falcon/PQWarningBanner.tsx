import { IoWarning } from "react-icons/io5";

export default function PQWarningBanner() {
  return (
    <div className="w-full rounded-2xl border border-primary-orange/30 bg-primary-orange/5 p-5">
      <div className="flex items-start gap-3">
        <IoWarning className="text-2xl text-primary-orange flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-bold text-primary-orange text-sm mb-1">
            Experimental Technology Demo
          </h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            This tool showcases{" "}
            <strong className="text-white">post-quantum Falcon-1024 signatures</strong> on
            Algorand. Keys are stored{" "}
            <strong className="text-white">only in your browser's local storage</strong>.
            Clearing browser data, switching browsers, or losing your device will{" "}
            <strong className="text-primary-orange">permanently lose access</strong> unless
            you export your keys.
            <br />
            <strong className="text-primary-orange">
              Do not use this for significant funds.
            </strong>{" "}
            This is not a production wallet.
          </p>
        </div>
      </div>
    </div>
  );
}
