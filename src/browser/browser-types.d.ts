/**
 * Minimal browser type declarations for code that runs in browser context via page.evaluate()
 * These are not the full DOM types - just enough to satisfy TypeScript for Playwright evaluate calls
 */

declare global {
  interface Element {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser globals need dynamic property access for page.evaluate() contexts
    [key: string]: any;
  }

  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser globals need dynamic property access for page.evaluate() contexts
    [key: string]: any;
  }

  interface Document {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser globals need dynamic property access for page.evaluate() contexts
    [key: string]: any;
  }

  const window: Window;
  const document: Document;
}

export {};
