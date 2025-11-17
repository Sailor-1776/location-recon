import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { runCli } from '../src/cli/reconcile.js';
describe('CLI e2e', () => {
    it('processes a text file and emits JSONL', async () => {
        const tmp = 'tmp_cli_output.jsonl';
        const originalWrite = process.stdout.write;
        const bufs = [];
        // Capture stdout
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        process.stdout.write = (chunk) => {
            bufs.push(chunk.toString());
            return true;
        };
        try {
            const code = await runCli([
                'node',
                'cli',
                '--input',
                'data/fixtures/texts/hospital_1.txt',
                '--format',
                'jsonl',
            ]);
            expect(code).toBe(0);
            const output = bufs.join('');
            const lines = output
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean);
            expect(lines.length).toBeGreaterThan(0);
            const obj = JSON.parse(lines[0]);
            expect(obj).toHaveProperty('parsed');
            expect(obj).toHaveProperty('match');
        }
        finally {
            // restore
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            process.stdout.write = originalWrite;
            try {
                await fs.unlink(tmp);
                // eslint-disable-next-line no-empty
            }
            catch { }
        }
    });
});
//# sourceMappingURL=cli.e2e.test.js.map