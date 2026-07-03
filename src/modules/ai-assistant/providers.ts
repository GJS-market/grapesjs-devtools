import type { AiProvider } from '../../types';

/** Resolved provider settings used to make a request. */
export interface ProviderConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  /** Custom endpoint. When set, the request goes here instead of the default. */
  endpoint?: string;
  /**
   * When `endpoint` is set: send the provider's auth to it (base-URL mode, e.g.
   * OpenRouter/Ollama). Default false = keyless proxy.
   */
  sendKeyToEndpoint?: boolean;
  /** Stream the response. Default: true. */
  stream?: boolean;
}

/** A single chat turn sent to the provider. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Per-request options. */
export interface CallOptions {
  signal?: AbortSignal;
  /** If provided, the response is streamed and this is called per token. */
  onToken?: (delta: string) => void;
}

/** Human-facing metadata for each provider (labels + default model). */
export const PROVIDERS: Record<
  AiProvider,
  { label: string; defaultModel: string; keyHint: string }
> = {
  claude: {
    label: 'Claude (Anthropic)',
    defaultModel: 'claude-opus-4-8',
    keyHint: 'sk-ant-…',
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    defaultModel: 'gpt-4o',
    keyHint: 'sk-…',
  },
  gemini: {
    label: 'Gemini (Google)',
    defaultModel: 'gemini-2.0-flash',
    keyHint: 'AIza…',
  },
};

const MAX_TOKENS = 2048;

/**
 * Send a system prompt + chat history to the configured provider and return the
 * assistant's text. Runs in the user's browser via `fetch` — no SDK.
 *
 * - When `options.onToken` is set, the response is streamed (SSE) and tokens
 *   are delivered as they arrive; the full text is still returned at the end.
 * - When `config.endpoint` is set, the request goes there instead of the
 *   provider's default. Two sub-modes:
 *   - proxy (default): no API key is sent — your proxy injects auth.
 *   - base-URL (`sendKeyToEndpoint`): the provider's auth IS sent, for
 *     OpenAI-compatible backends (OpenRouter/Ollama/LM Studio) and gateways.
 *   The body/response stay provider-native, so streaming still works either way.
 */
export async function callProvider(
  config: ProviderConfig,
  system: string,
  messages: ChatMessage[],
  options: CallOptions = {},
): Promise<string> {
  const hasEndpoint = !!config.endpoint;
  const proxy = hasEndpoint && !config.sendKeyToEndpoint;
  const needsKey = !proxy; // direct provider or base-URL both send auth
  if (needsKey && !config.apiKey) {
    throw new Error('No API key set — open Settings.');
  }
  const stream = !!options.onToken;
  const spec = SPECS[config.provider];

  let url: string;
  if (hasEndpoint) {
    url = config.endpoint!;
    // Gemini authenticates via a `?key=` query param, not a header — append it
    // in base-URL mode if the endpoint doesn't already carry a key.
    if (!proxy && config.provider === 'gemini' && !/[?&]key=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(config.apiKey);
    }
  } else {
    url = spec.url(config, stream);
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (proxy) {
    // Let a multi-provider proxy route the request; no key leaves the browser.
    headers['x-devtools-provider'] = config.provider;
  } else {
    Object.assign(headers, spec.headers(config));
  }

  const res = await fetch(url, {
    method: 'POST',
    signal: options.signal,
    headers,
    body: JSON.stringify(spec.body(config, system, messages, stream)),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw providerError(res, data);
  }

  if (stream) {
    return readSSE(res, spec.delta, options.onToken!);
  }
  const data = await res.json().catch(() => ({}));
  return spec.full(data);
}

// ── Per-provider specs ──────────────────────────────────────────────────────

interface ProviderSpec {
  url(cfg: ProviderConfig, stream: boolean): string;
  headers(cfg: ProviderConfig): Record<string, string>;
  body(
    cfg: ProviderConfig,
    system: string,
    messages: ChatMessage[],
    stream: boolean,
  ): unknown;
  /** Extract full text from a non-streamed response body. */
  full(data: unknown): string;
  /** Extract the text delta from one parsed SSE `data:` object (or ''). */
  delta(evt: unknown): string;
}

const SPECS: Record<AiProvider, ProviderSpec> = {
  claude: {
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (cfg) => ({
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser use (opts past the default CORS block).
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    body: (cfg, system, messages, stream) => ({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    }),
    full: (data) =>
      ((data as { content?: { type: string; text?: string }[] }).content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim(),
    delta: (evt) => {
      const e = evt as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        return e.delta.text ?? '';
      }
      return '';
    },
  },

  openai: {
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (cfg) => ({ authorization: `Bearer ${cfg.apiKey}` }),
    body: (cfg, system, messages, stream) => ({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      stream,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    full: (data) =>
      (
        (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]
          ?.message?.content ?? ''
      ).trim(),
    delta: (evt) =>
      (evt as { choices?: { delta?: { content?: string } }[] }).choices?.[0]
        ?.delta?.content ?? '',
  },

  gemini: {
    url: (cfg, stream) => {
      const verb = stream ? 'streamGenerateContent' : 'generateContent';
      const q = stream ? '?alt=sse&key=' : '?key=';
      return (
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(cfg.model)}:${verb}${q}` +
        encodeURIComponent(cfg.apiKey)
      );
    },
    headers: () => ({}),
    body: (_cfg, system, messages) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
    full: (data) => geminiText(data).trim(),
    delta: (evt) => geminiText(evt),
  },
};

function geminiText(data: unknown): string {
  const parts = (
    data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  ).candidates?.[0]?.content?.parts;
  return (parts ?? []).map((p) => p.text ?? '').join('');
}

// ── SSE reader ──────────────────────────────────────────────────────────────

/**
 * Read a Server-Sent-Events response body line by line, extract text deltas via
 * `extractDelta`, forward each to `onToken`, and return the accumulated text.
 * Provider-agnostic: it only understands `data:` lines and `[DONE]`.
 */
async function readSSE(
  res: Response,
  extractDelta: (evt: unknown) => string,
  onToken: (delta: string) => void,
): Promise<string> {
  const body = res.body;
  if (!body) {
    // No streamable body — fall back to a full parse.
    const data = await res.json().catch(() => ({}));
    return extractDelta(data);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = extractDelta(json);
    if (delta) {
      full += delta;
      onToken(delta);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer) handleLine(buffer);
  return full.trim();
}

// ── errors ──────────────────────────────────────────────────────────────────

function providerError(res: Response, data: unknown): Error {
  const d = data as { error?: { message?: string } | string };
  let msg: string | undefined;
  if (typeof d.error === 'string') msg = d.error;
  else msg = d.error?.message;
  return new Error(msg || `HTTP ${res.status} ${res.statusText}`);
}
