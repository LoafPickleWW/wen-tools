import { SelectToolComponent } from "../components/SelectToolComponent";
import { trackEvent } from "../utils";
import { Meta } from "../components/Meta";
import { useSearchParams } from "react-router-dom";
import { TOOLS } from "../constants";
import { BrandBracket } from "../components/Wordmark";
import { Scramble } from "../components/cypher/Scramble";
import { Typewriter } from "../components/cypher/Typewriter";
import { LedgerStrip } from "../components/cypher/LedgerStrip";
import { Manifesto } from "../components/cypher/Manifesto";

const PARTNER =
  "group flex h-24 items-center justify-center rounded-2xl border border-white/[0.07] bg-banner-grey/40 px-6 text-slate-300 backdrop-blur transition duration-300 hover:border-white/15 hover:bg-banner-grey/70 hover:text-white";
const PARTNER_IMG = "opacity-70 transition duration-300 group-hover:opacity-100";

export default function Home() {
  // An open suite (?suite=) renders as its own focused page
  const [searchParams] = useSearchParams();
  const inSuite = !!searchParams.get("suite");

  return (
    <div className="flex flex-col pb-10 text-white">
      <Meta />

      {/* Hero */}
      <section className={inSuite ? "hidden" : "relative overflow-hidden"}>
        <div aria-hidden="true" className="wt-scanlines pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,#000,transparent_85%)]" />
        <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-4 pb-14 pt-14 text-center md:pb-20 md:pt-20">
          <h1 className="wt-chip animate-fade-in font-mono text-[11px] font-normal tracking-wide">
            <span className="wt-pulse-dot h-1.5 w-1.5 rounded-full bg-primary-orange" />
            Free, open-source Algorand tools <span className="text-slate-600">·</span>{" "}
            {TOOLS.length}+ and counting
          </h1>

          <p className="mt-8 flex items-center justify-center gap-[0.12em] font-display text-[2.9rem] font-semibold leading-none tracking-[-0.045em] text-white sm:text-7xl md:text-[6.5rem]">
            <BrandBracket className="wt-hero-bracket" strokeWidth={1.7} />
            <Scramble
              segments={[
                { text: "not if, " },
                { text: "wen.", className: "wt-gradient-text" },
              ]}
            />
            <BrandBracket flip className="wt-hero-bracket" strokeWidth={1.7} />
          </p>

          <div className="mt-7 inline-flex max-w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-primary-black/60 px-4 py-2.5 font-mono text-[13px] text-slate-300 backdrop-blur sm:text-sm">
            <span className="text-primary-orange">&gt;</span>
            <Typewriter
              className="truncate"
              lines={[
                "airdrop to 5,000 holders",
                "mint an ARC-19 collection",
                "swap peer-to-peer, no middleman",
                "deploy a static site to IPFS",
                "anchor your software supply chain",
                "spin up a post-quantum account",
              ]}
            />
          </div>

          <p className="mt-7 max-w-2xl text-base leading-relaxed text-slate-400 md:text-lg">
            Mint, airdrop, swap, deploy and secure on Algorand — permissionless
            tooling with no accounts, no custody and no paywall. Just connect a
            wallet and ship.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#tools"
              className="wt-btn wt-btn-primary h-11 px-5"
              onClick={() => trackEvent("hero_click", "home", "Explore tools")}
            >
              Explore tools
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M19 9l-7 7-7-7" />
              </svg>
            </a>
            <a
              href="https://github.com/LoafPickleWW/wen-tools"
              target="_blank"
              rel="noreferrer"
              className="wt-btn wt-btn-ghost h-11 px-5 font-mono text-[13px]"
              onClick={() => trackEvent("hero_click", "home", "View source")}
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              view source
            </a>
          </div>

          <div className="mt-14 w-full max-w-4xl">
            <LedgerStrip />
          </div>
        </div>
      </section>

      <SelectToolComponent />

      <div className={inSuite ? "hidden" : "mt-24 mb-24"}>
        <Manifesto />
      </div>

      {/* Partners */}
      <section className={inSuite ? "hidden" : "mx-auto w-full max-w-7xl px-4 pt-4"}>
        <p className="wt-label mb-5 text-center">( partners )</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <a
            href="https://www.algorand.foundation?ref=eviltools"
            className={PARTNER}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("partner_click", "home", "Algorand Foundation")}
          >
            <img src="./af_logo.svg" alt="Algorand Foundation" className={`h-10 w-auto ${PARTNER_IMG}`} />
          </a>
          <a
            href="https://algoverify.me?ref=eviltools"
            className={`${PARTNER} font-display text-xl font-semibold tracking-tight`}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("partner_click", "home", "AlgoVerify")}
          >
            <span className={PARTNER_IMG}>AlgoVerify</span>
          </a>
          <a
            href="https://nf.domains?ref=eviltools"
            className={PARTNER}
            target="_blank"
            rel="noreferrer"
            aria-label="NF Domains"
            onClick={() => trackEvent("partner_click", "home", "NF Domains")}
          >
            <svg viewBox="0 0 1260 400" fill="currentColor" className={`h-6 w-auto ${PARTNER_IMG}`}>
              <polygon points="430,0 430,66.7 430,133.3 430,200 430,266.7 430,400 630,400 630,266.7 730,266.7 730,200 730,133.3 830,133.3 830,66.7 830,0 630,0"></polygon>
              <polygon points="200,200 0,0 0,400 200,400 400,400 400,200 400,0 200,0"></polygon>
              <path d="M1060,0H860v200v200h200c110.5,0,200-89.5,200-200S1170.5,0,1060,0z"></path>
            </svg>
          </a>
          <a
            href="https://www.randgallery.com/algo-collection?ref=eviltools"
            className={PARTNER}
            target="_blank"
            rel="noreferrer"
            aria-label="Rand Gallery"
            onClick={() => trackEvent("partner_click", "home", "Rand Gallery")}
          >
            <svg viewBox="0 0 560 560" fill="currentColor" className={`h-16 w-auto ${PARTNER_IMG}`} xmlns="http://www.w3.org/2000/svg">
              <path d="M80.0151 400V160H132.868V400H80.0151ZM222.783 400L156.01 297.948H214.02L284.015 400H222.783ZM118.688 323.696V281.631H176.698C184.432 281.631 191.093 280.109 196.679 277.066C202.48 273.805 206.884 269.348 209.892 263.696C213.115 257.827 214.726 251.087 214.726 243.479C214.726 235.87 213.115 229.24 209.892 223.587C206.884 217.718 202.48 213.261 196.679 210.218C191.093 206.957 184.432 205.327 176.698 205.327H118.688V160H172.508C192.059 160 209.033 163.044 223.427 169.131C237.822 175 248.887 183.805 256.622 195.544C264.356 207.283 268.224 222.066 268.224 239.892V245.109C268.224 262.718 264.249 277.392 256.299 289.131C248.565 300.653 237.5 309.348 223.105 315.218C208.925 320.87 192.412 323.696 172.861 323.696H118.688Z" />
              <path d="M355.962 400C340.174 400 326.583 397.111 315.188 391.331C303.794 385.552 295.044 377.719 288.937 367.833C282.831 357.947 279.777 346.845 279.777 334.525C279.777 325.324 281.602 317.187 285.251 310.115C288.9 302.966 293.964 296.388 300.443 290.381C306.922 284.297 314.444 278.289 323.008 272.358L366.239 243.042C371.973 239.24 376.255 235.248 379.085 231.065C381.915 226.807 383.33 222.092 383.33 216.921C383.33 212.13 381.431 207.681 377.633 203.575C373.835 199.468 368.51 197.415 361.659 197.415C357.041 197.415 353.02 198.48 349.594 200.609C346.243 202.738 343.599 205.514 341.663 208.936C339.801 212.282 338.87 215.97 338.87 220C338.87 224.943 340.211 229.962 342.892 235.058C345.647 240.153 349.259 245.514 353.727 251.141C358.196 256.693 363.074 262.662 368.361 269.05L479.777 400H434.908L341.588 293.232C335.407 286.008 329.338 278.594 323.38 270.989C317.148 263.557 309.316 253.524 305.369 245.083C301.422 236.566 299.55 229.164 299.55 219.202C299.55 208.023 302.082 197.947 307.146 188.974C312.284 180 319.471 172.928 328.705 167.757C338.014 162.586 348.85 160 361.212 160C373.425 160 383.926 162.51 392.713 167.529C401.501 172.472 408.278 179.088 413.044 187.377C417.81 195.59 420.193 204.601 420.193 214.411C420.193 225.438 417.512 235.4 412.15 244.297C406.863 253.118 399.416 261.065 389.809 268.137L343.339 302.586C336.562 307.529 331.609 312.586 328.482 317.757C325.428 322.928 323.902 327.681 323.902 332.016C323.902 337.795 325.279 343.004 328.035 347.643C330.865 352.206 334.849 355.856 339.987 358.594C345.126 361.255 351.121 362.586 357.972 362.586C366.015 362.586 373.984 360.723 381.878 356.997C389.772 353.194 394.896 346.483 401.375 339.487C407.929 332.491 414.765 325.953 418.99 316.052C422.862 306.394 424.761 293.481 424.761 281.694H462.741C462.741 296.142 461.19 311.103 458.062 322.434C455.009 333.689 450.801 343.423 445.439 351.635C440.152 359.772 434.231 366.388 427.678 371.483C425.592 372.928 423.544 374.297 421.534 375.59C419.597 376.883 417.587 378.213 415.501 379.582C407.161 386.731 397.703 391.94 387.128 395.21C376.553 398.404 366.164 400 355.962 400Z" />
            </svg>
          </a>
          <a
            href="https://apps.crust.network/?rpc=wss%3A%2F%2Frpc.crust.network#/explorer"
            className={PARTNER}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("partner_click", "home", "Crust Network")}
          >
            <img src="./crust.png" alt="Crust Network" className={`h-9 w-auto ${PARTNER_IMG}`} />
          </a>
          <a
            href="https://mentalmarvin.art/"
            className={PARTNER}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("partner_click", "home", "Mental Marvin")}
          >
            <img src="./sm-small.png" alt="Studio Maars" className={`h-7 w-auto ${PARTNER_IMG}`} />
          </a>
        </div>
      </section>
    </div>
  );
}
