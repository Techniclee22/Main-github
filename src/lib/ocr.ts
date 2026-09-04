import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;
let progressHandler: ((progress: OcrProgress) => void) | null = null;

export type OcrProgress = {
  status: string;
  progress: number;
};

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      logger: (message) => {
        if (
          progressHandler &&
          typeof message.progress === "number" &&
          message.status
        ) {
          progressHandler({
            status: String(message.status),
            progress: message.progress,
          });
        }
      },
    });
  }
  return workerPromise;
}

export async function recognizeImageText(
  source: File | Blob | HTMLCanvasElement | string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  progressHandler = onProgress ?? null;
  try {
    const worker = await getWorker();
    const result = await worker.recognize(source);
    return result.data.text?.trim() ?? "";
  } finally {
    progressHandler = null;
  }
}

export async function terminateOcrWorker() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
