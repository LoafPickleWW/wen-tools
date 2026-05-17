import { Meta } from "../components/Meta";

export function PrivacyPolicy() {
  return (
    <>
      <Meta title="Privacy Policy" />
      <div className="min-h-screen bg-neutral-950 text-white font-sans py-16 px-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <h1 className="text-4xl font-black text-orange-500 mb-8">Privacy Policy</h1>
          <p className="text-neutral-400">Last updated: {new Date().toLocaleDateString()}</p>
          <div className="space-y-4 text-neutral-300">
            <h2 className="text-2xl font-bold text-white mt-8">1. Information Collection</h2>
            <p>We do not collect, store, or process any personal data or transaction information on our servers. All operations are performed directly between your browser and the Algorand blockchain.</p>
            <h2 className="text-2xl font-bold text-white mt-8">2. Analytics</h2>
            <p>We use standard, privacy-respecting analytics tools to understand site traffic and usage patterns. This data is aggregated and does not identify individual users.</p>
            <h2 className="text-2xl font-bold text-white mt-8">3. Third-Party Services</h2>
            <p>Our tools interact with public blockchain nodes and third-party APIs (such as Algonode or NFDomains). Your interactions with these services are subject to their respective privacy policies.</p>
          </div>
        </div>
      </div>
    </>
  );
}
