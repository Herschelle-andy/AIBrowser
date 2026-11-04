/**
 * Sahayak — Test Suite Runner (Slice 4.4)
 *
 * Runs all unit tests and syntax checks across the codebase.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Running Sahayak Automated Test Suite...\n');

// ── 1. Syntax Validation ──────────────────────────────────
console.log('1. Checking file syntax...');
const jsFiles = [
  'manifest.json',
  'background/index.js',
  'background/contextMenus.js',
  'background/tabCapture.js',
  'content/index.js',
  'content/reader.js',
  'content/youtube.js',
  'content/scanner.js',
  'content/overlay.js',
  'content/executor.js',
  'services/ai/geminiProvider.js',
  'services/ai/groqProvider.js',
  'services/ai/modelGateway.js',
  'services/ai/promptBuilder.js',
  'services/ai/retryWithFallback.js',
  'services/state/agentStateMachine.js',
  'services/state/checkpoint.js',
  'services/storage/profileStore.js',
  'services/storage/skillsStore.js',
  'safety/blocklists.js',
  'safety/consequential.js',
  'safety/guardrails.js',
  'sidepanel/app.js',
  'sidepanel/components/ActionCard.js',
  'sidepanel/components/ActionLog.js',
  'sidepanel/components/AgentView.js',
  'sidepanel/components/ChatView.js',
  'sidepanel/components/ProfileView.js',
  'sidepanel/components/ScreenshotView.js',
  'sidepanel/components/SettingsView.js',
  'sidepanel/components/SkillsView.js',
  'sidepanel/components/SummaryView.js'
];

for (const rel of jsFiles) {
  const full = path.resolve(__dirname, '..', rel);
  if (rel.endsWith('.json')) {
    JSON.parse(fs.readFileSync(full, 'utf8'));
  } else {
    new Function(fs.readFileSync(full, 'utf8'));
  }
}
console.log('✓ All 32 code & manifest files pass syntax verification.\n');

// ── 2. Mock Storage for Service Tests ─────────────────────
let mockLocalStorage = {};
let mockSessionStorage = {};
global.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (Array.isArray(key)) {
          const res = {};
          key.forEach(k => { res[k] = mockLocalStorage[k]; });
          return res;
        }
        return { [key]: mockLocalStorage[key] };
      },
      set: async (obj) => { Object.assign(mockLocalStorage, obj); },
      remove: async (key) => { delete mockLocalStorage[key]; }
    },
    session: {
      get: async (key) => ({ [key]: mockSessionStorage[key] }),
      set: async (obj) => { Object.assign(mockSessionStorage, obj); },
      remove: async (key) => { delete mockSessionStorage[key]; }
    }
  }
};

(async () => {
  // ── 3. Profile Store Unit Tests ─────────────────────────
  console.log('2. Running ProfileStore tests...');
  const ProfileStore = require('../services/storage/profileStore.js');

  const p1 = ProfileStore.sanitizeProfile({
    fullName: '<script>alert(1)</script>Jane <b>Doe</b>',
    bio: 'Hello <USER_PROFILE>evil</USER_PROFILE> world',
    skills: 'js, python, react, sql'
  });
  assert.strictEqual(p1.fullName, 'Jane Doe');
  assert.strictEqual(p1.bio, 'Hello evil world');
  assert.deepStrictEqual(p1.skills, ['js', 'python', 'react', 'sql']);

  await ProfileStore.saveProfile({ fullName: 'Rohan Sharma', email: 'rohan@example.com' });
  const loadedP = await ProfileStore.getProfile();
  assert.strictEqual(loadedP.fullName, 'Rohan Sharma');
  assert.strictEqual(loadedP.email, 'rohan@example.com');
  await ProfileStore.clearProfile();
  assert.strictEqual(await ProfileStore.getProfile(), null);
  console.log('✓ ProfileStore CRUD and sanitization passed.\n');

  // ── 4. Skills Store Unit Tests ───────────────────────────
  console.log('3. Running SkillsStore tests...');
  const SkillsStore = require('../services/storage/skillsStore.js');

  const skills = await SkillsStore.getSkills();
  assert.strictEqual(skills.length, 4);
  assert.ok(skills.every(s => s.builtIn));

  // Protect built-ins
  await assert.rejects(async () => await SkillsStore.deleteSkill('builtin-exam-notes'), /Built-in skills cannot be deleted/);

  // Template substitution
  const sub = SkillsStore.substituteTemplate('Hello {{profile.fullName}}, notes: {{selectedText}}', {
    selectedText: 'Key formula',
    profile: { fullName: 'Priya' }
  });
  assert.strictEqual(sub.substituted, 'Hello Priya, notes: Key formula');
  console.log('✓ SkillsStore built-in protection and substitution passed.\n');

  // ── 5. Safety Rails Unit Tests ───────────────────────────
  console.log('4. Running Safety Rails tests...');
  const Blocklists = require('../safety/blocklists.js');
  const Guardrails = require('../safety/guardrails.js');
  const Consequential = require('../safety/consequential.js');

  assert.strictEqual(Blocklists.isDomainBlocked('https://onlinesbi.com/login'), true);
  assert.strictEqual(Blocklists.isDomainBlocked('https://razorpay.com/pay'), true);
  assert.strictEqual(Blocklists.isDomainBlocked('https://paypal.com/signin'), true);
  assert.strictEqual(Blocklists.isDomainBlocked('https://example.com/blog/banking-tips'), false);

  // Custom domain blocklist verification
  Blocklists.setCustomDomains(['mybank.internal', 'confidential.corp']);
  assert.strictEqual(Blocklists.isDomainBlocked('https://mybank.internal/dashboard'), true);
  assert.strictEqual(Blocklists.isDomainBlocked('https://sub.confidential.corp/data'), true);
  assert.strictEqual(Blocklists.isDomainBlocked('https://wikipedia.org'), false);

  // Robust URL-based normalization test
  Blocklists.setCustomDomains(['https://wikipedia.org/']);
  assert.strictEqual(Blocklists.isDomainBlocked('https://wikipedia.org/'), true);
  assert.strictEqual(Blocklists.isDomainBlocked('https://en.wikipedia.org/wiki/Main_Page'), true);
  assert.strictEqual(Blocklists.isDomainBlocked('https://en.m.wikipedia.org'), true);

  Blocklists.setCustomDomains([]);
  assert.strictEqual(Blocklists.isDomainBlocked('https://mybank.internal/dashboard'), false);
  assert.strictEqual(Blocklists.isDomainBlocked('https://wikipedia.org'), false);

  assert.strictEqual(Blocklists.isFieldBlocked({ type: 'password' }), true);
  assert.strictEqual(Blocklists.isFieldBlocked({ type: 'text', name: 'user_otp' }), true);
  assert.strictEqual(Blocklists.isFieldBlocked({ type: 'text', name: 'fullname' }), false);

  assert.strictEqual(Consequential.isConsequential({ text: 'Submit Order' }), true);
  assert.strictEqual(Consequential.isConsequential({ text: 'Pay Now' }), true);
  assert.strictEqual(Consequential.isConsequential({ text: 'Read Article' }), false);

  const guardRes1 = Guardrails.checkSafety({ action: 'type', targetElementId: 1 }, 'https://hdfcbank.com', {});
  assert.strictEqual(guardRes1.allowed, false);
  assert.strictEqual(guardRes1.blockType, 'DOMAIN_BLOCKED');

  console.log('✓ Deterministic safety guardrails passed.\n');

  console.log('🎉 All Sahayak tests passed successfully!');
})().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});

