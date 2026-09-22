/**
 * Script to prepare an audited dsh-review campaign plan for @dipertq/dsh-openviking-status.
 * Conforms strictly to dsh-review contract schema (planInputSchema).
 */

const filesToReview = [
  "src/index.ts",
  "src/trustFence.ts",
  "src/credentials.ts",
  "src/client/OpenVikingStatusChip.tsx",
  "src/client/OpenVikingStatusPopover.tsx",
  "src/client/OpenVikingSettingsSection.tsx",
  "src/client/recallParser.ts",
  "tests/securityHardening.test.ts",
];

const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

export const plan = {
  scope:
    "Comprehensive multi-lens audit of @dipertq/dsh-openviking-status: security hardening (V1-V4), Trust Fence network boundaries, credential isolation, and client UI/recall parser robustness.",
  files: filesToReview,
  profile: "adaptive",
  required_lenses: ["correctness", "security", "regressions"],
  routes: [
    {
      id: "gemini-auditor",
      provider: "ninitux",
      model: "gemini-flash-high-latest",
      family: "gemini",
      failure_domain: "ninitux-gemini",
    },
    {
      id: "opus-reasoner",
      provider: "ninitux",
      model: "claude-opus-latest",
      family: "claude",
      failure_domain: "ninitux-anthropic",
    },
    {
      id: "grok-adversary",
      provider: "ninitux",
      model: "grok-latest",
      family: "grok",
      failure_domain: "ninitux-xai",
    },
  ],
  lanes: [
    {
      id: "security-and-trust-fence",
      lenses: ["security"],
      primary: "grok-adversary",
      fallback: "opus-reasoner",
    },
    {
      id: "correctness-and-regressions",
      lenses: ["correctness", "regressions"],
      primary: "gemini-auditor",
      fallback: "opus-reasoner",
    },
    {
      id: "independent-judge",
      lenses: [],
      primary: "opus-reasoner",
      fallback: null,
    },
  ],
  judge_lane: "independent-judge",
  judge_independence: "model_family",
  max_attempts: 6,
  max_requests: 8,
  deadline,
  evidence_sessions: [],
};

console.log(JSON.stringify(plan, null, 2));
