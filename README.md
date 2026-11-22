# Money Tracker

A private, phone-first personal finance tracker. Plain HTML/CSS/JS — no build step, no server.

## Features
- **Payslips:** import a PDF (read on-device, never uploaded) or enter one step by step with hints.
  Flags emergency tax codes (M1/W1/X, 0T, BR…).
- Monthly take-home, bills and Amex spend; month-end balances for current account, cash ISA,
  stocks & shares ISA, JP Morgan and pension
- Net worth headline and chart; emergency-fund progress with months-to-go
- Surplus saved this UK tax year
- **Passcode lock:** AES-256-GCM encryption on the device, auto-lock, wipe on forgotten passcode
- Private mode (nothing saved), export / import backup

## Privacy & security
All data stays in your browser. See [SECURITY.md](SECURITY.md) for the threat model.

## Run
Open `index.html`, or serve the folder:

```sh
python3 -m http.server
```

## Deploy
Prefer a dedicated origin (e.g. a Cloudflare Pages project) over `username.github.io`,
because all GitHub Pages sites on one account share browser storage.
