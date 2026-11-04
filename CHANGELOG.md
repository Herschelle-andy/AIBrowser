# Changelog

All notable changes to the **Sahayak** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-05

### 🎉 Initial Production Release

Complete implementation of the **Sahayak** AI Browser Assistant across all 4 build phases (17 architectural slices).

### Added
- **Phase 1: Read the Web**
  - **Extension Shell & MV3 Setup (Slice 1.1)**: Chrome Side Panel integration, service worker background script, active tab info, and local API key storage with format validation.
  - **Quick Explain (Slice 1.2)**: Instant plain-language explanation for selected or pasted text with character counts and keyboard shortcuts (`Ctrl+Enter`).
  - **Structured Article Summary (Slice 1.3)**: Mozilla Readability DOM extraction delivering structured 3-part briefs (TL;DR, 5 Key Points, What To Do Next), read-time estimation, and paywall detection.
  - **YouTube Video Notes (Slice 1.4)**: Timed transcript extraction, chapter-by-chapter notes with clickable timestamps, video seeker, and Gemini direct video fallback.
  - **Bilingual English / Roman-script Hinglish Toggle (Slice 1.5)**: Global language toggle with persistent storage and system prompt language adapters.

- **Phase 2: Conversational Grounding & Vision**
  - **Grounded Tab Chat (Slice 2.1)**: Anti-hallucination chat assistant answering questions strictly grounded in `<PAGE_CONTEXT>` with TF-IDF chunk selection.
  - **Context Menu Quick Actions (Slice 2.2)**: Right-click on any webpage selection to Explain, Translate to Hindi/Hinglish, or Draft Reply.
  - **Multimodal Tab Vision (Slice 2.3)**: Full viewport screenshot capture via `chrome.tabs.captureVisibleTab()` and visual question answering with Gemini Flash.
  - **Dual-Model Gateway & Groq Fallback (Slice 2.4)**: Free-tier orchestration routing to Gemini 2.5 Flash / Flash-Lite, with automatic exponential-backoff retries and fallback to Groq (`llama-3.3-70b-versatile`).

- **Phase 3: The Hands (Autonomous Agent with Human in the Loop)**
  - **Interactive Element Scanner (Slice 3.1 & 3.2)**: DOM crawler filtering visible, non-occluded elements and rendering stable numbered badges in a maximum z-index closed Shadow DOM overlay.
  - **Element Locator ("Find It For Me") (Slice 3.3)**: Natural-language search matching user intent to DOM element IDs with pulsing visual ring highlights.
  - **Autonomous Agent Loop & Approval UI (Slice 3.4)**: Finite state machine proposing one strict-JSON browser action at a time with an interactive ActionCard.
  - **Synthetic Event Dispatcher (Slice 3.5)**: Realistic synthetic event sequences (`focus`, native prototype setter, `input`, `change`, `pointerdown`, `click`) compatible with React, Vue, and Angular forms.
  - **Dry-Run, Persistence & Action Log (Slice 3.6)**: Non-destructive preview mode with purple element pulsing, task history logging, session checkpoints surviving service worker sleep, and keepalive alarms.

- **Phase 4: Memory, Safety & Shipping**
  - **Local Profile Memory (Slice 4.1)**: Client-side profile store (`sahayak_user_profile`) with personal, academic, professional, and preference fields; HTML stripping; prompt injection protection; and multi-window sync.
  - **One-Click Saved Skills (Slice 4.2)**: Prompt recipe engine with 4 built-in skills (Exam Notes, Explain in Hinglish, Reply Politely, Fill Form From Profile), variable substitution (`{{selectedText}}`, `{{profile.*}}`), and JSON export/import.
  - **Deterministic Safety Rails (Slice 4.3)**: Hardcoded domain blocklists (banking, UPI, payments, crypto, government ID), credential field protection (passwords, OTPs, PINs, CVVs), and consequential action double-confirmation.
  - **Release Packaging & Landing Page (Slice 4.4)**: Zero-dependency ZIP builder (`npm run build:zip`), comprehensive test runner (`npm test`), GitHub Pages landing site (`docs/landing/index.html`), and automated GitHub Actions release workflow.

