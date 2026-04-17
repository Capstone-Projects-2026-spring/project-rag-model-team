import axios from 'axios';
import * as cheerio from 'cheerio';

const WIKIPEDIA_SEARCH_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const MAX_RETRIES = 3;
const TIMEOUT = 10000;

/**
 * Search Wikipedia for articles matching the query
 * @param {string} query - The search query
 * @param {number} count - Number of results to return (default: 3)
 * @returns {Promise<Array>} Array of search results with metadata
 */
export async function searchWeb(query, count = 3) {
  try {
    // Clean the query - remove extra quotes that LLM might add
    let cleanQuery = query.replace(/"/g, '').trim();
    
    // Simplify query for Wikipedia: take first 3-4 words only
    // Wikipedia search works better with shorter, more focused queries
    const words = cleanQuery.split(/\s+/);
    if (words.length > 4) {
      cleanQuery = words.slice(0, 4).join(' ');
    }

    console.log(`Searching Wikipedia for: "${cleanQuery}"`);

    // Search for articles
    const searchResponse = await axios.get(WIKIPEDIA_SEARCH_ENDPOINT, {
      params: {
        action: 'query',
        list: 'search',
        srsearch: cleanQuery,
        srwhat: 'text',
        srlimit: count,
        format: 'json',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: TIMEOUT,
    });

    if (!searchResponse.data.query?.search || searchResponse.data.query.search.length === 0) {
      console.warn('No Wikipedia results found for:', cleanQuery);
      return [];
    }

    const results = searchResponse.data.query.search.map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
      snippet: item.snippet.replace(/<[^>]*>/g, ''), // Remove HTML tags
      summary: item.snippet.replace(/<[^>]*>/g, ''),
    }));

    console.log(`Found ${results.length} Wikipedia results:`, results.map(r => r.title));
    return results;
  } catch (error) {
    console.error('Wikipedia search error:', error.message);
    // Return empty array on error - no fallback
    return [];
  }
}

/**
 * Fetch and parse the full content of a webpage
 * @param {string} url - The URL to fetch
 * @returns {Promise<string>} Plain text content of the page
 */
export async function fetchPageContent(url) {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      const response = await axios.get(url, {
        timeout: TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      const $ = cheerio.load(response.data);

      // Remove script, style, and non-visible elements
      $('script').remove();
      $('style').remove();
      $('noscript').remove();

      // Extract main content (try multiple selectors for Wikipedia)
      let content = '';
      const mainSelectors = [
        '.mw-parser-output',  // Wikipedia main content
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.post',
        '#content',
        '.page-content',
      ];

      for (const selector of mainSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
          content = element.text();
          if (content.length > 100) {
            // Found substantial content
            break;
          }
        }
      }

      // Fallback to body if no main content found
      if (!content || content.length < 100) {
        content = $('body').text();
      }

      // Clean up whitespace
      content = content
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 4000); // Limit to 4000 chars to avoid token overload

      console.log(`Successfully fetched content from ${url} (${content.length} chars)`);
      return content;
    } catch (error) {
      retries++;
      console.warn(`Attempt ${retries}/${MAX_RETRIES} to fetch ${url} failed:`, error.message);
      if (retries >= MAX_RETRIES) {
        console.error(`Failed to fetch ${url} after ${MAX_RETRIES} retries`);
        throw new Error(`Could not fetch content from ${url}`);
      }
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Perform web search and fetch content for all results
 * @param {string} query - The search query
 * @param {number} count - Number of results to fetch
 * @returns {Promise<Array>} Array of results with full content
 */
export async function searchAndFetchWeb(query, count = 3) {
  try {
    const searchResults = await searchWeb(query, count);

    if (searchResults.length === 0) {
      return [];
    }

    const resultsWithContent = await Promise.allSettled(
      searchResults.map(async (result) => {
        try {
          const content = await fetchPageContent(result.url);
          return {
            ...result,
            content,
          };
        } catch (error) {
          // If we can't fetch content, still return the result with just snippet
          console.warn(`Could not fetch full content for ${result.url}:`, error.message);
          return {
            ...result,
            content: result.snippet,
          };
        }
      })
    );

    // Filter out rejected promises and map successful ones
    return resultsWithContent
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
  } catch (error) {
    console.error('Web search and fetch error:', error.message);
    throw error;
  }
}

export default {
  searchWeb,
  fetchPageContent,
  searchAndFetchWeb,
};
