import { useState } from "react";
import { FAQ, type FAQItem } from "../types";

const FAQItem = ({ faq, index, toggleFAQ }: FAQItem) => (
  <div className="border-b border-white/[0.07] last:border-b-0">
    <button
      className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.02]"
      onClick={() => toggleFAQ(index)}
      aria-expanded={faq.open}
    >
      <h3 className="text-sm font-medium text-white md:text-base">{faq.question}</h3>
      <span
        aria-hidden="true"
        className={`shrink-0 font-mono text-lg leading-none transition-transform duration-300 ${
          faq.open ? "rotate-45 text-primary-orange" : "text-slate-500 group-hover:text-slate-300"
        }`}
      >
        +
      </span>
    </button>
    {/* grid-rows animation: no fixed max-height, so long answers never get cut off */}
    <div
      className={`grid transition-all duration-300 ${
        faq.open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="overflow-hidden">
        <p className="px-5 pb-5 text-sm leading-relaxed text-slate-400">{faq.answer}</p>
      </div>
    </div>
  </div>
);

const FaqSectionComponent = ({ faqData }: { faqData: FAQ[] }) => {
  const [faqs, setFaqs] = useState(
    faqData.map((faq) => ({ ...faq, open: false }))
  );

  const toggleFAQ = (index: number) => {
    setFaqs(
      faqs.map((faq, i) => {
        if (i === index) {
          faq.open = !faq.open;
        } else {
          faq.open = false;
        }
        return faq;
      })
    );
  };

  return (
    <section className="mx-auto mt-14 w-full max-w-2xl text-left">
      <p className="wt-label mb-2 text-center">( faq )</p>
      <h2 className="mb-5 text-center text-2xl font-semibold text-white">
        Frequently asked questions
      </h2>
      <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50 backdrop-blur">
        {faqs.map((faq, index) => (
          <FAQItem key={index} faq={faq} index={index} toggleFAQ={toggleFAQ} />
        ))}
      </div>
    </section>
  );
};

export default FaqSectionComponent;
