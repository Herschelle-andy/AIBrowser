/**
 * Sahayak — Prompt Builder Service
 *
 * Centralises system and user prompt construction for AI tasks.
 * Handles language adapters (English / Hinglish), formatting rules,
 * and structured output schemas.
 */

(function () {
  'use strict';

  /**
   * Get system prompt language instruction.
   *
   * @param {string} language - 'en' or 'hi-en'
   * @returns {string}
   */
  function getLanguageInstruction(language) {
    if (language === 'hi-en') {
      return (
        'Respond in Hinglish — natural Hindi-English mix written strictly in Roman script. ' +
        'Keep technical and domain-specific terms in English. ' +
        'CRITICAL: You MUST write in Roman script only. Do NOT use Devanagari (Hindi script). ' +
        "Example tone: 'Is article ka core takeaway yeh hai ki...', 'Pehla main point yeh hai...'"
      );
    }
    return 'Respond in clear, concise English.';
  }

  /**
   * Build the prompt for structured article summarisation.
   *
   * @param {Object} article
   * @param {string} article.title
   * @param {string} article.content
   * @param {string} [article.byline]
   * @param {string} [article.siteName]
   * @param {string} [article.url]
   * @param {boolean} [article.isTruncated]
   * @param {string} [language='en']
   * @returns {{ systemPrompt: string, userPrompt: string }}
   */
  function buildSummaryPrompt(article, language = 'en') {
    const langRule = getLanguageInstruction(language);

    const systemPrompt = [
      'You are Sahayak, an intelligent, objective browser assistant that helps users quickly grasp web articles.',
      langRule,
      'Maintain an informative, neutral tone. Ground all statements strictly in the article provided.',
      'Do not invent facts or extrapolate beyond what the text states.'
    ].join(' ');

    const metadataLines = [];
    if (article.title) metadataLines.push(`Title: ${article.title}`);
    if (article.siteName) metadataLines.push(`Source: ${article.siteName}`);
    if (article.byline) metadataLines.push(`Byline: ${article.byline}`);
    if (article.url) metadataLines.push(`URL: ${article.url}`);
    if (article.isTruncated) {
      metadataLines.push('Note: This article is very long and has been truncated to fit.');
    }

    const userPrompt = [
      'Please read the following article extract and provide a structured summary.',
      '',
      metadataLines.join('\n'),
      '',
      '--- Article Content Start ---',
      article.content,
      '--- Article Content End ---',
      '',
      'Format your response strictly using the following three Markdown sections:',
      '',
      '## TL;DR',
      'One direct, punchy sentence summarising the primary conclusion or theme of the article.',
      '',
      '## Key Points',
      '1. [First major insight or fact]',
      '2. [Second major insight or fact]',
      '3. [Third major insight or fact]',
      '4. [Fourth major insight or fact]',
      '5. [Fifth major insight or fact]',
      '',
      '## What To Do Next',
      'Provide 2 to 3 concrete, practical recommendations, next steps, or discussion angles for someone reading this topic.'
    ].join('\n');

    return {
      systemPrompt,
      userPrompt
    };
  }

  // Export
  globalThis.PromptBuilder = {
    getLanguageInstruction,
    buildSummaryPrompt
  };
})();

