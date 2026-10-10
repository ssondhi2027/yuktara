// Runs the program generator (src/lib/programGen.ts) on JSON from stdin:
//   {"input": {goal, experience, training_days, train_location}, "library": [...]}
// and prints the generated program as JSON. Used by backend/scripts/walkthrough.py
// so the end-to-end check exercises the same rules as the coach's builder.
//
//   node --experimental-strip-types --no-warnings scripts/generate-program.mts < answers.json

import { generateProgram } from '../src/lib/programGen.ts'

const chunks: Buffer[] = []
for await (const c of process.stdin) chunks.push(c as Buffer)
const { input, library } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
process.stdout.write(JSON.stringify(generateProgram(input, library)))
