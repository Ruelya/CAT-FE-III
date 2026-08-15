import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  PDF_IMPORT_OPTIONS_KEY,
  readPdfImportOptions,
} from "../lib/pdf-import-options";
import { ImportDocument } from "./ImportDocument";

afterEach(() => {
  localStorage.removeItem(PDF_IMPORT_OPTIONS_KEY);
});

describe("ImportDocument OCR options", () => {
  it("persists engine/mode/languages for the next batchImport", async () => {
    const user = userEvent.setup();
    render(
      <ImportDocument projectName="Scan job" onImport={() => undefined} />,
    );

    await user.selectOptions(screen.getByTestId("import-ocr-engine"), "mineru");
    await user.selectOptions(screen.getByTestId("import-ocr-mode"), "always");
    await user.clear(screen.getByTestId("import-ocr-languages"));
    await user.type(screen.getByTestId("import-ocr-languages"), "ch");

    expect(readPdfImportOptions()).toEqual({
      ocrEngine: "mineru",
      ocrMode: "always",
      ocrLanguages: "ch",
    });
  });
});
