const width = 8;
const activeBlock = "🟦";
const inactiveBlock = "🔹";

export const scannerIntervalMs = 80;

export const scannerFrames = [
  ...Array.from({ length: width }, (_, head) => head),
  ...Array.from({ length: 9 }, () => width - 1),
  ...Array.from({ length: width - 1 }, (_, index) => width - index - 2),
  ...Array.from({ length: 30 }, () => 0),
].map((head) =>
  Array.from({ length: width }, (_, index) => (index === head ? activeBlock : inactiveBlock)).join(""),
);
