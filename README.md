# 🤖 Sahayak — AI Browser Assistant

> Your browser AI assistant — reads, explains, sees, and acts on web pages with your explicit approval.

Sahayak is a Chrome Extension (Manifest V3) that lives in your browser's side panel. It pairs with you to digest complex articles, explain technical jargon, and assist with on-page tasks using Google's Gemini models.

---

## ✨ Features (Phase 1)

* **📄 Page Summary (Slice 1.3):**
  * One-click article extraction powered by Mozilla Readability.
  * Delivers a structured 3-part brief:
    * **💡 TL;DR:** Single-sentence core insight.
    * **📌 5 Key Points:** Numbered breakdown of key facts.
    * **🎯 What To Do Next:** Concrete recommendations and takeaways.
  * Displays article metadata (word count, source, estimated read time) and detects paywall/login teasers.
* **✨ Explain Text (Slice 1.2):**
  * Paste or select any text on any webpage to receive an instant, simple explanation.
  * Supports keyboard shortcuts (`Ctrl+Enter` / `Cmd+Enter`) and one-click copy.
* **🌐 Language Toggle (English / Hinglish):**
  * Switch between clear English and natural Roman-script Hinglish (`hi-en`) at any time.
* **⚙️ Client-Side Key Management:**
  * Free-tier Gemini API integration.
  * API keys are stored locally on your machine via `chrome.storage.local` — never sent to third-party proxy servers.

---

## 🏗️ Project Structure

```text
AIBrowser/
├── manifest.json              # Chrome Manifest V3 configuration
├── background/
│   └── index.js               # Service Worker & Message Router
├── content/
│   ├── index.js               # Content script entry point
│   ├── reader.js              # DOM cloning & article extraction
│   └── lib/
│       └── Readability.js     # Standalone Mozilla Readability engine
├── services/
│   └── ai/
│       ├── geminiProvider.js  # Gemini REST API client with error mapping
│       ├── modelGateway.js    # Gateway with dynamic model discovery
│       └── promptBuilder.js   # Prompt formatting & language adapters
├── sidepanel/
│   ├── index.html             # Side panel interface
│   ├── app.js                 # App controller & tab navigation
│   ├── components/
│   │   ├── SettingsView.js    # API Key & preference manager
│   │   └── SummaryView.js     # Page summarisation UI
│   └── styles/
│       └── panel.css          # Design system & component styling
├── icons/                     # Extension icons (16px, 48px, 128px)
└── docs/                      # Architectural specifications & implementation plan
```

---

## 🚀 Installation & Local Setup

### 1. Prerequisites
* Google Chrome (or any Chromium browser like Brave, Edge, Arc)
* A free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### 2. Load into Chrome
1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select this folder (`AIBrowser`).
6. Click the extension puzzle icon in Chrome and pin **Sahayak**.

### 3. Add API Key
1. Click the **Sahayak** icon to open the side panel.
2. Click the **⚙️ Settings** icon in the top right.
3. Paste your Gemini API key and click **Save Keys**.

---

## 🛡️ Privacy & Security
* **No external servers:** All API calls originate directly from your browser to Google's official Gemini endpoint.
* **Human-in-the-loop:** No autonomous actions are executed without your approval.
* **Local persistence:** Settings and preferences are saved only inside your local browser storage.

---

## 📜 License
MIT License

