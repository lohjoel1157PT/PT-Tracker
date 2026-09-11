const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Anthropic = require("@anthropic-ai/sdk");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const MAX_QUESTION_LENGTH = 2000;
const MAX_HISTORY_TURNS = 10;

const FITNESS_SYSTEM_PROMPT = `You are the "AI Coach" embedded in a personal trainer's client-management app. The person asking is a personal trainer, not a client.

Your domain is exercise science, strength & conditioning, program design, and general fitness nutrition. Stay in that lane — for questions clearly outside fitness/exercise, say briefly that it's outside what you're built for rather than answering as a general-purpose assistant.

Factual accuracy matters more than sounding confident:
- For anything time-sensitive, statistical, citing a specific study, or otherwise fact-specific, use the web_search tool and ground your answer in what you find rather than answering from memory alone.
- If you're not sure or the search doesn't turn up a clear answer, say so explicitly. Never present a guess as settled fact.
- When you use web search, briefly indicate what you found it from so the trainer can verify it themselves.

You are not a medical professional. For anything involving injury, pain, diagnosis, or medical conditions, say clearly that the client should see a qualified healthcare provider — don't attempt a diagnosis or medical treatment plan yourself.

Keep answers focused and practical — this trainer is checking something between clients, not reading an essay.`;

exports.askAI = onCall({ secrets: [anthropicApiKey], cors: true }, async (request) => {
  const question = (request.data?.question || "").trim();
  const history = Array.isArray(request.data?.history) ? request.data.history : [];

  if (!question) {
    throw new HttpsError("invalid-argument", "Question is required.");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new HttpsError("invalid-argument", `Question must be under ${MAX_QUESTION_LENGTH} characters.`);
  }

  const trimmedHistory = history
    .slice(-MAX_HISTORY_TURNS)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  const client = new Anthropic({ apiKey: anthropicApiKey.value() });

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: FITNESS_SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages: [...trimmedHistory, { role: "user", content: question }],
    });
  } catch (err) {
    console.error("Anthropic API error:", err);
    throw new HttpsError("internal", "The AI assistant is temporarily unavailable. Please try again.");
  }

  let answer = "";
  const sources = [];
  for (const block of response.content) {
    if (block.type === "text") {
      answer += block.text;
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === "web_search_result" && result.url) {
          sources.push({ title: result.title || result.url, url: result.url });
        }
      }
    }
  }

  return { answer: answer.trim(), sources };
});
