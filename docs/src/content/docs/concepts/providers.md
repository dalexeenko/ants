---
title: LLM Providers
description: Supported LLM providers and how to configure API keys.
sidebar:
  order: 4
---

OpenMgr supports 14+ LLM providers. API keys are encrypted at rest with AES-256-GCM.

## Supported Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **Anthropic** | Claude models (Opus, Sonnet, Haiku) | |
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5, o1, o3 | |
| **Google** | Gemini models | |
| **OpenRouter** | Multi-model gateway | Access many models through one API key |
| **Groq** | LLaMA, Mixtral | Fast inference |
| **xAI** | Grok models | |
| **AWS Bedrock** | Claude, Llama, etc. | Uses AWS credentials |
| **Azure OpenAI** | GPT models on Azure | |
| **Google Vertex** | Gemini on Google Cloud | |
| **Mistral** | Mistral models | |
| **Cohere** | Command models | |
| **Together** | Open-source models | |
| **Fireworks** | Open-source models | Fast inference |
| **DeepSeek** | DeepSeek models | |

## Configuring API Keys

### Via the Web UI

1. Open the OpenMgr web UI
2. Go to **Settings**
3. Under **API Keys**, select the provider
4. Enter your API key and save

### Via the API

```bash
curl -X PUT http://localhost:6647/system/api-keys/anthropic \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-ant-..."}'
```

Replace `anthropic` with the provider identifier: `openai`, `google`, `openrouter`, `groq`, `xai`, `aws-bedrock`, `azure-openai`, `google-vertex`, `mistral`, `cohere`, `together`, `fireworks`, `deepseek`.

## Security

- All API keys are **encrypted at rest** using AES-256-GCM with the `OPENMGR_ENCRYPTION_KEY`
- Keys are only decrypted in memory when needed for LLM requests
- The encryption key itself is never stored in the database
- Legacy `providers.json` files are automatically migrated to encrypted storage on first startup

:::caution
If you lose the `OPENMGR_ENCRYPTION_KEY`, all stored API keys become unrecoverable. Back up the key securely.
:::
