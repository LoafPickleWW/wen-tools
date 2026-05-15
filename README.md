# wen.tools

No-Code Front End Tooling for Bulk Processes on Algorand. These tools were designed with the aim of onboarding creators, collectors and developers.

- Simple Mint
- Really Simple Mint
- P2P Encrypted Chat (E2E, Wallet-Verified)
- And more...

## 🔐 P2P Chat Setup (Vercel / Production)

If you are forking this repo and want the **P2P Chat** to work reliably across different networks (WiFi vs Mobile Data), you should set up a free STUN/TURN server account at [Metered.ca](https://www.metered.ca/stun-turn).

Once you have your credentials, add them to your **Vercel Project Settings > Environment Variables**:

1.  `VITE_TURN_USERNAME`: Your Metered.ca Username
2.  `VITE_TURN_CREDENTIAL`: Your Metered.ca Password

The application will automatically detect these and enable the relay service for peers behind strict firewalls. If these variables are missing, the chat will still work over local networks using Google's public STUN servers.

## 🚀 Getting Started

### Prerequisites

List of things needed to install the software and how to install them.

### Installation

`pnpm i`

`pnpm dev`

## Deployment

Changes that are merged to `main` will be deployed automatically.

## Contributing

To contribute, fork this repo and propose changes back via Pull Request. One of the team members will review and merge your changes.

## Brand Kit

https://drive.google.com/drive/folders/1__MffzHe_qNcpttT6GjpZHackStN_D4C?usp=sharing

## Authors

- **algovado** - _Initial work_ - [algovado](https://github.com/algovado)
- **LoafPickle** - _Initial work_ - [LoafPickle](https://github.com/LoafPickleWW)

See the list of [contributors](https://github.com/thurstober-digital/evil-tools/contributors) who participated in this project.

## Bounties

Bounties will be paid out upon successful merge and approval of the Pull Request.

Total Bounties Paid: 4,450A

## 🔒 Security & Integrity

This repository uses the **ANCHOR Protocol** to create a tamper-evident software supply chain record on the Algorand blockchain. Every build artifact is "anchored" with a cryptographic hash to ensure the code you run matches the code published by the authors.

### Verification

You can verify the provenance of this package at any time using the ANCHOR CLI:

```bash
npx @loafpickleww/anchor verify wen-tools <version>
```

Verification relies on cross-referencing this repository's metadata (wallet `WENFZQKZSLDSJTOH5PXUXSUXFY4UMSC2DB22GK6HL7QBEV7X7ESWNUEZ2U`) with the official transparency log on the Algorand blockchain.

---

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details


