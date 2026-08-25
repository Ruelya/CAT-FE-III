/** Incremental JSON-lines decoder for the engine's stdout stream. */

export interface JsonlDecoder {
  push(chunk: string): void;
  /** Bytes buffered without a trailing newline yet. */
  pending(): string;
}

export function createJsonlDecoder(
  onFrame: (frame: unknown) => void,
  onError?: (line: string, error: unknown) => void,
): JsonlDecoder {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          onFrame(JSON.parse(line));
        } catch (error) {
          onError?.(line, error);
        }
      }
    },
    pending() {
      return buffer;
    },
  };
}

export function encodeJsonlFrame(frame: unknown): string {
  return `${JSON.stringify(frame)}\n`;
}
