import type { NotionPost } from '../notion';

// Environment bindings from the worker
export interface Bindings {
  KV: KVNamespace;
  R2: R2Bucket;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  NOTION_SCHEDULE_DB_ID: string;
  ANTHROPIC_API_KEY: string;
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  X_ACCESS_TOKEN: string;
  X_REFRESH_TOKEN: string;
  LINKEDIN_ACCESS_TOKEN: string;
  TIMEZONE: string;
}

// Context passed to each processor plugin
export interface ProcessingContext {
  content: NotionPost;
  env: Bindings;
  log: string[];
  results: Record<string, ProcessingResult>;
}

// Result returned by each plugin
export interface ProcessingResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

// Interface that all processor plugins must implement
export interface ProcessorPlugin {
  // Unique name for this plugin
  name: string;

  // Determine if this plugin should run for the given content
  shouldRun(context: ProcessingContext): Promise<boolean>;

  // Execute the processing and return result
  process(context: ProcessingContext): Promise<ProcessingResult>;
}
