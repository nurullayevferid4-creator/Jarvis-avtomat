# Pulsuz AI alternativləri (Claude / GPT əvəzləri)

Tarix: 29 sentyabr 2026. Bu siyahı üçüncü tərəf mənbələrinə əsaslanır, limitlər və qiymətlər tez dəyişir. İstifadədən əvvəl rəsmi səhifədən yoxla.

## Pulsuz API-lər (kart istəmir, üçüncü tərəf siyahısı, avqust 2026)

| Provayder | Modellər | Limit |
|---|---|---|
| Google Gemini | Gemini Flash variantları | 15 sorğu/dəq, 1500/gün (rəsmi sənəd rəqəm göstərmir, AI Studio-da bax) |
| Groq | GPT-OSS, Qwen | 30 sorğu/dəq, 1000/gün |
| Mistral | Medium, Small, Ministral | təxminən 500 min token/dəq |
| Cloudflare Workers AI | 75+ model | 10 000 neuron/gün |
| OpenRouter | `:free` modellər | 20 sorğu/dəq, 50/gün (10 kredit alanda 1000/gün, rəsmi sənəd) |

GitHub Models 30 iyul 2026-da bağlanıb (GitHub sənədi).

## Kompüterdə lokal (Ollama və s.)

- Motor: Ollama (asan) və ya llama.cpp (daha çox nəzarət, sürət eyni).
- İnterfeys: Open WebUI (geniş platforma) və ya LibreChat (MIT, təmiz multi-provayder). İkisi də Ollama, OpenAI və Anthropic ilə işləyir.
- Modellər (28 sentyabr 2026):
  - 8-16 GB video yaddaş: GPT-OSS 20B, Gemma 4 12B, ZAYA1-8B
  - 16-24 GB: Qwen3.6-27B (kod üçün ən yaxşı), Gemma 4 31B
  - Mac 32 GB: Qwen3.6-27B, Gemma 4 31B
  - Kimi K2.6, GLM-5.1: çoxlu server GPU-su lazımdır
- Kod agentləri (Claude Code əvəzi): OpenHands, OpenCode, Aider, Cline. Hamısı Ollama ilə işləyir.

## Açıq suallar

- Kompüterin RAM, GPU və əməliyyat sistemi məlum deyil, model seçimi buna bağlıdır.
- Azərbaycanca keyfiyyət yoxlanmayıb.

## Mənbələr

- https://github.com/mnfst/awesome-free-llm-apis
- https://docs.github.com/en/github-models/about-github-models
- https://openrouter.ai/docs/api-reference/limits
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://benchlm.ai/best/local-llm
- https://mrsaynothing.dev/en/blog/2026-09-10/llama-cpp-vs-ollama
- https://docs.openwebui.com/alternatives/librechat/
- https://www.openhands.dev/blog/claude-code-alternatives
