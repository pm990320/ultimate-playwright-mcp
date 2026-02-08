/**
 * Minimal browser type declarations for code that runs in browser context via page.evaluate()
 * These are not the full DOM types - just enough to satisfy TypeScript for Playwright evaluate calls
 */

declare global {
  interface Element {
    [key: string]: any;
  }

  interface Window {
    [key: string]: any;
  }

  interface Document {
    [key: string]: any;
  }

  const window: Window;
  const document: Document;
}

export {};
