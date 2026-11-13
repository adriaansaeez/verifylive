// Minimal Clef client for NaN (Node.js 18+, no dependencies).
// Usage: NAN_KEY=... node clef.mjs
// Retries immediately on 429 and caps concurrency at 2 in-flight requests.

const URL = "https://api.nan.builders/v1/systemone";
const MAX_RETRIES = 5;
const MAX_CONCURRENCY = 2; // NaN allows at most 2 concurrent requests per person

let inFlight = 0;
const waiting = [];
const acquire = () =>
  inFlight < MAX_CONCURRENCY ? (inFlight++, Promise.resolve()) : new Promise((r) => waiting.push(r));
const release = () => (waiting.length ? waiting.shift()() : inFlight--);

export async function askClef(state, questions, model = "clef") {
  await acquire();
  try {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NAN_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, state, questions }),
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (!res.ok) throw new Error(`Clef HTTP ${res.status}: ${await res.text()}`);
      return res.json();
    }
  } finally {
    release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await askClef("User prompt: Write a haiku about cats.", {
    route: {
      type: "choice",
      instructions: "Which model should answer this request?",
      criteria: {
        fast: "Simple, short or conversational requests",
        large: "Hard requests: multi-step reasoning, large codebases, long documents",
      },
    },
  });
  console.log(JSON.stringify(result, null, 2));
}
