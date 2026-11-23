import { parentPort, workerData } from 'node:worker_threads';
import { analyzeShell } from './shellAnalysis';

void analyzeShell(workerData as string).then(result => parentPort!.postMessage(result));
