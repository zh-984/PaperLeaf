import bridge from '../desktop/word.cjs';
const { runWord } = bridge;
import path from 'node:path';
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', async () => {
  try {
    console.log(
      JSON.stringify(await runWord(JSON.parse(data), path.resolve('desktop/word-bridge.ps1'))),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
});
