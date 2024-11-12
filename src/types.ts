// Component Props

export interface Image {
  path: string;
  url: string;
}

export interface DropdownMenu {
  onClose: () => void;
  isOpen: boolean;
}

export interface FAQItem {
  faq: FAQ;
  index: number;
  toggleFAQ: (index: number) => void;
}

export interface FAQ {
  question: string;
  answer: string;
  open?: boolean;
}

export interface Infinity {
  mnemonic: string;
  setMnemonic: React.Dispatch<React.SetStateAction<string>>;
  description?: string;
}
