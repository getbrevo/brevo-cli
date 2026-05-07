import * as readline from 'readline';

export function readHiddenInput(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let answered = false;

    // Mute output
    const stdout = process.stdout;

    process.stdout.write(`  ${prompt}`);

    // Override _writeToOutput to mask user keystrokes only
    // readline calls _writeToOutput for its own internal writes (prompt, question text)
    // as well as echoed user input — we suppress the internal writes and mask keystrokes
    let prompting = true;
    (rl as any)._writeToOutput = function (str: string) {
      if (prompting) return; // suppress readline's own prompt/question echo
      if (str.includes('\n') || str.includes('\r')) {
        stdout.write('\n');
      } else {
        stdout.write('*');
      }
    };

    // After readline finishes its internal setup, start masking user input
    process.nextTick(() => {
      prompting = false;
    });

    rl.question('', (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });

    rl.on('close', () => {
      if (!answered) {
        reject(new Error('readline was closed'));
      }
    });
  });
}
