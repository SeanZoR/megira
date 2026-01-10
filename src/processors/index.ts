import type { ProcessorPlugin, ProcessingContext, Bindings } from './types';
import { QuotePlugin } from './plugins/quote';
import {
  getDraftedContent,
  markContentProcessing,
  markContentProcessed,
  markContentProcessingFailed,
} from '../notion';

// Register all processor plugins here
// Future plugins (memes, hashtags, etc.) can be added to this array
const plugins: ProcessorPlugin[] = [
  new QuotePlugin(),
  // new MemePlugin(),
  // new HashtagPlugin(),
];

export async function processDraftedContent(
  env: Bindings
): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    // Get all content with "Drafted" status
    const draftedContent = await getDraftedContent(
      env.NOTION_TOKEN,
      env.NOTION_DATABASE_ID
    );

    console.log(`Found ${draftedContent.length} drafted posts for processing`);

    for (const content of draftedContent) {
      // Mark as processing to prevent double-processing
      await markContentProcessing(env.NOTION_TOKEN, content.id);

      // Create processing context for this content
      const context: ProcessingContext = {
        content,
        env,
        log: [],
        results: {},
      };

      try {
        // Run each registered plugin
        for (const plugin of plugins) {
          if (await plugin.shouldRun(context)) {
            console.log(`Running ${plugin.name} on ${content.id}`);
            const result = await plugin.process(context);
            context.results[plugin.name] = result;
            context.log.push(
              `${plugin.name}: ${result.success ? '✓' : '✗'} ${result.message}`
            );
          } else {
            context.log.push(`${plugin.name}: skipped`);
          }
        }

        // Mark as processed with log
        await markContentProcessed(
          env.NOTION_TOKEN,
          content.id,
          context.log.join('\n'),
          context.results
        );
        processed++;
        console.log(`Processed content ${content.id}:`, context.log);
      } catch (error) {
        const errorMsg = `Processing failed: ${error}`;
        errors.push(`Content ${content.id}: ${errorMsg}`);
        await markContentProcessingFailed(env.NOTION_TOKEN, content.id, errorMsg);
        console.error(`Failed to process ${content.id}:`, error);
      }
    }
  } catch (error) {
    errors.push(`Main process error: ${error}`);
    console.error('Processor main error:', error);
  }

  return { processed, errors };
}
