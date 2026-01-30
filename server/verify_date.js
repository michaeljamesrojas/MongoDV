const d1 = new Date("2025-10-16T15:57:15.305Z");
const d2 = new Date("2026-01-28T01:54:54.895Z");

const diff = d2 - d1;
const absDiff = Math.abs(diff);

const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
const hours = Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));
const seconds = Math.floor((absDiff % (1000 * 60)) / 1000);

console.log(`D1: ${d1.toISOString()}`);
console.log(`D2: ${d2.toISOString()}`);
console.log(`Diff ms: ${diff}`);
console.log(`Result: ${days}d ${hours}h ${minutes}m ${seconds}s`);
