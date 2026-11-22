import minimist from 'minimist';

export function parseArgs(argv: string[]) {
  return minimist(argv, {
    string: ['key', 'port', 'base-url'],
    boolean: ['http', 'help'],
    alias: { h: 'help', k: 'key', p: 'port' },
    default: { port: '3001' },
  });
}
