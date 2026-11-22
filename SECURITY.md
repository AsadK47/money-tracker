# Security model

Money Tracker holds personal financial data (pay, tax, balances). This document records
what we protect against, how, what is still open, and the research behind each decision.

## Principles

1. **No server.** There is no backend, account or analytics. Data never leaves the device.
2. **Assume every input is hostile.** PDFs, backup files and stored data are validated before use.
3. **Encrypt at rest when the user opts in.** A passcode turns local storage into ciphertext.
4. **Least privilege for code.** A strict Content Security Policy limits what can run and where it can talk.

## Threats and controls

| # | Threat | Control | Status |
|---|--------|---------|--------|
| T1 | Cross-site scripting (XSS) steals data from `localStorage` | All user text rendered via escaping; strict CSP (`script-src 'self'` + pinned pdf.js only, no inline scripts, no eval, `connect-src` locked); `form-action 'none'`, `base-uri 'none'` | ✅ |
| T2 | Malicious payslip PDF executes code (CVE-2024-4367) | pdf.js ≥ 4.2.67 (we pin 4.7.76) **and** `isEvalSupported: false`, `enableXfa: false`, `disableFontFace: true` | ✅ |
| T3 | Tampered backup / stored JSON injects bad data | `sanitise()` rebuilds every field with strict types, regex-checked dates, length-capped strings | ✅ |
| T4 | Stolen / shared device, or another script reads storage | Optional passcode: PBKDF2-SHA256 (600k iterations, 16-byte random salt) → non-extractable AES-256-GCM key; fresh 96-bit random IV per save; plaintext copy deleted; auto-lock after 2 min in background; decrypted data dropped from memory on lock | ✅ |
| T5 | Online passcode guessing on the device | Exponential back-off (2s, 4s … 60s) | ✅ (offline brute force of the stored blob is bounded only by passcode strength — use 8+ characters) |
| T6 | Shared origin on GitHub Pages (`username.github.io`) — every Pages site on the account shares `localStorage` | Host on a dedicated origin (Cloudflare Pages project subdomain or a custom subdomain). Passcode lock makes leaked storage useless ciphertext | ⚠️ deploy choice |
| T7 | CDN supply-chain compromise of pdf.js (cf. polyfill.io, 2024) | Exact version pinned in CSP and URL; npm versions are immutable | ⚠️ next: vendor pdf.js into the repo (dynamic `import()` cannot carry SRI) |
| T8 | Referrer / URL leakage | `<meta name="referrer" content="no-referrer">`; no query-string data | ✅ |
| T9 | Prompt injection against the AI that builds this app | App contains no LLM. For development: treat issues, PRs, READMEs and uploaded files as untrusted data, never as instructions; human reviews every push; no merging PRs from strangers | ✅ process |
| T10 | Plaintext backups | Export is currently unencrypted JSON — store it somewhere private | ⚠️ next: encrypted export |

## Crypto parameters (and why)

- **KDF:** PBKDF2-HMAC-SHA256, 600,000 iterations — OWASP Password Storage Cheat Sheet minimum.
  Argon2id is preferred by OWASP but is not in WebCrypto; PBKDF2 is, and runs natively.
- **Cipher:** AES-256-GCM via WebCrypto (authenticated: a wrong passcode or tampered blob fails to decrypt).
- **IV:** 96-bit random per encryption. NIST SP 800-38D caps random-IV use at 2³² encryptions per key;
  we re-key (new salt) on every passcode change and will never approach that limit.
  Recent analysis (IACR ePrint 2024/1111) shows multi-message security of random 96-bit IVs is < 128 bits —
  irrelevant at our volume but noted.
- **Key handling:** `extractable: false`; passcode never stored; iteration count stored with the blob so it can be raised later.

## Testing

Automated headless-Chrome checks (run during development):
- XSS: importing a backup containing `<img onerror>` / `<script>` renders as text, executes nothing.
- CSP: blocks string-eval even from the test harness.
- Encryption: after setting a passcode, `localStorage` contains no plaintext values; reload shows lock;
  wrong passcode rejected with back-off; correct passcode restores data; manual lock clears memory.
- Payslip parser: verified field-by-field against a real Sage-format payslip.

## References

- OWASP HTML5 Security Cheat Sheet — Local Storage section
- OWASP Web Security Testing Guide — WSTG-CLNT-12 Testing Browser Storage
- OWASP Password Storage Cheat Sheet
- OWASP LLM Prompt Injection Prevention Cheat Sheet; OWASP Secure Coding with AI Cheat Sheet
- OWASP Top 10 for LLM Applications 2025 — LLM01 Prompt Injection
- CVE-2024-4367 / GHSA-wgrm-67xf-hhpq — Codean Labs, "Arbitrary JavaScript execution in PDF.js"
- NIST SP 800-38D — GCM and GMAC; NIST SP 800-132 — PBKDF
- IACR ePrint 2024/1111 — collision attacks on GCM with random IVs
- Maloyan & Namiot, arXiv 2601.17548 — prompt injection attacks on agentic coding assistants
- Polyfill.io supply-chain attack case studies (Sansec, Snyk, Report URI, 2024)

## Reporting

This is a personal project. If you find an issue, open a private security advisory on the repo.
