/**
 * LLM Prompts for Web Search Integration
 * Similar structure to existing rag_implementation.js prompts
 */

export const webSearchOfferPrompt = `You are a helpful assistant integrated into a team Slack channel.

The user asked a question, but we found NO relevant information in our internal documentation.

Based on the user's question below, decide whether it would be helpful to search the web for information.
- Say YES if the question is about a general technical topic, industry knowledge, or third-party tools
- Say NO if the question is private, sensitive, or clearly internal-only

User's question: "{userQuestion}"

Respond with only: YES or NO`;

export const webSearchQueryPrompt = `You are an expert at formulating search queries.

The user has asked a question, and we want to search the web for relevant information.

Formulate an optimized search query that will return the most relevant and helpful results.
Keep it concise (3-8 words) and focused on the core topic.

User's question: "{userQuestion}"

Respond with only the search query, nothing else.`;

export const webContentSummarizationPrompt = `You are an expert at extracting relevant information from web sources.

The user asked the following question: "{userQuestion}"

Below are the top web search results with their content. Extract the most relevant information to answer the user's question.
Synthesize the information into a clear, concise answer. If the sources don't directly answer the question, say so.

Web Search Results:
{webContent}

Provide a helpful, accurate answer based on these sources:`;


export const webSourceAttributionTemplate = `_Based on web search results_ (since we don't have this in our internal docs)`;

/**
 * Helper to format web sources for LLM consumption
 * @param {Array} results - Array of web search results with content
 * @returns {string} Formatted content for LLM
 */
export function formatWebContentForLLM(results) {
  if (!results || results.length === 0) {
    return 'No web content available';
  }

  return results
    .map(
      (result, index) => `
Source ${index + 1}: ${result.title}
URL: ${result.url}
Content:
${result.content}
---
`
    )
    .join('\n');
}

/**
 * Helper to create web search attribution message
 * @param {Array} results - Array of web search results
 * @returns {string} Attribution with sources
 */
export function createWebSourceAttribution(results) {
  if (!results || results.length === 0) {
    return webSourceAttributionTemplate;
  }

  const sources = results
    .map((result, index) => `${index + 1}. <${result.url}|${result.title}>`)
    .join('\n');

  return `_This answer is based on web search results:_\n${sources}`;
}

export default {
  webSearchOfferPrompt,
  webSearchQueryPrompt,
  webContentSummarizationPrompt,
  webSourceAttributionTemplate,
  formatWebContentForLLM,
  createWebSourceAttribution,
};
