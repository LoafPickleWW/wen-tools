import { Meta } from "../components/Meta";

export function TermsOfUse() {
  return (
    <>
      <Meta title="Terms of Use" />
      <div className="min-h-screen bg-neutral-950 text-white font-sans py-16 px-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <h1 className="text-4xl font-black text-orange-500 mb-8">Terms of Use</h1>
          <p className="text-neutral-400">Last updated: {new Date().toLocaleDateString()}</p>
          <div className="space-y-4 text-neutral-300">
            <h2 className="text-2xl font-bold text-white mt-8">1. Acceptance of Terms</h2>
            <p>By accessing and using wen.tools, you accept and agree to be bound by the terms and provision of this agreement.</p>
            <h2 className="text-2xl font-bold text-white mt-8">2. Use License</h2>
            <p>wen.tools is provided "as is", without warranty of any kind, express or implied. You are responsible for your own actions and transactions on the Algorand blockchain.</p>
            <h2 className="text-2xl font-bold text-white mt-8">3. Disclaimer</h2>
            <p>The materials on wen.tools are provided on an 'as is' basis. LoafPickle Worldwide LLC makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.</p>
          </div>
        </div>
      </div>
    </>
  );
}
