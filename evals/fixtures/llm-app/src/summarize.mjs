const MODEL = 'claude-fixture-1';

/**
 * One-sentence summary of `text`.
 * @param {{ messages: { create: (params: object) => Promise<{ content: { type: string, text?: string }[] }> } }} client
 * @param {string} text
 */
export async function summarize(client, text) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: `Resuma em uma frase: ${text}` }],
  });
  return response.content[0].text;
}
