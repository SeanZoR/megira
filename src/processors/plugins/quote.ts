import type { ProcessorPlugin, ProcessingContext, ProcessingResult } from '../types';
import { matchQuoteToContent, generateQuoteImage } from '../../quotes';

export class QuotePlugin implements ProcessorPlugin {
  name = 'quote';

  async shouldRun(context: ProcessingContext): Promise<boolean> {
    // Run if content has "Include Quote" checkbox enabled
    return context.content.includeQuote === true;
  }

  async process(context: ProcessingContext): Promise<ProcessingResult> {
    try {
      // Load quotes from R2
      const quotesData = await context.env.R2.get('quotes.json');
      if (!quotesData) {
        return {
          success: false,
          message: 'No quotes database found in R2',
        };
      }

      const quotes = JSON.parse(await quotesData.text());

      // Use Claude to find the best matching quote
      const matchedQuote = await matchQuoteToContent(
        context.content.content,
        quotes.quotes,
        context.env.ANTHROPIC_API_KEY
      );

      if (!matchedQuote) {
        return {
          success: false,
          message: 'No matching quote found for content',
        };
      }

      // Generate and cache the quote image
      const imageKey = `images/${matchedQuote.id}.png`;
      let imageData = await context.env.R2.get(imageKey);

      if (!imageData) {
        console.log(`Generating quote image for ${matchedQuote.id}`);
        const generatedImage = await generateQuoteImage(matchedQuote);
        await context.env.R2.put(imageKey, generatedImage);
      }

      return {
        success: true,
        message: `Matched: "${matchedQuote.text.substring(0, 50)}..." by ${matchedQuote.author}`,
        data: {
          quoteId: matchedQuote.id,
          author: matchedQuote.author,
          book: matchedQuote.book,
          text: matchedQuote.text.substring(0, 100),
          imageKey,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Quote matching error: ${error}`,
      };
    }
  }
}
