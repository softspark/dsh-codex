export const initializeResult = {
  userAgent: 'codex_cli_rs/0.1.0',
  codexHome: '/tmp/codex-home',
  platformFamily: 'unix',
  platformOs: 'macos',
} as const

export const chatGptAccountResult = {
  account: {
    type: 'chatgpt',
    email: 'user@example.test',
    planType: 'pro',
  },
  requiresOpenaiAuth: true,
} as const

export const modelListResult = {
  data: [
    {
      id: 'gpt-5.6-terra',
      model: 'gpt-5.6-terra',
      upgrade: null,
      upgradeInfo: null,
      availabilityNux: null,
      displayName: 'GPT-5.6 Terra',
      description: 'Test model fixture',
      modelSpecialty: null,
      hidden: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: 'Balanced' },
      ],
      defaultReasoningEffort: 'medium',
      inputModalities: ['text', 'image'],
      supportsPersonality: false,
      multiAgentVersion: null,
      additionalSpeedTiers: [],
      serviceTiers: [],
      defaultServiceTier: null,
      isDefault: true,
    },
  ],
  nextCursor: null,
} as const

export const threadStartResult = {
  thread: {
    id: 'thr_test_123',
    preview: '',
    modelProvider: 'openai',
    createdAt: 1_725_000_000,
    updatedAt: 1_725_000_000,
    status: { type: 'idle' },
  },
} as const

export const turnStartResult = {
  turn: {
    id: 'turn_test_456',
    items: [],
    status: 'inProgress',
    error: null,
  },
} as const

export const agentDeltaNotification = {
  method: 'item/agentMessage/delta',
  params: {
    threadId: 'thr_test_123',
    turnId: 'turn_test_456',
    itemId: 'item_test_789',
    delta: 'Hello',
  },
} as const

export const turnCompletedNotification = {
  method: 'turn/completed',
  params: {
    threadId: 'thr_test_123',
    turn: {
      id: 'turn_test_456',
      items: [],
      status: 'completed',
      error: null,
    },
  },
} as const

export const commandApprovalRequest = {
  id: 9001,
  method: 'item/commandExecution/requestApproval',
  params: {
    itemId: 'item_command_1',
    threadId: 'thr_test_123',
    turnId: 'turn_test_456',
    reason: 'Run project tests',
    command: ['npm', 'test'],
    cwd: '/workspace',
    availableDecisions: ['accept', 'decline', 'cancel'],
  },
} as const
