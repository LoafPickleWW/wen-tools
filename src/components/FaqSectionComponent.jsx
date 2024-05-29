import { useState } from "react";

const FAQItem = ({ faq, index, toggleFAQ }) => (
  <div className="border-b-2 py-4 border-gray-200">
    <button
      className="w-full text-left py-4 focus:outline-none"
      onClick={() => toggleFAQ(index)}
    >
      <h2 className="text-base font-medium px-4">{faq.question}</h2>
    </button>
    <div
      className={`overflow-hidden transition-all duration-300 ${
        faq.open ? "max-h-40" : "max-h-0"
      }`}
    >
      <p className="p-4 text-sm">{faq.answer}</p>
    </div>
  </div>
);

const FaqSectionComponent = ({faqData}) => {
  const [faqs, setFaqs] = useState(
    faqData.map((faq) => ({ ...faq, open: false }))
  );

  const toggleFAQ = (index) => {
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
    <div className="max-w-xl mx-auto mt-10">
      <h1 className="text-xl font-semibold text-center">
        Frequently Asked Questions
      </h1>
      {faqs.map((faq, index) => (
        <FAQItem key={index} faq={faq} index={index} toggleFAQ={toggleFAQ} />
      ))}
    </div>
  );
};

export default FaqSectionComponent;
