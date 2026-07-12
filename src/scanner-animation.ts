const width = 8;
const activeBlock = "🟦";
const inactiveBlock = "🔹";
const activeTerminalBlock = "\x1b[94m█\x1b[0m";
const inactiveTerminalBlock = "\x1b[2;36m░\x1b[0m";

export const scannerIntervalMs = 80;

const scannerHeads = [
  ...Array.from({ length: width }, (_, head) => head),
  ...Array.from({ length: 9 }, () => width - 1),
  ...Array.from({ length: width - 1 }, (_, index) => width - index - 2),
  ...Array.from({ length: 30 }, () => 0),
];

export const scannerFrames = scannerHeads.map((head) =>
  Array.from({ length: width }, (_, index) => (index === head ? activeBlock : inactiveBlock)).join(""),
);

export const terminalScannerFrames = scannerHeads.map((head) =>
  Array.from({ length: width }, (_, index) =>
    index === head ? activeTerminalBlock : inactiveTerminalBlock,
  ).join(""),
);
